#!/usr/bin/env bash

# WebUI deployment helpers. Functions are intentionally side-effect free when
# DRY_RUN=true so they can be used by installer previews and tests.

WEBUI_ROOT="${WEBUI_ROOT:-${SANDKASTEN_WEBUI_DIR:-/opt/sandkasten/webui}}"
NGINX_SITE_AVAIL="${NGINX_SITE_AVAIL:-/etc/nginx/sites-available/sandkasten.conf}"
NGINX_SITE_ENABLED="${NGINX_SITE_ENABLED:-/etc/nginx/sites-enabled/sandkasten.conf}"
HTTP_PORT="${HTTP_PORT:-8080}"
WEBUI_MANAGED_MARKER="${WEBUI_MANAGED_MARKER:-sandkasten-webui-managed}"
NGINX_MANAGED_MARKER="# sandkasten-webui-managed"
WEBUI_DIST_FILES=(index.html app.js styles.css config.js)

_webui_error() {
  printf 'webui: %s\n' "$*" >&2
}

validate_webui_root() {
  local root="${WEBUI_ROOT:-}" canonical
  [[ -n "$root" && "$root" == /* ]] || {
    _webui_error "WEBUI_ROOT must be an absolute path"
    return 1
  }
  [[ "$root" =~ ^/[A-Za-z0-9._/-]+$ ]] || {
    _webui_error "WEBUI_ROOT contains unsupported characters: $root"
    return 1
  }
  case "$root" in
    */../*|*/..|../*|..) _webui_error "WEBUI_ROOT contains traversal: $root"; return 1 ;;
  esac
  command -v realpath >/dev/null 2>&1 || {
    _webui_error "realpath is required to validate WEBUI_ROOT"
    return 1
  }
  canonical="$(realpath -m -- "$root")" || {
    _webui_error "unable to canonicalize WEBUI_ROOT"
    return 1
  }
  case "$canonical" in
    /|/tmp|/var|/usr|/etc|/home|/root|/opt|/opt/sandkasten)
      _webui_error "WEBUI_ROOT is too broad or protected: $root"
      return 1
      ;;
  esac
}

validate_webui_source() {
  local source="${REPO_ROOT:-}/webui/dist" entry name entry_count=0
  [[ -n "${REPO_ROOT:-}" && -d "$source" && ! -L "$source" ]] || {
    _webui_error "WebUI distribution directory not found or is not a regular directory: $source"
    return 1
  }

  for name in "${WEBUI_DIST_FILES[@]}"; do
    [[ -f "$source/$name" && ! -L "$source/$name" && -r "$source/$name" ]] || {
      _webui_error "WebUI distribution requires a readable regular file: $source/$name"
      return 1
    }
  done

  while IFS= read -r -d '' entry; do
    entry_count=$((entry_count + 1))
    name="${entry##*/}"
    [[ -f "$entry" && ! -L "$entry" ]] || {
      _webui_error "WebUI distribution contains a non-regular entry: $entry"
      return 1
    }
    case " ${WEBUI_DIST_FILES[*]} " in
      *" $name "*) ;;
      *)
        _webui_error "WebUI distribution contains an unexpected file: $entry"
        return 1
        ;;
    esac
  done < <(find "$source" -mindepth 1 -maxdepth 1 -print0)

  [[ "$entry_count" -eq "${#WEBUI_DIST_FILES[@]}" ]] || {
    _webui_error "WebUI distribution must contain exactly ${#WEBUI_DIST_FILES[@]} files: $source"
    return 1
  }
}

is_managed_webui_root() {
  local root="${1:-$WEBUI_ROOT}" marker
  [[ -d "$root" && ! -L "$root" ]] || return 1
  marker="$root/.${WEBUI_MANAGED_MARKER}"
  [[ -f "$marker" && ! -L "$marker" ]] || return 1
  [[ "$(<"$marker")" == "managed-by=sandkasten" ]]
}

install_webui_assets() {
  validate_webui_root || return
  validate_webui_source || return
  if [[ "${DRY_RUN:-false}" == true ]]; then
    printf '[dry-run] install WebUI assets from %s to %s\n' "${REPO_ROOT}/webui/dist" "$WEBUI_ROOT"
    return 0
  fi

  local parent stage backup name source="${REPO_ROOT}/webui/dist"
  parent="$(dirname "$WEBUI_ROOT")"
  mkdir -p "$parent"
  if [[ -e "$WEBUI_ROOT" || -L "$WEBUI_ROOT" ]] && ! is_managed_webui_root "$WEBUI_ROOT"; then
    _webui_error "refusing to replace unmanaged WebUI directory: $WEBUI_ROOT"
    return 1
  fi

  stage="$(mktemp -d "${WEBUI_ROOT}.staging.XXXXXX")" || return 1
  for name in "${WEBUI_DIST_FILES[@]}"; do
    if ! cp -p -- "$source/$name" "$stage/$name"; then
      rm -rf "$stage"
      _webui_error "failed to stage WebUI asset: $name"
      return 1
    fi
  done
  printf '%s\n' "managed-by=sandkasten" > "$stage/.${WEBUI_MANAGED_MARKER}"

  # Rename the old managed tree aside, publish the complete staged tree, then
  # remove the old tree. This avoids exposing a partially copied directory.
  backup=""
  if [[ -e "$WEBUI_ROOT" ]]; then
    backup="$(mktemp -d "${WEBUI_ROOT}.old.XXXXXX")" || { rm -rf "$stage"; return 1; }
    rmdir "$backup"
    mv "$WEBUI_ROOT" "$backup" || { rm -rf "$stage" "$backup"; return 1; }
  fi
  if ! mv "$stage" "$WEBUI_ROOT"; then
    [[ -n "$backup" ]] && mv "$backup" "$WEBUI_ROOT" || true
    rm -rf "$stage"
    return 1
  fi
  if [[ -n "$backup" ]]; then
    rm -rf "$backup"
  fi
  return 0
}

render_webui_nginx_config() {
  local output="${1:-$NGINX_SITE_AVAIL}" mode="${SANDKASTEN_INSTALL_MODE:-webui}"
  [[ "$mode" != webui ]] || { validate_webui_root || return; }
  if [[ -L "$output" ]]; then
    _webui_error "refusing to replace Nginx symlink: $output"
    return 1
  fi
  if [[ -e "$output" ]] && ! grep -Fq -- "$NGINX_MANAGED_MARKER" "$output" 2>/dev/null; then
    _webui_error "refusing to replace unmanaged Nginx config: $output"
    return 1
  fi
  if [[ "${DRY_RUN:-false}" == true ]]; then
    printf '[dry-run] render Nginx config to %s\n' "$output"
    return 0
  fi
  mkdir -p "$(dirname "$output")"
  cat > "$output" <<EOF
$NGINX_MANAGED_MARKER
server {
    listen 80;
    listen [::]:80;
    server_name _;
EOF
  if [[ "$mode" == webui ]]; then
    cat >> "$output" <<EOF
    root $WEBUI_ROOT;
    index index.html;

    location / {
        try_files \$uri \$uri/ /index.html;
    }
EOF
  else
    cat >> "$output" <<'EOF'
    location / {
        proxy_pass http://127.0.0.1:__SANDKASTEN_HTTP_PORT__;
    }
EOF
  fi
  cat >> "$output" <<EOF

    location /v1/ {
        proxy_pass http://127.0.0.1:$HTTP_PORT;
        proxy_http_version 1.1;
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
        proxy_read_timeout 120s;
    }

    location = /healthz {
        proxy_pass http://127.0.0.1:$HTTP_PORT;
        proxy_http_version 1.1;
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
    }
}
EOF
  if [[ "$mode" != webui ]]; then
    sed -i "s/__SANDKASTEN_HTTP_PORT__/$HTTP_PORT/" "$output"
  fi
}

remove_webui_assets() {
  validate_webui_root || return 1
  [[ -e "$WEBUI_ROOT" || -L "$WEBUI_ROOT" ]] || return 0
  is_managed_webui_root "$WEBUI_ROOT" || {
    _webui_error "preserving unmanaged WebUI directory: $WEBUI_ROOT"
    return 0
  }
  if [[ "${DRY_RUN:-false}" == true ]]; then
    printf '[dry-run] remove WebUI assets %s\n' "$WEBUI_ROOT"
  else
    rm -rf "$WEBUI_ROOT"
  fi
}

remove_managed_webui_nginx() {
  local avail="${1:-$NGINX_SITE_AVAIL}" enabled="${2:-$NGINX_SITE_ENABLED}"
  local remove_enabled=false avail_real enabled_real
  [[ -f "$avail" ]] || return 0
  grep -Fq -- "$NGINX_MANAGED_MARKER" "$avail" || return 0
  if [[ -L "$enabled" ]]; then
    avail_real="$(readlink -f -- "$avail" 2>/dev/null || true)"
    enabled_real="$(readlink -f -- "$enabled" 2>/dev/null || true)"
    [[ -n "$avail_real" && "$avail_real" == "$enabled_real" ]] || return 0
    remove_enabled=true
  elif [[ -e "$enabled" ]]; then
    # An unrelated regular enabled file must never be removed.
    return 0
  fi
  if [[ "${DRY_RUN:-false}" == true ]]; then
    printf '[dry-run] remove managed Nginx config %s%s\n' "$avail" "$([[ "$remove_enabled" == true ]] && printf ' and %s' "$enabled")"
    return 0
  fi
  rm -f "$avail"
  if [[ "$remove_enabled" == true ]]; then
    rm -f "$enabled"
  fi
  return 0
}

remove_webui_nginx_config() { remove_managed_webui_nginx "$@"; }
