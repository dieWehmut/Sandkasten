#!/usr/bin/env bash
set -Eeuo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"

need_tool() {
  local name="$1"
  local hint="$2"
  if ! command -v "$name" >/dev/null 2>&1; then
    printf 'missing required tool: %s\n%s\n' "$name" "$hint" >&2
    exit 127
  fi
}

need_path() {
  local path="$1"
  if [[ ! -e "$ROOT/$path" ]]; then
    printf 'missing required path: %s\n' "$path" >&2
    exit 1
  fi
}

need_tool buf "Install buf or run generation in a container that has buf available: https://buf.build/docs/installation"
need_path vertrag/buf.yaml
need_path vertrag/buf.gen.yaml
need_path schnittstelle
need_path laeufer/crates/laeufer-core/src

printf 'Generating protobuf bindings from vertrag/...\n'
(cd "$ROOT/vertrag" && buf generate)

if command -v gofmt >/dev/null 2>&1 && [[ -d "$ROOT/schnittstelle/gen" ]]; then
  find "$ROOT/schnittstelle/gen" -type f -name '*.go' -print0 | xargs -0r gofmt -w
elif [[ -d "$ROOT/schnittstelle/gen" ]]; then
  printf 'gofmt not found; generated Go files were not formatted\n' >&2
fi

if command -v rustfmt >/dev/null 2>&1 && [[ -d "$ROOT/laeufer/crates/laeufer-core/src/pb" ]]; then
  find "$ROOT/laeufer/crates/laeufer-core/src/pb" -type f -name '*.rs' -print0 | xargs -0r rustfmt --edition 2021
elif [[ -d "$ROOT/laeufer/crates/laeufer-core/src/pb" ]]; then
  printf 'rustfmt not found; generated Rust files were not formatted\n' >&2
fi

printf 'protobuf generation complete\n'
