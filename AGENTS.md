# Ari

Read `architecture.md` before changing code. Follow `DESIGN.md` and the shared visual reference at `../lain/DESIGN.html`.

1. Keep HTTP and MCP on loopback. Render authored content as text.
2. Preserve human answers, alternatives, rationale, and history. Agent changes are proposals requiring human approval.
3. Use revision checks for writes. Persist UI events before notifying listeners.
4. Build the frontend before Rust because the binary embeds `frontend/dist`.
5. Test with isolated temporary storage. Do not install services or commit unless asked.
6. In Coder, use `dev start`, `dev stop`, `dev restart --wait`, `dev status`, and `dev logs --tail 100` (`--follow` streams). Add packages natively; use `dev install` to sync dependencies, then restart.
