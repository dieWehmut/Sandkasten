#!/usr/bin/env bash

_INSTALLER_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=lib.sh
source "${_INSTALLER_DIR}/lib.sh"
# shellcheck source=languages.sh
source "${_INSTALLER_DIR}/languages.sh"
if [[ -r "${_INSTALLER_DIR}/webui.sh" ]]; then
  # shellcheck source=webui.sh
  source "${_INSTALLER_DIR}/webui.sh"
fi

installer_usage() {
  cat <<'EOF'
Sandkasten installer

Usage:
  werkzeug/install.sh [--mode cli|webui] [--languages LIST] [--non-interactive] [--dry-run]
  werkzeug/install.sh install|status|restart|uninstall|languages|reconfigure|domain|menu

LIST accepts comma-separated names, one-based numbers, numeric ranges, or the
core, web, and all presets.
EOF
}

parse_args() {
  # Each invocation is independent. This matters when entrypoint.sh is
  # sourced by tests or by a process that dispatches multiple commands.
  INSTALL_MODE=cli
  parse_mode "${SANDKASTEN_INSTALL_MODE:-cli}" || return
  INSTALL_LANGUAGES="${SANDKASTEN_LANGUAGES:-}"
  NONINTERACTIVE="${SANDKASTEN_NONINTERACTIVE:-false}"
  DRY_RUN="${SANDKASTEN_DRY_RUN:-false}"
  ASSUME_YES="${SANDKASTEN_ASSUME_YES:-false}"
  PURGE="${SANDKASTEN_PURGE:-false}"
  INSTALL_COMMAND=menu

  local arg value
  while (($#)); do
    arg="$1"; shift
    case "$arg" in
      --mode)
        (($#)) || { installer_error '--mode requires cli or webui'; return 2; }
        parse_mode "$1" || return; shift ;;
      --mode=*) parse_mode "${arg#*=}" || return ;;
      --languages|-l)
        (($#)) || { installer_error '--languages requires a value'; return 2; }
        INSTALL_LANGUAGES="$1"; shift ;;
      --languages=*) INSTALL_LANGUAGES="${arg#*=}" ;;
      --non-interactive|--noninteractive|--dry-run) parse_bool_flag "$arg" ;;
      --yes|-y) ASSUME_YES=true ;;
      --purge) PURGE=true ;;
      -h|--help|help) INSTALL_COMMAND=help ;;
      install|status|restart|uninstall|languages|reconfigure|domain|menu)
        INSTALL_COMMAND="$arg" ;;
      '') INSTALL_COMMAND=menu ;;
      *) installer_error "unknown argument '$arg'"; return 2 ;;
    esac
  done

  if [[ -n "$INSTALL_LANGUAGES" ]]; then
    parse_languages "$INSTALL_LANGUAGES" || return
  elif [[ "$NONINTERACTIVE" == true ]]; then
    parse_languages core || return
  fi
}

source_legacy_deploy() {
  local deploy="$1" cleaned status
  if LC_ALL=C grep -q $'\r' "$deploy"; then
    cleaned="$(mktemp "${_INSTALLER_DIR}/../.deploy-source.XXXXXX.sh")"
    sed 's/\r$//' "$deploy" > "$cleaned"
    # shellcheck disable=SC1090
    if SANDKASTEN_SOURCE_ONLY=1 source "$cleaned"; then
      status=0
    else
      status=$?
    fi
    rm -f "$cleaned"
    return "$status"
  else
    # shellcheck disable=SC1090
    SANDKASTEN_SOURCE_ONLY=1 source "$deploy"
  fi
}

run_legacy_command() {
  local deploy="${_INSTALLER_DIR}/../deploy.sh"
  local mode="$INSTALL_MODE" languages="$INSTALL_LANGUAGES" noninteractive="$NONINTERACTIVE" assume_yes="$ASSUME_YES"
  local uninstaller="${_INSTALLER_DIR}/../uninstall.sh"
  if [[ "$INSTALL_COMMAND" == uninstall && -r "$uninstaller" ]]; then
    local args=() cleaned status
    [[ "$PURGE" == true ]] && args+=(--purge)
    [[ "$DRY_RUN" == true ]] && args+=(--dry-run)
    [[ "$ASSUME_YES" == true ]] && args+=(--yes)
    # Repository scripts may be checked out with CRLF; normalize only this
    # temporary execution copy so the standalone uninstaller remains intact.
    cleaned="$(mktemp "${_INSTALLER_DIR}/../.uninstall-source.XXXXXX.sh")"
    sed 's/\r$//' "$uninstaller" > "$cleaned"
    if WEBUI_ROOT="${SANDKASTEN_WEBUI_DIR:-${WEBUI_ROOT:-}}" \
      SANDKASTEN_INSTALL_MODE="$mode" bash "$cleaned" "${args[@]}"; then
      status=0
    else
      status=$?
    fi
    rm -f "$cleaned"
    return "$status"
  fi
  [[ -r "$deploy" ]] || { installer_error "legacy deployer not found"; return 1; }
  source_legacy_deploy "$deploy"
  # deploy.sh initializes its own legacy globals while loading, so restore
  # the parsed modular values at the source boundary before dispatch.
  NONINTERACTIVE="$noninteractive"
  SANDKASTEN_INSTALL_MODE="$mode"
  SANDKASTEN_LANGUAGES="$languages"
  ASSUME_YES="$assume_yes"
  export NONINTERACTIVE SANDKASTEN_INSTALL_MODE SANDKASTEN_LANGUAGES ASSUME_YES
  if [[ -n "${SANDKASTEN_WEBUI_DIR:-}" ]]; then
    WEBUI_ROOT="$SANDKASTEN_WEBUI_DIR"
    export WEBUI_ROOT
  fi
  require_root
  detect_os
  case "$INSTALL_COMMAND" in
    install|menu)
      run_install
      if [[ "$mode" == webui && "$INSTALL_COMMAND" == install ]] && declare -F install_webui_assets >/dev/null 2>&1; then
        install_webui_assets
        render_webui_nginx_config
        activate_webui_nginx
      fi
      ;;
    languages|reconfigure) reconfigure_languages ;;
    domain) configure_domain ;;
    status) show_status ;;
    restart) systemctl restart sandkasten-api.service sandkasten-laeufer.service ;;
    uninstall)
      if [[ "$mode" == webui ]] && declare -F remove_webui_assets >/dev/null 2>&1; then
        remove_webui_assets
        remove_webui_nginx_config
      fi
      # A WebUI dry-run is intentionally limited to marker-aware WebUI
      # cleanup. The legacy uninstaller has destructive operations without
      # dry-run guards, so do not dispatch it in this mode.
      [[ "$DRY_RUN" == true ]] || uninstall_all
      ;;
  esac
}

activate_webui_nginx() {
  [[ "${SANDKASTEN_INSTALL_MODE:-cli}" == webui ]] || return 0
  if [[ "${DRY_RUN:-false}" == true ]]; then
    printf '[dry-run] enable and reload managed Nginx site %s\n' "${NGINX_SITE_AVAIL:-/etc/nginx/sites-available/sandkasten.conf}"
    return 0
  fi
  local available="${NGINX_SITE_AVAIL:-/etc/nginx/sites-available/sandkasten.conf}"
  local enabled="${NGINX_SITE_ENABLED:-/etc/nginx/sites-enabled/sandkasten.conf}"
  [[ -f "$available" ]] || { installer_error "managed WebUI Nginx config not found: $available"; return 1; }
  grep -Fq -- '# sandkasten-webui-managed' "$available" || {
    installer_error "refusing to enable unmanaged Nginx config: $available"
    return 1
  }
  mkdir -p "$(dirname "$enabled")"
  if [[ -e "$enabled" && ! -L "$enabled" ]]; then
    installer_error "refusing to replace unmanaged Nginx site: $enabled"
    return 1
  fi
  if declare -F apt_install >/dev/null 2>&1; then
    apt_install nginx
  fi
  ln -sfn "$available" "$enabled"
  if command -v nginx >/dev/null 2>&1; then
    nginx -t >/dev/null 2>&1 || return 1
    systemctl reload nginx
  else
    installer_error 'nginx is required to enable the WebUI site'
    return 1
  fi
}

installer_main() {
  parse_args "$@" || return
  if [[ "$INSTALL_COMMAND" == help ]]; then installer_usage; return 0; fi
  if [[ "$DRY_RUN" == true ]]; then
    if [[ "$INSTALL_COMMAND" == uninstall && "$INSTALL_MODE" == webui ]]; then
      run_legacy_command || return
    fi
    printf 'mode=%s\n' "$INSTALL_MODE"
    printf 'languages=%s\n' "${INSTALL_LANGUAGES:-${SELECTED_LANGS[*]:-core}}"
    printf 'command=%s\n' "$INSTALL_COMMAND"
    return 0
  fi
  [[ "${SANDKASTEN_INSTALLER_TEST:-0}" == 1 ]] && return 0
  if [[ -z "$INSTALL_LANGUAGES" ]]; then
    [[ "$NONINTERACTIVE" == true ]] && parse_languages core
  fi
  run_legacy_command
}

if [[ "${BASH_SOURCE[0]}" == "$0" ]]; then
  installer_main "$@"
fi
