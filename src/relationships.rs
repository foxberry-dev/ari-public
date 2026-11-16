use std::collections::{HashMap, HashSet};

use schemars::JsonSchema;
use serde::{Deserialize, Deserializer, Serialize};

use crate::model::{GraphNode, NodeKind, valid_id, validate_text};

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Participant {
    /// ID of a node in this complete graph. Each constraint names a node at most once.
    #[schemars(length(min = 1, max = 64), regex(pattern = r"^[A-Za-z0-9_-]+$"))]
    pub node_id: String,
    /// Scope this rule to one exact alternatives[].label on the participant; omit to cover the whole node.
    #[serde(
        default,
        skip_serializing_if = "Option::is_none",
        deserialize_with = "optional_alternative"
    )]
    #[schemars(with = "String", length(min = 1, max = 32768), regex(pattern = r"\S"))]
    pub alternative: Option<String>,
}

fn optional_alternative<'de, D: Deserializer<'de>>(
    deserializer: D,
) -> Result<Option<String>, D::Error> {
    String::deserialize(deserializer).map(Some)
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub enum ConstraintStrength {
    /// A condition the recorded choices must satisfy; do not claim satisfaction without checking.
    Requirement,
    /// A supported preference rather than a requirement. Explain whose preference or which criterion supports it.
    Preference,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize, JsonSchema)]
#[serde(tag = "kind", rename_all = "camelCase", deny_unknown_fields)]
pub enum GraphEdge {
    /// Broader question to its detail, not conversation order or calculation flow. Every non-root node has exactly one parent.
    Parent {
        /// Stable relationship ID; preserve it when the same relationship remains in later revisions.
        #[schemars(length(min = 1, max = 64), regex(pattern = r"^[A-Za-z0-9_-]+$"))]
        id: String,
        /// ID of the broader topic or question in graph.nodes.
        #[schemars(length(min = 1, max = 64), regex(pattern = r"^[A-Za-z0-9_-]+$"))]
        from: String,
        /// ID of its distinct child node in graph.nodes.
        #[schemars(length(min = 1, max = 64), regex(pattern = r"^[A-Za-z0-9_-]+$"))]
        to: String,
    },
    /// Information source to the answer that actually uses it. Mere relevance is insufficient. Input cycles are checked independently of parent links.
    Input {
        /// Stable relationship ID; preserve it when the same relationship remains in later revisions.
        #[schemars(length(min = 1, max = 64), regex(pattern = r"^[A-Za-z0-9_-]+$"))]
        id: String,
        /// ID of the node supplying information.
        #[schemars(length(min = 1, max = 64), regex(pattern = r"^[A-Za-z0-9_-]+$"))]
        from: String,
        /// ID of the distinct node whose answer consumes that information.
        #[schemars(length(min = 1, max = 64), regex(pattern = r"^[A-Za-z0-9_-]+$"))]
        to: String,
        /// Name the information consumed and why it affects the dependent answer; plain text, at most 32 KiB UTF-8.
        #[schemars(length(min = 1, max = 32768), regex(pattern = r"\S"))]
        rationale: String,
    },
    /// One concrete permitted/forbidden combination or compatibility rule across distinct nodes. Rules are recorded text, not executable predicates.
    Constraint {
        /// Stable relationship ID; preserve it when the same rule remains in later revisions.
        #[schemars(length(min = 1, max = 64), regex(pattern = r"^[A-Za-z0-9_-]+$"))]
        id: String,
        /// Nodes governed by this one rule, with optional alternative scopes. Do not split one multi-node rule into pairwise duplicates.
        #[schemars(length(min = 2, max = 200))]
        participants: Vec<Participant>,
        /// Short name shown for the rule; plain text, at most 32 KiB UTF-8.
        #[schemars(length(min = 1, max = 32768), regex(pattern = r"\S"))]
        label: String,
        /// State the actual condition, not just that the nodes are related; plain text, at most 32 KiB UTF-8.
        #[schemars(length(min = 1, max = 32768), regex(pattern = r"\S"))]
        rule: String,
        /// Distinguish a required condition from a supported preference.
        strength: ConstraintStrength,
    },
}

pub fn validate(nodes: &[GraphNode], edges: &[GraphEdge]) -> Result<(), String> {
    if edges.len() > 1000 {
        return Err("graph.edges supports at most 1000 relationships".into());
    }
    if let Some(node) = nodes.iter().find(|n| !n.depends_on.is_empty()) {
        return Err(format!(
            "graph.nodes (node {:?}).dependsOn is not accepted in a publication; express each relationship in graph.edges",
            node.id
        ));
    }
    let by_id: HashMap<_, _> = nodes.iter().map(|n| (n.id.as_str(), n)).collect();
    let mut ids = HashSet::new();
    let mut pairs = HashSet::new();
    let mut parents: HashMap<&str, Vec<&str>> = HashMap::new();
    let mut inputs: HashMap<&str, Vec<&str>> = HashMap::new();
    for (index, edge) in edges.iter().enumerate() {
        let id = match edge {
            GraphEdge::Parent { id, .. }
            | GraphEdge::Input { id, .. }
            | GraphEdge::Constraint { id, .. } => id,
        };
        if !valid_id(id) {
            return Err(format!(
                "graph.edges[{index}].id must contain 1–64 ASCII letters, digits, underscores, or hyphens"
            ));
        }
        if !ids.insert(id.as_str()) {
            return Err(format!(
                "graph.edges[{index}].id duplicates relationship {id:?}; keep relationship IDs unique"
            ));
        }
        let path = format!("graph.edges[{index}] (edge {id:?})");
        match edge {
            GraphEdge::Parent { from, to, .. } | GraphEdge::Input { from, to, .. } => {
                if !by_id.contains_key(from.as_str()) {
                    return Err(format!(
                        "{path}.from references missing node {from:?}; include that node or remove this relationship"
                    ));
                }
                if !by_id.contains_key(to.as_str()) {
                    return Err(format!(
                        "{path}.to references missing node {to:?}; include that node or remove this relationship"
                    ));
                }
                if from == to {
                    return Err(format!(
                        "{path}.to must differ from from; a node cannot relate to itself"
                    ));
                }
                let is_parent = matches!(edge, GraphEdge::Parent { .. });
                if !pairs.insert((is_parent, from, to)) {
                    return Err(format!(
                        "{path} duplicates a {} relationship from {from:?} to {to:?}; retain one relationship ID",
                        if is_parent { "parent" } else { "input" }
                    ));
                }
                if let GraphEdge::Input { rationale, .. } = edge {
                    validate_text(rationale, &format!("{path}.rationale"), true)?;
                }
                let incoming = if is_parent { &mut parents } else { &mut inputs };
                incoming.entry(to).or_default().push(from);
            }
            GraphEdge::Constraint {
                participants,
                label,
                rule,
                ..
            } => {
                validate_text(label, &format!("{path}.label"), true)?;
                validate_text(rule, &format!("{path}.rule"), true)?;
                if !(2..=200).contains(&participants.len()) {
                    return Err(format!(
                        "{path}.participants must name 2–200 distinct nodes"
                    ));
                }
                let mut seen = HashSet::new();
                for (participant_index, p) in participants.iter().enumerate() {
                    let participant_path = format!("{path}.participants[{participant_index}]");
                    let node = by_id
                        .get(p.node_id.as_str())
                        .ok_or_else(|| format!("{participant_path}.nodeId references missing node {:?}; include that node or remove it from the rule", p.node_id))?;
                    if !seen.insert(&p.node_id) {
                        return Err(format!(
                            "{participant_path}.nodeId repeats node {:?}; a constraint names each node at most once",
                            p.node_id
                        ));
                    }
                    if let Some(label) = &p.alternative
                        && !node.alternatives.iter().any(|a| &a.label == label)
                    {
                        return Err(format!(
                            "{participant_path}.alternative must match an exact alternatives[].label on node {:?}",
                            p.node_id
                        ));
                    }
                }
            }
        }
    }
    if !nodes.is_empty() {
        let roots: Vec<_> = nodes
            .iter()
            .filter(|n| !parents.contains_key(n.id.as_str()))
            .collect();
        if roots.len() != 1 || roots[0].kind != NodeKind::Topic {
            return Err(format!(
                "graph.edges parent links must form one tree with exactly one root topic; nodes without a parent: {:?}",
                roots.iter().map(|n| &n.id).collect::<Vec<_>>()
            ));
        }
        if let Some(node) = nodes.iter().find(|node| {
            parents
                .get(node.id.as_str())
                .is_some_and(|parents| parents.len() != 1)
        }) {
            return Err(format!(
                "graph.edges gives node {:?} more than one parent; retain exactly one organisational parent",
                node.id
            ));
        }
    }
    acyclic(&parents, "parent")?;
    acyclic(&inputs, "input")
}

fn acyclic<'a>(incoming: &HashMap<&'a str, Vec<&'a str>>, label: &str) -> Result<(), String> {
    fn visit<'a>(
        id: &'a str,
        incoming: &HashMap<&'a str, Vec<&'a str>>,
        active: &mut HashSet<&'a str>,
        done: &mut HashSet<&'a str>,
    ) -> Result<(), &'a str> {
        if done.contains(id) {
            return Ok(());
        }
        if !active.insert(id) {
            return Err(id);
        }
        if let Some(sources) = incoming.get(id) {
            for source in sources {
                visit(source, incoming, active, done)?;
            }
        }
        active.remove(id);
        done.insert(id);
        Ok(())
    }
    let mut done = HashSet::new();
    for id in incoming.keys() {
        if let Err(node) = visit(id, incoming, &mut HashSet::new(), &mut done) {
            return Err(format!(
                "graph.edges {label} relationships contain a cycle through node {node:?}; remove or redirect a {label} link in that cycle"
            ));
        }
    }
    Ok(())
}
