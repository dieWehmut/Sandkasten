#!/usr/bin/env bash
set -euo pipefail
# Everything is installed in the new conda environment; never update base or
# another existing environment. A second run reuses this dedicated prefix.
ENV_NAME="${SANDKASTEN_CONDA_ENV:-sandkasten-languages-58-20261022}"
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
ARTIFACTS="$ROOT/.sandkasten/language-matrix"
mkdir -p "$ARTIFACTS"
if ! conda env list --json | python -c 'import json,sys; name=sys.argv[1]; sys.exit(not any(p.endswith("/"+name) for p in json.load(sys.stdin)["envs"]))' "$ENV_NAME"; then
  conda create --yes --name "$ENV_NAME" --override-channels --channel conda-forge python=3.12 nodejs=22 pip
fi
conda install --yes --name "$ENV_NAME" --override-channels --channel conda-forge \
  go=1.25.14 rust=1.90.0 ruby=3.4.8 lua=5.4.8 openjdk=21.0.10 kotlin=2.2.21 \
  nim=2.2.6 julia=1.12.7 r-base=4.5.3 swi-prolog=9.2.9 elixir=1.18.4 erlang=28.5 \
  zig=0.15.2 typst=0.14.2 tectonic=0.15.0 gleam=1.12.0 dotnet-sdk=10.0.401 \
  graphviz=13.1.2 gfortran_linux-64=15 ocaml=4.14.4 racket=7.8 poppler
PREFIX="$(conda run --name "$ENV_NAME" python -c 'import sys; print(sys.prefix)')"
conda run --name "$ENV_NAME" npm install --prefix "$PREFIX/share/sandkasten-node" --no-fund --no-audit \
  typescript@5.9.3 esbuild@0.27.2 react@19.2.0 react-dom@19.2.0 \
  vue@3.5.41 @vue/compiler-sfc@3.5.41 @vue/server-renderer@3.5.41 @mdx-js/mdx@3.1.1 \
  markdown-it@14.1.0 mermaid@11.12.2 jsdom@26.1.0 dompurify@3.3.1 \
  sass@1.97.3 tailwindcss@3.4.19 postcss@8.5.6 next@15.5.9
conda run --name "$ENV_NAME" pip install miniwdl==1.13.1
mkdir -p "$PREFIX/etc/conda/activate.d"
cat > "$PREFIX/etc/conda/activate.d/sandkasten-languages.sh" <<'ACTIVATE'
export NODE_PATH="$CONDA_PREFIX/share/sandkasten-node/node_modules"
export PATH="$CONDA_PREFIX/share/sandkasten-node/node_modules/.bin:$PATH"
export XDG_CACHE_HOME="$CONDA_PREFIX/share/sandkasten-cache"
export DOTNET_CLI_TELEMETRY_OPTOUT=1
export DOTNET_SKIP_FIRST_TIME_EXPERIENCE=1
ACTIVATE
conda list --name "$ENV_NAME" --explicit > "$ARTIFACTS/conda-explicit.txt"
conda env export --name "$ENV_NAME" > "$ARTIFACTS/environment.yml"
printf 'Activate %s, then run node scripts/language-matrix/run.mjs\n' "$ENV_NAME"
