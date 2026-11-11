#!/bin/bash
set -euo pipefail

export PATH="$HOME/.local/bin:$HOME/.local/node/bin:$HOME/.cargo/bin:$PATH"
cd "$(dirname "$0")/.."

opencode --version
opencode api --standalone get /api/info >/dev/null
npm --prefix frontend ci
npm --prefix frontend run build
npm --prefix frontend test
cargo test --locked
cargo build --locked

data=$(mktemp -d)
./target/debug/ari --home "$data" --port 38478 &
server=$!
trap 'kill "$server" 2>/dev/null || true; wait "$server" || true; rm -rf -- "$data"' EXIT
curl --fail --silent --show-error --retry 10 --retry-connrefused --retry-delay 1 \
    http://127.0.0.1:38478/api/health
git rev-parse HEAD
