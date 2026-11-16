# Ari

Read `architecture.md` before changing code. Follow `DESIGN.md` and the shared visual reference at `../lain/DESIGN.html`.

Use `ari` for user-requested content authoring: clarifications. Share its viewer URLs.

Use `ari_dev` when developing or testing the Ari application itself and share its viewer URLs. If that development connection is unavailable, report the blocker; do not test application changes against production. Read production when needed.

1. Keep HTTP and MCP on loopback. Render authored content as text.
2. Preserve human meaning, alternatives, rationale, and immutable graph history. Agent MCP publications directly append complete graph snapshots; the viewer is read-only.
3. Use revision checks for graph publications. Persist snapshots before notifying viewers.
4. Build the frontend before Rust because the binary embeds `frontend/dist`.
5. Test with isolated temporary storage. Do not install services or commit unless asked.
6. In Coder, use `dev start`, `dev stop`, `dev restart --wait`, `dev status`, and `dev logs --tail 100` (`--follow` streams). Add packages natively; use `dev install` to sync dependencies, then restart.
