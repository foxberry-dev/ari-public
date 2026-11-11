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

if ! "$HOME/.local/lazygit/0.66.3/lazygit" --version >/dev/null 2>&1; then
    curl --fail --silent --show-error --location --retry 3 \
        https://github.com/jesseduffield/lazygit/releases/download/v0.66.3/lazygit_0.66.3_linux_x86_64.tar.gz \
        --output /tmp/ari-lazygit.tar.gz
    echo '0a23f429a95f0d09db298b3c291536d818de066aa5a85c255806f0490ff6656b  /tmp/ari-lazygit.tar.gz' | sha256sum --check
    mkdir -p "$HOME/.local/lazygit/0.66.3"
    tar -xzf /tmp/ari-lazygit.tar.gz -C "$HOME/.local/lazygit/0.66.3" lazygit
fi
ln -sfn "$HOME/.local/lazygit/0.66.3/lazygit" "$HOME/.local/bin/lazygit"

if ! "$HOME/.local/neovim/0.12.6/bin/nvim" --version >/dev/null 2>&1; then
    curl --fail --silent --show-error --location --retry 3 \
        https://github.com/neovim/neovim/releases/download/v0.12.6/nvim-linux-x86_64.tar.gz \
        --output /tmp/ari-neovim.tar.gz
    echo '474430d53e6264f6d6dd18db42d6dc9df3a1b56ca9e88a325bbf860e1a811d87  /tmp/ari-neovim.tar.gz' | sha256sum --check
    mkdir -p "$HOME/.local/neovim/0.12.6"
    tar -xzf /tmp/ari-neovim.tar.gz --strip-components=1 -C "$HOME/.local/neovim/0.12.6"
fi
ln -sfn "$HOME/.local/neovim/0.12.6/bin/nvim" "$HOME/.local/bin/nvim"

if ! "$HOME/.local/bin/rg" --version >/dev/null 2>&1; then
    curl --fail --silent --show-error --location --retry 3 \
        https://github.com/BurntSushi/ripgrep/releases/download/15.2.0/ripgrep-15.2.0-x86_64-unknown-linux-musl.tar.gz \
        --output /tmp/ari-ripgrep.tar.gz
    echo '33e15bcf1624b25cdd2a55813a47a2f95dbe126268203e76aa6a585d1e7b149c  /tmp/ari-ripgrep.tar.gz' | sha256sum --check
    tar -xzf /tmp/ari-ripgrep.tar.gz --strip-components=1 -C "$HOME/.local/bin" ripgrep-15.2.0-x86_64-unknown-linux-musl/rg
fi

if ! "$HOME/.local/bin/fd" --version >/dev/null 2>&1; then
    curl --fail --silent --show-error --location --retry 3 \
        https://github.com/sharkdp/fd/releases/download/v10.5.2/fd-v10.5.2-x86_64-unknown-linux-musl.tar.gz \
        --output /tmp/ari-fd.tar.gz
    echo '7e2d07fa2b8807642aaec67b7e2972a9fbe4db26fcb340a7372392db42b26694  /tmp/ari-fd.tar.gz' | sha256sum --check
    tar -xzf /tmp/ari-fd.tar.gz --strip-components=1 -C "$HOME/.local/bin" fd-v10.5.2-x86_64-unknown-linux-musl/fd
fi

if ! "$HOME/.local/bin/tree-sitter" --version >/dev/null 2>&1; then
    curl --fail --silent --show-error --location --retry 3 \
        https://github.com/tree-sitter/tree-sitter/releases/download/v0.27.2/tree-sitter-linux-x64.gz \
        --output /tmp/ari-tree-sitter.gz
    echo '7ed56d152c52437397b9fcaa43cf341f49933cecc1ca291843f0d347c6e2cb3a  /tmp/ari-tree-sitter.gz' | sha256sum --check
    gzip --decompress --force /tmp/ari-tree-sitter.gz
    install -m 0755 /tmp/ari-tree-sitter "$HOME/.local/bin/tree-sitter"
fi

if [ ! -e "$HOME/.config/nvim" ]; then
    curl --fail --silent --show-error --location --retry 3 \
        https://codeload.github.com/LazyVim/starter/tar.gz/803bc181d7c0d6d5eeba9274d9be49b287294d99 \
        --output /tmp/ari-lazyvim.tar.gz
    echo 'b580d0bdb1654342dcf9f24fa1d4584bb91046a06dc1b6c866cbd06719b9dc7a  /tmp/ari-lazyvim.tar.gz' | sha256sum --check
    mkdir -p "$HOME/.config/nvim"
    tar -xzf /tmp/ari-lazyvim.tar.gz --strip-components=1 -C "$HOME/.config/nvim"
fi

if ! grep -q 'ari-coder-path' "$HOME/.bashrc" 2>/dev/null; then
    echo 'export PATH="$HOME/.local/bin:$HOME/.local/node/bin:$HOME/.cargo/bin:$PATH" # ari-coder-path' >> "$HOME/.bashrc"
fi

opencode --version
lazygit --version
nvim --version
touch /tmp/ari-coder-ready
