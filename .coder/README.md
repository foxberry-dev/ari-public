---
display_name: Ari
description: Persistent Ari development workspace on Foxberry
icon: https://auth.foxberry.dev/static/dist/assets/foxberry/ari.svg
---

Run `npm start` inside the workspace, then open **web** in Coder. The authenticated URL is `https://web--<workspace>--<owner>.coder.foxberry.dev/`. The template maps `web` to loopback port `5175`. `ARI_DEV_HOST` supplies the agent-qualified hostname; Vite accepts that exact hostname and its short Coder alias for host and browser-origin checks.

Codex inside the workspace connects directly to `http://127.0.0.1:38477/mcp`. The web proxy forwards only `/api` to the backend. Ari keeps both listeners on loopback.
