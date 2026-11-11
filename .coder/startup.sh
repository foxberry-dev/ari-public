#!/bin/bash
set -euo pipefail

mkdir -p "$HOME/.local/bin" "$HOME/ari"
export PATH="$HOME/.local/bin:$HOME/.local/node/bin:$HOME/.cargo/bin:$PATH"

if [ ! -x "$HOME/.local/node/bin/node" ]; then
    curl --fail --silent --show-error --location --retry 3 \
        https://nodejs.org/dist/v24.15.0/node-v24.15.0-linux-x64.tar.xz \
        --output /tmp/ari-node.tar.xz
    echo '472655581fb851559730c48763e0c9d3bc25975c59d518003fc0849d3e4ba0f6  /tmp/ari-node.tar.xz' | sha256sum --check
    mkdir -p "$HOME/.local/node"
    tar -xJf /tmp/ari-node.tar.xz --strip-components=1 -C "$HOME/.local/node"
fi

if ! command -v rustup >/dev/null; then
    curl --fail --silent --show-error --location --retry 3 \
        https://static.rust-lang.org/rustup/archive/1.28.2/x86_64-unknown-linux-gnu/rustup-init \
        --output /tmp/rustup-init
    echo '20a06e644b0d9bd2fbdbfd52d42540bdde820ea7df86e92e533c073da0cdd43c  /tmp/rustup-init' | sha256sum --check
    chmod +x /tmp/rustup-init
    /tmp/rustup-init -y --profile minimal --default-toolchain 1.96.0
fi
rustup set auto-self-update disable
if ! rustup run 1.96.0 rustfmt --version >/dev/null 2>&1 || ! rustup run 1.96.0 cargo clippy --version >/dev/null 2>&1; then
    rustup toolchain install 1.96.0 --profile minimal --component rustfmt --component clippy
fi
rustup default 1.96.0

if [ "$("$HOME/.local/opencode/2.0.22/opencode" --version 2>/dev/null || true)" != 'opencode v2.0.22' ]; then
    curl --fail --silent --show-error --location --retry 3 \
        https://registry.npmjs.org/@opencode/cli-linux-x64/-/cli-linux-x64-2.0.22.tgz \
        --output /tmp/ari-opencode.tgz
    echo '65434cbe256f23df397a4941039e5eee28b1a37c1bad5376a5217f583a353583  /tmp/ari-opencode.tgz' | sha256sum --check
    mkdir -p "$HOME/.local/opencode/2.0.22"
    tar -xzf /tmp/ari-opencode.tgz --strip-components=2 -C "$HOME/.local/opencode/2.0.22" package/bin/opencode
fi
ln -sfn "$HOME/.local/opencode/2.0.22/opencode" "$HOME/.local/bin/opencode"

if ! grep -q 'ari-coder-path' "$HOME/.bashrc" 2>/dev/null; then
    echo 'export PATH="$HOME/.local/bin:$HOME/.local/node/bin:$HOME/.cargo/bin:$PATH" # ari-coder-path' >> "$HOME/.bashrc"
fi

opencode --version
touch /tmp/ari-coder-ready
