use std::collections::{BTreeMap, HashSet};

use schemars::JsonSchema;
use serde::{Deserialize, Serialize};

pub fn now() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as i64
}

pub fn valid_id(id: &str) -> bool {
    !id.is_empty()
        && id.len() <= 64
        && id
            .bytes()
            .all(|c| c.is_ascii_alphanumeric() || c == b'-' || c == b'_')
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Alternative {
    /// A competing answer to the same node question. Selected answers refer to this exact label.
    #[schemars(length(min = 1, max = 32768), regex(pattern = r"\S"))]
    pub label: String,
    /// Explain how this option differs from the others; plain text, at most 32 KiB UTF-8.
    #[serde(default)]
    #[schemars(length(max = 32768))]
    pub description: String,
    /// An agent recommendation, separate from the selected answer and from human confirmation.
    #[serde(default)]
    pub recommended: bool,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub enum NodeKind {
    Topic,
    #[serde(alias = "decision")]
    Decided,
    Assumption,
    #[schemars(skip)]
    Question,
    #[schemars(skip)]
    Forecast,
}

#[derive(Clone, Debug, PartialEq, Eq, Hash, Serialize, JsonSchema)]
#[serde(transparent)]
pub struct GroupLabel(
    #[schemars(
        length(min = 1, max = 64),
        regex(pattern = r"^[a-z][a-z0-9]*(?:-[a-z0-9]+){0,5}$")
    )]
    String,
);

impl GroupLabel {
    pub fn as_str(&self) -> &str {
        &self.0
    }
}

impl<'de> Deserialize<'de> for GroupLabel {
    fn deserialize<D: serde::Deserializer<'de>>(deserializer: D) -> Result<Self, D::Error> {
        let value = String::deserialize(deserializer)?;
        let words: Vec<_> = value.split('-').collect();
        if value.len() > 64
            || !value.starts_with(|c: char| c.is_ascii_lowercase())
            || words.len() > 6
            || words.iter().any(|word| {
                word.is_empty()
                    || !word
                        .bytes()
                        .all(|b| b.is_ascii_lowercase() || b.is_ascii_digit())
            })
        {
            return Err(serde::de::Error::custom(
                "groupLabel must be 1–64 characters, 1–6 lowercase words joined by single hyphens, starting with a letter; reuse the exact existing label, without spaces, underscores or punctuation",
            ));
        }
        Ok(Self(value))
    }
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct GraphNode {
    pub id: String,
    pub title: String,
    pub kind: NodeKind,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub group_label: Option<GroupLabel>,
    /// Concrete assumed answer or human-confirmed understanding, not a pending question.
    pub content: String,
    #[serde(default)]
    /// Stored annotation from older records; excluded from the public MCP authoring API.
    pub rationale: String,
    #[serde(default)]
    pub alternatives: Vec<Alternative>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    /// Exact selected alternative label. Required for assumptions; identifies the decided alternative when applicable.
    pub selected_alternative: Option<String>,
    #[serde(default)]
    #[schemars(skip)]
    pub depends_on: Vec<String>,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Graph {
    pub nodes: Vec<GraphNode>,
    /// Complete parent, input, and constraint relationships for this snapshot. Every publication supplies an array.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[schemars(with = "Vec<crate::relationships::GraphEdge>", !default, required)]
    pub edges: Option<Vec<crate::relationships::GraphEdge>>,
}

#[derive(Clone, Debug, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub enum CommitKind {
    TopicStaged,
    DirectAnswer,
    OpenDiscussion,
    FollowUpQuestion,
    RevisedDecision,
    ForecastUpdated,
    GraphUpdated,
    Imported,
}

#[derive(Clone, Debug, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct CommitMetadata {
    pub title: String,
    pub kind: CommitKind,
    #[serde(default)]
    /// Stored metadata from older records; excluded from public MCP authoring and reads.
    pub summary: String,
    #[serde(default)]
    /// Stored excerpt from older records; excluded from public MCP authoring and reads.
    pub source: String,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GraphCommit {
    pub id: String,
    pub revision: u64,
    pub at: i64,
    pub metadata: CommitMetadata,
    pub graph: Graph,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Workspace {
    pub id: String,
    pub title: String,
    pub description: String,
    pub revision: u64,
    pub updated_at: i64,
    #[serde(default)]
    pub commits: Vec<GraphCommit>,
    #[serde(default)]
    pub links: Vec<crate::related_links::RelatedLink>,
    #[serde(flatten)]
    pub archive: BTreeMap<String, serde_json::Value>,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct NodeReference {
    pub number: usize,
    pub id: String,
    pub reference: String,
}

impl Workspace {
    pub fn node_index(&self) -> Vec<NodeReference> {
        let mut ids = Vec::new();
        let mut seen = HashSet::new();
        if let Some(first) = self
            .commits
            .iter()
            .find(|commit| !commit.graph.nodes.is_empty())
        {
            let children: HashSet<_> = first
                .graph
                .edges
                .iter()
                .flatten()
                .filter_map(|edge| match edge {
                    crate::relationships::GraphEdge::Parent { to, .. } => Some(to.as_str()),
                    _ => None,
                })
                .collect();
            if let Some(root) =
                first.graph.nodes.iter().find(|node| {
                    node.kind == NodeKind::Topic && !children.contains(node.id.as_str())
                })
            {
                ids.push(root.id.clone());
                seen.insert(root.id.clone());
            }
        }
        for commit in &self.commits {
            for node in &commit.graph.nodes {
                if seen.insert(node.id.clone()) {
                    ids.push(node.id.clone());
                }
            }
        }
        ids.into_iter()
            .enumerate()
            .map(|(index, id)| NodeReference {
                number: index + 1,
                reference: format!("ari@{}@{id}", self.id),
                id,
            })
            .collect()
    }
}

#[derive(Clone, Debug, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct CreateWorkspace {
    pub id: String,
    pub title: String,
    #[serde(default)]
    pub description: String,
    #[serde(default)]
    pub links: Vec<crate::related_links::RelatedLink>,
    pub graph: Graph,
    pub commit: CommitMetadata,
}

#[derive(Clone, Debug, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct PublishGraph {
    pub workspace_id: String,
    pub expected_revision: u64,
    #[serde(default)]
    pub links: Option<Vec<crate::related_links::RelatedLink>>,
    pub graph: Graph,
    pub commit: CommitMetadata,
    #[serde(default)]
    pub confirmed_changes: Vec<String>,
}

pub fn validate_text(value: &str, label: &str, required: bool) -> Result<(), String> {
    if value.len() > 32_768 || (required && value.trim().is_empty()) {
        return Err(format!(
            "{label} must {}fit within 32 KiB",
            if required { "be nonblank and " } else { "" }
        ));
    }
    Ok(())
}

pub fn validate_commit(commit: &CommitMetadata) -> Result<(), String> {
    validate_text(&commit.title, "commit.title", true)?;
    validate_text(&commit.summary, "commit.summary", false)?;
    validate_text(&commit.source, "commit.source", false)
}

pub fn validate_graph(graph: &Graph) -> Result<(), String> {
    if graph.nodes.len() > 200 {
        return Err("graph.nodes supports at most 200 nodes".into());
    }
    if serde_json::to_vec(graph).map_err(|e| e.to_string())?.len() > 1_048_576 {
        return Err("graph must fit within 1 MiB of JSON".into());
    }
    let mut ids = HashSet::new();
    let mut group_counts = std::collections::BTreeMap::new();
    for (index, n) in graph.nodes.iter().enumerate() {
        if !valid_id(&n.id) {
            return Err(format!(
                "graph.nodes[{index}].id must contain 1–64 ASCII letters, digits, underscores, or hyphens"
            ));
        }
        if !ids.insert(n.id.as_str()) {
            return Err(format!(
                "graph.nodes[{index}].id duplicates node {:?}; reuse one node per distinct question",
                n.id
            ));
        }
        let path = format!("graph.nodes[{index}] (node {:?})", n.id);
        if let Some(label) = &n.group_label {
            if n.kind == NodeKind::Topic {
                return Err(format!(
                    "{path}.groupLabel: omit on topic nodes; groups collect related decisions, not the shared subject"
                ));
            }
            *group_counts.entry(label.as_str()).or_insert(0usize) += 1;
        }
        validate_text(&n.title, &format!("{path}.title"), true)?;
        validate_text(
            &n.content,
            &format!("{path}.content"),
            matches!(n.kind, NodeKind::Assumption | NodeKind::Decided),
        )?;
        validate_text(&n.rationale, &format!("{path}.rationale"), false)?;
        if matches!(n.kind, NodeKind::Question | NodeKind::Forecast) {
            return Err(format!(
                "{path}.kind must be topic, decided, or assumption; put the question in title and its concrete answer in content"
            ));
        }
        if n.kind == NodeKind::Assumption && n.alternatives.len() < 2 {
            return Err(format!(
                "{path}.alternatives must offer at least two competing answers for an assumption; select one with selectedAlternative"
            ));
        }
        if n.alternatives.len() > 20 {
            return Err(format!("{path}.alternatives supports at most 20 options"));
        }
        let mut labels = HashSet::new();
        for (alternative_index, a) in n.alternatives.iter().enumerate() {
            let alternative_path = format!("{path}.alternatives[{alternative_index}]");
            validate_text(&a.label, &format!("{alternative_path}.label"), true)?;
            validate_text(
                &a.description,
                &format!("{alternative_path}.description"),
                false,
            )?;
            if !labels.insert(a.label.as_str()) {
                return Err(format!(
                    "{alternative_path}.label duplicates {:?}; alternative labels must be unique within this node",
                    a.label
                ));
            }
        }
        if let Some(selected) = &n.selected_alternative {
            if !n.alternatives.iter().any(|a| &a.label == selected) {
                return Err(format!(
                    "{path}.selectedAlternative must match an exact alternatives[].label on this node"
                ));
            }
        } else if n.kind == NodeKind::Assumption {
            return Err(format!(
                "{path}.selectedAlternative is required for an assumption; choose an exact alternatives[].label"
            ));
        }
    }
    for (label, count) in group_counts {
        if count < 2 {
            return Err(format!(
                "groupLabel {label:?} has only one member; omit it or assign the exact label to at least two genuinely related non-topic nodes"
            ));
        }
    }
    let edges = graph.edges.as_deref().ok_or(
        "graph.edges is required for every publication; use an empty array for an empty graph",
    )?;
    crate::relationships::validate(&graph.nodes, edges)
}

impl Workspace {
    pub fn import_legacy(&mut self) -> Result<(), String> {
        if !self.commits.is_empty() {
            return Ok(());
        }
        let mut nodes = Vec::new();
        if let Some(questions) = self.archive.get("questions").and_then(|v| v.as_array()) {
            for q in questions {
                let id = q["id"]
                    .as_str()
                    .ok_or("Stored question is missing its ID")?
                    .to_owned();
                let answer = self.archive.get("answers").and_then(|a| a.get(&id));
                let reason = answer
                    .and_then(|a| a["reason"].as_str())
                    .unwrap_or_default();
                let rationale = q["rationale"].as_str().unwrap_or_default();
                nodes.push(GraphNode {
                    group_label: None,
                    id,
                    title: q["title"].as_str().unwrap_or_default().into(),
                    kind: if answer.is_some() {
                        NodeKind::Decided
                    } else {
                        NodeKind::Question
                    },
                    content: answer
                        .and_then(|a| a["value"].as_str())
                        .or_else(|| q["question"].as_str())
                        .unwrap_or_default()
                        .into(),
                    rationale: if reason.is_empty() {
                        rationale.into()
                    } else {
                        format!("{rationale}\n\nRecorded reason: {reason}")
                    },
                    alternatives: serde_json::from_value(
                        q.get("alternatives")
                            .cloned()
                            .unwrap_or(serde_json::json!([])),
                    )
                    .map_err(|e| e.to_string())?,
                    selected_alternative: None,
                    depends_on: serde_json::from_value(
                        q.get("dependsOn").cloned().unwrap_or(serde_json::json!([])),
                    )
                    .map_err(|e| e.to_string())?,
                });
            }
        }
        self.commits.push(GraphCommit {
            id: format!("baseline-{}", self.revision), revision: self.revision, at: self.updated_at,
            metadata: CommitMetadata { title: "Existing clarification".into(), kind: CommitKind::Imported, summary: "Baseline graph. Earlier answers, alternatives, rationale, proposals, and history remain preserved in the clarification record.".into(), source: String::new() },
            graph: Graph { nodes, edges: None },
        });
        Ok(())
    }
}
