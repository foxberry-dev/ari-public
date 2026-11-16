use crate::{
    model::*,
    service::{Error, Service},
};

fn node(id: &str, deps: &[&str]) -> GraphNode {
    GraphNode {
        group_label: None,
        id: id.into(),
        title: format!("Node {id}"),
        kind: NodeKind::Assumption,
        content: format!("Working assumption for {id}"),
        rationale: "A possible follow-up".into(),
        alternatives: vec![
            Alternative {
                label: format!("Working assumption for {id}"),
                description: "A provisional choice".into(),
                recommended: false,
            },
            Alternative {
                label: format!("Alternative for {id}"),
                description: "Another direction".into(),
                recommended: false,
            },
        ],
        selected_alternative: Some(format!("Working assumption for {id}")),
        depends_on: deps.iter().map(|s| (*s).into()).collect(),
    }
}
fn test_graph(mut nodes: Vec<GraphNode>) -> Graph {
    use crate::relationships::GraphEdge;
    nodes.retain(|n| n.id != "topic");
    let mut edges = Vec::new();
    for n in &mut nodes {
        edges.push(GraphEdge::Parent {
            id: format!("parent-{}", n.id),
            from: "topic".into(),
            to: n.id.clone(),
        });
        for (i, source) in n.depends_on.drain(..).enumerate() {
            edges.push(GraphEdge::Input {
                id: format!("input-{}-{i}", n.id),
                from: source,
                to: n.id.clone(),
                rationale: "Information used to develop this answer".into(),
            });
        }
    }
    if !nodes.is_empty() {
        let mut topic = node("topic", &[]);
        topic.kind = NodeKind::Topic;
        nodes.push(topic);
    }
    Graph {
        nodes,
        edges: Some(edges),
    }
}

fn metadata() -> CommitMetadata {
    CommitMetadata {
        title: "Explore the plan".into(),
        kind: CommitKind::OpenDiscussion,
        summary: "Connected ideas from the conversation".into(),
        source: "Let's think about the whole plan.".into(),
    }
}
async fn fixture() -> (tempfile::TempDir, Service, Workspace) {
    let temp = tempfile::tempdir().unwrap();
    let service = Service::open(&temp.path().join("ari.db")).await.unwrap();
    let workspace = service
        .create(CreateWorkspace {
            links: vec![],
            id: "team-lunch".into(),
            title: "Team lunch".into(),
            description: "An isolated fixture".into(),
            graph: test_graph(vec![
                node("people", &[]),
                node("diet", &["people"]),
                node("venue", &["diet"]),
            ]),
            commit: metadata(),
        })
        .await
        .unwrap();
    (temp, service, workspace)
}

#[tokio::test]
async fn graph_commits_replace_the_whole_graph_and_preserve_snapshots_after_restart() {
    let (temp, service, original) = fixture().await;
    let mut graph = original.commits[0].graph.clone();
    graph.nodes[0].kind = NodeKind::Decided;
    graph.nodes[0].content = "Four teammates".into();
    graph.nodes[0].alternatives = ["Four teammates", "Six teammates"]
        .into_iter()
        .map(|label| Alternative {
            label: label.into(),
            description: String::new(),
            recommended: false,
        })
        .collect();
    graph.nodes[0].selected_alternative = Some("Four teammates".into());
    graph.nodes.retain(|n| n.id != "venue");
    graph.nodes.push(node("menu", &["diet"]));
    graph = test_graph(graph.nodes);
    let updated = service
        .publish(PublishGraph {
            links: None,
            confirmed_changes: vec![],
            workspace_id: original.id.clone(),
            expected_revision: 1,
            graph: graph.clone(),
            commit: metadata(),
        })
        .await
        .unwrap();
    assert_eq!(updated.revision, 2);
    assert_eq!(updated.commits.len(), 2);
    assert_eq!(updated.commits[0].graph, original.commits[0].graph);
    assert_eq!(updated.commits[1].graph, graph);
    let mut updates = service.updates.subscribe();
    let mut next = graph.clone();
    next.nodes[0].content = "Six teammates".into();
    next.nodes[0].selected_alternative = Some("Six teammates".into());
    service
        .publish(PublishGraph {
            links: None,
            confirmed_changes: vec!["people".into()],
            workspace_id: original.id.clone(),
            expected_revision: 2,
            graph: next,
            commit: metadata(),
        })
        .await
        .unwrap();
    updates.recv().await.unwrap();
    assert_eq!(service.get(&original.id).await.unwrap().revision, 3);
    drop(service);
    let reopened = Service::open(&temp.path().join("ari.db")).await.unwrap();
    let saved = reopened.get(&original.id).await.unwrap();
    assert_eq!(saved.commits.len(), 3);
    assert_eq!(
        saved.commits[2].graph.nodes[0]
            .selected_alternative
            .as_deref(),
        Some("Six teammates")
    );
    assert_eq!(saved.commits[1].graph, graph);
    assert_eq!(
        saved.commits[0].metadata.source,
        "Let's think about the whole plan."
    );
}

#[tokio::test]
async fn competing_writers_require_the_latest_revision_and_invalid_graphs_are_atomic() {
    let (_temp, service, w) = fixture().await;
    let make = || PublishGraph {
        links: None,
        confirmed_changes: vec![],
        workspace_id: w.id.clone(),
        expected_revision: 1,
        graph: w.commits[0].graph.clone(),
        commit: metadata(),
    };
    let (a, b) = tokio::join!(service.publish(make()), service.publish(make()));
    assert_eq!([a.is_ok(), b.is_ok()].into_iter().filter(|v| *v).count(), 1);
    assert!(
        matches!(a, Err(Error::RevisionConflict(_)))
            || matches!(b, Err(Error::RevisionConflict(_)))
    );
    let invalid = PublishGraph {
        links: None,
        confirmed_changes: vec![],
        workspace_id: w.id.clone(),
        expected_revision: 2,
        graph: test_graph(vec![node("broken", &["missing"])]),
        commit: metadata(),
    };
    assert!(matches!(
        service.publish(invalid).await,
        Err(Error::Invalid(_))
    ));
    assert_eq!(service.get(&w.id).await.unwrap().commits.len(), 2);
}

#[tokio::test]
async fn all_publications_require_typed_relationships_and_a_single_parent_tree() {
    use crate::relationships::GraphEdge;
    let (_temp, service, workspace) = fixture().await;
    let mut missing_edges = workspace.commits[0].graph.clone();
    missing_edges.edges = None;
    let mut two_parents = workspace.commits[0].graph.clone();
    two_parents.edges.as_mut().unwrap().push(GraphEdge::Parent {
        id: "second-parent".into(),
        from: "people".into(),
        to: "venue".into(),
    });
    for graph in [missing_edges, two_parents] {
        assert!(matches!(
            service
                .create(CreateWorkspace {
                    links: vec![],
                    id: "invalid".into(),
                    title: "Invalid publication".into(),
                    description: String::new(),
                    graph: graph.clone(),
                    commit: metadata()
                })
                .await,
            Err(Error::Invalid(_))
        ));
        assert!(matches!(
            service
                .publish(PublishGraph {
                    links: None,
                    confirmed_changes: vec![],
                    workspace_id: workspace.id.clone(),
                    expected_revision: 1,
                    graph,
                    commit: metadata()
                })
                .await,
            Err(Error::Invalid(_))
        ));
    }
    assert_eq!(service.get(&workspace.id).await.unwrap().revision, 1);
    assert_eq!(service.list().await.unwrap().len(), 1);
}

#[test]
fn graphs_require_unique_resolvable_acyclic_nodes_and_bounded_text() {
    for nodes in [
        vec![node("a", &["b"]), node("b", &["a"])],
        vec![node("a", &["missing"])],
        vec![node("a", &[]), node("a", &[])],
        vec![node("a", &["a"])],
        vec![node("a", &[]), node("b", &["a", "a"])],
    ] {
        assert!(validate_graph(&test_graph(nodes)).is_err());
    }
    assert!(
        validate_graph(&test_graph(vec![
            node("a", &[]),
            node("b", &["a"]),
            node("c", &["a", "b"])
        ]))
        .is_ok()
    );
    let mut oversized = node("a", &[]);
    oversized.content = "x".repeat(32_769);
    assert!(validate_graph(&test_graph(vec![oversized])).is_err());
}

#[tokio::test]
async fn legacy_records_preserve_answers_alternatives_rationale_and_history() {
    use sqlx::Connection;
    let temp = tempfile::tempdir().unwrap();
    let path = temp.path().join("ari.db");
    let service = Service::open(&path).await.unwrap();
    let legacy = serde_json::json!({"id":"legacy","title":"Earlier plan","description":"Saved work","revision":7,"updatedAt":123,
      "questions":[{"id":"people","title":"Attendees","question":"Who is coming?","rationale":"Count everyone","dependsOn":[],"alternatives":[{"label":"Four","description":"Small group","recommended":false}]}],
      "answers":{"people":{"value":"Four","reason":"Core team only","at":120}},"history":[{"questionId":"people","previous":null,"answer":{"value":"Four","reason":"Core team only","at":120}}],"questionHistory":[],"proposals":[{"id":"old-proposal","message":"Original reasoning","status":"pending"}],"needsReview":["people"]});
    let mut db = sqlx::SqliteConnection::connect_with(
        &sqlx::sqlite::SqliteConnectOptions::new().filename(&path),
    )
    .await
    .unwrap();
    sqlx::query("INSERT INTO workspaces VALUES (?,?)")
        .bind("legacy")
        .bind(legacy.to_string())
        .execute(&mut db)
        .await
        .unwrap();
    let imported = service.get("legacy").await.unwrap();
    assert_eq!(imported.revision, 7);
    assert_eq!(imported.commits[0].graph.nodes[0].content, "Four");
    assert!(
        imported.commits[0].graph.nodes[0]
            .rationale
            .contains("Core team only")
    );
    assert_eq!(
        imported.commits[0].graph.nodes[0].alternatives[0].description,
        "Small group"
    );
    let saved = service
        .publish(PublishGraph {
            links: None,
            confirmed_changes: vec!["people".into()],
            workspace_id: "legacy".into(),
            expected_revision: 7,
            graph: test_graph(vec![]),
            commit: metadata(),
        })
        .await
        .unwrap();
    for key in [
        "questions",
        "answers",
        "history",
        "questionHistory",
        "proposals",
        "needsReview",
    ] {
        assert_eq!(saved.archive[key], legacy[key]);
    }
    drop(service);
    let reopened = Service::open(&path).await.unwrap();
    assert_eq!(
        reopened.get("legacy").await.unwrap().commits[0].graph,
        imported.commits[0].graph
    );
}

#[tokio::test]
async fn context_index_is_slim_and_includes_bundled_guidance() {
    let (_temp, service, w) = fixture().await;
    let context = crate::mcp::context(&service, "http://127.0.0.1:38477")
        .await
        .unwrap();
    assert_eq!(context["clarifications"][0]["id"], w.id);
    assert_eq!(context["clarifications"][0]["revision"], 1);
    assert!(context["clarifications"][0].get("commits").is_none());
    assert_eq!(context["instructions"], crate::mcp::INSTRUCTIONS);
}

#[test]
fn assumed_choices_are_explicit_and_must_match_the_available_alternatives() {
    let mut n = node("diet", &[]);
    n.selected_alternative = None;
    assert!(validate_graph(&test_graph(vec![n.clone()])).is_err());
    n.selected_alternative = Some("Missing option".into());
    assert!(validate_graph(&test_graph(vec![n.clone()])).is_err());
    n.alternatives = vec![
        Alternative {
            label: "No restrictions".into(),
            description: String::new(),
            recommended: false,
        },
        Alternative {
            label: "Vegetarian meals".into(),
            description: String::new(),
            recommended: false,
        },
    ];
    n.selected_alternative = Some("No restrictions".into());
    n.content = "No restrictions assumed".into();
    assert!(validate_graph(&test_graph(vec![n.clone()])).is_ok());
    let saved = serde_json::to_value(&n).unwrap();
    assert_eq!(saved["kind"], "assumption");
    assert_eq!(saved["selectedAlternative"], "No restrictions");
    let restored: GraphNode = serde_json::from_value(saved).unwrap();
    assert_eq!(restored, n);
    let mut one_direction = n.clone();
    one_direction.alternatives.truncate(1);
    assert!(validate_graph(&test_graph(vec![one_direction])).is_err());
    n.content.clear();
    assert!(validate_graph(&test_graph(vec![n])).is_err());
}

#[test]
fn publication_schema_has_only_three_node_kinds_and_archived_question_types_cannot_be_published() {
    let schema = serde_json::to_value(schemars::schema_for!(NodeKind)).unwrap();
    assert_eq!(
        schema["enum"],
        serde_json::json!(["topic", "decided", "assumption"])
    );
    for kind in [NodeKind::Question, NodeKind::Forecast] {
        let mut n = node("old", &[]);
        n.kind = kind;
        assert!(validate_graph(&test_graph(vec![n])).is_err());
    }
}

fn lunch_relationships() -> Graph {
    let fixture: serde_json::Value =
        serde_json::from_str(include_str!("../fixtures/team-lunch-graph.json")).unwrap();
    serde_json::from_value(fixture["commits"].as_array().unwrap().last().unwrap()["graph"].clone())
        .unwrap()
}

#[test]
fn parent_and_input_cycles_are_independent_and_constraints_can_cross_branches() {
    use crate::relationships::GraphEdge;
    let graph = lunch_relationships();
    assert_eq!(validate_graph(&graph), Ok(()));
    let schema = serde_json::to_value(schemars::schema_for!(Graph)).unwrap();
    assert!(
        schema["required"]
            .as_array()
            .unwrap()
            .contains(&serde_json::json!("edges"))
    );
    let node_schema = serde_json::to_value(schemars::schema_for!(GraphNode)).unwrap();
    assert!(node_schema["properties"].get("dependsOn").is_none());

    let mut two_parents = graph.clone();
    two_parents.edges.as_mut().unwrap().push(GraphEdge::Parent {
        id: "extra-parent".into(),
        from: "people".into(),
        to: "amount".into(),
    });
    assert_eq!(
        validate_graph(&two_parents).unwrap_err(),
        "graph.edges gives node \"amount\" more than one parent; retain exactly one organisational parent"
    );

    let mut input_cycle = graph.clone();
    input_cycle.edges.as_mut().unwrap().push(GraphEdge::Input {
        id: "cycle".into(),
        from: "topic".into(),
        to: "amount".into(),
        rationale: "A circular calculation".into(),
    });
    assert!(validate_graph(&input_cycle).unwrap_err().contains("cycle"));

    let mut parent_cycle = graph.clone();
    parent_cycle
        .edges
        .as_mut()
        .unwrap()
        .retain(|e| !matches!(e, GraphEdge::Parent { to, .. } if to == "people"));
    parent_cycle
        .edges
        .as_mut()
        .unwrap()
        .push(GraphEdge::Parent {
            id: "cycle".into(),
            from: "headcount".into(),
            to: "people".into(),
        });
    assert!(validate_graph(&parent_cycle).unwrap_err().contains("cycle"));

    let mut bad_scope = graph.clone();
    if let GraphEdge::Constraint { participants, .. } = bad_scope
        .edges
        .as_mut()
        .unwrap()
        .iter_mut()
        .find(|e| matches!(e, GraphEdge::Constraint { id, .. } if id == "vegan-exclusion"))
        .unwrap()
    {
        participants[0].alternative = Some("Unlisted choice".into());
    }
    let scope_error = validate_graph(&bad_scope).unwrap_err();
    assert!(scope_error.contains("vegan-exclusion") && scope_error.contains("alternative"));

    let mut missing = graph.clone();
    if let GraphEdge::Input { from, .. } = missing
        .edges
        .as_mut()
        .unwrap()
        .iter_mut()
        .find(|e| matches!(e, GraphEdge::Input { .. }))
        .unwrap()
    {
        *from = "unknown".into();
    }
    let missing_error = validate_graph(&missing).unwrap_err();
    assert!(missing_error.contains("input-headcount-amount") && missing_error.contains("unknown"));

    let mut mixed = graph;
    mixed.nodes[1].depends_on.push("topic".into());
    let mixed_error = validate_graph(&mixed).unwrap_err();
    assert!(
        mixed_error.contains("people")
            && mixed_error.contains("dependsOn")
            && mixed_error.contains("graph.edges")
    );
}

#[tokio::test]
async fn typed_relationships_preserve_full_scope_and_immutable_history() {
    let (temp, service, original) = fixture().await;
    let graph = lunch_relationships();
    let saved = service
        .publish(PublishGraph {
            links: None,
            confirmed_changes: vec![],
            workspace_id: original.id.clone(),
            expected_revision: 1,
            graph: graph.clone(),
            commit: metadata(),
        })
        .await
        .unwrap();
    assert_eq!(saved.commits[0].graph, original.commits[0].graph);
    assert_eq!(saved.commits[1].graph, graph);
    let mut invalid = graph.clone();
    let duplicate = invalid.edges.as_ref().unwrap()[0].clone();
    invalid.edges.as_mut().unwrap().push(duplicate);
    assert!(matches!(
        service
            .publish(PublishGraph {
                links: None,
                confirmed_changes: vec![],
                workspace_id: original.id.clone(),
                expected_revision: 2,
                graph: invalid,
                commit: metadata()
            })
            .await,
        Err(Error::Invalid(_))
    ));
    drop(service);
    let reopened = Service::open(&temp.path().join("ari.db")).await.unwrap();
    let restored = reopened.get(&original.id).await.unwrap();
    assert_eq!(restored.revision, 2);
    assert_eq!(restored.commits[1].graph, graph);
}
