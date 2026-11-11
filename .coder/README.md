---
display_name: Ari
description: Persistent Ari development workspace on Foxberry
icon: /icon/rust.svg
---

# Ari development workspace

Requires Foxberry's Coder installation and its `coder-workspaces` namespace. The template creates an unprivileged pod and a persistent 20Gi home directory. It installs Node 24.15.0, Rust 1.96.0, OpenCode 2.0.22, LazyGit 0.66.3, Neovim 0.12.6, and the LazyVim starter configuration. Home storage survives workspace stops; deleting the workspace deletes its home volume.

## Publish and create

From the Ari repository:

```sh
coder login https://coder.foxberry.dev
coder templates push ari --directory .coder
coder create ari-pilot --template ari --stop-after 2h --yes
```

For a new workspace, connect and clone the private repository over HTTPS:

```sh
coder ssh ari-pilot
git clone https://github.com/foxberry-dev/ari.git ~/ari
```

Skip cloning when `~/ari/.git` already exists. Use your own GitHub credentials: Git prompts for a username and a personal access token when no credential helper is configured. Scope the token to Ari and grant the repository access you need. Enter it at the password prompt, never in the clone URL. GitHub account passwords do not authenticate Git. The template does not configure a credential helper; authentication persistence depends on your chosen helper.

## Develop

The workspace UI has OpenCode, LazyGit, LazyVim, and Terminal buttons. All tools start in `~/ari`. LazyVim installs its plugins on first launch and retains them in the persistent home. An existing Neovim configuration is preserved.

From your local Ari checkout, connect and start OpenCode:

```sh
npm run coder
```

The script passes your terminal size before starting OpenCode. Coder starts a stopped workspace automatically. Requires the local Coder CLI authenticated with `coder login https://coder.foxberry.dev`.

Use `/connect` inside OpenCode to sign in to a model provider, then `/models` to choose a model. Credentials and sessions stay in the workspace's persistent home. Standalone mode runs OpenCode for that terminal session without a separate background service. The template supplies the executable; personal settings, skills, MCPs, and credentials are configured separately.

To preview Ari, use another workspace terminal to run `cd ~/ari && npm start`. Port forwarding is separate from `npm run coder`. On your own machine, keep this tunnel running:

```sh
coder port-forward ari-pilot --tcp 5175:5175 --tcp 38477:38477
```

The tunnel maps local ports to the same ports inside the workspace through Coder's authenticated connection. Open http://127.0.0.1:5175. Use http://127.0.0.1:38477/mcp for development MCP clients. The backend keeps its loopback Host/Origin checks. Development data lives in `~/ari/.ari-dev`, separate from hosted Ari.

Stop with `coder stop ari-pilot`; resume with `coder start ari-pilot`. Save code to Git; persistent home storage is not an off-host backup.

The persistent home also keeps `~/.npm`, `~/.cargo`, OpenCode data, and the checkout's `node_modules`. Bun's `~/.bun/install/cache` persists if Bun is installed separately. Caches belong to this workspace; they are not shared between workspaces.

## Verify

Inside the workspace checkout, run `npm run coder:verify`. It verifies OpenCode, installs frontend dependencies, builds Ari, runs frontend/Rust tests, and checks HTTP health on loopback port 38478 with temporary data. The temporary server and data are removed when the check exits.
