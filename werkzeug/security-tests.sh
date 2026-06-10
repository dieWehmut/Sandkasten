#!/usr/bin/env bash
set -Eeuo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

cd "$ROOT/laeufer"
cargo test -p laeufer-sandbox --test security_blackbox -- --ignored --nocapture
