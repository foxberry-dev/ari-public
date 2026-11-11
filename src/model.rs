use std::collections::{HashMap, HashSet};

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

#[derive(Clone, Debug, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Alternative {
    pub label: String,
    #[serde(default)]
    pub description: String,
    #[serde(default)]
    pub recommended: bool,
}

#[derive(Clone, Debug, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Question {
    pub id: String,
    pub title: String,
    pub question: String,
    #[serde(default)]
    pub rationale: String,
    #[serde(default)]
    pub assumption: bool,
    #[serde(default)]
    pub alternatives: Vec<Alternative>,
    #[serde(default)]
    pub depends_on: Vec<String>,
}

#[derive(Clone, Debug, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Answer {
    pub value: String,
    pub reason: String,
    pub at: i64,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct HistoryEntry {
    pub question_id: String,
    pub previous: Option<Answer>,
    pub answer: Answer,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct QuestionChange {
    pub previous: Question,
    pub proposed: Question,
    pub at: i64,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Proposal {
    pub id: String,
    pub base_revision: u64,
    pub message: String,
    pub questions: Vec<Question>,
    pub status: String,
    pub at: i64,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Workspace {
    pub id: String,
    pub title: String,
    pub description: String,
    pub revision: u64,
    pub updated_at: i64,
    pub questions: Vec<Question>,
    pub answers: HashMap<String, Answer>,
    pub needs_review: HashSet<String>,
    pub history: Vec<HistoryEntry>,
    #[serde(default)]
    pub question_history: Vec<QuestionChange>,
    pub proposals: Vec<Proposal>,
}

#[derive(Clone, Debug, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct CreateWorkspace {
    pub id: String,
    pub title: String,
    #[serde(default)]
    pub description: String,
    #[serde(default)]
    pub questions: Vec<Question>,
}

#[derive(Clone, Debug, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Action {
    pub expected_revision: u64,
    pub kind: ActionKind,
    #[serde(default)]
    pub question_id: Option<String>,
    #[serde(default)]
    pub value: String,
    #[serde(default)]
    pub reason: String,
    #[serde(default)]
    pub message: String,
    #[serde(default)]
    pub proposal_id: Option<String>,
}

#[derive(Clone, Debug, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub enum ActionKind {
    Answer,
    Request,
    AcceptProposal,
    RejectProposal,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentEvent {
    pub id: String,
    pub workspace_id: String,
    pub kind: String,
    pub question_id: Option<String>,
    pub message: String,
    pub snapshot: Workspace,
    pub created_at: i64,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Claim {
    pub event: AgentEvent,
    pub token: String,
    pub lease_until: i64,
}

#[derive(Clone, Debug, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Reply {
    pub event_id: String,
    pub token: String,
    pub expected_revision: u64,
    pub message: String,
    #[serde(default)]
    pub questions: Vec<Question>,
}

#[derive(Clone, Debug, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Propose {
    pub workspace_id: String,
    pub expected_revision: u64,
    pub message: String,
    pub questions: Vec<Question>,
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

pub fn validate_questions(questions: &[Question]) -> Result<(), String> {
    if questions.len() > 200 {
        return Err("A workspace supports at most 200 questions".into());
    }
    let mut ids = HashSet::new();
    for q in questions {
        if !valid_id(&q.id) || !ids.insert(q.id.as_str()) {
            return Err("Question IDs must be valid and unique".into());
        }
        validate_text(&q.title, "Title", true)?;
        validate_text(&q.question, "Question", true)?;
        validate_text(&q.rationale, "Rationale", false)?;
        if q.alternatives.len() > 20 {
            return Err("A question supports at most 20 alternatives".into());
        }
        let mut labels = HashSet::new();
        for alternative in &q.alternatives {
            validate_text(&alternative.label, "Alternative", true)?;
            validate_text(&alternative.description, "Alternative description", false)?;
            if !labels.insert(alternative.label.as_str()) {
                return Err("Alternative labels must be unique".into());
            }
        }
    }
    let by_id: HashMap<_, _> = questions.iter().map(|q| (q.id.as_str(), q)).collect();
    fn visit<'a>(
        id: &'a str,
        by_id: &HashMap<&'a str, &'a Question>,
        active: &mut HashSet<&'a str>,
        done: &mut HashSet<&'a str>,
    ) -> Result<(), String> {
        if done.contains(id) {
            return Ok(());
        }
        if !active.insert(id) {
            return Err("Dependencies must not contain cycles".into());
        }
        let q = by_id
            .get(id)
            .ok_or("Every dependency must name an existing question")?;
        let mut deps = HashSet::new();
        for dep in &q.depends_on {
            if !deps.insert(dep.as_str()) {
                return Err("Dependencies must be unique".into());
            }
            visit(dep, by_id, active, done)?;
        }
        active.remove(id);
        done.insert(id);
        Ok(())
    }
    let mut done = HashSet::new();
    for id in by_id.keys() {
        visit(id, &by_id, &mut HashSet::new(), &mut done)?;
    }
    Ok(())
}

pub fn merged_questions(
    existing: &[Question],
    changes: &[Question],
) -> Result<Vec<Question>, String> {
    let mut merged = existing.to_vec();
    let mut seen = HashSet::new();
    for q in changes {
        if !seen.insert(&q.id) {
            return Err("Proposal question IDs must be unique".into());
        }
        if let Some(index) = merged.iter().position(|old| old.id == q.id) {
            merged[index] = q.clone();
        } else {
            merged.push(q.clone());
        }
    }
    validate_questions(&merged)?;
    Ok(merged)
}

impl Workspace {
    pub fn affected_by(&self, id: &str) -> HashSet<String> {
        let mut found = HashSet::new();
        let mut frontier = vec![id.to_owned()];
        while let Some(current) = frontier.pop() {
            for q in &self.questions {
                if q.depends_on.contains(&current) && found.insert(q.id.clone()) {
                    frontier.push(q.id.clone());
                }
            }
        }
        found
    }
}
