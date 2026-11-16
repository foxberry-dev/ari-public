#!/bin/bash
set -euo pipefail
cd "$(dirname "$0")/.."
if [[ -z "${ARI_CHER_URL:-}" && -n "${ARI_DEV_HOST:-}" ]]; then
  cher_host="${ARI_DEV_HOST/--ari--/--cher--}"
  export ARI_CHER_URL="https://${cher_host/--main--/--}/"
fi
node .coder/catalog-api.mjs &
proxy=$!
npm start &
app=$!
trap 'kill "$proxy" "$app" 2>/dev/null || true; wait || true' EXIT
trap 'exit 143' TERM
trap 'exit 130' INT
wait -n "$proxy" "$app"
