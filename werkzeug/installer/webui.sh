#!/usr/bin/env bash

# WebUI deployment helpers. Functions are intentionally side-effect free when
# DRY_RUN=true so they can be used by installer previews and tests.

WEBUI_ROOT="${WEBUI_ROOT:-/opt/sandkasten/webui}"
NGINX_SITE_AVAIL="${NGINX_SITE_AVAIL:-/etc/nginx/sites-available/sandkasten.conf}"
NGINX_SITE_ENABLED="${NGINX_SITE_ENABLED:-/etc/nginx/sites-enabled/sandkasten.conf}"
HTTP_PORT="${HTTP_PORT:-8080}"
WEBUI_MANAGED_MARKER="${WEBUI_MANAGED_MARKER:-sandkasten-webui-managed}"
NGINX_MANAGED_MARKER="# sandkasten-webui-managed"

_webui_error() {
  printf 'webui: %s\n' "$*" >&2
}

validate_webui_source() {
  local source="${REPO_ROOT:-}/webui"
  [[ -n "${REPO_ROOT:-}" && -d "$source" ]] || {
    _webui_error "WebUI source directory not found: $source"
    return 1
  }
  [[ -f "$source/index.html" ]] || {
    _webui_error "WebUI source is missing index.html: $source"
    return 1
  }
  [[ -r "$source/index.html" ]] || {
    _webui_error "WebUI entrypoint is not readable: $source/index.html"
    return 1
  }
}

install_webui_assets() {
  validate_webui_source || return
  if [[ "${DRY_RUN:-false}" == true ]]; then
    printf '[dry-run] install WebUI assets from %s to %s\n' "${REPO_ROOT}/webui" "$WEBUI_ROOT"
    return 0
  fi

  local parent stage backup source="${REPO_ROOT}/webui"
  parent="$(dirname "$WEBUI_ROOT")"
  mkdir -p "$parent"
  if [[ -e "$WEBUI_ROOT" && ! -f "$WEBUI_ROOT/.${WEBUI_MANAGED_MARKER}" ]]; then
    _webui_error "refusing to replace unmanaged WebUI directory: $WEBUI_ROOT"
    return 1
  fi

  stage="$(mktemp -d "${WEBUI_ROOT}.staging.XXXXXX")" || return 1
  if ! cp -a "$source"/. "$stage"/; then
    rm -rf "$stage"
    _webui_error "failed to stage WebUI assets"
    return 1
  fi
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
  [[ -e "$WEBUI_ROOT" || -L "$WEBUI_ROOT" ]] || return 0
  [[ -f "$WEBUI_ROOT/.${WEBUI_MANAGED_MARKER}" ]] || {
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
  [[ -f "$avail" ]] || return 0
  grep -Fq -- "$NGINX_MANAGED_MARKER" "$avail" || return 0
  if [[ "${DRY_RUN:-false}" == true ]]; then
    printf '[dry-run] remove managed Nginx config %s and %s\n' "$avail" "$enabled"
    return 0
  fi
  rm -f "$enabled" "$avail"
}

remove_webui_nginx_config() { remove_managed_webui_nginx "$@"; }
