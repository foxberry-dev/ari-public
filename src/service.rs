use crate::model::*;
use sqlx::{Connection, Row, SqliteConnection, sqlite::SqliteConnectOptions};
use std::{path::Path, sync::Arc};
use tokio::sync::{Mutex, broadcast};
use uuid::Uuid;

#[derive(Debug)]
pub enum Error {
    Invalid(String),
    Missing,
    Conflict(String),
    RevisionConflict(u64),
    Storage(anyhow::Error),
}
impl From<sqlx::Error> for Error {
    fn from(value: sqlx::Error) -> Self {
        Self::Storage(value.into())
    }
}
impl From<serde_json::Error> for Error {
    fn from(value: serde_json::Error) -> Self {
        Self::Storage(value.into())
    }
}
impl From<String> for Error {
    fn from(value: String) -> Self {
        Self::Invalid(value)
    }
}

#[derive(Clone)]
pub struct Service {
    db: Arc<Mutex<SqliteConnection>>,
    pub updates: broadcast::Sender<()>,
}

impl Service {
    pub async fn open(path: &Path) -> Result<Self, Error> {
        let options = SqliteConnectOptions::new()
            .filename(path)
            .create_if_missing(true)
            .journal_mode(sqlx::sqlite::SqliteJournalMode::Wal);
        let mut db = SqliteConnection::connect_with(&options).await?;
        sqlx::query(
            "CREATE TABLE IF NOT EXISTS workspaces (id TEXT PRIMARY KEY, document TEXT NOT NULL)",
        )
        .execute(&mut db)
        .await?;
        Ok(Self {
            db: Arc::new(Mutex::new(db)),
            updates: broadcast::channel(64).0,
        })
    }

    fn decode(document: &str) -> Result<Workspace, Error> {
        let mut workspace: Workspace = serde_json::from_str(document)?;
        workspace.import_legacy()?;
        Ok(workspace)
    }

    pub async fn list(&self) -> Result<Vec<Workspace>, Error> {
        let rows = sqlx::query("SELECT document FROM workspaces")
            .fetch_all(&mut *self.db.lock().await)
            .await?;
        let mut all = rows
            .into_iter()
            .map(|r| Self::decode(r.get("document")))
            .collect::<Result<Vec<_>, _>>()?;
        all.sort_by_key(|w| std::cmp::Reverse(w.updated_at));
        Ok(all)
    }

    async fn read(db: &mut SqliteConnection, id: &str) -> Result<Workspace, Error> {
        let row = sqlx::query("SELECT document FROM workspaces WHERE id=?")
            .bind(id)
            .fetch_optional(db)
            .await?
            .ok_or(Error::Missing)?;
        Self::decode(row.get("document"))
    }
    pub async fn get(&self, id: &str) -> Result<Workspace, Error> {
        Self::read(&mut *self.db.lock().await, id).await
    }
    async fn save(db: &mut SqliteConnection, w: &Workspace) -> Result<(), Error> {
        sqlx::query("INSERT INTO workspaces (id, document) VALUES (?, ?) ON CONFLICT(id) DO UPDATE SET document=excluded.document")
            .bind(&w.id).bind(serde_json::to_string(w)?).execute(db).await?;
        Ok(())
    }

    pub async fn create(&self, input: CreateWorkspace) -> Result<Workspace, Error> {
        if !valid_id(&input.id) {
            return Err(Error::Invalid("Invalid clarification ID".into()));
        }
        validate_text(&input.title, "Title", true)?;
        validate_text(&input.description, "Description", false)?;
        validate_graph(&input.graph)?;
        crate::related_links::validate(&input.links)?;
        validate_commit(&input.commit)?;
        let at = now();
        let w = Workspace {
            id: input.id,
            title: input.title,
            description: input.description,
            links: input.links,
            revision: 1,
            updated_at: at,
            commits: vec![GraphCommit {
                id: Uuid::new_v4().to_string(),
                revision: 1,
                at,
                metadata: input.commit,
                graph: input.graph,
            }],
            archive: Default::default(),
        };
        let mut db = self.db.lock().await;
        let mut tx = db.begin().await?;
        let exists: i64 = sqlx::query_scalar("SELECT count(*) FROM workspaces WHERE id=?")
            .bind(&w.id)
            .fetch_one(&mut *tx)
            .await?;
        if exists > 0 {
            return Err(Error::Conflict(
                "This clarification ID already exists".into(),
            ));
        }
        Self::save(&mut tx, &w).await?;
        tx.commit().await?;
        drop(db);
        let _ = self.updates.send(());
        Ok(w)
    }

    pub async fn publish(&self, input: PublishGraph) -> Result<Workspace, Error> {
        validate_graph(&input.graph)?;
        if let Some(links) = &input.links {
            crate::related_links::validate(links)?;
        }
        validate_commit(&input.commit)?;
        let mut db = self.db.lock().await;
        let mut tx = db.begin().await?;
        let mut w = Self::read(&mut tx, &input.workspace_id).await?;
        if w.revision != input.expected_revision {
            return Err(Error::RevisionConflict(w.revision));
        }
        crate::revision_validation::validate(
            &w.commits
                .last()
                .ok_or_else(|| Error::Invalid("Clarification has no current graph".into()))?
                .graph,
            &input.graph,
            &input.confirmed_changes,
        )?;
        if let Some(links) = input.links {
            w.links = links;
        }
        w.revision += 1;
        w.updated_at = now();
        w.commits.push(GraphCommit {
            id: Uuid::new_v4().to_string(),
            revision: w.revision,
            at: w.updated_at,
            metadata: input.commit,
            graph: input.graph,
        });
        Self::save(&mut tx, &w).await?;
        tx.commit().await?;
        drop(db);
        let _ = self.updates.send(());
        Ok(w)
    }
}
