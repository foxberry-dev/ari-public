# Ari

Read `architecture.md` before changing code. Follow `DESIGN.md` and the shared visual reference at `../lain/DESIGN.html`.

1. Keep HTTP and MCP on loopback. Render authored content as text.
2. Preserve human answers, alternatives, rationale, and history. Agent changes are proposals requiring human approval.
3. Use revision checks for writes. Persist UI events before notifying listeners.
4. Build the frontend before Rust because the binary embeds `frontend/dist`.
5. Test with isolated temporary storage. Do not install services or commit unless asked.
