use crate::{
    model::*,
    service::{Error, Service},
};

fn question(id: &str, deps: &[&str]) -> Question {
    Question {
        id: id.into(),
        title: format!("Question {id}"),
        question: format!("What about {id}?"),
        rationale: "A test decision".into(),
        assumption: false,
        alternatives: vec![],
        depends_on: deps.iter().map(|s| (*s).into()).collect(),
    }
}

async fn fixture() -> (tempfile::TempDir, Service, Workspace) {
    let temp = tempfile::tempdir().unwrap();
    let service = Service::open(&temp.path().join("ari.db")).await.unwrap();
    let workspace = service
        .create(CreateWorkspace {
            id: "repair-cafe".into(),
            title: "Repair café".into(),
            description: "An isolated test".into(),
            questions: vec![
                question("B1", &[]),
                question("V2", &["B1"]),
                question("A4", &["V2"]),
                question("S5", &["V2", "A4"]),
            ],
        })
        .await
        .unwrap();
    (temp, service, workspace)
}

fn answer(revision: u64, id: &str, value: &str, reason: &str) -> Action {
    Action {
        expected_revision: revision,
        kind: ActionKind::Answer,
        question_id: Some(id.into()),
        value: value.into(),
        reason: reason.into(),
        message: String::new(),
        proposal_id: None,
    }
}

fn proposal_action(revision: u64, id: &str) -> Action {
    Action {
        expected_revision: revision,
        kind: ActionKind::AcceptProposal,
        proposal_id: Some(id.into()),
        question_id: None,
        value: String::new(),
        reason: String::new(),
        message: String::new(),
    }
}

#[tokio::test]
async fn answer_changes_preserve_reasons_and_mark_all_transitive_dependents() {
    let (_temp, service, w) = fixture().await;
    let w = service
        .act(
            &w.id,
            answer(w.revision, "V2", "24 people", "Library limit"),
        )
        .await
        .unwrap();
    let w = service
        .act(&w.id, answer(w.revision, "A4", "Hybrid", "Keep walk-ins"))
        .await
        .unwrap();
    let w = service
        .act(
            &w.id,
            answer(w.revision, "V2", "12 people", "Smaller room confirmed"),
        )
        .await
        .unwrap();
    assert_eq!(w.answers["A4"].value, "Hybrid");
    assert_eq!(w.needs_review, ["A4".into(), "S5".into()].into());
    let entry = w.history.last().unwrap();
    assert_eq!(entry.previous.as_ref().unwrap().reason, "Library limit");
    assert_eq!(entry.previous.as_ref().unwrap().value, "24 people");
    assert_eq!(entry.answer.reason, "Smaller room confirmed");
    let confirmed = service
        .act(&w.id, answer(w.revision, "A4", "Hybrid", "Still fits"))
        .await
        .unwrap();
    assert!(!confirmed.needs_review.contains("A4"));
    assert!(confirmed.needs_review.contains("S5"));
    assert_eq!(
        service.get(&w.id).await.unwrap().revision,
        confirmed.revision
    );
}

#[tokio::test]
async fn proposals_require_current_revision_and_preserve_human_answers() {
    let (_temp, service, w) = fixture().await;
    let w = service
        .act(&w.id, answer(w.revision, "V2", "24 people", "Confirmed"))
        .await
        .unwrap();
    let mut revision = question("V2", &["B1"]);
    revision.rationale = "Count staff and visitors together".into();
    let w = service
        .propose(Propose {
            workspace_id: w.id.clone(),
            expected_revision: w.revision,
            message: "Clarify the capacity".into(),
            questions: vec![revision.clone()],
        })
        .await
        .unwrap();
    assert_eq!(w.questions[1].rationale, "A test decision");
    let proposal_id = w.proposals[0].id.clone();
    let w = service
        .act(&w.id, proposal_action(w.revision, &proposal_id))
        .await
        .unwrap();
    assert_eq!(w.questions[1].rationale, revision.rationale);
    assert_eq!(w.answers["V2"].value, "24 people");
    assert_eq!(w.answers["V2"].reason, "Confirmed");
    assert_eq!(w.question_history[0].previous.rationale, "A test decision");
    assert_eq!(
        w.question_history[0].proposed.rationale,
        "Count staff and visitors together"
    );
    assert!(w.needs_review.contains("V2"));
    let w = service
        .propose(Propose {
            workspace_id: w.id.clone(),
            expected_revision: w.revision,
            message: "Another proposal".into(),
            questions: vec![question("L6", &["V2"])],
        })
        .await
        .unwrap();
    let stale = w.proposals.last().unwrap().id.clone();
    let w = service
        .act(&w.id, answer(w.revision, "A4", "Booked", "New constraint"))
        .await
        .unwrap();
    assert!(matches!(
        service
            .act(&w.id, proposal_action(w.revision, &stale))
            .await,
        Err(Error::Conflict(_))
    ));
    assert!(matches!(
        service
            .act(&w.id, answer(1, "A4", "Drop-in", "Stale"))
            .await,
        Err(Error::Conflict(_))
    ));
}

#[tokio::test]
async fn event_claims_are_exclusive_and_replies_are_atomic_and_durable() {
    let (temp, service, w) = fixture().await;
    let (first, second) = tokio::join!(service.poll(&w.id, 0), service.poll(&w.id, 0));
    let claims: Vec<_> = [first.unwrap(), second.unwrap()]
        .into_iter()
        .flatten()
        .collect();
    assert_eq!(claims.len(), 1);
    let claim = &claims[0];
    assert_eq!(claim.event.kind, "created");
    assert_eq!(claim.event.snapshot.title, "Repair café");
    let invalid = Reply {
        event_id: claim.event.id.clone(),
        token: "wrong".into(),
        expected_revision: w.revision,
        message: "Proposed follow-up".into(),
        questions: vec![question("L6", &["V2"])],
    };
    assert!(matches!(
        service.reply(invalid).await,
        Err(Error::Conflict(_))
    ));
    let make_reply = || Reply {
        event_id: claim.event.id.clone(),
        token: claim.token.clone(),
        expected_revision: w.revision,
        message: "Check insurance".into(),
        questions: vec![question("L6", &["V2"])],
    };
    let result = service.reply(make_reply()).await.unwrap();
    assert_eq!(result.proposals[0].message, "Check insurance");
    assert!(result.questions.iter().all(|q| q.id != "L6"));
    assert!(matches!(
        service.reply(make_reply()).await,
        Err(Error::Conflict(_))
    ));
    drop(service);
    let reopened = Service::open(&temp.path().join("ari.db")).await.unwrap();
    assert!(reopened.poll(&w.id, 0).await.unwrap().is_none());
    assert_eq!(
        reopened.get(&w.id).await.unwrap().proposals[0].message,
        "Check insurance"
    );
}

#[test]
fn questions_require_resolvable_acyclic_dependencies() {
    assert!(validate_questions(&[question("A", &["B"]), question("B", &["A"])]).is_err());
    assert!(validate_questions(&[question("A", &["missing"])]).is_err());
    assert!(validate_questions(&[question("A", &[]), question("A", &[])]).is_err());
    assert!(
        validate_questions(&[
            question("A", &[]),
            question("B", &["A"]),
            question("C", &["A", "B"])
        ])
        .is_ok()
    );
}

#[tokio::test]
async fn context_index_is_slim_and_includes_bundled_guidance() {
    let (_temp, service, w) = fixture().await;
    let context = crate::mcp::context(&service, "http://127.0.0.1:38477")
        .await
        .unwrap();
    assert_eq!(
        context["clarifications"][0],
        serde_json::json!({
            "index": 1, "id": w.id, "title": "Repair café", "description": "An isolated test", "revision": 1,
            "url": "http://127.0.0.1:38477/#/clarifications/repair-cafe"
        })
    );
    assert_eq!(context["instructions"], crate::mcp::INSTRUCTIONS);
}

#[tokio::test]
async fn expired_events_are_reclaimed_with_a_new_token() {
    use sqlx::Connection;

    let (temp, service, w) = fixture().await;
    let first = service.poll(&w.id, 0).await.unwrap().unwrap();
    let options = sqlx::sqlite::SqliteConnectOptions::new().filename(temp.path().join("ari.db"));
    let mut db = sqlx::SqliteConnection::connect_with(&options)
        .await
        .unwrap();
    sqlx::query("UPDATE events SET lease_until=0 WHERE id=?")
        .bind(&first.event.id)
        .execute(&mut db)
        .await
        .unwrap();
    let reclaimed = service.poll(&w.id, 0).await.unwrap().unwrap();
    assert_eq!(reclaimed.event.id, first.event.id);
    assert_ne!(reclaimed.token, first.token);
    let old_reply = Reply {
        event_id: first.event.id,
        token: first.token,
        expected_revision: w.revision,
        message: "An expired response".into(),
        questions: vec![],
    };
    assert!(matches!(
        service.reply(old_reply).await,
        Err(Error::Conflict(_))
    ));
    let current = service
        .reply(Reply {
            event_id: reclaimed.event.id,
            token: reclaimed.token,
            expected_revision: w.revision,
            message: "A recovered response".into(),
            questions: vec![],
        })
        .await
        .unwrap();
    assert_eq!(current.proposals.len(), 1);
    assert_eq!(current.proposals[0].message, "A recovered response");
}
