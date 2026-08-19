#!/usr/bin/env bash

# Shared installer state and argument helpers. This file is safe to source in
# parser tests: it does not inspect the host or perform privileged operations.

INSTALL_MODE="${INSTALL_MODE:-cli}"
INSTALL_LANGUAGES="${INSTALL_LANGUAGES:-}"
NONINTERACTIVE="${NONINTERACTIVE:-false}"
DRY_RUN="${DRY_RUN:-false}"
INSTALL_COMMAND="${INSTALL_COMMAND:-menu}"

installer_error() {
  printf 'installer: %s\n' "$*" >&2
}

parse_mode() {
  local mode="${1:-}"
  case "$mode" in
    cli|webui) INSTALL_MODE="$mode"; return 0 ;;
    *) installer_error "invalid mode '$mode' (expected cli or webui)"; return 2 ;;
  esac
}

parse_bool_flag() {
  case "${1:-}" in
    --non-interactive|--noninteractive) NONINTERACTIVE=true ;;
    --dry-run) DRY_RUN=true ;;
    *) return 2 ;;
  esac
}

