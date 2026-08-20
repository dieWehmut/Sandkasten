<h1 align="center">Sandkasten</h1>

<p align="center">自托管的多语言在线代码执行沙箱</p>

<div align="center">

<div>
<a href="https://run.diesw.tech/v1/runtimes" target="_blank">
  <img src="https://img.shields.io/badge/DEMO-Runtimes-1FC41F?style=flat-square&logo=googlechrome&logoColor=white&labelColor=555555" alt="Demo">
</a>
<a href="https://github.com/dieWehmut/Sandkasten" target="_blank">
  <img src="https://img.shields.io/badge/Languages-58-F9D553?style=flat-square&logo=codeigniter&logoColor=white&labelColor=555555" alt="Languages">
</a>
</div>

<div>
<a href="https://go.dev/" target="_blank">
  <img src="https://img.shields.io/badge/API-Go%201.25%2B-00ADD8?style=flat-square&logo=go&logoColor=white&labelColor=555555" alt="Go">
</a>
<a href="https://www.rust-lang.org/" target="_blank">
  <img src="https://img.shields.io/badge/Runner-Rust-DEA584?style=flat-square&logo=rust&logoColor=white&labelColor=555555" alt="Rust">
</a>
<a href="https://www.postgresql.org/" target="_blank">
  <img src="https://img.shields.io/badge/Store-PostgreSQL-4169E1?style=flat-square&logo=postgresql&logoColor=white&labelColor=555555" alt="PostgreSQL">
</a>
<a href="https://www.linux.org/" target="_blank">
  <img src="https://img.shields.io/badge/Sandbox-Linux-FCC624?style=flat-square&logo=linux&logoColor=black&labelColor=555555" alt="Linux">
</a>
</div>

</div>

<div align="center">

简体中文 | [繁體中文](handbuch/README.zh-TW.md) | [English](handbuch/README.en.md) | [日本語](handbuch/README.ja.md)

</div>

---

`Sandkasten` 是一个自托管的在线代码执行系统。客户端通过 HTTP API 上传单文件源码或 `tar.gz` 归档，服务端把任务写入 Postgres，由一个 Rust 编写的运行器（`laeufer`）异步领取，并在带 cgroup、命名空间、文件系统与网络隔离的 Linux 沙箱中编译、运行。v1 支持 **58 种语言与运行时**，可作为博客/文档站的「在线跑代码」后端，也可独立作为评测与演示服务。

运行器**不会**静默回退到 Docker 或宿主机直接执行；若缺少所需的内核或权限特性,它会在预检时失败并拒绝运行任务。

## 示例

- 运行时索引页：<https://run.diesw.tech/v1/runtimes>
- GitHub Pages WebUI：<https://diewehmut.github.io/Sandkasten/>

GitHub Pages 由仓库中的 `.github/workflows/pages.yml` 自动发布。首次启用时，在
GitHub 仓库的 **Settings → Pages** 将发布来源设为 **GitHub Actions**；之后推送到
`main` 或手动运行该 workflow 即可更新页面。Pages 页面使用仓库变量
`SANDKASTEN_API_BASE_URL` 连接独立部署的 HTTP API。该变量会原样写入公开静态文件，
因此它只能包含公开的 HTTPS API 基址（例如 `https://run.example.com`），不得放入
API token、密码或其它凭据。API 与 Pages 跨域时，服务端必须使用 HTTPS，并在
`SANDKASTEN_API_CORS_ORIGINS` 中允许来源 `https://diewehmut.github.io`（CORS 使用
origin，不包含 `/sandkasten/` 路径）。

运行时索引页由 API 直接服务端渲染,列出所有已启用语言、版本、默认资源限制与编译/运行命令。

## 功能

- 58 种语言与运行时,可按需自选安装(不必一次装全)
- 单文件源码或 `tar.gz` 归档两种提交方式
- Rust 运行器 + Linux 沙箱:cgroup v2 资源限额、命名空间隔离、无网络、只读根文件系统
- 每种语言可独立配置默认/上限资源(超时、内存、CPU、输出大小)
- 服务端渲染的运行时索引页,内置官方语言图标
- HTTP 与 gRPC 双接口
- 前端/文档类运行时(HTML、Markdown、Mermaid、Graphviz、Typst、LaTeX、Vue、TSX 等)输出可预览产物
- 交互式一键部署脚本:选语言、编译、systemd 开机自启、Nginx 反代 + Let's Encrypt HTTPS
- 配套卸载脚本,支持彻底清理与残留自检

## 架构

| 目录 | 说明 |
| --- | --- |
| `schnittstelle/` | Go 编写的 gRPC / HTTP API 服务 |
| `laeufer/` | Rust 运行器与 Linux 沙箱控制器 |
| `vertrag/` | Go 与 Rust 共享的 protobuf 契约 |
| `speicher/` | Postgres schema 与迁移 |
| `wurzelwerk/` | 运行器使用的 rootfs 与运行时资源 |
| `einsatz/` | 部署清单(Docker / K8s) |
| `pruefung/` | 集成测试与安全测试 |
| `beispiele/` | 示例客户端与项目 |
| `werkzeug/` | 开发与部署脚本 |
| `handbuch/` | 架构与运维文档(含本 README 的多语言译文) |

## 快速开始

### 免克隆一键部署(推荐)

在一台 Debian / Ubuntu (x86_64) 主机上,以 root 运行一行命令即可(脚本会自动安装 git 并克隆源码到 `/opt/sandkasten/src`):

```bash
curl -fsSL https://cdn.jsdelivr.net/gh/dieWehmut/Sandkasten@main/werkzeug/install.sh -o sandkasten-install.sh && chmod +x sandkasten-install.sh && sudo ./sandkasten-install.sh
```

或先克隆再运行:

```bash
git clone https://github.com/dieWehmut/Sandkasten.git
cd Sandkasten
sudo ./werkzeug/deploy.sh
```

脚本是交互式的,会引导你完成:

1. **显示服务器配置**(CPU / 内存 / 磁盘)并估算所选语言的磁盘占用
2. **按编号选择语言** —— 58 种运行时带编号菜单,输入数字(如 `1 5 12`)、区间(`1-10`)、语言名,或预设 `core` / `web` / `all`;只安装所选语言的工具链
3. **provision PostgreSQL**(角色 / 库 / schema)
4. **编译** `sandkasten-api`(Go)与 `laeufer`(Rust)二进制
5. **写入环境文件**并安装 systemd 单元,**设置开机自启**
6. 可选:**Nginx 反向代理 + Let's Encrypt HTTPS**,并自动更新 CORS

也支持非交互子命令:

```bash
sudo ./werkzeug/deploy.sh install     # 直接全新安装
sudo ./werkzeug/deploy.sh status      # 查看状态
sudo ./werkzeug/deploy.sh languages   # 重新选择语言并热更新
sudo ./werkzeug/deploy.sh domain      # 仅配置域名 / Nginx / HTTPS
```

### 本地开发栈

仅启动 Postgres 并载入 schema(需要 Docker):

```bash
./werkzeug/development/dev-up.sh
```

## 卸载

免克隆一键卸载:

```bash
curl -fsSL https://cdn.jsdelivr.net/gh/dieWehmut/Sandkasten@main/werkzeug/uninstall.sh -o sk-uninstall.sh && chmod +x sk-uninstall.sh && sudo ./sk-uninstall.sh --purge
```

或在仓库内运行:

```bash
sudo ./werkzeug/uninstall.sh              # 交互式逐项确认
sudo ./werkzeug/uninstall.sh --dry-run    # 仅预览将删除的内容
sudo ./werkzeug/uninstall.sh --purge      # 一键彻底卸载(仍二次确认)
```

卸载脚本与部署一一对应地清除:systemd 服务、二进制、`/etc/sandkasten` 配置、`/var/lib/sandkasten` 状态、数据库与角色、`/opt` 下的语言工具链及 `/usr/local/bin` 符号链接、全局 npm 包、`/usr/local/go`、构建缓存、Nginx 站点与证书、服务账户,最后做**残留自检**。系统 apt 语言包默认保留(可能被系统其它部分依赖)。

## API

API 同时提供 HTTP 与 gRPC。主要 HTTP 路由:

| 方法与路径 | 说明 |
| --- | --- |
| `GET /v1/runtimes` | 列出运行时(浏览器返回 HTML 索引页,其余返回 JSON) |
| `POST /v1/run` | 提交任务(通用) |
| `POST /v1/{language}/run` | 提交指定语言的任务 |
| `GET /v1/jobs/{job_id}` | 查询任务状态与结果 |
| `GET /healthz` | 健康检查 |

**v1 契约**:客户端上传 `tar.gz` 归档或提交单文件源码。Go 归档必须包含 `go.mod` 与 `vendor/` 目录;非 Go 运行时使用各自的入口文件,如 `main.sh`、`main.f90`、`main.md`、`main.dot`、`index.html`、`app/page.tsx`、`main.py`、`main.tex`、`main.vue`、`main.zig` 等。前端与文档类运行时会向 stdout 输出源码、编译后的 CSS、静态 HTML 或 SVG;客户端应将 HTML/SVG 输出视为**不可信**预览内容。

更多细节见 `handbuch/api.md`、`handbuch/architecture.md`、`handbuch/deployment.md` 与 `handbuch/runner-security.md`。

## 支持的语言

Go、Assembly、Bash/Shell、C、Cangjie(仓颉)、Clojure、CSS、C++、C#、Coq、Crystal、Dart、Elixir、Erlang、F#、Fortran、GDScript、Gleam、GNU Octave、Graphviz DOT、Haskell、HTML、Java、JavaScript、Julia、Kotlin、LaTeX、Lean4、Lua、Markdown/Mermaid、MDX、Mojo、Next.js、Nextflow、Nim、OCaml、Pascal、Perl、PHP、Prolog、Python、QML、R、Racket、Ruby、Rust、Scala、SCSS、SQL、Swift、Tailwind CSS、TypeScript、TSX/React、Typst、V、Vue 3、WDL、Zig。

## 本地测试

```bash
./werkzeug/quality/test.sh         # 单元测试
./werkzeug/smoke/smoke-go.sh       # 本地 API + 运行器 Go 执行冒烟
./werkzeug/smoke/smoke-languages.sh # 所有语言的 HTTP 冒烟
```

可用 `SMOKE_LANGUAGES=ocaml` 或 `SMOKE_LANGUAGES="markdown graphviz"` 只验证子集。

## 工具目录

开发与质量脚本按用途归档在 `werkzeug/development/`、`werkzeug/quality/`、
`werkzeug/security/` 和 `werkzeug/smoke/`。根目录下同名的 `werkzeug/*.sh`（以及
`smoke-concurrency.mjs`）是兼容 wrapper，会转发到对应的 canonical 路径；已有自动化
调用无需立即修改。常用入口也可通过 `make test`、`make lint`、`make preflight`、
`make smoke-go` 和 `make smoke-languages` 执行。

## 许可

本仓库尚未附带独立的 LICENSE 文件;如需在生产或二次分发中使用,请先与仓库所有者确认授权条款。
