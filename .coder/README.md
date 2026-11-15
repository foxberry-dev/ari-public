---
display_name: Ari
description: Persistent Ari development workspace on Foxberry
icon: https://auth.foxberry.dev/static/dist/assets/foxberry/ari.svg
---

Workspace startup runs `dev install` and `dev start --wait`; open **Web** in Coder. Use `dev status`, `dev restart --wait`, and `dev logs --tail 100`. The authenticated URL is `https://web--<workspace>--<owner>.coder.foxberry.dev/`. The template maps `web` to loopback port `5175`. `ARI_DEV_HOST` supplies the agent-qualified hostname; Vite accepts that exact hostname and its short Coder alias for host and browser-origin checks.

Codex inside the workspace connects directly to `http://127.0.0.1:38477/mcp`. The web proxy forwards only `/api` to the backend. Ari keeps both listeners on loopback.

The project-owned catalog proxy permits clarification list/detail reads from the same owner’s Cher workspace on private port 8082. `dev` manages it with Ari's development stack. MCP and agent actions remain private.
