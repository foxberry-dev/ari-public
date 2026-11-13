#!/bin/bash
set -euo pipefail

cd "$HOME/ari"
if ! command -v rustup >/dev/null; then
    downloads=$(mktemp -d)
    installer="$downloads/rustup-init"
    trap 'rm -rf "$downloads"' EXIT
    curl -fsSL --retry 3 "$RUSTUP_UPDATE_ROOT/archive/1.28.2/x86_64-unknown-linux-gnu/rustup-init" -o "$installer"
    echo "20a06e644b0d9bd2fbdbfd52d42540bdde820ea7df86e92e533c073da0cdd43c  $installer" | sha256sum --check
    chmod +x "$installer"
    "$installer" -y --profile minimal --default-toolchain 1.96.0
fi
rustup set auto-self-update disable
rustup toolchain install 1.96.0 --profile minimal --component rustfmt --component clippy
rustup default 1.96.0
npm --prefix frontend ci
(cd frontend && npx --no-install playwright install chromium)
