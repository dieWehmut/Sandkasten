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
# 用法: sudo ./werkzeug/uninstall.sh [--purge] [--dry-run] [--yes]
#========================================================
set -Eeuo pipefail

#--------------------------------------------------------
# 常量(与 deploy.sh 保持一致)
#--------------------------------------------------------
BIN_DIR="/usr/local/bin"
ETC_DIR="/etc/sandkasten"
STATE_DIR="/var/lib/sandkasten"
OPT_DIR="/opt/sandkasten"
SYSTEMD_DIR="/etc/systemd/system"
NODE_MODULES="/usr/local/lib/node_modules"

API_USER="sandkasten-api"
API_GROUP="sandkasten-api"
DB_NAME="sandkasten"
DB_USER="sandkasten"

PURGE=false
DRY_RUN=false
ASSUME_YES=false

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
  [[ -L "$link" ]] || { [[ -e "$link" ]] && warn "$link 不是符号链接,保留(可能非本脚本安装)。"; return; }
  tgt="$(readlink -f "$link" 2>/dev/null || readlink "$link")"
  if [[ "$tgt" == "$want"* ]]; then
    if [[ "$DRY_RUN" == true ]]; then info "[dry-run] 将删除符号链接: $link -> $tgt"
    else rm -f "$link" && ok "已删除符号链接: $link"; fi
  else
    warn "$link -> $tgt 不指向本脚本安装目录($want*),保留。"
  fi
}

require_root() {
  [[ "${EUID:-$(id -u)}" -eq 0 ]] || die "请以 root 运行(sudo ./werkzeug/uninstall.sh)。"
}

#========================================================
# 1) systemd 服务与二进制
#========================================================
remove_services() {
  title "1) 停止并移除 systemd 服务与二进制"
  if confirm_step "停止/禁用/删除 sandkasten-api 与 sandkasten-laeufer 服务及二进制?"; then
    if [[ "$DRY_RUN" != true ]]; then
      systemctl disable --now sandkasten-api.service sandkasten-laeufer.service 2>/dev/null || true
    fi
    rm_path "${SYSTEMD_DIR}/sandkasten-api.service" "${SYSTEMD_DIR}/sandkasten-laeufer.service"
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
      sudo -u postgres dropdb --if-exists "${DB_NAME}" 2>/dev/null && ok "已删除数据库 ${DB_NAME}" || warn "删除数据库失败或不存在。"
      sudo -u postgres dropuser --if-exists "${DB_USER}" 2>/dev/null && ok "已删除角色 ${DB_USER}" || warn "删除角色失败或不存在。"
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
    "/opt/miniwdl" "/opt/cangjie" "/opt/sandkasten"
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
    warn "未找到 npm,无法移除全局包。"
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
# 7) Nginx 站点与 Let's Encrypt 证书
#========================================================
remove_nginx() {
  title "7) 删除 Nginx 站点与 HTTPS 证书"
  local site_avail="/etc/nginx/sites-available/sandkasten.conf"
  local site_enabled="/etc/nginx/sites-enabled/sandkasten.conf"
  if [[ ! -e "$site_avail" && ! -L "$site_enabled" ]]; then
    info "未发现 sandkasten 的 Nginx 站点,跳过。"; return
  fi
  local domain=""
  [[ -f "$site_avail" ]] && domain="$(grep -m1 'server_name' "$site_avail" 2>/dev/null | awk '{print $2}' | tr -d ';')"
  if confirm_step "删除 Nginx 站点 sandkasten.conf${domain:+(域名 $domain)}?"; then
    rm_path "$site_enabled" "$site_avail"
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

  remove_services
  remove_config_state
  remove_database
  remove_toolchains
  remove_npm_globals
  remove_go
  remove_nginx
  remove_user
  list_apt_packages

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
