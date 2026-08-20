#!/usr/bin/env bash
#========================================================
# Sandkasten 交互式部署脚本 / Sandkasten interactive deployer
#
# 一键在 Debian/Ubuntu (x86_64) 主机上部署 Sandkasten 后端:
#   - 交互式勾选需要的语言运行时(编号选择,不必安装全部 58 种)
#   - 编译 sandkasten-api (Go) 与 laeufer (Rust) 二进制
#   - provision Postgres、写入环境文件、安装 systemd 单元并开机自启
#   - 可选:Nginx 反向代理 + Let's Encrypt HTTPS 证书,并自动配置 CORS
#
# 风格参照 nezha 的 install 脚本:彩色输出、菜单驱动、地理镜像探测。
#
# 免克隆一键安装(推荐):
#   curl -fsSL https://cdn.jsdelivr.net/gh/dieWehmut/Sandkasten@main/werkzeug/deploy.sh -o sandkasten.sh \
#     && chmod +x sandkasten.sh && sudo ./sandkasten.sh
# 脚本单独运行时会自动安装 git 并克隆源码到 /opt/sandkasten/src。
#
# 或在已克隆的仓库内运行: sudo ./werkzeug/deploy.sh
#========================================================
set -Eeuo pipefail

#--------------------------------------------------------
# 常量 / Constants
#--------------------------------------------------------
SCRIPT_VERSION="1.0.0"
REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

# 源码获取(支持免克隆一键安装:脚本被单独下载运行时自动克隆仓库)
GIT_REPO_URL="${SANDKASTEN_GIT_URL:-https://github.com/dieWehmut/Sandkasten.git}"
SRC_DIR="${SANDKASTEN_SRC_DIR:-/opt/sandkasten/src}"

# 安装目标路径(与仓库现有 systemd 单元约定保持一致)
BIN_DIR="/usr/local/bin"
ETC_DIR="/etc/sandkasten"
STATE_DIR="/var/lib/sandkasten"
API_STATE_DIR="${STATE_DIR}/api"
LAEUFER_STATE_DIR="${STATE_DIR}/laeufer"
OPT_DIR="/opt/sandkasten"
SYSTEMD_DIR="/etc/systemd/system"
API_ENV="${ETC_DIR}/api.env"
LAEUFER_ENV="${ETC_DIR}/laeufer.env"

# 服务账户
API_USER="sandkasten-api"
API_GROUP="sandkasten-api"

# 数据库默认值
DB_NAME="sandkasten"
DB_USER="sandkasten"
DB_PASS="sandkasten"
DB_HOST="localhost"
DB_PORT="5432"

# 监听端口
HTTP_PORT="8080"
GRPC_ADDR="127.0.0.1:50051"

# 工具链版本(与 einsatz/docker/laeufer.Dockerfile 保持一致)
# 带 *_SHA256 的条目会在解包/执行前用 sha256sum 校验(离线固定摘要)。
GO_VERSION="1.26.0"
GO_SHA256="aac1b08a0fb0c4e0a7c1555beb7b59180b05dfc5a3d62e40e9de90cd42f88235"
JULIA_VERSION="1.10.10"; JULIA_MINOR="1.10"
JULIA_SHA256="6a78a03a71c7ab792e8673dc5cedb918e037f081ceb58b50971dfb7c64c5bf81"
LEAN_VERSION="4.23.0"
SWIFT_VERSION="6.3.2"
ZIG_VERSION="0.16.0"
ZIG_SHA256="70e49664a74374b48b51e6f3fdfbf437f6395d42509050588bd49abe52ba3d00"
DART_VERSION="3.12.2"
DART_SHA256="28e47b44cf075f36771046c068bb0d174201cf9c7608744aed1cc23204299c2d"
DOTNET_SDK_VERSION="10.0.301"
PIXI_VERSION="0.70.2"
NEXTFLOW_VERSION="26.04.3"
CANGJIE_VERSION="1.1.3"
CANGJIE_SHA256="2b68905afc466e665ae181595c63f96c18d75fd2c1fb6c6f0cb64e179c28d61a"
GLEAM_VERSION="1.17.0"
GLEAM_SHA256="c0d1eaadac40c88ac93ea45fc150f6363f4ceb8c925b5ac90f371b1665613cc4"
V_VERSION="weekly.2026.08"
V_SHA256="9a71226a554a184d7d4dac9898bc5a9a65b496da26ec1ad0d412721b775be789"
TYPST_VERSION="0.14.2"
TYPST_SHA256="a6044cbad2a954deb921167e257e120ac0a16b20339ec01121194ff9d394996d"
TECTONIC_VERSION="0.16.9"
TECTONIC_SHA256="60b13a0826ae7ad9ce34b4a2df06bff2cfcfa6dda8a915477c0cbb84e1a4a902"

CURL_RETRY=(--retry 5 --retry-delay 2 --retry-connrefused --retry-all-errors --http1.1)

USE_CN_MIRROR=false
NONINTERACTIVE=false
ASSUME_YES=false
#--------------------------------------------------------
# 彩色输出 / Colored output helpers
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

#--------------------------------------------------------
# 下载完整性校验 / Download integrity
#--------------------------------------------------------
# verify_sha256 <file> <expected_hex>
# 用离线固定摘要校验已下载文件;不匹配则删除文件并终止(脚本以 root 运行,
# 供应链完整性至关重要)。
verify_sha256() {
  local file="$1" expected="$2"
  local actual
  actual="$(sha256sum "$file" | awk '{print $1}')"
  if [[ "$actual" != "$expected" ]]; then
    rm -f "$file"
    err "SHA256 校验失败: $file"
    err "  期望: $expected"
    err "  实际: $actual"
    die "拒绝安装被篡改或版本不符的文件。"
  fi
  ok "SHA256 校验通过: $(basename "$file")"
}

# note_unverified <what> <source>
# 对无官方摘要可固定、或本质为供应商引导脚本(rustup/dotnet/pixi/nextflow)的
# 下载,显式提示 root 操作者:仅有 HTTPS/官方来源保证,无离线摘要校验。
note_unverified() {
  warn "无离线摘要校验: $1(来源 $2)。仅依赖 HTTPS 与官方来源;如需最高保障请预先固定其摘要。"
}


# ask "提示" "默认值" -> 回显用户输入(或默认)
ask() {
  local prompt="$1" default="${2:-}" reply
  if [[ "$NONINTERACTIVE" == true ]]; then
    printf '%s' "$default"; return 0
  fi
  if [[ -n "$default" ]]; then
    read -r -p "$prompt [$default]: " reply || true
    printf '%s' "${reply:-$default}"
  else
    read -r -p "$prompt: " reply || true
    printf '%s' "$reply"
  fi
}

# confirm "问题" "y|n(默认)" -> 返回 0=yes 1=no
confirm() {
  local prompt="$1" default="${2:-n}" reply
  [[ "${ASSUME_YES:-false}" == true ]] && return 0
  if [[ "$NONINTERACTIVE" == true ]]; then
    [[ "$default" == "y" ]]; return
  fi
  local hint="[y/N]"; [[ "$default" == "y" ]] && hint="[Y/n]"
  read -r -p "$prompt $hint " reply || true
  reply="${reply:-$default}"
  [[ "$reply" =~ ^[Yy]$ ]]
}

#--------------------------------------------------------
# 环境前置检查 / Preconditions
#--------------------------------------------------------
require_root() {
  if [[ "${EUID:-$(id -u)}" -ne 0 ]]; then
    die "请以 root 运行(sudo ./werkzeug/deploy.sh)。"
  fi
}

detect_os() {
  [[ "$(uname -s)" == "Linux" ]] || die "仅支持 Linux 主机。"
  local arch; arch="$(uname -m)"
  [[ "$arch" == "x86_64" ]] || die "自定义下载的工具链仅提供 x86_64 版本,当前架构: $arch。"
  if [[ -r /etc/os-release ]]; then
    # shellcheck disable=SC1091
    . /etc/os-release
    case "${ID:-}" in
      debian|ubuntu) ok "检测到 ${PRETTY_NAME:-$ID}" ;;
      *) warn "此脚本针对 Debian/Ubuntu 设计,当前系统 ${ID:-unknown},apt 相关步骤可能失败。" ;;
    esac
  else
    warn "无法读取 /etc/os-release,假定为 Debian 系。"
  fi
  command -v apt-get >/dev/null 2>&1 || die "未找到 apt-get,此脚本依赖 Debian/Ubuntu 包管理。"
}

# 探测是否位于中国大陆,决定是否使用镜像(参照 nezha 的 geo_check)
geo_check() {
  local api_list ua text
  api_list="https://blog.cloudflare.com/cdn-cgi/trace https://developers.cloudflare.com/cdn-cgi/trace"
  ua="Mozilla/5.0 (X11; Linux x86_64; rv:60.0) Gecko/20100101 Firefox/81.0"
  for url in $api_list; do
    text="$(curl -A "$ua" -m 10 -s "$url" 2>/dev/null || true)"
    if echo "$text" | grep -qw 'CN'; then
      USE_CN_MIRROR_SUGGEST=true; return
    fi
  done
  USE_CN_MIRROR_SUGGEST=false
}

choose_mirror() {
  geo_check
  if [[ "${USE_CN_MIRROR_SUGGEST:-false}" == true ]]; then
    if confirm "检测到您的 IP 可能来自中国大陆,是否为 apt/Go 等使用国内镜像加速?" "y"; then
      USE_CN_MIRROR=true
    fi
  else
    if confirm "是否使用中国大陆镜像加速下载?" "n"; then
      USE_CN_MIRROR=true
    fi
  fi
  [[ "$USE_CN_MIRROR" == true ]] && ok "将使用国内镜像。" || info "将使用官方/国际源。"
}

# 根据镜像选择返回 Go 下载地址前缀
go_dl_base() {
  if [[ "$USE_CN_MIRROR" == true ]]; then
    printf 'https://mirrors.aliyun.com/golang'
  else
    printf 'https://go.dev/dl'
  fi
}

#========================================================
# 服务器配置信息 / Server spec summary
#========================================================
# 返回某挂载点可用空间(MB)
avail_mb() {
  df -Pm "$1" 2>/dev/null | awk 'NR==2 {print $4}'
}

show_server_info() {
  title "服务器配置 / Server configuration"
  local host os kernel arch cpus mem_total mem_free disk_root disk_free
  host="$(hostname 2>/dev/null || echo '?')"
  if [[ -r /etc/os-release ]]; then . /etc/os-release; os="${PRETTY_NAME:-$ID}"; else os="$(uname -o)"; fi
  kernel="$(uname -r)"; arch="$(uname -m)"
  cpus="$(nproc 2>/dev/null || echo '?')"
  mem_total="$(awk '/MemTotal/ {printf "%.1f", $2/1024/1024}' /proc/meminfo 2>/dev/null || echo '?')"
  mem_free="$(awk '/MemAvailable/ {printf "%.1f", $2/1024/1024}' /proc/meminfo 2>/dev/null || echo '?')"
  disk_root="$(df -Ph / 2>/dev/null | awk 'NR==2 {print $2}')"
  disk_free="$(df -Ph / 2>/dev/null | awk 'NR==2 {print $4}')"
  printf '  主机名   : %s\n' "$host"
  printf '  系统     : %s (%s %s)\n' "$os" "$kernel" "$arch"
  printf '  CPU      : %s 核\n' "$cpus"
  printf '  内存     : 总 %s GiB / 可用 %s GiB\n' "$mem_total" "$mem_free"
  printf "  磁盘 (/) : 总 %s / 可用 %s\n" "${disk_root:-?}" "${disk_free:-?}"
  # 简单资源提醒
  if [[ "$mem_total" != "?" ]] && awk "BEGIN{exit !($mem_total < 1.5)}"; then
    warn "内存偏低(<1.5 GiB):编译 laeufer(Rust)可能 OOM,建议先添加 swap。"
  fi
  hr
}

#========================================================
# 语言磁盘占用估算 / Per-language disk footprint estimate
# 数值为安装后大致占用(MB),仅供规划参考。
#========================================================
lang_size_mb() {
  case "$1" in
    # 轻量 apt 语言
    bash|assembly|css|html) echo 5 ;;
    c|cpp) echo 60 ;;            # 依赖 build-essential(共享)
    lua|sql) echo 10 ;;
    perl|prolog|graphviz|fortran|nim) echo 40 ;;
    python|elixir|php|ruby) echo 80 ;;
    erlang|crystal|ocaml) echo 120 ;;
    coq) echo 250 ;;
    r|octave|racket) echo 300 ;;
    # JVM 系
    java) echo 350 ;;
    clojure|scala|kotlin) echo 500 ;;
    # Qt / .NET / Mono
    qml) echo 500 ;;
    csharp) echo 350 ;;
    gdscript) echo 80 ;;
    rust) echo 400 ;;
    # node 全局包系
    javascript|typescript) echo 200 ;;
    scss|tsx|vue3|mdx) echo 320 ;;
    tailwindcss) echo 260 ;;
    markdown|nextjs) echo 700 ;;  # 含 chromium/puppeteer
    # 自定义下载(大)
    go) echo 550 ;;
    zig) echo 200 ;;
    vlang) echo 150 ;;
    gleam) echo 120 ;;
    typst) echo 60 ;;
    latex) echo 300 ;;            # tectonic + 预热缓存
    julia) echo 550 ;;
    lean4) echo 600 ;;
    dart) echo 450 ;;
    fsharp) echo 900 ;;           # .NET SDK
    nextflow) echo 400 ;;         # + JVM
    cangjie) echo 900 ;;
    wdl) echo 200 ;;
    swift) echo 1700 ;;
    mojo) echo 3200 ;;            # conda/pixi 环境
    *) echo 150 ;;
  esac
}

# 估算所选语言 + 基础环境总占用,并对比可用磁盘
BASE_FOOTPRINT_MB=2600   # 基础依赖 + Go + Rust 构建缓存(laeufer target)
estimate_and_check_disk() {
  local total="$BASE_FOOTPRINT_MB" lang sz
  printf '\n%s磁盘占用估算(近似值,仅供参考)%s\n' "$C_BOLD" "$C_RESET"
  printf '  基础环境(依赖+Go+Rust 构建): ~%d MB\n' "$BASE_FOOTPRINT_MB"
  for lang in "${SELECTED_LANGS[@]}"; do
    sz="$(lang_size_mb "$lang")"
    total=$((total + sz))
  done
  local total_gb; total_gb="$(awk "BEGIN{printf \"%.1f\", $total/1024}")"
  printf '  所选 %d 种语言合计: ~%d MB\n' "${#SELECTED_LANGS[@]}" "$((total - BASE_FOOTPRINT_MB))"
  printf '  %s预计总需求: ~%d MB (%s GiB)%s\n' "$C_BOLD" "$total" "$total_gb" "$C_RESET"
  local free; free="$(avail_mb /)"
  if [[ -n "$free" ]]; then
    local free_gb; free_gb="$(awk "BEGIN{printf \"%.1f\", $free/1024}")"
    printf '  当前 / 可用: ~%d MB (%s GiB)\n' "$free" "$free_gb"
    if (( free < total * 12 / 10 )); then
      warn "可用磁盘可能不足(建议预留需求的 1.2 倍以上),请注意清理或扩容。"
      confirm "仍要继续吗?" "n" || return 1
    else
      ok "磁盘空间充足。"
    fi
  fi
  hr
  return 0
}


#
# LANGS 为有序数组,索引即菜单编号(从 1 开始)。
# 每种语言的安装动作由 install_lang_<name>() 提供。
#========================================================
LANGS=(
  go assembly bash c cangjie clojure css cpp csharp coq crystal dart elixir
  erlang fsharp fortran gdscript gleam graphviz haskell html java javascript
  julia kotlin lean4 latex lua markdown mdx mojo nextjs nextflow nim octave
  ocaml pascal perl php prolog python qml r racket ruby rust scala scss sql
  swift tailwindcss typescript tsx typst vlang vue3 wdl zig
)

# 人类可读描述(仅用于菜单展示)
lang_desc() {
  case "$1" in
    go) echo "Go";; assembly) echo "Assembly (GAS)";; bash) echo "Bash / Shell";;
    c) echo "C (gcc)";; cangjie) echo "仓颉 Cangjie *";; clojure) echo "Clojure";;
    css) echo "CSS";; cpp) echo "C++ (g++)";; csharp) echo "C# (Mono)";;
    coq) echo "Coq";; crystal) echo "Crystal";; dart) echo "Dart *";;
    elixir) echo "Elixir";; erlang) echo "Erlang";; fsharp) echo "F# (.NET) *";;
    fortran) echo "Fortran";; gdscript) echo "GDScript (Godot3)";; gleam) echo "Gleam *";;
    graphviz) echo "Graphviz DOT";; haskell) echo "Haskell (GHC)";; html) echo "HTML";;
    java) echo "Java (OpenJDK 17)";; javascript) echo "JavaScript (Node)";; julia) echo "Julia *";;
    kotlin) echo "Kotlin";; lean4) echo "Lean 4 *";; latex) echo "LaTeX (Tectonic) *";;
    lua) echo "Lua 5.4";; markdown) echo "Markdown/Mermaid (npm)";; mdx) echo "MDX (npm)";;
    mojo) echo "Mojo (pixi) *";; nextjs) echo "Next.js (npm)";; nextflow) echo "Nextflow *";;
    nim) echo "Nim";; octave) echo "GNU Octave";; ocaml) echo "OCaml";;
    pascal) echo "Pascal (fpc)";; perl) echo "Perl";; php) echo "PHP CLI";;
    prolog) echo "Prolog (SWI)";; python) echo "Python 3";; qml) echo "QML (Qt)";;
    r) echo "R";; racket) echo "Racket";; ruby) echo "Ruby";;
    rust) echo "Rust (rustc)";; scala) echo "Scala";; scss) echo "SCSS/Sass (npm)";;
    sql) echo "SQL (SQLite)";; swift) echo "Swift *";; tailwindcss) echo "Tailwind CSS (npm)";;
    typescript) echo "TypeScript (npm)";; tsx) echo "TSX/React (npm)";; typst) echo "Typst *";;
    vlang) echo "V *";; vue3) echo "Vue 3 (npm)";; wdl) echo "WDL (miniwdl)";;
    zig) echo "Zig *";;
    *) echo "$1";;
  esac
}

SELECTED_LANGS=()

# 打印带编号的语言菜单
print_lang_menu() {
  title "可选语言运行时 (带 * 者需从官网单独下载,体积较大)"
  local i label
  for i in "${!LANGS[@]}"; do
    label="$(lang_desc "${LANGS[$i]}")"
    printf '%s%3d%s) %-22s' "$C_GREEN" "$((i + 1))" "$C_RESET" "$label"
    (( (i + 1) % 3 == 0 )) && printf '\n'
  done
  (( ${#LANGS[@]} % 3 != 0 )) && printf '\n'
  hr
  printf '预设: %score%s=常用15种  %sweb%s=前端/文档  %sall%s=全部58种\n' \
    "$C_YELLOW" "$C_RESET" "$C_YELLOW" "$C_RESET" "$C_YELLOW" "$C_RESET"
}

PRESET_CORE=(go python javascript typescript bash c cpp rust java ruby php html css sql lua)
PRESET_WEB=(html css scss tailwindcss javascript typescript tsx vue3 nextjs markdown mdx)

# 解析用户输入(编号/范围/预设),写入 SELECTED_LANGS(去重、保持注册表顺序)
parse_lang_selection() {
  local raw="$1"
  local -A picked=()
  local invalid=false
  if [[ "$raw" =~ (^|,)[[:space:]]*(,|$) ]]; then
    invalid=true
  fi
  raw="${raw//,/ }"
  local token
  for token in $raw; do
    [[ "$token" == *-* && ! "$token" =~ ^[0-9]+-[0-9]+$ ]] && invalid=true
    case "$token" in
      all|ALL) local l; for l in "${LANGS[@]}"; do picked["$l"]=1; done ;;
      core|CORE) local l; for l in "${PRESET_CORE[@]}"; do picked["$l"]=1; done ;;
      web|WEB) local l; for l in "${PRESET_WEB[@]}"; do picked["$l"]=1; done ;;
      *-*)
        local lo="${token%-*}" hi="${token#*-}" n
        if [[ "$lo" =~ ^[0-9]+$ && "$hi" =~ ^[0-9]+$ ]]; then
          if (( ${#lo} > 3 || ${#hi} > 3 )); then
            invalid=true
            continue
          fi
          lo=$((10#$lo)); hi=$((10#$hi))
          if (( lo < 1 || hi > ${#LANGS[@]} || lo > hi )); then
            invalid=true
            continue
          fi
          for (( n = lo; n <= hi; n++ )); do
            picked["${LANGS[$((n - 1))]}"]=1
          done
        else
          invalid=true
          warn "忽略无法识别的范围: $token"
        fi
        ;;
      [0-9]*)
        if [[ "$token" =~ ^[0-9]+$ && ${#token} -le 3 ]]; then
          local n=$((10#$token))
          if (( n >= 1 && n <= ${#LANGS[@]} )); then
            picked["${LANGS[$((n - 1))]}"]=1
          else
            invalid=true
            warn "编号超出范围: $token"
          fi
        else
          invalid=true
          warn "无效语言编号: $token"
        fi
        ;;
      *)
        # 允许直接输入语言名
        local found=false l
        for l in "${LANGS[@]}"; do [[ "$l" == "${token,,}" ]] && { picked["$l"]=1; found=true; break; }; done
        [[ "$found" == false ]] && invalid=true
        [[ "$found" == false ]] && warn "忽略未知语言: $token"
        ;;
    esac
  done
  SELECTED_LANGS=()
  local l
  for l in "${LANGS[@]}"; do
    [[ -n "${picked[$l]:-}" ]] && SELECTED_LANGS+=("$l")
  done
  if [[ "$invalid" == true || ${#SELECTED_LANGS[@]} -eq 0 ]]; then
    warn "鏈€夋嫨鏈夋晥璇█"
    return 2
  fi
  return 0
}

select_languages() {
  if [[ -n "${SANDKASTEN_LANGUAGES:-}" ]]; then
    parse_lang_selection "${SANDKASTEN_LANGUAGES}" || return
    return 0
  fi
  print_lang_menu
  while :; do
    local input
    input="$(ask "输入编号(可用空格分隔,支持区间如 1-10,或 core/web/all)" "core")"
    if ! parse_lang_selection "$input"; then
      continue
    fi
    if [[ ${#SELECTED_LANGS[@]} -eq 0 ]]; then
      warn "未选择任何语言,请重新输入。"; continue
    fi
    printf '\n已选择 %s%d%s 种语言: %s%s%s\n' \
      "$C_BOLD" "${#SELECTED_LANGS[@]}" "$C_RESET" "$C_GREEN" "${SELECTED_LANGS[*]}" "$C_RESET"
    estimate_and_check_disk || { print_lang_menu; continue; }
    confirm "确认使用以上语言?" "y" && break
    print_lang_menu
  done
}

# 判断某语言是否被选中
lang_selected() {
  local target="$1" l
  for l in "${SELECTED_LANGS[@]}"; do [[ "$l" == "$target" ]] && return 0; done
  return 1
}

#========================================================
# 系统基础依赖 / Base system packages
#========================================================
APT_UPDATED=false
apt_update_once() {
  if [[ "$APT_UPDATED" == false ]]; then
    info "apt-get update ..."
    DEBIAN_FRONTEND=noninteractive apt-get update -y
    APT_UPDATED=true
  fi
}

apt_install() {
  [[ $# -eq 0 ]] && return 0
  apt_update_once
  info "安装 apt 包: $*"
  DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends "$@"
}

install_base_deps() {
  title "安装基础依赖"
  apt_install ca-certificates curl wget git xz-utils zstd unzip tar \
    build-essential pkg-config postgresql-client
}

# 免克隆一键安装:若脚本被单独下载运行(不在仓库内),自动克隆源码。
# 通过是否存在 schnittstelle/go.mod 与 laeufer/Cargo.toml 判断是否已在仓库内。
ensure_source() {
  if [[ -f "${REPO_ROOT}/schnittstelle/go.mod" && -f "${REPO_ROOT}/laeufer/Cargo.toml" ]]; then
    info "在仓库内运行,使用源码目录: ${REPO_ROOT}"
    return 0
  fi
  title "获取源码(免克隆一键安装)"
  command -v git >/dev/null 2>&1 || apt_install git
  if [[ -d "${SRC_DIR}/.git" ]]; then
    info "更新已存在的源码: ${SRC_DIR}"
    git -C "${SRC_DIR}" pull --ff-only 2>/dev/null || warn "git pull 失败,使用现有副本继续。"
  else
    mkdir -p "$(dirname "${SRC_DIR}")"
    info "克隆源码到 ${SRC_DIR} (${GIT_REPO_URL})"
    git clone --depth 1 "${GIT_REPO_URL}" "${SRC_DIR}" \
      || die "克隆失败。可设置 SANDKASTEN_GIT_URL 指向镜像后重试。"
  fi
  REPO_ROOT="${SRC_DIR}"
  [[ -f "${REPO_ROOT}/schnittstelle/go.mod" ]] || die "源码不完整: 未找到 ${REPO_ROOT}/schnittstelle/go.mod"
  ok "源码就绪: ${REPO_ROOT}"
}

# Node.js:多个前端语言依赖。若无 node 则安装。
NODE_READY=false
ensure_node() {
  [[ "$NODE_READY" == true ]] && return 0
  if command -v node >/dev/null 2>&1 && command -v npm >/dev/null 2>&1; then
    NODE_READY=true; return 0
  fi
  info "安装 Node.js 与 npm ..."
  apt_install nodejs npm
  NODE_READY=true
}

# 全局 npm 包安装(供 sass/tsx/vue/next/markdown/mdx/tailwind/typescript 等使用)
npm_global_install() {
  ensure_node
  info "安装全局 npm 包: $*"
  PUPPETEER_SKIP_DOWNLOAD=true npm install -g --prefix /usr/local "$@"
}

#--------------------------------------------------------
# 各语言工具链安装函数
# 三类:apt / npm 全局 / 官网自定义下载(带 *)
#--------------------------------------------------------

# Go:构建 API 需要,也是默认运行时。用官方 tar 安装到 /usr/local/go。
GO_READY=false
ensure_go() {
  [[ "$GO_READY" == true ]] && return 0
  if [[ -x /usr/local/go/bin/go ]]; then
    export PATH="/usr/local/go/bin:$PATH"; GO_READY=true
    ok "已存在 Go: $(/usr/local/go/bin/go version)"; return 0
  fi
  if command -v go >/dev/null 2>&1; then
    GO_READY=true; ok "已存在 Go: $(go version)"; return 0
  fi
  info "下载安装 Go ${GO_VERSION} ..."
  curl "${CURL_RETRY[@]}" -fsSL "$(go_dl_base)/go${GO_VERSION}.linux-amd64.tar.gz" -o /tmp/go.tgz
  verify_sha256 /tmp/go.tgz "$GO_SHA256"
  rm -rf /usr/local/go
  tar -C /usr/local -xzf /tmp/go.tgz
  rm -f /tmp/go.tgz
  export PATH="/usr/local/go/bin:$PATH"
  GO_READY=true
  ok "已安装 $(/usr/local/go/bin/go version)"
}

install_lang_go()         { ensure_go; }
install_lang_assembly()   { apt_install gcc; }          # gas 随 binutils/gcc
install_lang_bash()       { apt_install bash; }
install_lang_c()          { apt_install gcc; }
install_lang_cpp()        { apt_install g++; }
install_lang_clojure()    { apt_install clojure; }
install_lang_coq()        { apt_install coq; }
install_lang_crystal()    { apt_install crystal || warn "crystal 不在默认源,请参照官方文档手动安装。"; }
install_lang_csharp()     { apt_install mono-mcs mono-runtime; }
install_lang_css()        { :; }                        # 无需工具链
install_lang_html()       { :; }
install_lang_elixir()     { apt_install elixir; }
install_lang_erlang()     { apt_install erlang-dev; }
install_lang_fortran()    { apt_install gfortran; }
install_lang_gdscript()   { apt_install godot3-server; }
install_lang_graphviz()   { apt_install graphviz; }
install_lang_haskell()    { apt_install ghc; }
install_lang_java()       { apt_install openjdk-17-jdk-headless; }
install_lang_javascript() { ensure_node; }
install_lang_kotlin()     { apt_install kotlin openjdk-17-jdk-headless; }
install_lang_lua()        { apt_install lua5.4; ln -sf /usr/bin/lua5.4 /usr/local/bin/lua; ln -sf /usr/bin/luac5.4 /usr/local/bin/luac; }
install_lang_nim()        { apt_install nim; }
install_lang_ocaml()      { apt_install ocaml-nox; }
install_lang_octave()     { apt_install octave; }
install_lang_pascal()     { apt_install fpc; }
install_lang_perl()       { apt_install perl; }
install_lang_php()        { apt_install php-cli; }
install_lang_prolog()     { apt_install swi-prolog; }
install_lang_python()     { apt_install python3 python3-pip python3-venv; }
install_lang_r()          { apt_install r-base-core; }
install_lang_racket()     { apt_install racket; }
install_lang_ruby()       { apt_install ruby; }
install_lang_rust()       { apt_install rustc; }
install_lang_scala()      { apt_install scala; }
install_lang_sql()        { apt_install sqlite3; }

install_lang_qml() {
  apt_install qml qml-module-qtquick2 qml6-module-qtqml qml6-module-qtquick \
    qt6-base-dev qt6-declarative-dev qt6-tools-dev-tools qmlscene
}

# npm 全局包类
install_lang_scss()        { npm_global_install "sass@1.99.0"; }
install_lang_tailwindcss() { npm_global_install "tailwindcss@3.4.19" "postcss@8.4.49" "autoprefixer@10.4.20"; }
install_lang_typescript()  { npm_global_install "typescript@5.8.3"; }
install_lang_tsx() {
  npm_global_install "esbuild@0.24.2" "react@18.3.1" "react-dom@18.3.1" \
    "@types/react@18.3.23" "@types/react-dom@18.3.7" "@types/node@20.19.1"
}
install_lang_vue3() {
  npm_global_install "esbuild@0.24.2" "vue@3.5.38" "@vue/compiler-sfc@3.5.38" "@vue/server-renderer@3.5.38"
}
install_lang_nextjs()   { npm_global_install "next@14.2.35" "react@18.3.1" "react-dom@18.3.1"; apt_install chromium; }
install_lang_markdown() {
  npm_global_install "markdown-it@14.2.0" "mermaid@11.15.0" "jsdom@26.1.0" "dompurify@3.3.1" \
    "@mermaid-js/mermaid-cli@11.15.0" "puppeteer@23.11.1"
  apt_install chromium
}
install_lang_mdx() {
  npm_global_install "@mdx-js/mdx@3.1.1" "react@18.3.1" "react-dom@18.3.1"
}

# 自定义下载类(*)——版本与 laeufer.Dockerfile 对齐
install_lang_zig() {
  info "下载 Zig ${ZIG_VERSION} ..."
  curl "${CURL_RETRY[@]}" -fsSL "https://ziglang.org/download/${ZIG_VERSION}/zig-x86_64-linux-${ZIG_VERSION}.tar.xz" -o /tmp/zig.tar.xz
  verify_sha256 /tmp/zig.tar.xz "$ZIG_SHA256"
  tar -xJf /tmp/zig.tar.xz -C /opt && rm -f /tmp/zig.tar.xz
  ln -sf "/opt/zig-x86_64-linux-${ZIG_VERSION}/zig" /usr/local/bin/zig
  ok "zig -> $(zig version 2>/dev/null || echo installed)"
}

install_lang_julia() {
  info "下载 Julia ${JULIA_VERSION} ..."
  curl "${CURL_RETRY[@]}" -fsSL "https://julialang-s3.julialang.org/bin/linux/x64/${JULIA_MINOR}/julia-${JULIA_VERSION}-linux-x86_64.tar.gz" -o /tmp/julia.tgz
  verify_sha256 /tmp/julia.tgz "$JULIA_SHA256"
  tar -xzf /tmp/julia.tgz -C /opt && rm -f /tmp/julia.tgz
  ln -sf "/opt/julia-${JULIA_VERSION}/bin/julia" /usr/local/bin/julia
  ok "julia installed"
}

install_lang_dart() {
  info "下载 Dart SDK ${DART_VERSION} ..."
  curl "${CURL_RETRY[@]}" -fL "https://storage.googleapis.com/dart-archive/channels/stable/release/${DART_VERSION}/sdk/dartsdk-linux-x64-release.zip" -o /tmp/dart.zip
  verify_sha256 /tmp/dart.zip "$DART_SHA256"
  unzip -q /tmp/dart.zip -d /opt && rm -f /tmp/dart.zip
  rm -rf "/opt/dart-sdk-${DART_VERSION}"; mv /opt/dart-sdk "/opt/dart-sdk-${DART_VERSION}"
  ln -sfn "/opt/dart-sdk-${DART_VERSION}" /opt/dart-sdk
  ln -sf /opt/dart-sdk/bin/dart /usr/local/bin/dart
  ok "dart installed"
}

install_lang_fsharp() {
  info "安装 .NET SDK ${DOTNET_SDK_VERSION} (F#) ..."
  note_unverified ".NET 安装脚本 dotnet-install.sh" "dot.net"
  curl "${CURL_RETRY[@]}" -fsSL https://dot.net/v1/dotnet-install.sh -o /tmp/dotnet-install.sh
  bash /tmp/dotnet-install.sh --version "${DOTNET_SDK_VERSION}" --install-dir /opt/dotnet --no-path
  rm -f /tmp/dotnet-install.sh
  ln -sf /opt/dotnet/dotnet /usr/local/bin/dotnet
  ok "dotnet installed"
}

install_lang_swift() {
  info "下载 Swift ${SWIFT_VERSION} ..."
  note_unverified "Swift ${SWIFT_VERSION}" "download.swift.org"
  apt_install libcurl4-openssl-dev libedit2 libpython3.11 libxml2-dev libz3-dev libsqlite3-0
  curl "${CURL_RETRY[@]}" -fL "https://download.swift.org/swift-${SWIFT_VERSION}-release/debian12/swift-${SWIFT_VERSION}-RELEASE/swift-${SWIFT_VERSION}-RELEASE-debian12.tar.gz" -o /tmp/swift.tgz
  tar -xzf /tmp/swift.tgz -C /opt && rm -f /tmp/swift.tgz
  ln -sf "/opt/swift-${SWIFT_VERSION}-RELEASE-debian12/usr/bin/swift" /usr/local/bin/swift
  ln -sf "/opt/swift-${SWIFT_VERSION}-RELEASE-debian12/usr/bin/swiftc" /usr/local/bin/swiftc
  ok "swift installed"
}

install_lang_lean4() {
  info "下载 Lean ${LEAN_VERSION} ..."
  note_unverified "Lean ${LEAN_VERSION}" "github.com/leanprover"
  curl "${CURL_RETRY[@]}" -fsSL "https://github.com/leanprover/lean4/releases/download/v${LEAN_VERSION}/lean-${LEAN_VERSION}-linux.tar.zst" -o /tmp/lean.tar.zst
  tar --zstd -xf /tmp/lean.tar.zst -C /opt && rm -f /tmp/lean.tar.zst
  ln -sf "/opt/lean-${LEAN_VERSION}-linux/bin/lean" /usr/local/bin/lean
  ln -sf "/opt/lean-${LEAN_VERSION}-linux/bin/lake" /usr/local/bin/lake
  ok "lean installed"
}

install_lang_gleam() {
  info "下载 Gleam ${GLEAM_VERSION} ..."
  apt_install erlang-dev
  curl "${CURL_RETRY[@]}" -fL "https://github.com/gleam-lang/gleam/releases/download/v${GLEAM_VERSION}/gleam-v${GLEAM_VERSION}-x86_64-unknown-linux-musl.tar.gz" -o /tmp/gleam.tgz
  echo "${GLEAM_SHA256}  /tmp/gleam.tgz" | sha256sum -c -
  tar -xzf /tmp/gleam.tgz -C /usr/local/bin gleam && rm -f /tmp/gleam.tgz
  chmod 0755 /usr/local/bin/gleam
  # 预热 gleam_stdlib 缓存到 /opt/sandkasten/gleam-cache(runner 依赖)
  local warm; warm="$(mktemp -d)"
  mkdir -p "$warm/src"
  printf '%s\n' 'name = "sandkasten_warm"' 'version = "1.0.0"' 'target = "erlang"' '' \
    '[dependencies]' 'gleam_stdlib = "1.0.3"' > "$warm/gleam.toml"
  printf '%s\n' 'pub fn main() { Nil }' > "$warm/src/main.gleam"
  ( cd "$warm" && XDG_CACHE_HOME="$warm/.cache" gleam build --target erlang --no-print-progress ) || warn "gleam 预热失败,可稍后手动预热。"
  mkdir -p "${OPT_DIR}/gleam-cache"
  cp -R "$warm/.cache/." "${OPT_DIR}/gleam-cache/" 2>/dev/null || true
  chmod -R a+rX "${OPT_DIR}/gleam-cache"
  rm -rf "$warm"
  ok "gleam installed"
}

install_lang_vlang() {
  info "下载 V ${V_VERSION} ..."
  curl "${CURL_RETRY[@]}" -fL "https://github.com/vlang/v/releases/download/${V_VERSION}/v_linux.zip" -o /tmp/v.zip
  echo "${V_SHA256}  /tmp/v.zip" | sha256sum -c -
  unzip -q /tmp/v.zip -d /opt && rm -f /tmp/v.zip
  ln -sf /opt/v/v /usr/local/bin/v
  ok "v installed"
}

install_lang_typst() {
  info "下载 Typst ${TYPST_VERSION} ..."
  curl "${CURL_RETRY[@]}" -fL "https://github.com/typst/typst/releases/download/v${TYPST_VERSION}/typst-x86_64-unknown-linux-musl.tar.xz" -o /tmp/typst.tar.xz
  echo "${TYPST_SHA256}  /tmp/typst.tar.xz" | sha256sum -c -
  tar -xJf /tmp/typst.tar.xz -C /opt && rm -f /tmp/typst.tar.xz
  ln -sf "/opt/typst-x86_64-unknown-linux-musl/typst" /usr/local/bin/typst
  ok "typst installed"
}

install_lang_latex() {
  info "下载 Tectonic ${TECTONIC_VERSION} (LaTeX) ..."
  curl "${CURL_RETRY[@]}" -fL "https://github.com/tectonic-typesetting/tectonic/releases/download/tectonic%40${TECTONIC_VERSION}/tectonic-${TECTONIC_VERSION}-x86_64-unknown-linux-musl.tar.gz" -o /tmp/tectonic.tgz
  echo "${TECTONIC_SHA256}  /tmp/tectonic.tgz" | sha256sum -c -
  tar -xzf /tmp/tectonic.tgz -C /usr/local/bin tectonic && rm -f /tmp/tectonic.tgz
  chmod 0755 /usr/local/bin/tectonic
  # 预热 Tectonic 缓存
  local warm; warm="$(mktemp -d)"
  printf '%s\n' '\documentclass{article}' '\begin{document}' 'sandkasten latex warmup' '\end{document}' > "$warm/main.tex"
  XDG_CACHE_HOME="$warm/.cache" tectonic --keep-logs --outdir "$warm/out" "$warm/main.tex" || warn "tectonic 预热失败,可稍后手动预热。"
  mkdir -p "${OPT_DIR}/tectonic-cache"
  cp -R "$warm/.cache/." "${OPT_DIR}/tectonic-cache/" 2>/dev/null || true
  chmod -R a+rX "${OPT_DIR}/tectonic-cache"
  rm -rf "$warm"
  ok "tectonic installed"
}

install_lang_nextflow() {
  info "安装 Nextflow ${NEXTFLOW_VERSION} ..."
  note_unverified "Nextflow 安装脚本 get.nextflow.io" "get.nextflow.io"
  apt_install openjdk-17-jdk-headless
  mkdir -p "${OPT_DIR}/nextflow"
  curl "${CURL_RETRY[@]}" -fsSL https://get.nextflow.io -o /usr/local/bin/nextflow-launcher
  chmod 0755 /usr/local/bin/nextflow-launcher
  NXF_HOME="${OPT_DIR}/nextflow" NXF_VER="${NEXTFLOW_VERSION}" /usr/local/bin/nextflow-launcher -version || warn "nextflow 初始化失败。"
  {
    printf '%s\n' '#!/bin/sh'
    printf 'export NXF_HOME="${NXF_HOME:-%s/nextflow}"\n' "${OPT_DIR}"
    printf '%s\n' 'exec /usr/local/bin/nextflow-launcher "$@"'
  } > /usr/local/bin/nextflow
  chmod 0755 /usr/local/bin/nextflow
  ok "nextflow installed"
}

install_lang_wdl() {
  info "安装 miniwdl (WDL) ..."
  apt_install python3 python3-venv python3-pip
  python3 -m venv /opt/miniwdl
  /opt/miniwdl/bin/pip install --upgrade pip setuptools wheel
  /opt/miniwdl/bin/pip install miniwdl
  ln -sf /opt/miniwdl/bin/miniwdl /usr/local/bin/miniwdl
  ok "miniwdl installed"
}

install_lang_mojo() {
  info "安装 Mojo (via pixi ${PIXI_VERSION}) ..."
  note_unverified "pixi 安装脚本 install.sh" "pixi.sh"
  curl "${CURL_RETRY[@]}" -fsSL https://pixi.sh/install.sh -o /tmp/pixi-install.sh
  PIXI_VERSION="${PIXI_VERSION}" PIXI_HOME=/opt/pixi PIXI_BIN_DIR=/opt/pixi/bin sh /tmp/pixi-install.sh
  rm -f /tmp/pixi-install.sh
  ln -sf /opt/pixi/bin/pixi /usr/local/bin/pixi
  rm -rf /opt/mojo; mkdir -p /opt/mojo
  pixi init /opt/mojo -c https://conda.modular.com/max/ -c conda-forge
  ( cd /opt/mojo && pixi add mojo && pixi run mojo --version )
  {
    printf '%s\n' '#!/bin/sh'
    printf '%s\n' 'exec /usr/local/bin/pixi run --frozen --no-install -q --manifest-path /opt/mojo/pixi.toml --executable mojo "$@"'
  } > /usr/local/bin/mojo
  chmod 0755 /usr/local/bin/mojo
  ok "mojo installed"
}

install_lang_cangjie() {
  info "下载 仓颉 Cangjie ${CANGJIE_VERSION} ..."
  curl "${CURL_RETRY[@]}" -fL "https://cangjie-lang.cn/v1/files/auth/downLoad?nsId=142267&fileName=cangjie-sdk-linux-x64-${CANGJIE_VERSION}.tar.gz&objectKey=6a19349d21f5a8178d6fd22b" -o /tmp/cangjie.tgz
  echo "${CANGJIE_SHA256}  /tmp/cangjie.tgz" | sha256sum -c -
  tar -xzf /tmp/cangjie.tgz -C /opt && rm -f /tmp/cangjie.tgz
  {
    printf '%s\n' '#!/bin/sh'
    printf '%s\n' 'export CANGJIE_HOME="${CANGJIE_HOME:-/opt/cangjie}"'
    printf '%s\n' 'export LD_LIBRARY_PATH="/opt/cangjie/runtime/lib/linux_x86_64_cjnative:/opt/cangjie/tools/lib:${LD_LIBRARY_PATH:-}"'
    printf '%s\n' 'exec /opt/cangjie/bin/cjc "$@"'
  } > /usr/local/bin/cjc
  chmod 0755 /usr/local/bin/cjc
  ok "cangjie installed"
}

# 按选择安装语言工具链
install_selected_toolchains() {
  title "安装所选语言工具链 (${#SELECTED_LANGS[@]} 种)"
  local lang fn
  for lang in "${SELECTED_LANGS[@]}"; do
    fn="install_lang_${lang}"
    if declare -F "$fn" >/dev/null 2>&1; then
      info "=> ${lang}"
      if ! "$fn"; then
        warn "语言 ${lang} 安装失败,已跳过(可稍后手动安装)。"
      fi
    else
      warn "未定义 ${lang} 的安装步骤,跳过。"
    fi
  done
  ok "语言工具链安装阶段完成。"
}

#========================================================
# Postgres provisioning
#========================================================
# 以 postgres 超级用户身份执行命令。优先用 runuser(root 下始终可用),
# 回退到 sudo;最小化 Debian 常常没有 sudo,故不能依赖它。
pg_super() {
  if command -v runuser >/dev/null 2>&1; then
    runuser -u postgres -- "$@"
  elif command -v sudo >/dev/null 2>&1; then
    sudo -u postgres "$@"
  else
    su postgres -s /bin/sh -c "$(printf '%q ' "$@")"
  fi
}

ensure_postgres() {
  title "配置 PostgreSQL"
  if ! command -v psql >/dev/null 2>&1 && ! command -v pg_isready >/dev/null 2>&1; then
    if confirm "未检测到 PostgreSQL,是否通过 apt 安装 postgresql?" "y"; then
      apt_install postgresql postgresql-client
    else
      warn "跳过 Postgres 安装;请确保 DATABASE_URL 指向的库可用。"
      return
    fi
  fi
  systemctl enable --now postgresql >/dev/null 2>&1 || true

  # 使用 postgres 超级用户创建角色与数据库(幂等)
  info "创建数据库角色与库 (${DB_USER}/${DB_NAME}) ..."
  pg_super psql -v ON_ERROR_STOP=1 <<SQL || warn "数据库角色/库可能已存在,继续。"
DO \$\$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = '${DB_USER}') THEN
    CREATE ROLE ${DB_USER} LOGIN PASSWORD '${DB_PASS}';
  END IF;
END
\$\$;
SQL
  if ! pg_super psql -tAc "SELECT 1 FROM pg_database WHERE datname='${DB_NAME}'" | grep -q 1; then
    pg_super createdb -O "${DB_USER}" "${DB_NAME}"
  fi

  # 载入 schema
  if [[ -f "${REPO_ROOT}/speicher/schema.sql" ]]; then
    info "载入 speicher/schema.sql ..."
    PGPASSWORD="${DB_PASS}" psql -h "${DB_HOST}" -p "${DB_PORT}" -U "${DB_USER}" -d "${DB_NAME}" \
      -v ON_ERROR_STOP=0 -f "${REPO_ROOT}/speicher/schema.sql" >/dev/null 2>&1 \
      && ok "schema 已载入。" || warn "schema 载入出现告警(可能已存在),请核对。"
  else
    warn "未找到 speicher/schema.sql,跳过 schema 载入。"
  fi
}

#========================================================
# 构建二进制 / Build binaries
#========================================================
build_binaries() {
  title "编译二进制 (sandkasten-api + laeufer)"
  ensure_go
  info "构建 sandkasten-api (Go) ..."
  ( cd "${REPO_ROOT}/schnittstelle" && go build -trimpath -ldflags="-s -w" -o /tmp/sandkasten-api ./cmd/sandkasten-api )
  install -m 0755 /tmp/sandkasten-api "${BIN_DIR}/sandkasten-api" && rm -f /tmp/sandkasten-api
  ok "sandkasten-api -> ${BIN_DIR}/sandkasten-api"

  if ! command -v cargo >/dev/null 2>&1; then
    if confirm "未检测到 Rust/Cargo,是否通过 rustup 安装?" "y"; then
      note_unverified "rustup 安装脚本 sh.rustup.rs" "sh.rustup.rs"
      curl "${CURL_RETRY[@]}" -fsSL https://sh.rustup.rs -o /tmp/rustup.sh
      sh /tmp/rustup.sh -y --profile minimal; rm -f /tmp/rustup.sh
      # shellcheck disable=SC1091
      . "$HOME/.cargo/env"
    else
      die "构建 laeufer 需要 Cargo。"
    fi
  fi
  info "构建 laeufer (Rust,首次编译较慢) ..."
  ( cd "${REPO_ROOT}/laeufer" && cargo build --release --bin laeufer )
  install -m 0755 "${REPO_ROOT}/laeufer/target/release/laeufer" "${BIN_DIR}/laeufer"
  ok "laeufer -> ${BIN_DIR}/laeufer"
}

#========================================================
# 系统账户与目录 / User & directories
#========================================================
ensure_user_dirs() {
  title "创建服务账户与目录"
  if ! getent group "${API_GROUP}" >/dev/null; then groupadd --system "${API_GROUP}"; fi
  if ! id "${API_USER}" >/dev/null 2>&1; then
    useradd --system --gid "${API_GROUP}" --home-dir "${API_STATE_DIR}" \
      --shell /usr/sbin/nologin "${API_USER}"
    ok "已创建用户 ${API_USER}"
  fi
  mkdir -p "${ETC_DIR}" "${API_STATE_DIR}" "${LAEUFER_STATE_DIR}" \
    "${LAEUFER_STATE_DIR}/sandbox" "${OPT_DIR}"
  chown -R "${API_USER}:${API_GROUP}" "${API_STATE_DIR}"
  chmod 0755 "${STATE_DIR}"
}

#========================================================
# 环境文件 / Env files
#========================================================
write_env_files() {
  title "写入环境文件"
  local db_url="postgres://${DB_USER}:${DB_PASS}@${DB_HOST}:${DB_PORT}/${DB_NAME}?sslmode=disable"
  local langs_csv; langs_csv="$(IFS=,; echo "${SELECTED_LANGS[*]}")"
  local http_listen="0.0.0.0:${HTTP_PORT}"
  local cors="${CORS_ORIGINS:-http://localhost:5173,http://127.0.0.1:5173}"

  # 备份旧文件
  [[ -f "$API_ENV" ]] && cp -a "$API_ENV" "${API_ENV}.$(date +%Y%m%d%H%M%S).bak"
  [[ -f "$LAEUFER_ENV" ]] && cp -a "$LAEUFER_ENV" "${LAEUFER_ENV}.$(date +%Y%m%d%H%M%S).bak"

  info "写入 ${API_ENV}"
  cat > "$API_ENV" <<ENV
DATABASE_URL=${db_url}
SANDKASTEN_API_GRPC_ADDR=${GRPC_ADDR}
SANDKASTEN_API_HTTP_ADDR=${http_listen}
SANDKASTEN_API_CORS_ORIGINS=${cors}
SANDKASTEN_RUNTIME_LANGUAGES=${langs_csv}
SANDKASTEN_INSTALL_MODE=${SANDKASTEN_INSTALL_MODE:-cli}
ENV

  info "写入 ${LAEUFER_ENV}"
  cat > "$LAEUFER_ENV" <<ENV
DATABASE_URL=${db_url}
LAEUFER_WORK_DIR=${LAEUFER_STATE_DIR}
LAEUFER_SANDBOX_ROOT=${LAEUFER_STATE_DIR}/sandbox
LAEUFER_POLL_INTERVAL_MS=1000
LAEUFER_LEASE_TTL_MS=60000
LAEUFER_CGROUP_ROOT=/sys/fs/cgroup
LAEUFER_RUNTIME_PATH=/usr/local/go/bin:/usr/local/bin:/usr/bin:/bin
LAEUFER_MAX_ARCHIVE_BYTES=67108864
LAEUFER_MAX_ARCHIVE_FILES=20000
LAEUFER_COMPILE_MEMORY_LIMIT_BYTES=1073741824
LAEUFER_PIDS_MAX=64
LAEUFER_MEMORY_SWAP_MAX_BYTES=0
LAEUFER_MAX_ATTEMPTS=3
LAEUFER_RLIMIT_CORE_BYTES=0
LAEUFER_RLIMIT_FSIZE_BYTES=67108864
LAEUFER_RLIMIT_NOFILE=1024
LAEUFER_RLIMIT_NPROC=64
LAEUFER_RLIMIT_STACK_BYTES=67108864
LAEUFER_RLIMIT_MEMLOCK_BYTES=0
LAEUFER_REQUIRE_PRIVATE_NAMESPACES=1
LAEUFER_CHILD_UID=65534
LAEUFER_CHILD_GID=65534
ENV
  chmod 0600 "$API_ENV" "$LAEUFER_ENV"
  ok "环境文件已写入(语言: ${langs_csv})"
}

#========================================================
# systemd 单元 / systemd units + 开机自启
#========================================================
PG_UNIT="postgresql.service"
install_systemd_units() {
  title "安装 systemd 单元并设置开机自启"

  cat > "${SYSTEMD_DIR}/sandkasten-api.service" <<UNIT
[Unit]
Description=Sandkasten HTTP and gRPC API
After=network-online.target ${PG_UNIT}
Wants=network-online.target
Requires=${PG_UNIT}

[Service]
Type=simple
User=${API_USER}
Group=${API_GROUP}
WorkingDirectory=${API_STATE_DIR}
EnvironmentFile=${API_ENV}
Environment=PATH=/usr/local/go/bin:/usr/local/bin:/usr/bin:/bin
ExecStart=${BIN_DIR}/sandkasten-api
Restart=always
RestartSec=3
NoNewPrivileges=true
PrivateTmp=true
ProtectSystem=full
ProtectHome=true
ProtectKernelTunables=true
ProtectKernelModules=true
ProtectControlGroups=true
RestrictSUIDSGID=true
LockPersonality=true
MemoryDenyWriteExecute=true
SystemCallArchitectures=native

[Install]
WantedBy=multi-user.target
UNIT

  cat > "${SYSTEMD_DIR}/sandkasten-laeufer.service" <<UNIT
[Unit]
Description=Sandkasten privileged code runner
After=network-online.target ${PG_UNIT} sandkasten-api.service
Wants=network-online.target
Requires=${PG_UNIT}

[Service]
Type=simple
WorkingDirectory=${LAEUFER_STATE_DIR}
EnvironmentFile=${LAEUFER_ENV}
Environment=PATH=/usr/local/go/bin:/usr/local/bin:/usr/bin:/bin
Environment=LAEUFER_RUNNER_ID=%H-systemd
ExecStart=${BIN_DIR}/laeufer
Restart=always
RestartSec=3
LimitNOFILE=65536
TasksMax=infinity
NoNewPrivileges=true
PrivateTmp=true
ProtectSystem=full
ProtectHome=true
ProtectKernelTunables=true
ProtectKernelModules=true
RestrictSUIDSGID=true
LockPersonality=true
SystemCallArchitectures=native
ReadWritePaths=${LAEUFER_STATE_DIR}

[Install]
WantedBy=multi-user.target
UNIT

  systemctl daemon-reload
  systemctl enable sandkasten-api.service sandkasten-laeufer.service >/dev/null 2>&1
  systemctl restart sandkasten-api.service
  systemctl restart sandkasten-laeufer.service
  ok "服务已启用并启动(已设置开机自启)。"
}

#========================================================
# 域名 / Nginx 反代 + Let's Encrypt
#========================================================
render_domain_nginx_site() {
  local site="$1" domain="$2"
  local mode="${SANDKASTEN_INSTALL_MODE:-cli}"
  local webui_root="${WEBUI_ROOT:-/opt/sandkasten/webui}" canonical_root
  if [[ "$mode" == webui ]]; then
    [[ "$domain" =~ ^[A-Za-z0-9]([A-Za-z0-9.-]*[A-Za-z0-9])?$ ]] || {
      warn "invalid domain name: $domain"
      return 1
    }
    [[ "$webui_root" =~ ^/[A-Za-z0-9._/-]+$ ]] || {
      warn "invalid WebUI root path"
      return 1
    }
    case "$webui_root" in
      */../*|*/..|/|/tmp|/var|/usr|/etc|/home|/root|/opt|/opt/sandkasten)
        warn "invalid WebUI root path"
        return 1
        ;;
    esac
    command -v realpath >/dev/null 2>&1 || {
      warn "realpath is required to validate WebUI root path"
      return 1
    }
    canonical_root="$(realpath -m -- "$webui_root")" || {
      warn "unable to canonicalize WebUI root path"
      return 1
    }
    case "$canonical_root" in
      /|/tmp|/var|/usr|/etc|/home|/root|/opt|/opt/sandkasten)
        warn "invalid WebUI root path"
        return 1
        ;;
    esac
    if [[ -L "$site" ]]; then
      warn "refusing to replace Nginx symlink: $site"
      return 1
    fi
    if [[ -e "$site" ]] && ! grep -Fq -- '# sandkasten-webui-managed' "$site" 2>/dev/null; then
      warn "refusing to replace unmanaged Nginx config: $site"
      return 1
    fi
    cat > "$site" <<NGINX
# sandkasten-webui-managed
server {
    listen 80;
    listen [::]:80;
    server_name ${domain};
    root ${webui_root};
    index index.html;

    location / {
        try_files \$uri \$uri/ /index.html;
    }

    location /v1/ {
        proxy_pass http://127.0.0.1:${HTTP_PORT};
        proxy_http_version 1.1;
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
        proxy_read_timeout 120s;
    }

    location = /healthz {
        proxy_pass http://127.0.0.1:${HTTP_PORT};
        proxy_http_version 1.1;
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
    }
}
NGINX
    return 0
  fi
  cat > "$site" <<NGINX
server {
    listen 80;
    listen [::]:80;
    server_name ${domain};

    location / {
        proxy_pass http://127.0.0.1:${HTTP_PORT};
        proxy_http_version 1.1;
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
        proxy_read_timeout 120s;
    }
}
NGINX
}

configure_domain() {
  title "域名与 HTTPS 配置 (Nginx 反向代理 + Let's Encrypt)"
  if ! confirm "是否现在配置域名与 Nginx 反向代理?" "y"; then
    info "跳过域名配置。API 直接监听 0.0.0.0:${HTTP_PORT}。"
    return
  fi
  local domain email
  domain="$(ask "请输入域名(如 run.example.com)")"
  [[ -z "$domain" ]] && { warn "未输入域名,跳过。"; return; }

  apt_install nginx
  local site="/etc/nginx/sites-available/sandkasten.conf"
  local enabled="/etc/nginx/sites-enabled/sandkasten.conf"
  info "写入 Nginx 配置 ${site}"
  render_domain_nginx_site "$site" "$domain"
  if [[ -e "$enabled" || -L "$enabled" ]]; then
    if [[ ! -L "$enabled" || "$(readlink -f "$enabled" 2>/dev/null || true)" != "$(readlink -f "$site" 2>/dev/null || true)" ]]; then
      warn "refusing to replace unmanaged enabled Nginx site: $enabled"
      return 1
    fi
  fi
  ln -sfn "$site" "$enabled"
  rm -f /etc/nginx/sites-enabled/default 2>/dev/null || true
  nginx -t && systemctl reload nginx
  ok "Nginx 已反代 ${domain} -> 127.0.0.1:${HTTP_PORT}"

  # 让 API 仅监听本地,由 Nginx 对外
  sed -i "s|^SANDKASTEN_API_HTTP_ADDR=.*|SANDKASTEN_API_HTTP_ADDR=127.0.0.1:${HTTP_PORT}|" "$API_ENV"

  local scheme="http"
  if confirm "是否使用 Let's Encrypt 申请 HTTPS 证书(需域名已解析到本机)?" "y"; then
    email="$(ask "证书通知邮箱(可留空使用 --register-unsafely-without-email)")"
    apt_install certbot python3-certbot-nginx
    local certbot_args=(--nginx -d "$domain" --redirect --non-interactive --agree-tos)
    if [[ -n "$email" ]]; then certbot_args+=(-m "$email"); else certbot_args+=(--register-unsafely-without-email); fi
    if certbot "${certbot_args[@]}"; then
      ok "HTTPS 证书已申请并配置(certbot 定时续期已随包启用)。"
      scheme="https"
    else
      warn "certbot 申请失败,保持 HTTP。请检查域名解析与 80 端口可达性。"
    fi
  fi

  # 更新 CORS 允许该域名来源
  local origin="${scheme}://${domain}"
  local existing; existing="$(grep '^SANDKASTEN_API_CORS_ORIGINS=' "$API_ENV" | cut -d= -f2-)"
  if [[ ",$existing," != *",$origin,"* ]]; then
    sed -i "s|^SANDKASTEN_API_CORS_ORIGINS=.*|SANDKASTEN_API_CORS_ORIGINS=${existing:+$existing,}${origin}|" "$API_ENV"
  fi
  systemctl restart sandkasten-api.service
  ok "已更新 CORS 允许来源: ${origin}"
  DEPLOY_URL="${origin}/v1/runtimes"
}

#========================================================
# 状态 / 卸载
#========================================================
show_status() {
  title "服务状态"
  systemctl --no-pager --full status sandkasten-api.service 2>/dev/null | head -8 || true
  hr
  systemctl --no-pager --full status sandkasten-laeufer.service 2>/dev/null | head -8 || true
  hr
  local addr; addr="$(grep '^SANDKASTEN_API_HTTP_ADDR=' "$API_ENV" 2>/dev/null | cut -d= -f2- || echo '?')"
  info "API 监听: ${addr}"
  info "本地验证: curl -s -H 'Accept: text/html' http://127.0.0.1:${HTTP_PORT}/v1/runtimes | head"
}

uninstall_all() {
  title "卸载 Sandkasten"
  confirm "确认停止并移除 systemd 服务与二进制?(数据库与语言工具链保留)" "n" || { info "已取消。"; return; }
  systemctl disable --now sandkasten-api.service sandkasten-laeufer.service 2>/dev/null || true
  rm -f "${SYSTEMD_DIR}/sandkasten-api.service" "${SYSTEMD_DIR}/sandkasten-laeufer.service"
  systemctl daemon-reload
  rm -f "${BIN_DIR}/sandkasten-api" "${BIN_DIR}/laeufer"
  ok "服务与二进制已移除。"
  if confirm "是否同时删除环境文件 ${ETC_DIR} 与状态目录 ${STATE_DIR}?" "n"; then
    rm -rf "${ETC_DIR}" "${STATE_DIR}"
    ok "配置与状态目录已删除。"
  fi
  if confirm "是否删除数据库 ${DB_NAME} 与角色 ${DB_USER}?" "n"; then
    pg_super dropdb "${DB_NAME}" 2>/dev/null || true
    pg_super dropuser "${DB_USER}" 2>/dev/null || true
    ok "数据库对象已删除。"
  fi
}

#========================================================
# 完整安装流程
#========================================================
DEPLOY_URL=""
run_install() {
  show_server_info
  choose_mirror
  select_languages
  # 允许覆盖数据库口令与端口
  title "基础配置"
  DB_PASS="$(ask "数据库密码" "${DB_PASS}")"
  HTTP_PORT="$(ask "API HTTP 端口" "${HTTP_PORT}")"

  install_base_deps
  ensure_source
  ensure_go
  install_selected_toolchains
  ensure_postgres
  ensure_user_dirs
  build_binaries
  write_env_files
  install_systemd_units
  # WebUI installs serve the staged frontend through the managed Nginx site
  # wired by the modular entrypoint. Domain/HTTPS setup remains opt-in so a
  # non-interactive WebUI install is deterministic.
  if [[ "${SANDKASTEN_INSTALL_MODE:-cli}" == webui && "${SANDKASTEN_CONFIGURE_DOMAIN:-false}" != true ]]; then
    info "WebUI mode: skipping interactive domain configuration"
  else
    configure_domain
  fi

  title "部署完成"
  ok "Sandkasten 后端已部署并设置开机自启。"
  show_status
  [[ -n "$DEPLOY_URL" ]] && ok "访问: ${DEPLOY_URL}"
  ok "已启用语言(${#SELECTED_LANGS[@]}): ${SELECTED_LANGS[*]}"
}

# 仅重新选择语言并热更新配置(不重装工具链)
reconfigure_languages() {
  choose_mirror
  select_languages
  install_selected_toolchains
  write_env_files
  systemctl restart sandkasten-api.service sandkasten-laeufer.service 2>/dev/null || true
  ok "语言配置已更新并重启服务。"
}

#========================================================
# 主菜单 / Main menu
#========================================================
main_menu() {
  title "Sandkasten 部署脚本 v${SCRIPT_VERSION}"
  cat <<MENU
  ${C_GREEN}1${C_RESET}) 全新安装 / 重新部署(选择语言 + 编译 + 服务 + 域名)
  ${C_GREEN}2${C_RESET}) 重新选择语言并热更新
  ${C_GREEN}3${C_RESET}) 仅配置域名 / Nginx / HTTPS
  ${C_GREEN}4${C_RESET}) 查看服务状态
  ${C_GREEN}5${C_RESET}) 重启服务
  ${C_GREEN}6${C_RESET}) 卸载
  ${C_GREEN}7${C_RESET}) 查看服务器配置
  ${C_GREEN}0${C_RESET}) 退出
MENU
  local choice; choice="$(ask "请选择" "1")"
  case "$choice" in
    1) run_install ;;
    2) reconfigure_languages ;;
    3) configure_domain ;;
    4) show_status ;;
    5) systemctl restart sandkasten-api.service sandkasten-laeufer.service && ok "已重启。" ;;
    6) uninstall_all ;;
    7) show_server_info ;;
    0) exit 0 ;;
    *) warn "无效选择。" ;;
  esac
}

usage() {
  cat <<EOF
Sandkasten 交互式部署脚本 v${SCRIPT_VERSION}

免克隆一键安装:
  curl -fsSL https://cdn.jsdelivr.net/gh/dieWehmut/Sandkasten@main/werkzeug/deploy.sh -o sandkasten.sh \\
    && chmod +x sandkasten.sh && sudo ./sandkasten.sh

用法:
  sudo ./werkzeug/deploy.sh              # 进入交互菜单
  sudo ./werkzeug/deploy.sh install      # 直接执行全新安装
  sudo ./werkzeug/deploy.sh status       # 查看状态
  sudo ./werkzeug/deploy.sh uninstall    # 卸载

环境变量:
  CORS_ORIGINS       额外的 CORS 允许来源(逗号分隔)
  SANDKASTEN_GIT_URL 源码仓库地址(默认 GitHub;可指向镜像)
  SANDKASTEN_SRC_DIR 克隆目标目录(默认 /opt/sandkasten/src)
EOF
}

main() {
  require_root
  detect_os
  case "${1:-}" in
    ""|menu) main_menu ;;
    install) run_install ;;
    languages|reconfigure) reconfigure_languages ;;
    domain) configure_domain ;;
    status) show_status ;;
    restart) systemctl restart sandkasten-api.service sandkasten-laeufer.service && ok "已重启。" ;;
    uninstall) uninstall_all ;;
    -h|--help|help) usage ;;
    *) usage; exit 2 ;;
  esac
}

if [[ "${SANDKASTEN_SOURCE_ONLY:-0}" == 1 ]]; then
  # Source boundary for the modular installer. Definitions above remain
  # available to installer/entrypoint.sh without triggering host changes.
  :
else
  # Keep the historical path compatible while making install.sh authoritative.
  _DEPLOY_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
  if [[ -f "${_DEPLOY_DIR}/install.sh" ]]; then
    exec bash "${_DEPLOY_DIR}/install.sh" "$@"
  fi
  # A downloaded legacy deploy.sh has no sibling modules, so retain its
  # original standalone behavior instead of failing to find install.sh.
  main "$@"
fi
