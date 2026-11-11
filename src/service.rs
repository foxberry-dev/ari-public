use std::{path::Path, sync::Arc};

use serde::Serialize;
use sqlx::{Connection, Row, SqliteConnection, sqlite::SqliteConnectOptions};
use tokio::sync::{Mutex, Notify, broadcast};
use uuid::Uuid;

use crate::model::*;

#[derive(Debug)]
pub enum Error {
    Invalid(String),
    Missing,
    Conflict(String),
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
    wake: Arc<Notify>,
    listeners: Arc<Mutex<std::collections::HashMap<String, usize>>>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentStatus {
    pub waiting: usize,
    pub queued: i64,
    pub working: i64,
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
        sqlx::query("CREATE TABLE IF NOT EXISTS events (id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL, payload TEXT NOT NULL, created_at INTEGER NOT NULL, token TEXT, lease_until INTEGER NOT NULL DEFAULT 0, completed INTEGER NOT NULL DEFAULT 0)")
            .execute(&mut db).await?;
        sqlx::query("CREATE INDEX IF NOT EXISTS pending_events ON events (workspace_id, completed, created_at)").execute(&mut db).await?;
        Ok(Self {
            db: Arc::new(Mutex::new(db)),
            updates: broadcast::channel(64).0,
            wake: Arc::new(Notify::new()),
            listeners: Default::default(),
        })
    }

    pub async fn list(&self) -> Result<Vec<Workspace>, Error> {
        let rows = sqlx::query("SELECT document FROM workspaces")
            .fetch_all(&mut *self.db.lock().await)
            .await?;
        let mut all = rows
            .into_iter()
            .map(|r| serde_json::from_str::<Workspace>(r.get("document")))
            .collect::<Result<Vec<_>, _>>()?;
        all.sort_by_key(|w| std::cmp::Reverse(w.updated_at));
        Ok(all)
    }

    async fn read(db: &mut SqliteConnection, id: &str) -> Result<Workspace, Error> {
        let row = sqlx::query("SELECT document FROM workspaces WHERE id = ?")
            .bind(id)
            .fetch_optional(db)
            .await?
            .ok_or(Error::Missing)?;
        Ok(serde_json::from_str(row.get("document"))?)
    }

    pub async fn get(&self, id: &str) -> Result<Workspace, Error> {
        Self::read(&mut *self.db.lock().await, id).await
    }

    async fn save(db: &mut SqliteConnection, workspace: &Workspace) -> Result<(), Error> {
        sqlx::query("INSERT INTO workspaces (id, document) VALUES (?, ?) ON CONFLICT(id) DO UPDATE SET document=excluded.document")
            .bind(&workspace.id).bind(serde_json::to_string(workspace)?).execute(db).await?;
        Ok(())
    }

    fn changed(&self) {
        let _ = self.updates.send(());
        self.wake.notify_waiters();
    }

    async fn enqueue(
        db: &mut SqliteConnection,
        workspace: &Workspace,
        kind: &str,
        question_id: Option<String>,
        message: String,
    ) -> Result<(), Error> {
        let event = AgentEvent {
            id: Uuid::new_v4().to_string(),
            workspace_id: workspace.id.clone(),
            kind: kind.into(),
            question_id,
            message,
            snapshot: workspace.clone(),
            created_at: now(),
        };
        sqlx::query(
            "INSERT INTO events (id, workspace_id, payload, created_at) VALUES (?, ?, ?, ?)",
        )
        .bind(&event.id)
        .bind(&event.workspace_id)
        .bind(serde_json::to_string(&event)?)
        .bind(event.created_at)
        .execute(db)
        .await?;
        Ok(())
    }

    pub async fn create(&self, input: CreateWorkspace) -> Result<Workspace, Error> {
        if !valid_id(&input.id) {
            return Err(Error::Invalid("Invalid workspace ID".into()));
        }
        validate_text(&input.title, "Title", true)?;
        validate_text(&input.description, "Description", false)?;
        validate_questions(&input.questions)?;
        let workspace = Workspace {
            id: input.id,
            title: input.title,
            description: input.description,
            revision: 1,
            updated_at: now(),
            questions: input.questions,
            answers: Default::default(),
            needs_review: Default::default(),
            history: vec![],
            question_history: vec![],
            proposals: vec![],
        };
        let mut db = self.db.lock().await;
        let mut tx = db.begin().await?;
        let exists: i64 = sqlx::query_scalar("SELECT count(*) FROM workspaces WHERE id=?")
            .bind(&workspace.id)
            .fetch_one(&mut *tx)
            .await?;
        if exists > 0 {
            return Err(Error::Conflict("This workspace ID already exists".into()));
        }
        Self::save(&mut tx, &workspace).await?;
        Self::enqueue(
            &mut tx,
            &workspace,
            "created",
            None,
            "Develop the starting questions for this clarity workspace. Keep assumptions explicit."
                .into(),
        )
        .await?;
        tx.commit().await?;
        drop(db);
        self.changed();
        Ok(workspace)
    }

    fn check_revision(workspace: &Workspace, expected: u64) -> Result<(), Error> {
        if workspace.revision != expected {
            return Err(Error::Conflict(format!(
                "Workspace is at revision {}; refresh before writing",
                workspace.revision
            )));
        }
        Ok(())
    }

    pub async fn act(&self, id: &str, input: Action) -> Result<Workspace, Error> {
        validate_text(&input.value, "Answer", false)?;
        validate_text(&input.reason, "Reason", false)?;
        validate_text(&input.message, "Message", false)?;
        let mut db = self.db.lock().await;
        let mut tx = db.begin().await?;
        let mut workspace = Self::read(&mut tx, id).await?;
        Self::check_revision(&workspace, input.expected_revision)?;
        if let Some(ref question_id) = input.question_id
            && !workspace.questions.iter().any(|q| &q.id == question_id)
        {
            return Err(Error::Invalid("Question not found".into()));
        }
        let event = match input.kind {
            ActionKind::Answer => {
                validate_text(&input.value, "Answer", true)?;
                let question_id = input
                    .question_id
                    .clone()
                    .ok_or_else(|| Error::Invalid("Select a question".into()))?;
                let answer = Answer {
                    value: input.value,
                    reason: input.reason,
                    at: now(),
                };
                let previous = workspace
                    .answers
                    .insert(question_id.clone(), answer.clone());
                workspace.history.push(HistoryEntry {
                    question_id: question_id.clone(),
                    previous,
                    answer,
                });
                workspace.needs_review.remove(&question_id);
                workspace
                    .needs_review
                    .extend(workspace.affected_by(&question_id));
                Some((
                    "answer",
                    format!(
                        "The user answered {question_id}. Review its consequences and propose any useful follow-up questions."
                    ),
                ))
            }
            ActionKind::Request => {
                validate_text(&input.message, "Request", true)?;
                Some(("request", input.message))
            }
            ActionKind::AcceptProposal | ActionKind::RejectProposal => {
                let index = workspace
                    .proposals
                    .iter()
                    .position(|p| Some(&p.id) == input.proposal_id.as_ref())
                    .ok_or_else(|| Error::Invalid("Proposal not found".into()))?;
                let proposal = &workspace.proposals[index];
                if proposal.status != "pending" {
                    return Err(Error::Conflict("Proposal was already reviewed".into()));
                }
                if matches!(input.kind, ActionKind::AcceptProposal) {
                    if proposal.base_revision != workspace.revision {
                        return Err(Error::Conflict("This proposal is stale. Ask the agent to refresh it against the current answers.".into()));
                    }
                    let questions = merged_questions(&workspace.questions, &proposal.questions)?;
                    for q in &proposal.questions {
                        if let Some(previous) =
                            workspace.questions.iter().find(|old| old.id == q.id)
                        {
                            workspace.question_history.push(QuestionChange {
                                previous: previous.clone(),
                                proposed: q.clone(),
                                at: now(),
                            });
                        }
                        if workspace.answers.contains_key(&q.id) {
                            workspace.needs_review.insert(q.id.clone());
                        }
                        workspace.needs_review.extend(workspace.affected_by(&q.id));
                    }
                    workspace.questions = questions;
                    for q in &workspace.proposals[index].questions {
                        workspace.needs_review.extend(workspace.affected_by(&q.id));
                    }
                    workspace.proposals[index].status = "accepted".into();
                } else {
                    workspace.proposals[index].status = "rejected".into();
                }
                None
            }
        };
        workspace.revision += 1;
        workspace.updated_at = now();
        Self::save(&mut tx, &workspace).await?;
        if let Some((kind, message)) = event {
            Self::enqueue(&mut tx, &workspace, kind, input.question_id, message).await?;
        }
        tx.commit().await?;
        drop(db);
        self.changed();
        Ok(workspace)
    }

    fn add_proposal(
        workspace: &mut Workspace,
        message: String,
        questions: Vec<Question>,
    ) -> Result<(), Error> {
        validate_text(&message, "Agent reply", true)?;
        merged_questions(&workspace.questions, &questions)?;
        workspace.revision += 1;
        workspace.updated_at = now();
        workspace.proposals.push(Proposal {
            id: Uuid::new_v4().to_string(),
            base_revision: workspace.revision,
            message,
            questions,
            status: "pending".into(),
            at: now(),
        });
        Ok(())
    }

    pub async fn propose(&self, input: Propose) -> Result<Workspace, Error> {
        let mut db = self.db.lock().await;
        let mut tx = db.begin().await?;
        let mut workspace = Self::read(&mut tx, &input.workspace_id).await?;
        Self::check_revision(&workspace, input.expected_revision)?;
        Self::add_proposal(&mut workspace, input.message, input.questions)?;
        Self::save(&mut tx, &workspace).await?;
        tx.commit().await?;
        drop(db);
        self.changed();
        Ok(workspace)
    }

    async fn claim(&self, workspace_id: &str) -> Result<Option<Claim>, Error> {
        let mut db = self.db.lock().await;
        let mut tx = db.begin().await?;
        let row = sqlx::query("SELECT id, payload FROM events WHERE workspace_id=? AND completed=0 AND lease_until <= ? ORDER BY created_at, rowid LIMIT 1")
            .bind(workspace_id).bind(now()).fetch_optional(&mut *tx).await?;
        let Some(row) = row else {
            return Ok(None);
        };
        let token = Uuid::new_v4().to_string();
        let lease_until = now() + 120_000;
        let event: AgentEvent = serde_json::from_str(row.get("payload"))?;
        sqlx::query("UPDATE events SET token=?, lease_until=? WHERE id=?")
            .bind(&token)
            .bind(lease_until)
            .bind(&event.id)
            .execute(&mut *tx)
            .await?;
        tx.commit().await?;
        drop(db);
        self.changed();
        Ok(Some(Claim {
            event,
            token,
            lease_until,
        }))
    }

    pub async fn poll(&self, workspace_id: &str, seconds: u64) -> Result<Option<Claim>, Error> {
        self.get(workspace_id).await?;
        let deadline =
            tokio::time::Instant::now() + std::time::Duration::from_secs(seconds.min(25));
        loop {
            let notified = self.wake.notified();
            tokio::pin!(notified);
            notified.as_mut().enable();
            if let Some(claim) = self.claim(workspace_id).await? {
                return Ok(Some(claim));
            }
            if tokio::time::Instant::now() >= deadline {
                return Ok(None);
            }
            tokio::select! {
                _ = &mut notified => {},
                _ = tokio::time::sleep_until(deadline.min(tokio::time::Instant::now() + std::time::Duration::from_secs(2))) => {},
            }
        }
    }

    pub async fn reply(&self, input: Reply) -> Result<Workspace, Error> {
        let mut db = self.db.lock().await;
        let mut tx = db.begin().await?;
        let row = sqlx::query(
            "SELECT workspace_id, token, lease_until, completed FROM events WHERE id=?",
        )
        .bind(&input.event_id)
        .fetch_optional(&mut *tx)
        .await?
        .ok_or(Error::Missing)?;
        let token: Option<String> = row.get("token");
        if row.get::<i64, _>("completed") != 0
            || token.as_deref() != Some(&input.token)
            || row.get::<i64, _>("lease_until") <= now()
        {
            return Err(Error::Conflict(
                "Event lease expired, was reclaimed, or was already completed".into(),
            ));
        }
        let mut workspace = Self::read(&mut tx, row.get("workspace_id")).await?;
        Self::check_revision(&workspace, input.expected_revision)?;
        Self::add_proposal(&mut workspace, input.message, input.questions)?;
        Self::save(&mut tx, &workspace).await?;
        sqlx::query("UPDATE events SET completed=1, lease_until=0 WHERE id=?")
            .bind(&input.event_id)
            .execute(&mut *tx)
            .await?;
        tx.commit().await?;
        drop(db);
        self.changed();
        Ok(workspace)
    }

    pub async fn agent_status(&self, workspace_id: &str) -> Result<AgentStatus, Error> {
        let row = sqlx::query("SELECT COALESCE(SUM(CASE WHEN lease_until <= ? THEN 1 ELSE 0 END), 0) AS queued, COALESCE(SUM(CASE WHEN lease_until > ? THEN 1 ELSE 0 END), 0) AS working FROM events WHERE workspace_id=? AND completed=0")
            .bind(now()).bind(now()).bind(workspace_id).fetch_one(&mut *self.db.lock().await).await?;
        let waiting = self
            .listeners
            .lock()
            .await
            .get(workspace_id)
            .copied()
            .unwrap_or(0);
        Ok(AgentStatus {
            waiting,
            queued: row.get("queued"),
            working: row.get("working"),
        })
    }

    pub async fn listener_enter(&self, id: &str) {
        *self.listeners.lock().await.entry(id.into()).or_default() += 1;
        let _ = self.updates.send(());
    }

    pub async fn listener_leave(&self, id: &str) {
        let mut listeners = self.listeners.lock().await;
        if let Some(count) = listeners.get_mut(id) {
            *count = count.saturating_sub(1);
        }
        let _ = self.updates.send(());
    }
}
