use std::collections::{HashMap, HashSet};

use crate::model::{Graph, NodeKind, valid_id};

pub fn validate(previous: &Graph, next: &Graph, declarations: &[String]) -> Result<(), String> {
    let next_nodes: HashMap<_, _> = next
        .nodes
        .iter()
        .map(|node| (node.id.as_str(), node))
        .collect();
    let requires_acknowledgment: HashSet<_> = previous
        .nodes
        .iter()
        .filter(|node| {
            node.kind == NodeKind::Decided
                && next_nodes.get(node.id.as_str()).is_none_or(|next| {
                    next.kind != node.kind
                        || next.title != node.title
                        || next.content != node.content
                        || next.selected_alternative != node.selected_alternative
                })
        })
        .map(|node| node.id.as_str())
        .collect();
    let mut declared = HashSet::new();
    for (index, node_id) in declarations.iter().enumerate() {
        if !valid_id(node_id) {
            return Err(format!(
                "confirmedChanges[{index}] must be a node ID containing 1–64 ASCII letters, digits, underscores, or hyphens"
            ));
        }
        if !declared.insert(node_id.as_str()) {
            return Err(format!(
                "confirmedChanges[{index}] duplicates node {node_id:?}; name each changed decided node exactly once"
            ));
        }
        if !requires_acknowledgment.contains(node_id.as_str()) {
            return Err(format!(
                "confirmedChanges[{index}] names node {node_id:?}, which is not a previously decided node whose title, content, selectedAlternative, kind, or presence changes; omit this ID"
            ));
        }
    }
    for node in &previous.nodes {
        if requires_acknowledgment.contains(node.id.as_str())
            && !declared.contains(node.id.as_str())
        {
            return Err(format!(
                "confirmedChanges is missing node {:?}; this revision changes or removes a previously decided answer. Include its ID to acknowledge the correction, reopening, retitling, or removal. Reopening keeps the same node ID and sets kind to assumption; do not replace it with a new node",
                node.id
            ));
        }
    }
    Ok(())
}
