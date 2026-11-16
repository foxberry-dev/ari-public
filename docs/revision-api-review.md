# Revision API review

## Objective and scope

Ari's publication API must help an agent record supported decisions without silently rewriting the human's meaning. The graph viewer, layouts, immutable snapshot model, and conversational workflow stay the same. This review covers the LLM-facing schema, publication validation, read/write responses, repair feedback, and authoring guidance.

The intended contract is described in [agent instructions](../agent-instructions.md). Authored fields supply content that is visible in the UI. Control fields such as revision checks and confirmed-change acknowledgements govern publication without creating additional hidden notes. Strict publication types define the supported public API. Internal readers may retain historical records so existing immutable development data remains readable; they do not authorize historical fields or aliases in new publications.

Implementation verification is pending the primary agent's final checks. The actions below describe the agreed implementation contract; the verification record must be completed before reporting them as verified.

## Findings and actions

| Finding | Consequence | Action |
| --- | --- | --- |
| One flat node schema left assumption requirements mostly in prose. | Agents could omit a selected answer and discover the node shape only through errors. | Use discriminated `topic`, `decided`, and `assumption` publication shapes. Assumptions require two to twenty alternatives and an exact selected label. |
| Node rationale and commit summaries or source excerpts were hidden from the viewer. | Agents authored extra prose that humans could not inspect in the interface. | Exclude node rationale and commit summary/source from the public write and normalized read contracts. Keep commit metadata to visible title and kind. Input rationale, alternative descriptions, and constraint rules remain visible authored fields. |
| Publication types exposed historical terms and commit kinds. | Agents received multiple competing representations and vocabulary for unsupported authoring states. | Keep one strict public write contract. Exclude historical node kinds, legacy dependency fields, compatibility aliases, and obsolete commit kinds. |
| Reads exposed a history array without an explicit current snapshot. | An agent could accidentally copy an earlier revision or reconstruct the graph from memory. | Return `currentGraph`, `latestCommit`, and `revision` explicitly, alongside the full normalized commit history. Instruct agents to copy the current graph and change only supported details. |
| Full-snapshot writes made unsupported certainty changes easy. | Confirmed answers could become assumptions or disappear during representation cleanup. | Require `confirmedChanges` IDs for intentional changes to prior decided nodes' title, answer content, selection, kind, or presence. Keep the acknowledgement a control field, without invisible explanatory prose. |
| Broad advice to stage future answers encouraged overgrown speculative graphs. | Missing information could turn into a forest of arbitrary provisional answers. | Keep useful assumptions relevant and shallow. Do not require exhaustive forecasts; omit unsupported branches and ask in the external conversation when necessary. |
| Examples and real human evidence were not consistently separated. | A copied scripted answer could be mistaken for a human-confirmed fact. | Prohibit invented dialogue and history unless a scripted example is explicitly requested. Label the example in its visible title or description and preserve the distinction from real conversation. |
| Commit kinds overlapped with unsupported question and forecast concepts. | An agent could infer that a commit label implied node status or permission to reinterpret earlier decisions. | Publish only `topicStaged`, `directAnswer`, `openDiscussion`, `revisedDecision`, and `graphUpdated`. Document each kind as a description of the update. |
| Write responses repeated the complete growing history. | Each successful publication increased response size and mixed acknowledgement with historical context. | Return a compact receipt: clarification ID, revision, commit ID, reference, and viewer URL. Read when graph or history is needed. |
| Plain error strings often omitted a repair action. | Agents had to guess whether to fix a node, refresh the revision, or retry. | Return structured `code`, `message`, and `nextAction`; include `currentRevision` for revision conflicts and identify offending fields or nodes in the message. |
| Schema descriptions did not carry enough of the authoring contract. | Correct use depended on remembering a long separate instruction document. | Describe field meaning, stable IDs, complete-snapshot semantics, and conditional node requirements in the public schema. Keep longer examples and revision discipline in the guidance. |

## Evidence from the development history

At review start, the team-lunch fixture's early revisions confirmed attendance, dietary needs, budget, meal format, and timing. Later revisions illustrated two authoring failures:

1. A later relationship-mapping revision demotes several confirmed answers to assumptions while adding structural detail, without a new human statement reopening those answers.
2. An otherwise scripted history incorporates an unlabelled real attendance statement, making the authority of copied earlier answers ambiguous.

That fixture also repeated a per-person budget across multiple nodes before introducing a distinct derived total. Some hidden rationale text described earlier forecasts after nodes became decided. Structural validation alone accepts these graphs because their IDs and relationships can be valid even when their conversational meaning drifts.

The canonical fixture files now retain confirmed answers during relationship mapping, explicitly acknowledge the legitimate twelve-person dietary-scope reopening, and keep the total allowance distinct from its per-person input. Existing stored snapshots remain immutable. The API guard targets explicit changes to already confirmed nodes. Guidance distinguishes genuinely separate questions and derived quantities and separates real conversation from examples. The review does not treat a fixture's accepted publication as evidence that its reasoning is correct.

## Intended revision semantics

The write remains a complete graph snapshot. Omitting a node or edge removes it from the latest state without modifying earlier snapshots. Stable node IDs preserve identity as answers evolve. Parentage describes subject structure; input links describe information actually used; constraints describe concrete requirements or preferences.

A confirmed answer may legitimately change or reopen as the conversation develops. The API must not impose a permanent ban on `decided` to `assumption` transitions. Keep the same node ID, change its kind and other visible fields appropriately, and include that ID in `confirmedChanges`. Deleting and re-adding the same decision is unnecessary and obscures continuity.

A change acknowledgement is not a hidden reason field or proof of authorization. Its purpose is to prevent accidental confirmed-answer changes during a complete-snapshot publication. The agent must still use the actual conversation to determine the supported answer and certainty. Supporting discussion belongs in that conversation, not in invisible publication metadata.

Public graph and history reads expose normalized UI content. Stored historical records may contain older fields internally, but those fields are not accepted for authoring or presented as part of the supported public schema.

## Limits of enforcement

The server can reject malformed node shapes, unknown fields, unsupported kinds, invalid IDs and references, missing assumption choices, impossible parent/input structures, stale revision numbers, and undeclared changes to confirmed nodes.

It cannot establish that the actual conversation supports an answer, prove that a natural-language constraint is satisfied, or determine that every alternative is materially distinct. An ID in `confirmedChanges` makes a consequential edit explicit; it does not prove human agreement. These remain responsibilities of the authoring agent and its actual conversation context.

Do not describe the API as making semantic errors impossible. The intended result is a smaller, clearer contract with mechanically checked requirements and deliberate acknowledgement of consequential changes.

## Verification record

Completed checks:

- Inspected actual MCP `tools/list` schemas through isolated HTTP servers. Node shapes are discriminated, assumption choices are required, IDs and collection limits are described, and unknown or retired authoring fields are rejected.
- Verified public current/history reads omit node rationale and commit summary/source while retaining visible relationship explanations.
- Published and read assumption-to-decided updates, confirmed-answer corrections, same-ID reopenings, and explicit removals. Missing, duplicated, irrelevant and incomplete acknowledgements fail without advancing history. Stale writes return the current revision and a repair action.
- Published both complete documentation payloads through the real MCP API using isolated storage. Verified compact receipts and the copyable current snapshot.
- Verified node references and stable numeric labels, including a topic introduced after an empty first revision and references to removed nodes.
- 17 Rust tests, 19 frontend unit tests, 35 browser checks, formatting, Clippy and whitespace checks passed. Browser coverage includes the visible schema contract, numbered neighborhood navigation, clipboard notifications, compact card alignment and blank-until-ready rendering.

The stored development clarifications were not rewritten. The canonical fixture files use the new public API and explicit confirmed-change declarations.
