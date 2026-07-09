<h1 align="center">Sandkasten</h1>

<p align="center">自架的多語言線上程式碼執行沙箱</p>

<div align="center">

<div>
<a href="https://run.diesw.tech/v1/runtimes" target="_blank">
  <img src="https://img.shields.io/badge/DEMO-Runtimes-1FC41F?style=flat-square&logo=googlechrome&logoColor=white&labelColor=555555" alt="Demo">
</a>
<a href="https://github.com/dieWehmut/sandkasten" target="_blank">
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

[简体中文](../README.md) | 繁體中文 | [English](README.en.md) | [日本語](README.ja.md)

</div>

---

`Sandkasten` 是一個自架的線上程式碼執行系統。用戶端透過 HTTP API 上傳單一檔案原始碼或 `tar.gz` 封存檔，伺服端把工作寫入 Postgres，由一個以 Rust 撰寫的執行器（`laeufer`）非同步領取，並在具備 cgroup、命名空間、檔案系統與網路隔離的 Linux 沙箱中編譯、執行。v1 支援 **58 種語言與執行環境**，可作為部落格／文件站的「線上跑程式碼」後端，也可獨立作為評測與展示服務。

執行器**不會**靜默回退到 Docker 或直接在主機上執行；若缺少所需的核心或權限特性,它會在預檢時失敗並拒絕執行工作。

## 範例

- 執行環境索引頁：<https://run.diesw.tech/v1/runtimes>
- 前端範例：<https://diewehmut.github.io/>

執行環境索引頁由 API 直接於伺服端算繪,列出所有已啟用語言、版本、預設資源限制與編譯／執行指令。

## 功能

- 58 種語言與執行環境,可依需求自選安裝(不必一次全裝)
- 單一檔案原始碼或 `tar.gz` 封存檔兩種提交方式
- Rust 執行器 + Linux 沙箱:cgroup v2 資源額度、命名空間隔離、無網路、唯讀根檔案系統
- 每種語言可獨立設定預設／上限資源(逾時、記憶體、CPU、輸出大小)
- 伺服端算繪的執行環境索引頁,內建官方語言圖示
- 同時提供 HTTP 與 gRPC 介面
- 前端／文件類執行環境(HTML、Markdown、Mermaid、Graphviz、Typst、LaTeX、Vue、TSX 等)輸出可預覽產物
- 互動式一鍵部署指令稿:選語言、編譯、systemd 開機自啟、Nginx 反向代理 + Let's Encrypt HTTPS
- 配套解除安裝指令稿,支援徹底清理與殘留自檢

## 架構

| 目錄 | 說明 |
| --- | --- |
| `schnittstelle/` | Go 撰寫的 gRPC / HTTP API 服務 |
| `laeufer/` | Rust 執行器與 Linux 沙箱控制器 |
| `vertrag/` | Go 與 Rust 共用的 protobuf 契約 |
| `speicher/` | Postgres schema 與遷移 |
| `wurzelwerk/` | 執行器使用的 rootfs 與執行環境資源 |
| `einsatz/` | 部署清單(Docker / K8s) |
| `pruefung/` | 整合測試與安全測試 |
| `beispiele/` | 範例用戶端與專案 |
| `werkzeug/` | 開發與部署指令稿 |
| `handbuch/` | 架構與維運文件(含本 README 的多語言譯文) |

## 快速開始

### 免克隆一鍵部署(建議)

在一台 Debian / Ubuntu (x86_64) 主機上,以 root 執行一行指令即可(指令稿會自動安裝 git 並克隆原始碼到 `/opt/sandkasten/src`):

```bash
curl -fsSL https://cdn.jsdelivr.net/gh/dieWehmut/sandkasten@main/werkzeug/deploy.sh -o sandkasten.sh && chmod +x sandkasten.sh && sudo ./sandkasten.sh
```

或先克隆再執行:

```bash
git clone https://github.com/dieWehmut/sandkasten.git
cd sandkasten
sudo ./werkzeug/deploy.sh
```

指令稿為互動式,會引導你完成:

1. **顯示伺服器配置**(CPU／記憶體／磁碟)並估算所選語言的磁碟佔用
2. **依編號選擇語言** —— 58 種執行環境帶編號選單,輸入數字(如 `1 5 12`)、區間(`1-10`)、語言名,或預設 `core` / `web` / `all`;僅安裝所選語言的工具鏈
3. **provision PostgreSQL**(角色／資料庫／schema)
4. **編譯** `sandkasten-api`(Go)與 `laeufer`(Rust)二進位檔
5. **寫入環境檔**並安裝 systemd 單元,**設定開機自啟**
6. 選用:**Nginx 反向代理 + Let's Encrypt HTTPS**,並自動更新 CORS

亦支援非互動子指令:

```bash
sudo ./werkzeug/deploy.sh install     # 直接全新安裝
sudo ./werkzeug/deploy.sh status      # 檢視狀態
sudo ./werkzeug/deploy.sh languages   # 重新選擇語言並熱更新
sudo ./werkzeug/deploy.sh domain      # 僅設定網域 / Nginx / HTTPS
```

### 本地開發堆疊

僅啟動 Postgres 並載入 schema(需要 Docker):

```bash
./werkzeug/dev-up.sh
```

## 解除安裝

免克隆一鍵解除安裝:

```bash
curl -fsSL https://cdn.jsdelivr.net/gh/dieWehmut/sandkasten@main/werkzeug/uninstall.sh -o sk-uninstall.sh && chmod +x sk-uninstall.sh && sudo ./sk-uninstall.sh --purge
```

或在儲存庫內執行:

```bash
sudo ./werkzeug/uninstall.sh              # 互動式逐項確認
sudo ./werkzeug/uninstall.sh --dry-run    # 僅預覽將刪除的內容
sudo ./werkzeug/uninstall.sh --purge      # 一鍵徹底解除安裝(仍二次確認)
```

解除安裝指令稿與部署一一對應地清除:systemd 服務、二進位檔、`/etc/sandkasten` 設定、`/var/lib/sandkasten` 狀態、資料庫與角色、`/opt` 下的語言工具鏈及 `/usr/local/bin` 符號連結、全域 npm 套件、`/usr/local/go`、建置快取、Nginx 站台與憑證、服務帳戶,最後做**殘留自檢**。系統 apt 語言套件預設保留(可能被系統其它部分依賴)。

## API

API 同時提供 HTTP 與 gRPC。主要 HTTP 路由:

| 方法與路徑 | 說明 |
| --- | --- |
| `GET /v1/runtimes` | 列出執行環境(瀏覽器回傳 HTML 索引頁,其餘回傳 JSON) |
| `POST /v1/run` | 提交工作(通用) |
| `POST /v1/{language}/run` | 提交指定語言的工作 |
| `GET /v1/jobs/{job_id}` | 查詢工作狀態與結果 |
| `GET /healthz` | 健康檢查 |

**v1 契約**:用戶端上傳 `tar.gz` 封存檔或提交單一檔案原始碼。Go 封存檔必須包含 `go.mod` 與 `vendor/` 目錄;非 Go 執行環境使用各自的進入點檔案,如 `main.sh`、`main.f90`、`main.md`、`main.dot`、`index.html`、`app/page.tsx`、`main.py`、`main.tex`、`main.vue`、`main.zig` 等。前端與文件類執行環境會向 stdout 輸出原始碼、編譯後的 CSS、靜態 HTML 或 SVG;用戶端應將 HTML/SVG 輸出視為**不可信**預覽內容。

更多細節見本資料夾中的 `api.md`、`architecture.md`、`deployment.md` 與 `runner-security.md`。

## 支援的語言

Go、Assembly、Bash/Shell、C、Cangjie(倉頡)、Clojure、CSS、C++、C#、Coq、Crystal、Dart、Elixir、Erlang、F#、Fortran、GDScript、Gleam、GNU Octave、Graphviz DOT、Haskell、HTML、Java、JavaScript、Julia、Kotlin、LaTeX、Lean4、Lua、Markdown/Mermaid、MDX、Mojo、Next.js、Nextflow、Nim、OCaml、Pascal、Perl、PHP、Prolog、Python、QML、R、Racket、Ruby、Rust、Scala、SCSS、SQL、Swift、Tailwind CSS、TypeScript、TSX/React、Typst、V、Vue 3、WDL、Zig。

## 本地測試

```bash
./werkzeug/test.sh                 # 單元測試
./werkzeug/smoke-go.sh             # 本地 API + 執行器 Go 執行冒煙
./werkzeug/smoke-languages.sh      # 所有語言的 HTTP 冒煙
```

可用 `SMOKE_LANGUAGES=ocaml` 或 `SMOKE_LANGUAGES="markdown graphviz"` 只驗證子集。

## 授權

本儲存庫尚未附帶獨立的 LICENSE 檔案;如需在生產或二次散布中使用,請先與儲存庫擁有者確認授權條款。
