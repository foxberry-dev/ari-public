# Ari

Ari is a local, read-only view of an agent-driven decision graph. A Rust daemon owns SQLite, HTTP, MCP, and live browser notifications. Vue provides a library and three views of each graph: Tree, Grouped, and Radial. Conversation happens with the agent outside Ari.

## Boundaries

| Module | Responsibility |
| --- | --- |
| `src/model.rs` | Stored graph snapshots, stable node numbering, graph validation, and immutable history |
| `src/publication.rs` | Strict UI-visible MCP authoring schemas and normalized graph reads |
| `src/revision_validation.rs` | Explicit acknowledgement of changes to previously confirmed nodes |
| `src/relationships.rs` | Typed relationships, parent-tree validation, independent input-cycle checks, and constraint scope validation |
| `src/service.rs` | Revision-checked SQLite graph transactions and post-commit notifications |
| `src/http.rs` | Loopback guards, read-only REST, SSE, and embedded frontend |
| `src/mcp.rs` | Agent discovery, clarification creation, and graph commit publication |
| `frontend/src/graph.ts` | Tree, island and ring layouts, edge geometry, and snapshot differences |
| `frontend/src/relationships.ts` | Relationship traversal, historical dependency interpretation, and relationship differences |
| `frontend/src/components/` | Library, conversation history, graph canvas, and node inspector |
| `scripts/dev.mjs` | Frontend HMR and backend rebuild/restart |

## Graph state

Clarification, node, and relationship IDs contain 1–64 ASCII letters, digits, underscores, or hyphens. Each graph contains at most 200 nodes, 1000 relationships, and 1 MiB of JSON. Public nodes have an ID, title, kind, content, alternatives, and a selected alternative label required for every assumption. Decided and assumption nodes may have a groupLabel: a canonical lowercase hyphenated label of 1–6 words and at most 64 characters, shared by at least two nodes. Node rationale and commit summary/source are stored only in older records and are excluded from public authoring and normalized MCP reads. Published kinds are topic, decided, and assumption. Every assumption requires a concrete answer, at least two alternatives, and a selected label matching one of those alternatives. Unselected assumptions and retired question or forecast kinds fail publication validation.

The MCP schema requires `edges`: parent links form a single tree rooted at a topic, input links have reasoning and are acyclic independently of that tree, and constraints hold a label, rule, requirement/preference strength, and 2–200 distinct participant nodes with optional exact alternative labels. Combined parent/input loops and constraint loops are valid. Typed graphs cannot mix in `dependsOn`. Every publication requires an explicit typed `edges` array, including empty graphs; missing or null edges are rejected. Stored historical snapshots remain immutable but are not rendered as a hierarchy. Authoring semantics live in `agent-instructions.md`.

Tree lays out parent links left to right and reveals selected-node inputs and constraints. Grouped puts nodes with the same explicit groupLabel in a titled container independently of parent links; unlabeled nodes stay unboxed. Its centered heading uses sentence case with hyphens replaced by spaces, without a trailing period. Radial centers the topic and places other nodes on unlabeled guides without inferring depth or importance. Grouped and Radial cache settled positions independently across publications; explicit group-label changes reflow Grouped. Constraints with multiple participants render as spokes meeting at one rule junction. All views use the same complete immutable snapshots and Current/Changed comparison. Relationship patterns carry meaning independently of change colors. Rules are inert text assessed by the agent; the server validates structure and references, not semantic satisfaction.

Each publication contains a complete graph and visible revision metadata: a short title and one of five documented commit kinds. Existing decided nodes whose title, answer, selected alternative, kind, or presence changes must be explicitly listed in confirmedChanges. Reopening a decided answer as an assumption keeps the same ID. It atomically appends an immutable snapshot and advances the clarification revision. Nodes omitted from a publication are absent from that new state; earlier snapshots retain them. Assumptions contain provisional agent answers; selected alternative labels identify assumed or chosen directions. Retired question and forecast nodes remain readable only as historical records, without inventing earlier answers or rewriting immutable snapshots. Human statements and sample conversations must remain distinguishable.

`get_context` serves bundled `agent-instructions.md` and a slim index containing IDs, titles, descriptions, revisions, and viewer URLs. `get_clarification` returns currentGraph, latestCommit, revision, nodeIndex, and normalized immutable commits, selected by stable ID, ari@<id> reference, exact title, or index. ari@<id>@<node-id> also returns the referenced node and its latest recorded revision; visible node numbers resolve through nodeIndex. Node numbers are assigned from immutable first appearance, with the first root topic numbered 1; removed nodes retain their numbers. Index order follows last modification time; durable references use IDs. `create_clarification` creates the initial graph; `publish_graph_commit` uses clarificationId and the latest expectedRevision to append a complete snapshot. Write receipts contain only clarificationId, revision, commitId, reference, and viewer URL. Validation/service errors are structured; malformed arguments use MCP parameter errors. Unknown write outcomes require a fresh read before retrying.

Pre-commit clarification documents are exposed with a deterministic baseline snapshot. Existing questions, answers, alternatives, rationale, answer history, question history, review state, and proposals remain preserved verbatim in their stored fields. Publishing the next graph saves both the baseline and preserved records. The inspector exposes relevant earlier records; the full document remains available through MCP.

## Agent-to-viewer flow

1. The human and agent discuss the topic in their conversation outside Ari.
2. The agent publishes a revision-checked graph snapshot through MCP.
3. SQLite commits the snapshot before the daemon broadcasts an invalidation.
4. The browser receives `/api/events` and refetches the clarification.
5. Viewers at the latest commit follow new commits. Viewers browsing history stay at their selected commit and can return to Latest.

The browser makes read-only requests. It has no answer forms, agent requests, approval workflow, event queue, or listener. Current view shows confirmed nodes neutrally and provisional assumptions in muted purple. Changed compares it with its immediate predecessor: green additions, purple added assumptions, blue resolved assumptions, amber revised answers, and pink removals. Removed nodes are temporary comparison representations, not part of the selected snapshot. Node details and conversation history are local navigation state. Keyboard revision navigation animates the camera to fit changed nodes visible in the selected display mode. Changed view includes comparison removals; Current view frames retained changes and additions. Track mode defaults on and persists for the browser session. At Latest, live publications frame changed nodes in either display mode when Track is enabled. Historical browsing keeps its selected revision and camera. Pointer revision selection, untracked live updates, and opening details preserve the camera; Fit graph explicitly reframes the graph. Node positions and edge endpoints interpolate on one animation clock, including interrupted transitions, with immediate positioning for reduced-motion preferences.

HTTP and MCP bind only to loopback. Authored text is inert and rendered through escaped Vue interpolation. Host and origin guards apply to every route. No model runs inside Ari.

## Development

In Coder use `dev start`, `dev stop`, `dev restart --wait`, `dev status`, and `dev logs --tail 100`. The launcher builds the frontend before Rust because the binary embeds `frontend/dist`. Vite hot-reloads Vue and CSS; Rust and bundled instruction edits rebuild the backend. Development storage is `.ari-dev`; verification uses isolated temporary storage and loopback ports. No services are installed by development checks.

`ARI_CHER_URL` / `--cher-url` configures a validated HTTP(S) return destination.
The read-only `/api/navigation` endpoint exposes it to the viewer. Escape and
Ctrl+[ dismiss open dialogs, return from a graph to the library, then navigate
to Cher. An unset URL retains local library shortcut behavior.

## Graph exports

`src/graph_export.rs` validates read-only export requests and runs the embedded
Node renderer with two concurrency slots, a 30-second timeout, a 32 MiB output
limit, and descendant-process cleanup on Linux (including detached browser groups). Other Unix systems terminate the renderer process group. `frontend/src/graph-export.ts` shares
layout and comparison logic with the viewer and serializes graph data as escaped
SVG text. The build creates `frontend/dist/graph-export.mjs` before Rust embeds
it. Node 24 is required for SVG; Playwright Chromium renders PNG/PDF with blocked
network access. `ARI_RENDERER_HOME` selects the module directory outside a source
checkout. The container includes this runtime. Parameter semantics belong in
[agent instructions](agent-instructions.md#references-and-graph-exports).

Clarification-wide links are ordered label/url references, validated as at most 50 absolute HTTP(S) URLs without credentials or control characters. Create accepts links; publications preserve them when omitted and replace them when supplied ([] clears). They persist independently of individual graph snapshots and are returned by get_clarification and HTTP reads. The header popover shows all references with browser-loaded site-origin favicons; the server does not fetch link targets.
