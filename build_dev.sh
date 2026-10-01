#!/bin/zsh
export PATH="$HOME/.local/zola-0.22.0:$PATH"
mkdir public
zola build
npx -y pagefind@1.5.2
node build/relativize-public-paths.mjs
