#!/bin/bash
set -euo pipefail
cd "$(dirname "$0")/.."
node .coder/catalog-api.mjs &
proxy=$!
npm start &
app=$!
trap 'kill "$proxy" "$app" 2>/dev/null || true; wait || true' EXIT
trap 'exit 143' TERM
trap 'exit 130' INT
wait -n "$proxy" "$app"
