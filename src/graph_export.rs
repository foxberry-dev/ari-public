use std::{process::Stdio, time::Duration};

use axum::http::StatusCode;
use serde::{Deserialize, Serialize};
use tokio::{
    io::{AsyncReadExt, AsyncWriteExt},
    process::Command,
    sync::Semaphore,
};

use crate::{
    model::{Graph, Workspace, valid_id},
    process_tree::ProcessTree,
};

static RENDERERS: Semaphore = Semaphore::const_new(2);
const LIMIT: usize = 32 * 1024 * 1024;

#[derive(Clone, Copy, Default, Deserialize, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum Format {
    #[default]
    Svg,
    Png,
    Pdf,
}
impl Format {
    pub fn extension(self) -> &'static str {
        match self {
            Self::Svg => "svg",
            Self::Png => "png",
            Self::Pdf => "pdf",
        }
    }
    pub fn mime(self) -> &'static str {
        match self {
            Self::Svg => "image/svg+xml",
            Self::Png => "image/png",
            Self::Pdf => "application/pdf",
        }
    }
}
#[derive(Clone, Copy, Default, Deserialize, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum Layout {
    #[default]
    Hierarchy,
    Islands,
    Rings,
}
impl Layout {
    fn label(self) -> &'static str {
        match self {
            Self::Hierarchy => "hierarchy",
            Self::Islands => "islands",
            Self::Rings => "rings",
        }
    }
}
#[derive(Clone, Copy, Default, Deserialize, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum Display {
    #[default]
    Current,
    Changed,
}
fn yes() -> bool {
    true
}
#[derive(Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Options {
    #[serde(default)]
    pub format: Format,
    pub revision: Option<u64>,
    #[serde(default)]
    pub layout: Layout,
    #[serde(default)]
    pub display: Display,
    #[serde(default = "yes")]
    pub inputs: bool,
    #[serde(default = "yes")]
    pub constraints: bool,
    pub selected: Option<String>,
}
#[derive(Serialize)]
struct Plan<'a> {
    title: &'a str,
    current: &'a Graph,
    previous: &'a Graph,
    options: &'a Options,
    #[serde(rename = "nodeIndex")]
    node_index: Vec<crate::model::NodeReference>,
}
pub struct Download {
    pub bytes: Vec<u8>,
    pub filename: String,
    pub mime: &'static str,
}
pub type ExportFailure = (StatusCode, &'static str);

pub async fn render(workspace: &Workspace, options: Options) -> Result<Download, ExportFailure> {
    let index = match options.revision {
        Some(revision) => workspace
            .commits
            .iter()
            .position(|c| c.revision == revision),
        None => workspace.commits.len().checked_sub(1),
    }
    .ok_or((StatusCode::NOT_FOUND, "Graph revision not found"))?;
    let commit = &workspace.commits[index];
    if commit.graph.edges.is_none() {
        return Err((
            StatusCode::BAD_REQUEST,
            "This historical revision has no typed relationships",
        ));
    }
    let empty = Graph {
        nodes: vec![],
        edges: Some(vec![]),
    };
    let previous = index
        .checked_sub(1)
        .map(|i| &workspace.commits[i].graph)
        .unwrap_or(&empty);
    if let Some(id) = &options.selected
        && (!valid_id(id)
            || !(commit.graph.nodes.iter().any(|n| &n.id == id)
                || matches!(options.display, Display::Changed)
                    && previous.nodes.iter().any(|n| &n.id == id)))
    {
        return Err((StatusCode::BAD_REQUEST, "Selected node not found"));
    }
    let _permit = RENDERERS.try_acquire().map_err(|_| {
        (
            StatusCode::SERVICE_UNAVAILABLE,
            "Graph renderer is busy; retry later",
        )
    })?;
    let payload = serde_json::to_vec(&Plan {
        title: &workspace.title,
        current: &commit.graph,
        previous,
        options: &options,
        node_index: workspace.node_index(),
    })
    .map_err(|_| {
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            "Cannot prepare graph export",
        )
    })?;
    let mut command = Command::new("node");
    command
        .args([
            "--input-type=module",
            "-e",
            include_str!("../frontend/dist/graph-export.mjs"),
        ])
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .kill_on_drop(true);
    let source_runtime = std::path::PathBuf::from(concat!(env!("CARGO_MANIFEST_DIR"), "/frontend"));
    if let Some(directory) = std::env::var_os("ARI_RENDERER_HOME")
        .map(std::path::PathBuf::from)
        .or_else(|| source_runtime.is_dir().then_some(source_runtime))
    {
        command.current_dir(directory);
    }
    #[cfg(unix)]
    {
        command.process_group(0);
    }
    let mut child = command.spawn().map_err(|_| {
        (
            StatusCode::SERVICE_UNAVAILABLE,
            "Node.js graph renderer is unavailable",
        )
    })?;
    let mut tree = ProcessTree { pid: child.id() };
    let mut stdin = child.stdin.take().unwrap();
    let stdout = child.stdout.take().unwrap();
    let stderr = child.stderr.take().unwrap();
    let work = async {
        let write = async move {
            stdin.write_all(&payload).await?;
            stdin.shutdown().await?;
            drop(stdin);
            Ok::<_, std::io::Error>(())
        };
        let read = async {
            let mut bytes = vec![];
            stdout
                .take(LIMIT as u64 + 1)
                .read_to_end(&mut bytes)
                .await?;
            if bytes.len() > LIMIT {
                return Err(std::io::Error::other("Graph export exceeds size limit"));
            }
            Ok(bytes)
        };
        let errors = async {
            let mut bytes = vec![];
            stderr.take(4096).read_to_end(&mut bytes).await.map(|_| ())
        };
        let (_, bytes, _, status) = tokio::try_join!(write, read, errors, child.wait())?;
        if !status.success() {
            return Err(std::io::Error::other("Graph renderer failed"));
        }
        Ok::<_, std::io::Error>(bytes)
    };
    let bytes = tokio::time::timeout(Duration::from_secs(30), work)
        .await
        .map_err(|_| (StatusCode::SERVICE_UNAVAILABLE, "Graph renderer timed out"))?
        .map_err(|_| {
            (
                StatusCode::SERVICE_UNAVAILABLE,
                "Graph renderer failed; PNG/PDF require Playwright Chromium",
            )
        })?;
    tree.pid = None;
    Ok(Download {
        bytes,
        filename: format!(
            "{}-r{}-{}.{}",
            workspace.id,
            commit.revision,
            options.layout.label(),
            options.format.extension()
        ),
        mime: options.format.mime(),
    })
}
