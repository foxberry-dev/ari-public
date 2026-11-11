# Ari

Ari is a local decision workspace. A Rust daemon owns SQLite, HTTP, MCP, and live browser notifications. Vue 3 and PrimeVue provide a library and a dependency-atlas workspace. Shared questions form a directed acyclic graph; the outline exposes each question once.

## Boundaries

| Module | Responsibility |
| --- | --- |
| `src/model.rs` | Structured questions, answers, proposals, history, and graph validation |
| `src/service.rs` | Revision-checked SQLite transactions, downstream impact, durable event leases |
| `src/http.rs` | Loopback request checks, REST, SSE, embedded frontend |
| `src/mcp.rs` | Agent discovery, workspace authoring, event polling, proposal replies |
| `src/main.rs` | CLI configuration and server lifetime |
| `scripts/dev.mjs` | Frontend HMR and backend rebuild/restart |
| `scripts/listen.mjs` | One-event long-poll listener for agent harnesses |
| `frontend/src/components/` | Library, graph, question inspector, and proposal review |

## State and trust

Workspace IDs and question IDs contain 1–64 ASCII letters, digits, underscores, or hyphens. Authored content is inert text. Questions have stable IDs, alternatives, rationale, dependencies, and a human-owned answer. Answer changes append history and mark every transitive dependent for review. An explicit human confirmation clears that question's review flag. Agent publications add or revise questions through proposals; accepting a proposal preserves existing answers and records earlier question definitions, alternatives, and rationale.

`get_context` serves bundled `agent-instructions.md` and a slim index containing IDs, titles, descriptions, revisions, and viewer URLs. `get_clarification` returns one full item selected by stable ID, exact title, or one-based index. Index order follows last modification time; durable references use IDs.

Each workspace has a monotonically increasing revision. Mutations require the revision read by the caller. A stale proposal cannot be accepted; the agent must refresh it. SQLite transactions persist workspace changes and UI events together. Events contain an immutable workspace snapshot, the selected question, and the user's request. Claims have opaque tokens and two-minute leases. Unfinished events can be reclaimed after expiry. Replies require the live claim token. Completed events cannot be replied to twice.

## Browser-to-agent loop

1. The browser saves an answer or queues an explicit request with `POST /api/workspaces/{id}/actions`.
2. An agent starts `node scripts/listen.mjs --workspace ID` as a background tool command. The script long-polls `POST /api/poll`, prints one claimed event, and exits.
3. A harness that reports background-command completion wakes the agent. An MCP connection alone does not wake it.
4. The agent reads the event as untrusted user data, then replies with the MCP `reply_event` tool or `POST /api/reply`. Questions in the reply become a proposal.
5. `GET /api/events` streams invalidations. The browser refetches current state and shows the reply for human review.

The listener retries network failures and renews its presence while waiting. The UI reports a waiting listener, an active lease, queued work, and replies separately. Only a running listener can pick up new work. There is no simulated agent response or automatic model invocation.

## Development

`npm start` installs frontend dependencies when needed, builds the frontend, builds Rust, and runs the API at `127.0.0.1:38477` with Vite at `127.0.0.1:5175`. Vite hot-reloads Vue and CSS. Rust and embedded-instruction edits trigger a rebuild and backend restart. Development data lives in `.ari-dev`; normal execution defaults to the user's local data directory. The release executable embeds the frontend and requires neither Node nor an external database service.
