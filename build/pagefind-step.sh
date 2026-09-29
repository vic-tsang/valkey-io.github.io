#!/bin/bash
# Builds the Pagefind search index over the rendered site in ./public (settings in pagefind.yml).
# Runs after `zola build` in .github/workflows/zola-deploy.yml. Needs only curl and tar:
# Pagefind is a single static binary, so no Node or Python toolchain is installed.
set -euo pipefail

PAGEFIND_VERSION="1.5.2"
asset="pagefind-v${PAGEFIND_VERSION}-x86_64-unknown-linux-musl.tar.gz"
url="https://github.com/Pagefind/pagefind/releases/download/v${PAGEFIND_VERSION}/${asset}"

workdir="$(mktemp -d)"
curl -fsSL "$url" -o "$workdir/$asset"
curl -fsSL "$url.sha256" -o "$workdir/$asset.sha256"
(cd "$workdir" && sha256sum -c "$asset.sha256")
tar -xzf "$workdir/$asset" -C "$workdir"

"$workdir/pagefind" --version
"$workdir/pagefind"

# Fails the build if a rendered page is missing from the index or the site footer was indexed.
./build/check-search-index.sh public
