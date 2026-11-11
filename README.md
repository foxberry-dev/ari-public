# Ari

A local decision workspace with a clarity library and an interactive dependency atlas. Rust serves SQLite-backed HTTP and MCP. Vue 3 and PrimeVue provide the browser UI. Saffron and honey identify Ari within the Foxberry application family.

## Run

Hosted app: https://ari.foxberry.dev. Linux x86_64: [public installer](https://github.com/foxberry-dev/downloads/releases/download/ari-latest/ari-installer.sh). Successful `main` builds publish installers/images and update Foxberry's deployment record. Use `--no-start` to install without starting a local service.

Requires Node 24+ and a current Rust toolchain with a C compiler.

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

The binary serves the UI at http://127.0.0.1:38477 and stores data in the user's local data directory. `--home PATH` and `--port PORT` override storage and port. `ARI_PUBLIC_URL` sets published viewer links behind an authenticated gateway. The release binary runs without Node.

## Connect an agent

Configure an HTTP MCP server at `http://127.0.0.1:38477/mcp` in your agent client. `get_context` returns bundled `agent-instructions.md` and a slim index of clarity items. `get_clarification` reads one item by stable ID, exact title, or one-based index. Index positions follow last modification time; use IDs across calls.

Tools: `get_context`, `get_clarification`, `create_clarification`, `propose_questions`, `poll_event`, and `reply_event`.

Create a clarification through the MCP `create_clarification` tool. Ask the agent to start this command as a background tool task:

```sh
node /absolute/path/to/ari/scripts/listen.mjs --workspace ITEM_ID
```

The listener long-polls, prints one claimed event, then exits. Supported harnesses notify the agent when the background command completes. The agent reads the current item, replies through `reply_event`, and starts the listener again. The browser receives live updates and lets you approve proposed questions. No model runs inside Ari. A connected MCP server alone cannot wake the agent; without a running listener, requests remain queued.

Events persist across restarts. Claims expire after two minutes; replies require the current token and workspace revision. The UI distinguishes a waiting listener, claimed work, and queued requests. Human answer changes preserve earlier answers and reasons and mark transitive dependents for review. Proposals cannot overwrite human answers. Stale proposals require a fresh agent review.

Ari starts with an empty library. Agents publish clarifications; users answer questions and review proposals in the browser.

## Checks

Enable the pre-commit checks with `git config core.hooksPath .githooks`. OpenCode `/push` writes a conventional commit and pushes after the hook passes.

```sh
npm --prefix frontend run build
npm test
cargo fmt --check
cargo clippy --all-targets -- -D warnings
npm run test:browser
```

Tests use temporary storage. Browser checks use `/usr/bin/google-chrome`, `CHROME_PATH`, or Playwright's Chromium (`cd frontend && npx playwright install chromium`). They exercise UI answers, a background listener, MCP replies, approval, dialogs, search, and mobile overflow. See `architecture.md` for the state and trust model and `DESIGN.md` for visual rules.
