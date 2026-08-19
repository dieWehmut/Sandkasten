#!/usr/bin/env bash

# Keep this catalog in the same order as the legacy deployer. Numeric language
# selections are one-based and are resolved against this array.
LANGS=(
  go assembly bash c cangjie clojure css cpp csharp coq crystal dart elixir
  erlang fsharp fortran gdscript gleam graphviz haskell html java javascript
  julia kotlin lean4 latex lua markdown mdx mojo nextjs nextflow nim octave
  ocaml pascal perl php prolog python qml r racket ruby rust scala scss sql
  swift tailwindcss typescript tsx typst vlang vue3 wdl zig
)

PRESET_CORE=(go python javascript typescript bash c cpp rust java ruby php html css sql lua)
PRESET_WEB=(html css scss tailwindcss javascript typescript tsx vue3 nextjs markdown mdx)

SELECTED_LANGS=()

parse_languages() {
  local raw="${1:-}"
  [[ -n "$raw" ]] || { installer_error "languages cannot be empty"; return 2; }
  [[ "$raw" =~ (^|,)[[:space:]]*(,|$) ]] && {
    installer_error "languages contain an empty selection"
    return 2
  }

  local -A picked=()
  local token lo hi n lang
  raw="${raw//,/ }"
  read -r -a _language_tokens <<< "$raw"
  [[ ${#_language_tokens[@]} -gt 0 ]] || { installer_error "languages cannot be empty"; return 2; }

  for token in "${_language_tokens[@]}"; do
    [[ -n "$token" ]] || { installer_error "empty language selection"; return 2; }
    case "${token,,}" in
      all)
        for lang in "${LANGS[@]}"; do picked["$lang"]=1; done ;;
      core)
        for lang in "${PRESET_CORE[@]}"; do picked["$lang"]=1; done ;;
      web)
        for lang in "${PRESET_WEB[@]}"; do picked["$lang"]=1; done ;;
      *-*)
        lo="${token%-*}"; hi="${token#*-}"
        [[ "$lo" =~ ^[0-9]+$ && "$hi" =~ ^[0-9]+$ ]] || {
          installer_error "invalid language range '$token'"; return 2;
        }
        (( ${#lo} <= 3 && ${#hi} <= 3 )) || {
          installer_error "language range '$token' is too large"; return 2;
        }
        lo=$((10#$lo)); hi=$((10#$hi))
        (( lo >= 1 && hi >= lo && hi <= ${#LANGS[@]} )) || {
          installer_error "language range '$token' is outside 1-${#LANGS[@]}"; return 2;
        }
        for ((n = lo; n <= hi; n++)); do picked["${LANGS[$((n - 1))]}"]=1; done ;;
      [0-9]*)
        [[ "$token" =~ ^[0-9]+$ ]] || { installer_error "invalid language '$token'"; return 2; }
        (( ${#token} <= 3 )) || { installer_error "invalid language '$token'"; return 2; }
        n=$((10#$token))
        (( n >= 1 && n <= ${#LANGS[@]} )) || {
          installer_error "language '$token' is outside 1-${#LANGS[@]}"; return 2;
        }
        picked["${LANGS[$((n - 1))]}"]=1 ;;
      *)
        lang="${token,,}"
        [[ " ${LANGS[*]} " == *" $lang "* ]] || {
          installer_error "unknown language '$token'"; return 2;
        }
        picked["$lang"]=1 ;;
    esac
  done

  SELECTED_LANGS=()
  for lang in "${LANGS[@]}"; do
    [[ -n "${picked[$lang]:-}" ]] && SELECTED_LANGS+=("$lang")
  done
  ((${#SELECTED_LANGS[@]} > 0)) || { installer_error "no languages selected"; return 2; }
  INSTALL_LANGUAGES="$(IFS=,; printf '%s' "${SELECTED_LANGS[*]}")"
}

# Legacy name retained for callers that source the old deployer.
parse_lang_selection() { parse_languages "$@"; }
