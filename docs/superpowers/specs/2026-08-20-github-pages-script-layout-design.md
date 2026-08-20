# GitHub Pages 与脚本布局设计

## 目标

将仓库中的无依赖 WebUI 发布到 GitHub Pages，并通过 GitHub Actions 在 `main`
推送时自动部署。Pages 页面可以连接到独立部署的 Sandkasten HTTP API，同时
保留空配置时的同源 WebUI 行为。

同时整理 `werkzeug/` 直属脚本，减少根目录职责混杂，但保留已有公开入口和
文档中的命令路径，避免升级后破坏安装或运维流程。

## 方案

### Pages 发布

`.github/workflows/pages.yml` 使用 GitHub 官方 Pages Actions：配置 Pages、上传
静态 artifact、部署 artifact。构建步骤只复制 `webui/`，不引入 Node 或打包器，
并生成一个不提交密钥的运行时配置文件。API 地址来自仓库变量
`SANDKASTEN_API_BASE_URL`；未设置时为空字符串，客户端继续请求同源 `/v1/...`。

客户端将所有 API 请求通过一个 URL helper 解析：绝对 API 基址用于跨域 Pages，
空基址用于已有 Nginx 同源部署。路径拼接必须避免双斜杠，并保留
`encodeURIComponent` 的语言和 job ID 处理。

### 脚本布局

保留以下三个直属路径作为兼容入口和远程安装 URL：

- `werkzeug/install.sh`
- `werkzeug/deploy.sh`
- `werkzeug/uninstall.sh`

其余直属脚本按职责移动到：

- `werkzeug/development/`: `dev-up.sh`、`gen-proto.sh`、`docker-clean.sh`
- `werkzeug/quality/`: `test.sh`、`lint.sh`
- `werkzeug/security/`: `preflight.sh`、`check-security-config.sh`、`security-tests.sh`
- `werkzeug/smoke/`: `smoke-go.sh`、`smoke-languages.sh`、`smoke-concurrency.mjs`

旧路径保留很薄的兼容 wrapper，转发到新位置并保留参数和退出码。新脚本的
仓库根目录解析改为基于两级父目录，wrapper 自身不复制业务逻辑。

### 分支与合并

从当前 `main` 创建功能分支。实现过程中只合并实际存在且不重复的分支；本次
盘点若没有其他分支，则不制造空合并提交。每个职责边界单独提交并推送，最后
运行全套静态、Shell、Node、Go 和 Pages artifact 检查。

## 验证

- Node WebUI 测试覆盖默认同源和配置的绝对 API 基址。
- Workflow YAML 可解析，artifact 只包含 `index.html`、`app.js`、`styles.css`
  和生成的配置文件。
- 所有原入口 wrapper 可执行并转发 `--help`/参数。
- Shell `bash -n`、现有 installer/WebUI 测试、`go test ./...` 通过。
- Git 状态干净，功能分支已推送，远程分支指向最终提交。
