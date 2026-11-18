use schemars::JsonSchema;
use serde::{Deserialize, Deserializer};
use serde_json::Value;

use crate::model::{
    Alternative, CommitKind, CommitMetadata, CreateWorkspace, Graph, GraphNode, GroupLabel,
    NodeKind, PublishGraph, valid_id, validate_graph, validate_text,
};
use crate::related_links::RelatedLink;
use crate::relationships::GraphEdge;

#[derive(Clone, Debug, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct PublicationAlternative {
    /// Stable option identity, referenced by selectedAlternative and constraint participants. Not displayed as answer text.
    #[schemars(length(min = 1, max = 32768), regex(pattern = r"\S"))]
    pub id: String,
    /// The complete answer in one text. No separate short label or description. May wrap across lines.
    #[schemars(length(min = 1, max = 32768), regex(pattern = r"\S"))]
    pub text: String,
    /// Advice only; does not imply selection or human confirmation.
    #[serde(default)]
    pub recommended: bool,
}

impl From<PublicationAlternative> for Alternative {
    fn from(option: PublicationAlternative) -> Self {
        Self {
            label: option.id,
            description: option.text,
            recommended: option.recommended,
        }
    }
}

#[derive(Clone, Debug, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct CreateClarification {
    /// Stable clarification slug, 1–64 ASCII letters, digits, underscores or hyphens.
    #[schemars(length(min = 1, max = 64), regex(pattern = r"^[A-Za-z0-9_-]+$"))]
    pub id: String,
    /// Human-readable subject of this clarification. Nonblank plain text, at most 32 KiB UTF-8.
    #[schemars(length(min = 1, max = 32768), regex(pattern = r"\S"))]
    pub title: String,
    /// Brief purpose or scope. Plain text, at most 32 KiB UTF-8.
    #[serde(default)]
    #[schemars(length(max = 32768))]
    pub description: String,
    /// Ordered clarification-wide references. Add reciprocal Ari/Esi/Lain viewer links for related work. At most 50; omit or use [] when none.
    #[serde(default)]
    #[schemars(length(max = 50))]
    pub links: Vec<RelatedLink>,
    /// Complete initial state. Use stable node and edge IDs; never publish a partial patch.
    pub graph: PublicationGraph,
    /// Why this initial state is being recorded. The server assigns revision 1 and its timestamp.
    pub commit: PublicationCommit,
}

#[derive(Clone, Debug, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct PublishRevision {
    /// Stable clarification ID from get_context or get_clarification, without the ari@ prefix.
    #[schemars(length(min = 1, max = 64), regex(pattern = r"^[A-Za-z0-9_-]+$"))]
    pub clarification_id: String,
    /// Latest revision returned by get_clarification. Read again after a conflict or unknown write outcome.
    #[schemars(range(min = 1))]
    pub expected_revision: u64,
    /// Replace clarification-wide references, including reciprocal Ari/Esi/Lain viewer links. Omit to preserve; [] clears them. At most 50; never null.
    #[serde(default, deserialize_with = "optional_links")]
    #[schemars(with = "Vec<RelatedLink>", length(max = 50))]
    pub links: Option<Vec<RelatedLink>>,
    /// Complete replacement state, including every retained node, edge and alternative. Omission removes a node or edge from this revision; earlier snapshots stay immutable.
    pub graph: PublicationGraph,
    /// One conversation turn or coherent update that explains this snapshot. Never invent human statements.
    pub commit: PublicationCommit,
    /// Stable IDs of previously confirmed nodes intentionally revised, reopened as assumptions or removed by this update. Read the current graph first; list only deliberate changes supported by the discussion. Omit or use [] when confirmed answers are preserved. These acknowledgements do not themselves change the graph.
    #[serde(default)]
    #[schemars(length(max = 200), inner(length(min = 1, max = 64), regex(pattern = r"^[A-Za-z0-9_-]+$")), extend("uniqueItems" = true))]
    pub confirmed_changes: Vec<String>,
}

#[derive(Clone, Debug, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct PublicationGraph {
    /// Complete set of current nodes. Preserve IDs when an assumption becomes decided. At most 200 nodes; [] is an empty graph.
    #[schemars(length(max = 200))]
    pub nodes: Vec<PublicationNode>,
    /// Complete typed relationships, always present. Parent edges form one tree rooted at a topic; input edges are independently acyclic. Use [] for an empty graph. At most 1000 edges; the complete graph must fit within 1 MiB UTF-8 JSON.
    #[schemars(length(max = 1000))]
    pub edges: Vec<GraphEdge>,
}

#[derive(Clone, Debug, Deserialize, JsonSchema)]
#[serde(
    tag = "kind",
    rename_all = "camelCase",
    rename_all_fields = "camelCase",
    deny_unknown_fields
)]
pub enum PublicationNode {
    /// Frames the subject rather than recording a human answer or agent guess. The single parent-tree root must be a topic.
    Topic {
        /// Stable identity, 1–64 ASCII letters, digits, underscores or hyphens. Reuse it in every retained snapshot.
        #[schemars(length(min = 1, max = 64), regex(pattern = r"^[A-Za-z0-9_-]+$"))]
        id: String,
        /// Short subject label. Nonblank plain text, at most 32 KiB UTF-8.
        #[schemars(length(min = 1, max = 32768), regex(pattern = r"\S"))]
        title: String,
        /// Brief framing of the shared subject. Plain text, at most 32 KiB UTF-8; do not put a pending answer here.
        #[schemars(length(max = 32768))]
        content: String,
        /// Usually omit on the root topic: alternatives belong to the specific question they answer. At most 20 choices.
        #[serde(default)]
        #[schemars(length(max = 20))]
        alternatives: Vec<PublicationAlternative>,
        /// Exact option ID from this node's alternatives when a choice is applicable. Omit when no choice is recorded; never use null.
        #[serde(
            default,
            skip_serializing_if = "Option::is_none",
            deserialize_with = "optional_selection"
        )]
        #[schemars(with = "String", length(min = 1, max = 32768), regex(pattern = r"\S"))]
        selected_alternative: Option<String>,
    },
    /// A human-supported answer or a conclusion directly entailed by confirmed inputs. Never use this kind for an agent's unconfirmed guess.
    Decided {
        /// Stable identity of this question. Keep the existing assumption's ID when confirming its answer.
        #[schemars(length(min = 1, max = 64), regex(pattern = r"^[A-Za-z0-9_-]+$"))]
        id: String,
        /// Optional meaningful visual group shared by at least two related non-topic nodes. Reuse an exact existing label: 1–6 lowercase words joined by hyphens, at most 64 characters (e.g. food-pickup). Omit when grouping adds no useful distinction. Independent of parent links; the viewer displays Food pickup, without punctuation. Never use null, spaces, underscores, a copied question title, status labels, or generic grouping words such as group or collection.
        #[serde(default, deserialize_with = "optional_group_label")]
        #[schemars(with = "GroupLabel")]
        group_label: Option<GroupLabel>,
        /// Short question or decision label. Nonblank plain text, at most 32 KiB UTF-8.
        #[schemars(length(min = 1, max = 32768), regex(pattern = r"\S"))]
        title: String,
        /// Free-text confirmed answer when no option is selected. Omit when selectedAlternative supplies the answer.
        #[serde(default)]
        #[schemars(length(max = 32768))]
        content: String,
        /// Materially different directions that remain relevant to this question. Retain useful options and remove obsolete ones when the discussion changes scope; free-text answers do not require invented alternatives. At most 20 choices.
        #[serde(default)]
        #[schemars(length(max = 20))]
        alternatives: Vec<PublicationAlternative>,
        /// Exact option ID of the decided alternative when applicable. Detailed content must agree with this option. Omit for a free-text answer; never use null.
        #[serde(
            default,
            skip_serializing_if = "Option::is_none",
            deserialize_with = "optional_selection"
        )]
        #[schemars(with = "String", length(min = 1, max = 32768), regex(pattern = r"\S"))]
        selected_alternative: Option<String>,
    },
    /// A concrete provisional agent answer that the human has not confirmed. Choose one direction instead of publishing an unanswered question.
    Assumption {
        /// Stable identity of this question. Keep it when revising the assumption or confirming it as decided.
        #[schemars(length(min = 1, max = 64), regex(pattern = r"^[A-Za-z0-9_-]+$"))]
        id: String,
        /// Optional meaningful visual group shared by at least two related non-topic nodes. Reuse an exact existing label: 1–6 lowercase words joined by hyphens, at most 64 characters (e.g. food-pickup). Omit when grouping adds no useful distinction. Independent of parent links; the viewer displays Food pickup, without punctuation. Never use null, spaces, underscores, a copied question title, status labels, or generic grouping words such as group or collection.
        #[serde(default, deserialize_with = "optional_group_label")]
        #[schemars(with = "GroupLabel")]
        group_label: Option<GroupLabel>,
        /// The question or decision being explored. Nonblank plain text, at most 32 KiB UTF-8.
        #[schemars(length(min = 1, max = 32768), regex(pattern = r"\S"))]
        title: String,
        /// Omit when selectedAlternative supplies the answer. If provided, must equal the selected option text.
        #[serde(default)]
        #[schemars(length(max = 32768))]
        content: String,
        /// 2–20 materially different answers to this question, usually 2–4. Option IDs must be unique within this node.
        #[schemars(length(min = 2, max = 20))]
        alternatives: Vec<PublicationAlternative>,
        /// Exact option ID of one of this node's alternatives. This is the agent's provisional choice, not human approval; content must agree with it.
        #[schemars(length(min = 1, max = 32768), regex(pattern = r"\S"))]
        selected_alternative: String,
    },
}

fn optional_links<'de, D: Deserializer<'de>>(
    deserializer: D,
) -> Result<Option<Vec<RelatedLink>>, D::Error> {
    Vec::<RelatedLink>::deserialize(deserializer).map(Some)
}

fn optional_group_label<'de, D: Deserializer<'de>>(
    deserializer: D,
) -> Result<Option<GroupLabel>, D::Error> {
    GroupLabel::deserialize(deserializer).map(Some)
}

fn optional_selection<'de, D: Deserializer<'de>>(
    deserializer: D,
) -> Result<Option<String>, D::Error> {
    String::deserialize(deserializer).map(Some)
}

#[derive(Clone, Debug, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct PublicationCommit {
    /// Short title of this coherent update, usually 2–4 words. Nonblank plain text, at most 32 KiB UTF-8.
    #[schemars(length(min = 1, max = 32768), regex(pattern = r"\S"))]
    pub title: String,
    /// Classify the conversation/update, not an individual node's status or a visual layout.
    pub kind: PublicationCommitKind,
}

#[derive(Clone, Debug, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub enum PublicationCommitKind {
    /// Introduce the shared subject and a small set of provisional starting questions and answers.
    TopicStaged,
    /// Record a human's direct answer, including any other conclusions entailed by that answer.
    DirectAnswer,
    /// Record a discussion that develops several connected questions or choices in one update.
    OpenDiscussion,
    /// Record an explicit revision, reopening or removal of previously confirmed understanding; acknowledge affected node IDs in confirmedChanges.
    RevisedDecision,
    /// Develop the graph's provisional detail or relationships without inventing a human statement or approval.
    GraphUpdated,
}

fn text(value: &str, path: &str, required: bool) -> Result<(), String> {
    validate_text(value, path, required)
}

fn id(value: &str, path: &str) -> Result<(), String> {
    if valid_id(value) {
        Ok(())
    } else {
        Err(format!(
            "{path}: expected 1–64 ASCII letters, digits, underscores or hyphens"
        ))
    }
}

impl CreateClarification {
    pub fn validate(&self) -> Result<(), String> {
        id(&self.id, "id")?;
        text(&self.title, "title", true)?;
        text(&self.description, "description", false)?;
        self.graph.validate()?;
        crate::related_links::validate(&self.links)?;
        self.commit.validate()
    }
}

impl PublishRevision {
    pub fn validate(&self) -> Result<(), String> {
        id(&self.clarification_id, "clarificationId")?;
        if self.expected_revision == 0 {
            return Err("expectedRevision: expected the latest revision, starting at 1".into());
        }
        self.graph.validate()?;
        if let Some(links) = &self.links {
            crate::related_links::validate(links)?;
        }
        self.commit.validate()?;
        if self.confirmed_changes.len() > 200 {
            return Err("confirmedChanges: expected at most 200 declarations".into());
        }
        let mut seen = std::collections::HashSet::new();
        for (index, node_id) in self.confirmed_changes.iter().enumerate() {
            id(node_id, &format!("confirmedChanges[{index}]"))?;
            if !seen.insert(node_id) {
                return Err(format!(
                    "confirmedChanges[{index}]: duplicate node ID {node_id:?}"
                ));
            }
        }
        Ok(())
    }
}

impl PublicationGraph {
    pub fn validate(&self) -> Result<(), String> {
        for (index, node) in self.nodes.iter().enumerate() {
            let (content, alternatives, selected) = match node {
                PublicationNode::Topic {
                    content,
                    alternatives,
                    selected_alternative,
                    ..
                }
                | PublicationNode::Decided {
                    content,
                    alternatives,
                    selected_alternative,
                    ..
                } => (content, alternatives, selected_alternative.as_deref()),
                PublicationNode::Assumption {
                    content,
                    alternatives,
                    selected_alternative,
                    ..
                } => (content, alternatives, Some(selected_alternative.as_str())),
            };
            for (option_index, option) in alternatives.iter().enumerate() {
                text(
                    &option.text,
                    &format!("graph.nodes[{index}].alternatives[{option_index}].text"),
                    true,
                )?;
            }
            if let Some(option) =
                selected.and_then(|id| alternatives.iter().find(|option| option.id == id))
                && !content.is_empty()
                && content != &option.text
            {
                return Err(format!(
                    "graph.nodes[{index}].content: omit when selectedAlternative supplies the answer, or use exactly its text"
                ));
            }
        }
        validate_graph(&self.clone().into()).map_err(|error| {
            error
                .replace(".label", ".id")
                .replace(".description", ".text")
        })
    }
}

impl PublicationCommit {
    pub fn validate(&self) -> Result<(), String> {
        text(&self.title, "commit.title", true)
    }
}

impl From<CreateClarification> for CreateWorkspace {
    fn from(input: CreateClarification) -> Self {
        Self {
            id: input.id,
            title: input.title,
            description: input.description,
            links: input.links,
            graph: input.graph.into(),
            commit: input.commit.into(),
        }
    }
}

impl From<PublishRevision> for PublishGraph {
    fn from(input: PublishRevision) -> Self {
        Self {
            workspace_id: input.clarification_id,
            expected_revision: input.expected_revision,
            links: input.links,
            graph: input.graph.into(),
            commit: input.commit.into(),
            confirmed_changes: input.confirmed_changes,
        }
    }
}

impl From<PublicationGraph> for Graph {
    fn from(graph: PublicationGraph) -> Self {
        Self {
            nodes: graph.nodes.into_iter().map(Into::into).collect(),
            edges: Some(graph.edges),
        }
    }
}

fn option_content(
    content: String,
    alternatives: &[PublicationAlternative],
    selected: Option<&str>,
) -> String {
    selected
        .and_then(|id| alternatives.iter().find(|option| option.id == id))
        .map_or(content, |option| option.text.clone())
}

impl From<PublicationNode> for GraphNode {
    fn from(node: PublicationNode) -> Self {
        match node {
            PublicationNode::Topic {
                id,
                title,
                content,
                alternatives,
                selected_alternative,
            } => Self {
                id,
                title,
                kind: NodeKind::Topic,
                group_label: None,
                content: option_content(content, &alternatives, selected_alternative.as_deref()),
                rationale: String::new(),
                alternatives: alternatives.into_iter().map(Into::into).collect(),
                selected_alternative,
                depends_on: vec![],
            },
            PublicationNode::Decided {
                group_label,
                id,
                title,
                content,
                alternatives,
                selected_alternative,
            } => Self {
                id,
                title,
                kind: NodeKind::Decided,
                group_label,
                content: option_content(content, &alternatives, selected_alternative.as_deref()),
                rationale: String::new(),
                alternatives: alternatives.into_iter().map(Into::into).collect(),
                selected_alternative,
                depends_on: vec![],
            },
            PublicationNode::Assumption {
                group_label,
                id,
                title,
                content,
                alternatives,
                selected_alternative,
            } => Self {
                id,
                title,
                kind: NodeKind::Assumption,
                group_label,
                content: option_content(content, &alternatives, Some(&selected_alternative)),
                rationale: String::new(),
                alternatives: alternatives.into_iter().map(Into::into).collect(),
                selected_alternative: Some(selected_alternative),
                depends_on: vec![],
            },
        }
    }
}

impl From<PublicationCommit> for CommitMetadata {
    fn from(commit: PublicationCommit) -> Self {
        Self {
            title: commit.title,
            kind: match commit.kind {
                PublicationCommitKind::TopicStaged => CommitKind::TopicStaged,
                PublicationCommitKind::DirectAnswer => CommitKind::DirectAnswer,
                PublicationCommitKind::OpenDiscussion => CommitKind::OpenDiscussion,
                PublicationCommitKind::RevisedDecision => CommitKind::RevisedDecision,
                PublicationCommitKind::GraphUpdated => CommitKind::GraphUpdated,
            },
            summary: String::new(),
            source: String::new(),
        }
    }
}

pub fn graph_for_agent(graph: &Graph) -> Value {
    let nodes: Vec<_> = graph.nodes.iter().map(|node| {
        let mut value = serde_json::json!({ "id": node.id, "title": node.title, "kind": node.kind,
            "content": node.content, "alternatives": node.alternatives.iter().map(|option| serde_json::json!({
                "id": option.label,
                "text": if node.selected_alternative.as_ref() == Some(&option.label) { &node.content } else if !option.description.is_empty() { &option.description } else { &option.label },
                "recommended": option.recommended
            })).collect::<Vec<_>>() });
        if let Some(label) = &node.group_label {
            value["groupLabel"] = serde_json::json!(label);
        }
        if let Some(selected) = &node.selected_alternative {
            value["selectedAlternative"] = serde_json::json!(selected);
        }
        value
    }).collect();
    serde_json::json!({ "nodes": nodes, "edges": graph.edges })
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn selected_option_supplies_the_answer_and_corrections_require_acknowledgment() {
        let input = json!({"nodes":[
            {"id":"topic","title":"Smoothie","kind":"topic","content":"Plan a smoothie."},
            {"id":"protein","title":"Main protein ingredient","kind":"assumption",
             "alternatives":[
                {"id":"yogurt","text":"Use Greek yogurt alongside protein powder."},
                {"id":"powder","text":"Use protein powder without Greek yogurt."}
             ],"selectedAlternative":"yogurt"}
        ],"edges":[{"id":"parent-protein","kind":"parent","from":"topic","to":"protein"}]});
        let publication: PublicationGraph = serde_json::from_value(input.clone()).unwrap();
        assert_eq!(publication.validate(), Ok(()));
        let mut stored: Graph = publication.into();
        assert_eq!(
            stored.nodes[1].content,
            "Use Greek yogurt alongside protein powder."
        );
        stored.nodes[1].kind = NodeKind::Decided;
        let normalized = graph_for_agent(&stored);
        assert_eq!(
            normalized["nodes"][1]["alternatives"][0],
            json!({
                "id":"yogurt", "text":"Use Greek yogurt alongside protein powder.", "recommended":false
            })
        );
        let copy: PublicationGraph = serde_json::from_value(normalized.clone()).unwrap();
        assert_eq!(copy.validate(), Ok(()));
        let copied: Graph = copy.into();
        assert_eq!(
            crate::revision_validation::validate(&stored, &copied, &[]),
            Ok(())
        );
        let mut correction = normalized;
        correction["nodes"][1]
            .as_object_mut()
            .unwrap()
            .remove("content");
        correction["nodes"][1]["alternatives"][0]["text"] =
            json!("Use Greek yogurt without protein powder.");
        let corrected: PublicationGraph = serde_json::from_value(correction).unwrap();
        assert_eq!(corrected.validate(), Ok(()));
        let corrected: Graph = corrected.into();
        assert!(crate::revision_validation::validate(&stored, &corrected, &[]).is_err());
        assert_eq!(
            crate::revision_validation::validate(&stored, &corrected, &["protein".into()]),
            Ok(())
        );
        let mut conflict = input;
        conflict["nodes"][1]["content"] = json!("Use only protein powder.");
        let conflict: PublicationGraph = serde_json::from_value(conflict).unwrap();
        assert!(
            conflict
                .validate()
                .unwrap_err()
                .contains("omit when selectedAlternative")
        );
    }

    #[test]
    fn node_schema_requires_a_concrete_selected_assumption_and_only_visible_fields() {
        let schema = serde_json::to_value(schemars::schema_for!(PublicationNode)).unwrap();
        let variants = schema["oneOf"].as_array().unwrap();
        assert_eq!(variants.len(), 3);
        for variant in variants {
            let properties = variant["properties"].as_object().unwrap();
            assert!(!properties.contains_key("rationale"));
            assert!(!properties.contains_key("dependsOn"));
            assert_eq!(variant["additionalProperties"], false);
            if variant["properties"]["kind"]["const"] == "assumption" {
                let required = variant["required"].as_array().unwrap();
                assert!(required.contains(&json!("alternatives")));
                assert!(required.contains(&json!("selectedAlternative")));
                assert_eq!(properties["alternatives"]["minItems"], 2);
                assert_eq!(properties["alternatives"]["maxItems"], 20);
            }
            assert_eq!(properties["selectedAlternative"]["type"], "string");
            assert!(properties["selectedAlternative"].get("nullable").is_none());
            assert_ne!(
                properties["selectedAlternative"].get("default"),
                Some(&Value::Null)
            );
        }
        let commit = serde_json::to_value(schemars::schema_for!(PublicationCommit)).unwrap();
        assert_eq!(
            commit["properties"]
                .as_object()
                .unwrap()
                .keys()
                .cloned()
                .collect::<Vec<_>>(),
            vec!["kind", "title"]
        );
    }

    #[test]
    fn publication_inputs_reject_hidden_fields_and_explicit_null_selections() {
        let mut decided = json!({"id":"venue","title":"Where shall we eat?","kind":"decided","content":"Office common room"});
        assert!(serde_json::from_value::<PublicationNode>(decided.clone()).is_ok());
        decided["selectedAlternative"] = Value::Null;
        assert!(serde_json::from_value::<PublicationNode>(decided.clone()).is_err());
        decided
            .as_object_mut()
            .unwrap()
            .remove("selectedAlternative");
        decided["rationale"] = json!("Hidden explanation");
        assert!(serde_json::from_value::<PublicationNode>(decided).is_err());
        let mut commit = json!({"title":"Confirm the venue","kind":"directAnswer"});
        assert!(serde_json::from_value::<PublicationCommit>(commit.clone()).is_ok());
        commit["source"] = json!("Invisible conversation excerpt");
        assert!(serde_json::from_value::<PublicationCommit>(commit).is_err());
    }

    #[test]
    fn group_labels_are_canonical_optional_and_visible_in_the_public_contract() {
        let schema = serde_json::to_value(schemars::schema_for!(PublicationNode)).unwrap();
        assert_eq!(schema["$defs"]["GroupLabel"]["type"], "string");
        assert_eq!(
            schema["$defs"]["GroupLabel"]["pattern"],
            "^[a-z][a-z0-9]*(?:-[a-z0-9]+){0,5}$"
        );
        assert_eq!(schema["$defs"]["GroupLabel"]["maxLength"], 64);
        for variant in schema["oneOf"].as_array().unwrap() {
            let topic = variant["properties"]["kind"]["const"] == "topic";
            assert_eq!(variant["properties"].get("groupLabel").is_none(), topic);
            assert!(
                !variant["required"]
                    .as_array()
                    .unwrap()
                    .contains(&json!("groupLabel"))
            );
        }
        let node = json!({"id":"collection","title":"Who collects the meal?","kind":"decided","content":"Alex","groupLabel":"food-pickup"});
        assert!(serde_json::from_value::<PublicationNode>(node.clone()).is_ok());
        for invalid in [
            json!("group name"),
            json!("group_name"),
            json!("Group-name"),
            json!("group-name."),
            json!(""),
            json!("-name"),
            json!("name-"),
            json!("a--b"),
            json!("1group"),
            json!("one-two-three-four-five-six-seven"),
            json!("x".repeat(65)),
            Value::Null,
        ] {
            let mut candidate = node.clone();
            candidate["groupLabel"] = invalid.clone();
            assert!(
                serde_json::from_value::<PublicationNode>(candidate).is_err(),
                "Accepted invalid group label: {invalid}"
            );
        }
        let mut topic = node;
        topic["kind"] = json!("topic");
        assert!(serde_json::from_value::<PublicationNode>(topic).is_err());
    }

    #[test]
    fn group_membership_survives_reads_requires_two_members_and_does_not_change_confirmed_answers()
    {
        let mut value = json!({"nodes":[
            {"id":"topic","title":"Lunch","kind":"topic","content":"Plan lunch"},
            {"id":"collector","title":"Who collects the food?","kind":"decided","content":"Alex","groupLabel":"food-pickup"},
            {"id":"transport","title":"How do we travel?","kind":"decided","content":"Walk","groupLabel":"food-pickup"}
        ],"edges":[
            {"id":"parent-collector","kind":"parent","from":"topic","to":"collector"},
            {"id":"parent-transport","kind":"parent","from":"topic","to":"transport"}
        ]});
        let publication: PublicationGraph = serde_json::from_value(value.clone()).unwrap();
        assert_eq!(publication.validate(), Ok(()));
        let stored: Graph = publication.into();
        let normalized = graph_for_agent(&stored);
        assert_eq!(normalized["nodes"][1]["groupLabel"], "food-pickup");
        assert!(normalized["nodes"][0].get("groupLabel").is_none());
        let copied: PublicationGraph = serde_json::from_value(normalized).unwrap();
        assert_eq!(Graph::from(copied), stored);
        value["nodes"][1]
            .as_object_mut()
            .unwrap()
            .remove("groupLabel");
        let singleton: PublicationGraph = serde_json::from_value(value.clone()).unwrap();
        assert!(
            singleton
                .validate()
                .unwrap_err()
                .contains("only one member")
        );
        value["nodes"][2]
            .as_object_mut()
            .unwrap()
            .remove("groupLabel");
        let ungrouped: PublicationGraph = serde_json::from_value(value).unwrap();
        assert_eq!(ungrouped.validate(), Ok(()));
        assert_eq!(
            crate::revision_validation::validate(&stored, &ungrouped.into(), &[]),
            Ok(())
        );
    }

    #[test]
    fn agent_graph_can_be_copied_into_a_strict_complete_publication() {
        let graph = Graph {
            nodes: vec![GraphNode {
                id: "topic".into(),
                title: "Team lunch".into(),
                kind: NodeKind::Topic,
                group_label: None,
                content: "Plan a relaxed team lunch".into(),
                rationale: "Stored hidden context".into(),
                alternatives: vec![],
                selected_alternative: None,
                depends_on: vec![],
            }],
            edges: Some(vec![]),
        };
        let copy = graph_for_agent(&graph);
        assert!(copy["nodes"][0].get("rationale").is_none());
        assert!(copy["nodes"][0].get("dependsOn").is_none());
        let publication: PublicationGraph = serde_json::from_value(copy).unwrap();
        assert_eq!(publication.validate(), Ok(()));
    }
}
