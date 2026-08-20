#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
CANONICAL_REPO='https://github.com/dieWehmut/Sandkasten'
CANONICAL_CDN='https://cdn.jsdelivr.net/gh/dieWehmut/Sandkasten@main'
CANONICAL_CODELOAD='https://codeload.github.com/dieWehmut/Sandkasten/tar.gz'

repo_files=(
  README.md
  handbuch/README.en.md
  handbuch/README.ja.md
  handbuch/README.zh-TW.md
  werkzeug/deploy.sh
)
cdn_files=(
  README.md
  handbuch/README.en.md
  handbuch/README.ja.md
  handbuch/README.zh-TW.md
  handbuch/deployment.md
  werkzeug/deploy.sh
  werkzeug/uninstall.sh
)
checked_files=("${repo_files[@]}" "${cdn_files[@]}" werkzeug/install.sh)

fail() {
  printf 'repository path test: %s\n' "$*" >&2
  exit 1
}

for relative in "${repo_files[@]}"; do
  file="$ROOT/$relative"
  [[ -f "$file" ]] || fail "missing checked file: $relative"
  grep -Fq -- "$CANONICAL_REPO" "$file" || fail "$relative lacks canonical repository URL"
done

for relative in "${cdn_files[@]}"; do
  file="$ROOT/$relative"
  [[ -f "$file" ]] || fail "missing checked file: $relative"
  grep -Fq -- "$CANONICAL_CDN" "$file" || fail "$relative lacks canonical jsDelivr URL"
done

grep -Fq -- "$CANONICAL_CODELOAD" "$ROOT/werkzeug/install.sh" ||
  fail 'install.sh lacks canonical codeload URL'

for old in \
  'https://github.com/dieWehmut/sandkasten' \
  'https://cdn.jsdelivr.net/gh/dieWehmut/sandkasten' \
  'https://codeload.github.com/dieWehmut/sandkasten'; do
  for relative in "${checked_files[@]}"; do
    if grep -Fq -- "$old" "$ROOT/$relative"; then
      fail "$relative still uses the old lowercase repository path: $old"
    fi
  done
done

for relative in README.md handbuch/README.en.md handbuch/README.ja.md handbuch/README.zh-TW.md; do
  if grep -Eq '^[[:space:]]*cd sandkasten[[:space:]]*$' "$ROOT/$relative"; then
    fail "$relative still uses the lowercase clone directory"
  fi
done

printf 'repository path tests: ok\n'
