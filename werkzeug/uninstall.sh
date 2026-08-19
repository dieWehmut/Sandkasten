#!/usr/bin/env bash
#========================================================
# Sandkasten 卸载脚本 / Sandkasten uninstaller
#
# 与 werkzeug/deploy.sh 一一对应地清除已部署内容,支持分层确认:
#   1) 停止并移除 systemd 服务与 API/runner 二进制
#   2) 删除配置 (/etc/sandkasten) 与状态目录 (/var/lib/sandkasten)
#   3) 删除数据库角色与库
#   4) 删除自定义下载的语言工具链 (/opt/* 及 /usr/local/bin 符号链接)
#   5) 删除全局 npm 包 (sass/esbuild/... 于 /usr/local/lib/node_modules)
#   6) 删除 /usr/local/go(仅当由本脚本安装)
#   7) 删除 Nginx 站点与 Let's Encrypt 证书
#   8) 删除服务账户 sandkasten-api
#
# 默认交互式逐项确认;`--purge` 一键全清(仍会二次确认);`--dry-run` 只打印不删除。
# apt 系统包(gcc/python3/nodejs 等)默认保留,仅列出,避免影响系统其它组件。
#
# 免克隆一键卸载(推荐):
#   curl -fsSL https://cdn.jsdelivr.net/gh/dieWehmut/sandkasten@main/werkzeug/uninstall.sh -o sk-uninstall.sh \
#     && chmod +x sk-uninstall.sh && sudo ./sk-uninstall.sh --purge
# 本脚本所有路径均为硬编码,无需仓库即可运行。
#
# 或在仓库内运行: sudo ./werkzeug/uninstall.sh [--purge] [--dry-run] [--yes]
#========================================================
set -Eeuo pipefail

#--------------------------------------------------------
# 常量(与 deploy.sh 保持一致)
#--------------------------------------------------------
REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." 2>/dev/null && pwd || echo "")"
BIN_DIR="/usr/local/bin"
ETC_DIR="/etc/sandkasten"
STATE_DIR="/var/lib/sandkasten"
OPT_DIR="/opt/sandkasten"
SYSTEMD_DIR="/etc/systemd/system"
NODE_MODULES="/usr/local/lib/node_modules"
WEBUI_ROOT="${WEBUI_ROOT:-${SANDKASTEN_WEBUI_DIR:-${OPT_DIR}/webui}}"
NGINX_SITE_AVAIL="${NGINX_SITE_AVAIL:-/etc/nginx/sites-available/sandkasten.conf}"
NGINX_SITE_ENABLED="${NGINX_SITE_ENABLED:-/etc/nginx/sites-enabled/sandkasten.conf}"

API_USER="sandkasten-api"
API_GROUP="sandkasten-api"
DB_NAME="sandkasten"
DB_USER="sandkasten"

PURGE=false
DRY_RUN=false
ASSUME_YES=false

# Reuse marker-aware WebUI cleanup when this is a repository checkout. A
# downloaded standalone uninstaller still uses the guarded fallback below.
_WEBUI_MODULE="${REPO_ROOT}/werkzeug/installer/webui.sh"
if [[ -r "$_WEBUI_MODULE" ]]; then
  # shellcheck disable=SC1090
  source "$_WEBUI_MODULE"
fi

_uninstall_webui_root_safe() {
  local root="${WEBUI_ROOT:-}" canonical
  [[ -n "$root" && "$root" == /* ]] || return 1
  case "$root" in */../*|*/..|../*|..|/|/tmp|/var|/usr|/etc|/home|/root|/opt|/opt/sandkasten) return 1 ;; esac
  if command -v realpath >/dev/null 2>&1; then
    canonical="$(realpath -m -- "$root")" || canonical="$root"
  else
    canonical="$root"
  fi
  case "$canonical" in /|/tmp|/var|/usr|/etc|/home|/root|/opt|/opt/sandkasten) return 1 ;; esac
}

_confirm_remove_webui_assets() {
  local marker=".${WEBUI_MANAGED_MARKER:-sandkasten-webui-managed}"
  [[ -f "$WEBUI_ROOT/$marker" ]] || return 0
  if confirm_step "delete managed WebUI assets at $WEBUI_ROOT?"; then
    if declare -F remove_webui_assets >/dev/null 2>&1; then
      remove_webui_assets || warn "WebUI assets could not be removed"
    elif _uninstall_webui_root_safe; then
      rm_path "$WEBUI_ROOT"
    else
      warn "refusing unsafe WebUI root: $WEBUI_ROOT"
    fi
  fi
}

#--------------------------------------------------------
# 彩色输出
#--------------------------------------------------------
if [[ -t 1 ]]; then
  C_RED=$'\033[31m'; C_GREEN=$'\033[32m'; C_YELLOW=$'\033[33m'
  C_BLUE=$'\033[36m'; C_BOLD=$'\033[1m'; C_DIM=$'\033[2m'; C_RESET=$'\033[0m'
else
  C_RED=""; C_GREEN=""; C_YELLOW=""; C_BLUE=""; C_BOLD=""; C_DIM=""; C_RESET=""
fi
info()  { printf '%s[*]%s %s\n' "$C_BLUE"  "$C_RESET" "$*"; }
ok()    { printf '%s[+]%s %s\n' "$C_GREEN" "$C_RESET" "$*"; }
warn()  { printf '%s[!]%s %s\n' "$C_YELLOW" "$C_RESET" "$*" >&2; }
err()   { printf '%s[x]%s %s\n' "$C_RED"   "$C_RESET" "$*" >&2; }
die()   { err "$*"; exit 1; }
hr()    { printf '%s────────────────────────────────────────────────────────%s\n' "$C_DIM" "$C_RESET"; }
title() { printf '\n%s%s%s\n' "$C_BOLD" "$*" "$C_RESET"; hr; }

# 分步确认。--dry-run 进入每个区块以预览(实际删除由 rm_* 助手拦截);
# --purge/--yes 直接执行;否则交互询问。
confirm_step() {
  local prompt="$1" reply
  [[ "$DRY_RUN" == true ]] && return 0
  [[ "$ASSUME_YES" == true || "$PURGE" == true ]] && return 0
  read -r -p "$prompt [y/N] " reply || true
  [[ "$reply" =~ ^[Yy]$ ]]
}

#--------------------------------------------------------
# 删除助手:统一处理 dry-run 与不存在的情况
#--------------------------------------------------------
# rm_path <路径...>
rm_path() {
  local p
  for p in "$@"; do
    [[ -z "$p" || "$p" == "/" ]] && { warn "拒绝删除危险路径: '$p'"; continue; }
    if [[ -e "$p" || -L "$p" ]]; then
      if [[ "$DRY_RUN" == true ]]; then
        info "[dry-run] 将删除: $p"
      else
        rm -rf "$p" && ok "已删除: $p"
      fi
    fi
  done
}

# rm_symlink_if_points <链接> <期望目标前缀>
# 仅当 <链接> 是符号链接且指向以 <期望前缀> 开头的目标时才删除,
# 避免误删同名的第三方二进制。
rm_symlink_if_points() {
  local link="$1" want="$2" tgt
  [[ -L "$link" ]] || { [[ -e "$link" ]] && warn "$link 不是符号链接,保留(可能非本脚本安装)。"; return 0; }
  # 用单层 readlink 读取"链接文本",不做 -f 全解析:否则当目标 /opt/... 已被
  # 先删除时,readlink -f 返回空字符串,会把我们自己的悬空链接误判为"非本脚本"
  # 而保留,留下死链接。比对链接文本前缀即可,目标是否仍存在都不影响判断。
  tgt="$(readlink "$link")"
  if [[ "$tgt" == "$want"* ]]; then
    if [[ "$DRY_RUN" == true ]]; then info "[dry-run] 将删除符号链接: $link -> $tgt"
    else rm -f "$link" && ok "已删除符号链接: $link"; fi
  else
    warn "$link -> $tgt 不指向本脚本安装目录($want*),保留。"
  fi
  return 0
}

# scan_dead_symlinks_into <目录> <目标前缀>
# 兜底:删除 <目录> 下所有指向 <目标前缀> 的符号链接(含已悬空者)。
# 用于清理 npm 全局 bin 等由脚本间接创建、难以逐一枚举的链接。
scan_dead_symlinks_into() {
  local dir="$1" want="$2" link tgt
  [[ -d "$dir" ]] || return 0
  for link in "$dir"/*; do
    [[ -L "$link" ]] || continue
    tgt="$(readlink "$link")"
    case "$tgt" in
      "$want"*|*/"$want"*)
        if [[ "$DRY_RUN" == true ]]; then info "[dry-run] 将删除链接: $link -> $tgt"
        else rm -f "$link" && ok "已删除链接: $link"; fi
        ;;
    esac
  done
}

require_root() {
  [[ "${EUID:-$(id -u)}" -eq 0 ]] || die "请以 root 运行(sudo ./werkzeug/uninstall.sh)。"
}

# 以 postgres 超级用户身份执行(优先 runuser,回退 sudo/su;最小化 Debian 无 sudo)
pg_super() {
  if command -v runuser >/dev/null 2>&1; then
    runuser -u postgres -- "$@"
  elif command -v sudo >/dev/null 2>&1; then
    sudo -u postgres "$@"
  else
    su postgres -s /bin/sh -c "$(printf '%q ' "$@")"
  fi
}

#========================================================
# 1) systemd 服务与二进制
#========================================================
remove_services() {
  title "1) 停止并移除 systemd 服务与二进制"
  if confirm_step "停止/禁用/删除 sandkasten-api 与 sandkasten-laeufer 服务及二进制?"; then
    if [[ "$DRY_RUN" != true ]]; then
      systemctl disable --now sandkasten-api.service sandkasten-laeufer.service 2>/dev/null || true
      systemctl reset-failed sandkasten-api.service sandkasten-laeufer.service 2>/dev/null || true
    fi
    rm_path "${SYSTEMD_DIR}/sandkasten-api.service" "${SYSTEMD_DIR}/sandkasten-laeufer.service"
    # 清理 enable 时生成的 .wants 符号链接(disable 通常已处理,兜底)
    rm_path "${SYSTEMD_DIR}/multi-user.target.wants/sandkasten-api.service" \
            "${SYSTEMD_DIR}/multi-user.target.wants/sandkasten-laeufer.service"
    [[ "$DRY_RUN" != true ]] && systemctl daemon-reload || true
    rm_path "${BIN_DIR}/sandkasten-api" "${BIN_DIR}/laeufer"
    ok "服务与主二进制处理完成。"
  else
    info "跳过。"
  fi
}

#========================================================
# 2) 配置与状态目录
#========================================================
remove_config_state() {
  title "2) 删除配置与状态目录"
  if confirm_step "删除 ${ETC_DIR}(含 env 文件与备份)与 ${STATE_DIR}(含 sandbox)?"; then
    rm_path "$ETC_DIR" "$STATE_DIR"
  else
    info "跳过(保留配置与状态)。"
  fi
}

#========================================================
# 3) 数据库
#========================================================
remove_database() {
  title "3) 删除 PostgreSQL 数据库与角色"
  if ! command -v psql >/dev/null 2>&1; then
    info "未检测到 psql,跳过数据库清理。"; return
  fi
  if confirm_step "删除数据库 ${DB_NAME} 与角色 ${DB_USER}(数据不可恢复)?"; then
    if [[ "$DRY_RUN" == true ]]; then
      info "[dry-run] 将执行 dropdb ${DB_NAME}; dropuser ${DB_USER}"
    else
      pg_super dropdb --if-exists "${DB_NAME}" 2>/dev/null && ok "已删除数据库 ${DB_NAME}" || warn "删除数据库失败或不存在。"
      pg_super dropuser --if-exists "${DB_USER}" 2>/dev/null && ok "已删除角色 ${DB_USER}" || warn "删除角色失败或不存在。"
    fi
  else
    info "跳过(保留数据库)。"
  fi
}

#========================================================
# 4) 自定义下载的语言工具链 (/opt + 符号链接)
#========================================================
remove_toolchains() {
  title "4) 删除自定义下载的语言工具链"
  if ! confirm_step "删除 /opt 下由 deploy.sh 安装的语言 SDK 及其 /usr/local/bin 符号链接?"; then
    info "跳过(保留工具链)。"; return
  fi

  # /usr/local/bin 符号链接:仅当指向 /opt/... 时删除
  rm_symlink_if_points "${BIN_DIR}/zig"    "/opt/zig-"
  rm_symlink_if_points "${BIN_DIR}/julia"  "/opt/julia-"
  rm_symlink_if_points "${BIN_DIR}/dart"   "/opt/dart-sdk"
  rm_symlink_if_points "${BIN_DIR}/dotnet" "/opt/dotnet"
  rm_symlink_if_points "${BIN_DIR}/swift"  "/opt/swift-"
  rm_symlink_if_points "${BIN_DIR}/swiftc" "/opt/swift-"
  rm_symlink_if_points "${BIN_DIR}/lean"   "/opt/lean-"
  rm_symlink_if_points "${BIN_DIR}/lake"   "/opt/lean-"
  rm_symlink_if_points "${BIN_DIR}/v"      "/opt/v"
  rm_symlink_if_points "${BIN_DIR}/typst"  "/opt/typst-"
  rm_symlink_if_points "${BIN_DIR}/pixi"   "/opt/pixi"
  rm_symlink_if_points "${BIN_DIR}/miniwdl" "/opt/miniwdl"

  # 由脚本生成的 wrapper 脚本(非符号链接,单独处理)
  for wrapper in mojo cjc nextflow nextflow-launcher gleam tectonic; do
    if [[ -f "${BIN_DIR}/${wrapper}" && ! -L "${BIN_DIR}/${wrapper}" ]]; then
      rm_path "${BIN_DIR}/${wrapper}"
    fi
  done
  # lua/luac 符号链接指向系统 /usr/bin,由 deploy.sh 创建,可安全删除
  rm_symlink_if_points "${BIN_DIR}/lua"  "/usr/bin/lua"
  rm_symlink_if_points "${BIN_DIR}/luac" "/usr/bin/luac"

  # /opt 目录(通配匹配版本化目录)
  local opt_globs=(
    "/opt/zig-x86_64-linux-"* "/opt/julia-"* "/opt/dart-sdk" "/opt/dart-sdk-"*
    "/opt/dotnet" "/opt/swift-"*"-debian12" "/opt/lean-"*"-linux" "/opt/v"
    "/opt/typst-x86_64-unknown-linux-musl" "/opt/pixi" "/opt/mojo"
    "/opt/miniwdl" "/opt/cangjie"
  )
  local g
  for g in "${opt_globs[@]}"; do
    # 展开通配;无匹配时 glob 原样返回,rm_path 会跳过不存在项
    local matched=false p
    for p in $g; do [[ -e "$p" ]] && { rm_path "$p"; matched=true; }; done
    [[ "$matched" == false && "$DRY_RUN" == true ]] && info "[dry-run] 无匹配: $g"
  done
  ok "工具链清理完成(${OPT_DIR}、各 SDK 目录与链接)。"
}

#========================================================
# 5) 全局 npm 包
#========================================================
remove_npm_globals() {
  title "5) 删除全局 npm 包"
  if [[ ! -d "$NODE_MODULES" ]]; then info "未发现 ${NODE_MODULES},跳过。"; return; fi
  if ! confirm_step "删除 deploy.sh 安装的全局 npm 包(sass/esbuild/react/vue/next/tailwind/typescript/mermaid 等)?"; then
    info "跳过(保留 npm 包)。"; return
  fi
  local pkgs=(
    sass esbuild typescript tailwindcss postcss autoprefixer
    react react-dom vue @vue/compiler-sfc @vue/server-renderer next
    markdown-it mermaid jsdom dompurify @mdx-js/mdx
    @mermaid-js/mermaid-cli puppeteer
    @types/react @types/react-dom @types/node
  )
  if command -v npm >/dev/null 2>&1 && [[ "$DRY_RUN" != true ]]; then
    PUPPETEER_SKIP_DOWNLOAD=true npm remove -g --prefix /usr/local "${pkgs[@]}" >/dev/null 2>&1 || warn "部分 npm 包移除失败或未安装。"
    ok "全局 npm 包已移除。"
  elif [[ "$DRY_RUN" == true ]]; then
    info "[dry-run] 将 npm remove -g: ${pkgs[*]}"
  else
    warn "未找到 npm(可能已先被卸载),改用直接删除包目录兜底。"
  fi
  # 兜底:清理 /usr/local/bin 中仍指向 node_modules 的悬空/残留链接
  scan_dead_symlinks_into "$BIN_DIR" "../lib/node_modules"
  # 兜底:npm 缺失时直接删除我们安装过的包目录
  if [[ -d "$NODE_MODULES" ]]; then
    local pkg
    for pkg in "${pkgs[@]}"; do rm_path "${NODE_MODULES}/${pkg}"; done
    # 若目录已空则一并删除
    if [[ "$DRY_RUN" != true ]] && [[ -d "$NODE_MODULES" ]] && [[ -z "$(ls -A "$NODE_MODULES" 2>/dev/null)" ]]; then
      rm_path "$NODE_MODULES"
    elif [[ -d "$NODE_MODULES" ]]; then
      info "${NODE_MODULES} 仍有其它包,保留(仅删除本脚本安装的包)。"
    fi
  fi
}

#========================================================
# 6) /usr/local/go(仅当由脚本安装)
#========================================================
remove_go() {
  title "6) 删除 /usr/local/go"
  if [[ ! -d /usr/local/go ]]; then info "未发现 /usr/local/go,跳过。"; return; fi
  warn "部分系统的 /usr/local/go 可能是你手动安装的常用工具链。"
  if confirm_step "删除 /usr/local/go?"; then
    rm_path /usr/local/go
  else
    info "跳过(保留 Go)。"
  fi
}

#========================================================
# 6.5) 构建副产物(Rust/Go 缓存与仓库 target)
#========================================================
remove_build_artifacts() {
  title "6.5) 删除构建副产物与工具链缓存"
  local caches=(
    "$HOME/.cargo" "$HOME/.rustup"
    "$HOME/.cache/go-build" "$HOME/go"
    "$HOME/.pixi"
  )
  # 仓库内的 Rust/Go 构建产物(若能定位到仓库)
  local repo=""
  if [[ -d "${REPO_ROOT:-}" ]]; then repo="$REPO_ROOT"
  elif [[ -d /root/sandkasten ]]; then repo="/root/sandkasten"; fi
  [[ -n "$repo" ]] && caches+=("$repo/laeufer/target")
  # 免克隆一键安装时源码克隆到 /opt/sandkasten/src(其 target 亦在此)
  caches+=("/opt/sandkasten/src/laeufer/target")

  local present=()
  local c
  for c in "${caches[@]}"; do [[ -e "$c" ]] && present+=("$c"); done
  if [[ ${#present[@]} -eq 0 ]]; then info "未发现构建缓存,跳过。"; return; fi
  info "检测到构建缓存: ${present[*]}"
  if confirm_step "删除以上 Rust/Go/pixi 构建缓存(可释放数 GB,不影响运行的服务)?"; then
    rm_path "${present[@]}"
  else
    info "跳过(保留构建缓存)。"
  fi
}


remove_nginx() {
  title "7) 删除 Nginx 站点与 HTTPS 证书"
  local site_avail="$NGINX_SITE_AVAIL"
  local site_enabled="$NGINX_SITE_ENABLED"
  if [[ ! -e "$site_avail" && ! -L "$site_enabled" ]]; then
    _confirm_remove_webui_assets
    info "未发现 sandkasten 的 Nginx 站点,跳过。"; return
  fi
  local domain=""
  [[ -f "$site_avail" ]] && domain="$(grep -m1 'server_name' "$site_avail" 2>/dev/null | awk '{print $2}' | tr -d ';')"
  if confirm_step "删除 Nginx 站点 sandkasten.conf${domain:+(域名 $domain)}?"; then
    if declare -F remove_managed_webui_nginx >/dev/null 2>&1; then
      remove_managed_webui_nginx "$site_avail" "$site_enabled" || warn "managed Nginx cleanup failed"
    elif grep -Fq -- '# sandkasten-webui-managed' "$site_avail" 2>/dev/null; then
      if [[ -L "$site_enabled" ]] && [[ "$(readlink -f -- "$site_enabled" 2>/dev/null || true)" == "$(readlink -f -- "$site_avail" 2>/dev/null || true)" ]]; then
        rm_path "$site_enabled" "$site_avail"
      elif [[ ! -e "$site_enabled" && ! -L "$site_enabled" ]]; then
        rm_path "$site_avail"
      else
        warn "Nginx enabled path is not a managed symlink; preserving $site_enabled"
      fi
    else
      warn "Nginx site is not managed by Sandkasten WebUI; preserving $site_avail"
    fi
    _confirm_remove_webui_assets
    if [[ "$DRY_RUN" != true ]] && command -v nginx >/dev/null 2>&1; then
      nginx -t >/dev/null 2>&1 && systemctl reload nginx 2>/dev/null || warn "nginx reload 失败,请手动检查。"
    fi
  else
    info "跳过 Nginx 站点。"
  fi
  # 证书
  if [[ -n "$domain" ]] && command -v certbot >/dev/null 2>&1; then
    if confirm_step "吊销并删除该域名的 Let's Encrypt 证书 ($domain)?"; then
      if [[ "$DRY_RUN" == true ]]; then
        info "[dry-run] 将 certbot delete --cert-name $domain"
      else
        certbot delete --cert-name "$domain" --non-interactive 2>/dev/null && ok "证书已删除。" || warn "证书删除失败或不存在。"
      fi
    fi
  fi
}

#========================================================
# 8) 服务账户
#========================================================
remove_user() {
  title "8) 删除服务账户 ${API_USER}"
  if ! id "$API_USER" >/dev/null 2>&1; then info "用户 ${API_USER} 不存在,跳过。"; return; fi
  if confirm_step "删除系统用户与组 ${API_USER}?"; then
    if [[ "$DRY_RUN" == true ]]; then
      info "[dry-run] 将 userdel ${API_USER}; groupdel ${API_GROUP}"
    else
      userdel "$API_USER" 2>/dev/null && ok "已删除用户 ${API_USER}" || warn "删除用户失败。"
      getent group "$API_GROUP" >/dev/null && groupdel "$API_GROUP" 2>/dev/null || true
    fi
  else
    info "跳过(保留账户)。"
  fi
}

#========================================================
# 系统 apt 包:只列出,不删除
#========================================================
list_apt_packages() {
  title "系统 apt 语言包(默认保留)"
  cat <<EOF
以下 apt 包由 deploy.sh 按需安装,可能被系统其它部分依赖,${C_BOLD}默认不自动删除${C_RESET}:
  gcc g++ clojure coq crystal mono-mcs mono-runtime elixir erlang-dev gfortran
  godot3-server graphviz ghc openjdk-17-jdk-headless kotlin lua5.4 nim ocaml-nox
  octave fpc perl php-cli swi-prolog python3 racket ruby rustc scala sqlite3
  qml qt6-* chromium nginx certbot nodejs npm postgresql postgresql-client ...

如需彻底移除,请自行核对依赖后手动执行,例如:
  ${C_DIM}apt-get remove --purge <包名> && apt-get autoremove --purge${C_RESET}
EOF
}

#========================================================
# 残留自检 / Residual scan
#========================================================
verify_clean() {
  title "残留自检"
  local residual=()
  local paths=(
    "${SYSTEMD_DIR}/sandkasten-api.service" "${SYSTEMD_DIR}/sandkasten-laeufer.service"
    "${BIN_DIR}/sandkasten-api" "${BIN_DIR}/laeufer"
    "$ETC_DIR" "$STATE_DIR" "$OPT_DIR"
  )
  local p
  for p in "${paths[@]}"; do [[ -e "$p" || -L "$p" ]] && residual+=("$p"); done
  # /opt 版本化目录
  for p in /opt/zig-* /opt/julia-* /opt/dart-sdk* /opt/dotnet /opt/swift-* \
           /opt/lean-* /opt/v /opt/typst-* /opt/pixi /opt/mojo /opt/miniwdl /opt/cangjie; do
    [[ -e "$p" ]] && residual+=("$p")
  done
  # 悬空的语言链接
  local b
  for b in zig julia dart dotnet swift swiftc lean lake v pixi miniwdl mojo cjc \
           gleam tectonic nextflow nextflow-launcher; do
    [[ -L "${BIN_DIR}/$b" && ! -e "${BIN_DIR}/$b" ]] && residual+=("${BIN_DIR}/$b(悬空链接)")
  done
  # systemd 仍知晓的单元
  local unit_state
  unit_state="$(systemctl list-unit-files 'sandkasten-*' --no-legend 2>/dev/null | awk '{print $1}' | tr '\n' ' ')"
  [[ -n "$unit_state" ]] && residual+=("systemd 仍列出: $unit_state")
  # 服务账户与数据库
  id "$API_USER" >/dev/null 2>&1 && residual+=("用户 ${API_USER} 仍存在")
  if command -v psql >/dev/null 2>&1; then
    pg_super psql -tAc "SELECT 1 FROM pg_database WHERE datname='${DB_NAME}'" 2>/dev/null | grep -q 1 \
      && residual+=("数据库 ${DB_NAME} 仍存在")
  fi

  if [[ ${#residual[@]} -eq 0 ]]; then
    ok "自检通过:未发现 Sandkasten 残留(apt 语言包除外,见上)。"
  else
    warn "以下项目仍存在(可能是你选择保留的步骤):"
    for p in "${residual[@]}"; do printf '    - %s\n' "$p"; done
  fi
}

#========================================================
# 主流程
#========================================================
run_all() {
  title "Sandkasten 卸载"
  if [[ "$DRY_RUN" == true ]]; then
    warn "DRY-RUN 模式:只显示将要删除的内容,不做任何实际改动。"
  elif [[ "$PURGE" == true ]]; then
    warn "PURGE 模式:将删除服务、配置、状态、数据库、工具链、npm 包、Go、Nginx、账户。"
    if [[ "$ASSUME_YES" != true ]]; then
      read -r -p "确认彻底卸载?此操作不可逆,输入 yes 继续: " r || true
      [[ "$r" == "yes" ]] || die "已取消。"
    fi
  fi

  # 每步都以最好努力执行:任何一步失败都不得中断后续清理,否则"卸载不干净"。
  remove_services          || warn "步骤 1 出现问题,继续。"
  remove_config_state      || warn "步骤 2 出现问题,继续。"
  remove_database          || warn "步骤 3 出现问题,继续。"
  remove_toolchains        || warn "步骤 4 出现问题,继续。"
  remove_npm_globals       || warn "步骤 5 出现问题,继续。"
  remove_go                || warn "步骤 6 出现问题,继续。"
  remove_build_artifacts   || warn "步骤 6.5 出现问题,继续。"
  remove_nginx             || warn "步骤 7 出现问题,继续。"
  remove_user              || warn "步骤 8 出现问题,继续。"
  list_apt_packages        || true
  verify_clean             || true

  title "完成"
  if [[ "$DRY_RUN" == true ]]; then
    ok "DRY-RUN 结束,未做任何改动。"
  else
    ok "Sandkasten 卸载流程结束。"
    info "如需确认残留: ls -d /opt/sandkasten ${BIN_DIR}/laeufer ${ETC_DIR} 2>/dev/null"
  fi
}

usage() {
  cat <<EOF
Sandkasten 卸载脚本

免克隆一键卸载:
  curl -fsSL https://cdn.jsdelivr.net/gh/dieWehmut/sandkasten@main/werkzeug/uninstall.sh -o sk-uninstall.sh \\
    && chmod +x sk-uninstall.sh && sudo ./sk-uninstall.sh --purge

用法:
  sudo ./werkzeug/uninstall.sh            # 交互式,逐项确认
  sudo ./werkzeug/uninstall.sh --purge    # 一键全清(仍二次确认)
  sudo ./werkzeug/uninstall.sh --purge --yes  # 全清且不再询问
  sudo ./werkzeug/uninstall.sh --dry-run  # 仅打印将删除的内容,不执行

选项:
  --purge     删除全部(服务/配置/状态/数据库/工具链/npm/Go/Nginx/账户)
  --dry-run   预演,不做任何改动
  --yes, -y   跳过每步确认(配合 --purge 使用)
  -h, --help  显示帮助
EOF
}

main() {
  while [[ $# -gt 0 ]]; do
    case "$1" in
      --purge) PURGE=true ;;
      --dry-run) DRY_RUN=true ;;
      --yes|-y) ASSUME_YES=true ;;
      -h|--help) usage; exit 0 ;;
      *) usage >&2; die "未知参数: $1" ;;
    esac
    shift
  done
  require_root
  run_all
}

main "$@"
