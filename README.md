# Ari

A local decision workspace with a clarity library and an interactive dependency atlas. Rust serves SQLite-backed HTTP and MCP. Vue 3 and PrimeVue provide the browser UI. Saffron and honey identify Ari within the Foxberry application family.

## Run

Hosted app: https://ari.foxberry.dev. Linux x86_64: [public installer](https://github.com/foxberry-dev/downloads/releases/download/ari-latest/ari-installer.sh). Successful `main` builds publish installers/images and update Foxberry's deployment record. Use `--no-start` to install without starting a local service.

Requires Node 24+ and a current Rust toolchain with a C compiler.

Run `npm run coder` to open OpenCode in the Foxberry development workspace. Requires an authenticated local Coder CLI; see [the Coder template](.coder/README.md).

```sh
npm start
```

Open http://127.0.0.1:5175. The API and MCP server run at http://127.0.0.1:38477. The launcher installs frontend dependencies on first use, builds the embedded frontend, then starts both processes. Vue and CSS hot-reload; Rust and agent-instruction edits rebuild and restart the backend. Ctrl+C stops the stack. Development data lives in `.ari-dev`; set `ARI_DEV_HOME` to use an isolated directory.

For an embedded release:

```sh
npm --prefix frontend ci
npm run build
./target/release/ari
```

The binary serves the UI at http://127.0.0.1:38477 and stores data in the user's local data directory. `--home PATH` and `--port PORT` override storage and port. `ARI_PUBLIC_URL` sets published viewer links behind an authenticated gateway. Viewing and MCP publication run without Node. Graph exports require Node 24+; PNG/PDF also require Playwright and Chromium. The container includes the renderer. For a standalone binary, install these in a runtime directory and set `ARI_RENDERER_HOME` to that directory; `ARI_CHROME_PATH` optionally selects a Chromium executable.

## Connect an agent

Configure an HTTP MCP server at `http://127.0.0.1:38477/mcp` in your agent client. `get_context` returns bundled `agent-instructions.md` and a slim index of clarity items. `get_clarification` reads one item by stable ID, `ari@<id>` reference, exact title, or one-based index. Index positions follow last modification time; use IDs across calls.

Tools: `get_context`, `get_clarification`, `create_clarification`, and `publish_graph_commit`.

The human and agent discuss the topic outside Ari. The agent publishes a complete graph snapshot and conversation metadata with each commit. Published nodes have stable IDs, a kind (`topic`, `decided`, or `assumption`), visible answer content, alternatives, and an optional selected alternative. Hidden node reasoning and commit prose are not authoring fields. Every assumption selects one of at least two possible directions, displayed in the sidebar. Typed relationships organise questions into a parent tree, declare independently acyclic information inputs, and state requirements or preferences across nodes or alternatives. Every retained node and relationship belongs in each publication; omissions remain preserved in earlier snapshots. Read `currentGraph` and `revision` before writing. Publication uses `clarificationId`, `expectedRevision`, the complete graph and visible commit title/kind; `confirmedChanges` lists existing decided nodes intentionally corrected, reopened, retitled or removed. Successful writes return a compact receipt. See [agent instructions](agent-instructions.md) for the complete authoring contract.

The graph viewer shows conversation commits on the left, the graph in the center, and node details on the right. Tree shows parent links left to right and reveals inputs and constraints on selection. Grouped and Radial show all relationships and keep settled node positions across publications. Optional canonical `groupLabel` values create meaningful collections of at least two nodes in Grouped; see [group-label guidance](agent-instructions.md#group-labels). Solid parent lines, dashed input arrows, and dotted constraint rules leave color available for Current/Changed. Current shows neutral decided nodes and purple assumptions; Changed highlights differences from the preceding commit. Live MCP publications appear automatically. The overview supports card deletion, Delete all, and an eight-second Undo notification. Graph content remains read-only. There are no UI messages, answer forms, approvals, or listeners. Earlier snapshots remain immutable. Stable numbered node labels start at #1 for the topic, persist across revisions, and copy `ari@<clarification-id>@<node-id>` references. Number shortcuts focus the node and its immediate parent/children without opening details; ambiguous number prefixes wait one second.

## Development fixture

With Ari Dev running, load the scripted team-lunch history through its loopback MCP connection:

```sh
node scripts/load-fixture.mjs
```

The team-lunch fixture contains a seven-commit lunch history and an eighteen-node working graph. It covers confirmed attendance, provisional food and logistics choices, parent/input loops, multi-node requirements, alternative incompatibility, and a provisional preference. The visible description identifies the scripted history as an example. The total allowance is distinct from the per-person budget; confirmed answers remain decided until an acknowledged discussion change reopens them. Existing fixture IDs are left untouched. Use `--url http://127.0.0.1:PORT` for an isolated server or `--file PATH` for another graph fixture.

A focused color fixture shows every transition together in its latest revision:

```sh
node scripts/load-fixture.mjs --file fixtures/graph-color-transitions.json
```

Open **All graph colors** and select **Changed**, then the latest revision, **See every transition**:

| Node | Transition | Color |
| --- | --- | --- |
| Who collects the food? | New confirmed node | Green |
| How will we travel? | New assumption | Purple |
| Where shall we eat? | Assumption answered | Blue |
| Budget per person | Confirmed answer changed | Amber |
| Reserve a table? | Node removed | Pink |

Who is joining? stays neutral and decided; Include drinks? stays a muted purple assumption. Every conversation in these fixtures is explicitly scripted.

## Checks

`npm install` and `npm ci` enable the pre-push hook automatically from the root or `frontend` package in a Git checkout. OpenCode `/push` writes a conventional commit and pushes after the hook passes. GitHub Actions builds and publishes releases and deployments; verification runs locally.

```sh
npm --prefix frontend run build
npm test
cargo fmt --check
cargo clippy --all-targets -- -D warnings
npm run test:browser
```

Tests use temporary storage. Browser checks use `/usr/bin/google-chrome`, `CHROME_PATH`, or Playwright's Chromium (`cd frontend && npx playwright install chromium`). They exercise real MCP graph publications, live updates, commit navigation, node inspection, change highlighting, read-only interaction, library navigation, and mobile overflow. See `architecture.md` for the state and trust model and `DESIGN.md` for visual rules.

Set `ARI_CHER_URL` (or `--cher-url`) to Cher's HTTP(S) URL to return from the
clarification library with Escape or Ctrl+[. Dialogs close before the workspace
returns to the library. With no Cher URL, library shortcuts keep their local
behavior. Use Cher's exact browser origin to restore its per-tab view state.

## Graph downloads

The bottom-right canvas tools provide a draggable minimap, zoom, fit, 1:1, and
SVG/PNG/PDF downloads. Exports include the entire selected graph. The same
read-only endpoint is available to agents; see [export parameters and renderer
requirements](agent-instructions.md#references-and-graph-exports).
