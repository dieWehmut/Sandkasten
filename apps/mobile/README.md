# Sandkasten Android 手机端

参照 Orchester 的四导航、六套暗色主题、圆角卡片、底部选择面板和单双栏布局，使用 Sandkasten 自己的品牌与远程代码运行协议。手机编辑源码和项目，在电脑服务上编译、运行、查看输出及停止任务。

## 使用

1. 启动电脑上的 Sandkasten API、Postgres 和 Rust 运行器。API 监听地址需允许手机访问，例如 `SANDKASTEN_API_HTTP_ADDR=0.0.0.0:8080`；访问令牌为电脑配置的 `SANDKASTEN_API_TOKEN`。
2. 手机在“控制台 → 连接电脑”输入电脑 IP、名称和访问令牌。仅输入 IP 时默认端口 8080，完整 HTTP(S) 地址可包含反向代理路径。服务没有设置令牌时可以留空。HTTP 连接用于可信局域网或 VPN；其他网络使用 HTTPS。
3. 在“项目”页选择运行设备，打开默认 Go/Python 示例或新建项目，从电脑返回的运行时目录中选择语言，编辑源码后保存。
4. 在“任务”工作栏点击“运行”。“输入、参数与文件”可设置入口文件、标准输入、JSON 字符串数组参数、运行超时及最多 32 个文本文件。Go 单文件项目使用默认入口或自定义 `.go` 文件路径。超时为 0 时使用电脑默认值。
5. “输出”显示编译/运行标准输出和错误输出、任务状态、退出码、信号、耗时和截断提示。运行中可停止；停止后继续补取运行器最后的输出。二进制输出不能转成 UTF-8 时保留 Base64 原文，HTML/SVG 作为文本显示。
6. 可连接多台电脑、打开最多 12 个设备/项目工作栏，在任务页或设置页切换单栏/双栏。每栏草稿独立，点击“保存项目”后可在重启后复用。关闭栏和删除本机记录不会取消电脑上的任务。

Android 使用 Keystore 的 AES-GCM 密钥加密保存令牌；设备地址、项目源码、工作栏、主题和布局偏好在本机保存。浏览器预览只在页面内存保留令牌。启动时重连保存的电脑，恢复工作栏与已知任务；每个任务的输出从电脑重新读取。API 没有全量任务列表接口，任务记录只包含该手机提交并保留的 ID。“从本机移除”删除对应电脑的本机凭据和任务记录，服务器令牌仍由电脑配置管理。

Android 主题在原生偏好写入成功后确认保存，启动时从原生偏好恢复，避免快速强退后读到旧 WebView 缓存。保存失败时设置页会提示重新选择。

## 构建与安装

要求 Node.js 22.18+、JDK 21、Android SDK 36 / Build Tools 36.0.0。

```bash
cd apps/mobile
npm ci
npm test
npm run typecheck
npm run build:android
adb install -r android/app/build/outputs/apk/debug/app-debug.apk
adb shell am start -n dev.sandkasten.mobile/.MainActivity
```

设置 `ANDROID_HOME` 指向本机 SDK；本机需要时也设置 `JAVA_HOME` 指向 JDK 21。`npm run sync` 把 Web 构建产物复制到原生工程。普通构建不需要 Python/Pillow；只有重新生成品牌资源时才需运行 `python3 scripts/generate-brand-assets.py`。

## 本机验证

既有 [Studio 验收证据](../../docs/mobile/acceptance.md) 来自 WSL/Linux 版 Android Studio：IDE 完成 Build/Run，安装包上的原生四测由 ADB AndroidJUnitRunner 执行。Windows 版 Android Studio 的 IDE 测试结果单独记录。

Windows 验证时，在 Windows 仓库的 `apps\mobile` 目录运行 `npm ci`、`npm run build` 和 `npm run sync`，然后用 Windows 版 Android Studio 打开该仓库的 `apps\mobile\android`。Gradle JDK 选择 JDK 21，SDK 指向 Windows SDK（通常为 `%LOCALAPPDATA%\Android\Sdk`），安装 Android SDK 36 / Build Tools 36.0.0 并等待同步完成。工程 `compileSdk` / `targetSdk` 为 36；运行设备可选 API 36 或更高，本机现有 Windows API 37 模拟器可用于此项验证。

选择 `app` 配置和对应模拟器，使用 IDE 的 Build 与 Run 按钮构建、安装并启动。安装后可在四个导航页检查主题、项目、运行输出、系统返回及重启恢复。

要让原生测试结果显示在 IDE 中，选择仓库中的[共享配置](android/.run/Sandkasten%20NativeBridgeTest.run.xml) `Sandkasten NativeBridgeTest` 和模拟器，点击 Run，在 Run 面板查看四个测试的测试树和控制台结果。本轮 Windows Studio 在 API 37 模拟器上四项全部通过，结果与截图见[独立验收](../../docs/mobile/acceptance.md#windows-studio-独立验收)。

配置尚未显示时，在 Project 面板打开 `app/src/androidTest/java/dev/sandkasten/mobile/NativeBridgeTest.java`，点击类名左侧绿色运行箭头运行 `NativeBridgeTest`。也可通过 Run → Edit Configurations → 新建 `Android Instrumented Tests`，Module 选择 app 对应模块，Test 选择 Class，填写 `dev.sandkasten.mobile.NativeBridgeTest`。

Vitest 使用隔离 HTTP/凭据 fixture 覆盖请求契约、多设备与草稿隔离、异步重连、取消输出补取和本机恢复。原生测试使用安装版 WebView 验证 Keystore 加密、凭据重建、HTTP bearer 请求、主题与系统返回。以下命令用于 WSL/Linux 的原生命令行验证：

```bash
cd apps/mobile
npm run build
npm run sync
cd android
./gradlew --no-daemon :app:assembleDebug :app:assembleDebugAndroidTest :app:lintDebug
adb install -r app/build/outputs/apk/debug/app-debug.apk
adb install -r -t app/build/outputs/apk/androidTest/debug/app-debug-androidTest.apk
adb shell am instrument -w dev.sandkasten.mobile.test/androidx.test.runner.AndroidJUnitRunner
```

安装版端到端脚本要求启动 Android 模拟器和真实 API + Rust 运行器，通过 WebView 调试端口操作实际应用，使用原生 HTTP 桥接执行代码、上传文本文件、触发编译错误、停止运行进程，验证六主题/四导航和强退后恢复；保留 JSON 与 Android 屏幕截图。脚本不清除应用数据，会新增验收项目与任务。

```bash
cd apps/mobile
MOBILE_E2E_ADDRESS=http://10.0.2.2:8080 \
MOBILE_E2E_TOKEN=your-test-token \
MOBILE_E2E_DEVICE=emulator-5554 \
  npm run test:android-e2e
```

应用 ID 为 `dev.sandkasten.mobile`，debug APK 由 [Android CI](../../.github/workflows/mobile.yml) 构建并保留为工作流安装产物。本轮本机结果和截图见 [验收记录](../../docs/mobile/acceptance.md)。debug 包用于开发验收；这里没有声称完成商店发布、release 签名或物理手机验证。
