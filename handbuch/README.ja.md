<h1 align="center">Sandkasten</h1>

<p align="center">セルフホスト型・多言語オンラインコード実行サンドボックス</p>

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

[简体中文](../README.md) | [繁體中文](README.zh-TW.md) | [English](README.en.md) | 日本語

</div>

---

`Sandkasten` はセルフホスト型のオンラインコード実行システムです。クライアントは HTTP API 経由で単一ファイルのソースまたは `tar.gz` アーカイブを送信し、サーバーはジョブを Postgres に保存します。Rust 製のランナー（`laeufer`）が非同期にジョブを取得し、cgroup・名前空間・ファイルシステム・ネットワークを隔離した Linux サンドボックス内でコンパイル・実行します。v1 は **58 種類の言語・ランタイム**をサポートします。ブログ／ドキュメントサイトの「オンライン実行」バックエンドとしても、単独のジャッジ／デモサービスとしても利用できます。

ランナーは Docker や通常のホスト実行に**暗黙のフォールバックを行いません**。必要なカーネル機能や権限が欠けている場合はプリフライトで失敗し、ジョブの実行を拒否します。

## デモ

- ランタイム一覧ページ：<https://run.diesw.tech/v1/runtimes>
- フロントエンド例：<https://diewehmut.github.io/>

ランタイム一覧ページは API がサーバーサイドでレンダリングし、有効なすべての言語・バージョン・デフォルトのリソース制限・コンパイル／実行コマンドを表示します。

## 機能

- 58 種類の言語・ランタイム。必要なものだけ選んでインストール可能(すべてを一度に入れる必要なし)
- 単一ファイルのソース、または `tar.gz` アーカイブの 2 通りの送信方式
- Rust ランナー + Linux サンドボックス:cgroup v2 のリソース上限、名前空間隔離、ネットワークなし、読み取り専用ルートファイルシステム
- 言語ごとにデフォルト／上限リソース(タイムアウト、メモリ、CPU、出力サイズ)を個別設定
- 公式言語アイコンを内蔵したサーバーレンダリングのランタイム一覧ページ
- HTTP と gRPC の両インターフェース
- フロントエンド／ドキュメント系ランタイム(HTML、Markdown、Mermaid、Graphviz、Typst、LaTeX、Vue、TSX など)はプレビュー可能な成果物を出力
- 対話式ワンショット・デプロイスクリプト:言語選択、ビルド、systemd による起動時自動開始、Nginx リバースプロキシ + Let's Encrypt HTTPS
- 徹底的なクリーンアップと残留セルフチェックを備えたアンインストールスクリプト

## アーキテクチャ

| ディレクトリ | 説明 |
| --- | --- |
| `schnittstelle/` | Go 製の gRPC / HTTP API サービス |
| `laeufer/` | Rust ランナーと Linux サンドボックス制御 |
| `vertrag/` | Go と Rust が共有する protobuf 契約 |
| `speicher/` | Postgres スキーマとマイグレーション |
| `wurzelwerk/` | ランナーが使う rootfs とランタイム資産 |
| `einsatz/` | デプロイメントマニフェスト(Docker / K8s) |
| `pruefung/` | 統合テストとセキュリティテスト |
| `beispiele/` | サンプルクライアントとプロジェクト |
| `werkzeug/` | 開発・デプロイスクリプト |
| `handbuch/` | アーキテクチャ・運用ドキュメント(および本 README の翻訳) |

## クイックスタート

### クローン不要のワンライナー導入(推奨)

Debian / Ubuntu (x86_64) ホスト上で、root として 1 行のコマンドを実行するだけです(スクリプトが git をインストールし、ソースを `/opt/sandkasten/src` へ自動的にクローンします):

```bash
curl -fsSL https://cdn.jsdelivr.net/gh/dieWehmut/sandkasten@main/werkzeug/deploy.sh -o sandkasten.sh && chmod +x sandkasten.sh && sudo ./sandkasten.sh
```

または、先にクローンしてから実行します:

```bash
git clone https://github.com/dieWehmut/sandkasten.git
cd sandkasten
sudo ./werkzeug/deploy.sh
```

スクリプトは対話式で、次の手順を案内します:

1. **サーバー構成の表示**(CPU／メモリ／ディスク)と選択言語のディスク使用量の見積もり
2. **番号で言語を選択** —— 58 種類のランタイムを番号付きメニューで表示。数字(例 `1 5 12`)、範囲(`1-10`)、言語名、またはプリセット `core` / `web` / `all` を入力。選んだ言語のツールチェーンのみをインストール
3. **PostgreSQL のプロビジョニング**(ロール／データベース／スキーマ)
4. `sandkasten-api`(Go)と `laeufer`(Rust)バイナリの**ビルド**
5. **環境ファイルの書き込み**、systemd ユニットのインストール、**起動時自動開始の有効化**
6. 任意:**Nginx リバースプロキシ + Let's Encrypt HTTPS**、CORS の自動更新

非対話サブコマンドも利用できます:

```bash
sudo ./werkzeug/deploy.sh install     # 直接、新規インストール
sudo ./werkzeug/deploy.sh status      # ステータス表示
sudo ./werkzeug/deploy.sh languages   # 言語を選び直してホット更新
sudo ./werkzeug/deploy.sh domain      # ドメイン / Nginx / HTTPS のみ設定
```

### ローカル開発スタック

Postgres のみを起動しスキーマを読み込みます(Docker が必要):

```bash
./werkzeug/dev-up.sh
```

## アンインストール

クローン不要のワンライナーでアンインストール:

```bash
curl -fsSL https://cdn.jsdelivr.net/gh/dieWehmut/sandkasten@main/werkzeug/uninstall.sh -o sk-uninstall.sh && chmod +x sk-uninstall.sh && sudo ./sk-uninstall.sh --purge
```

またはリポジトリ内から実行:

```bash
sudo ./werkzeug/uninstall.sh              # 対話式・項目ごとに確認
sudo ./werkzeug/uninstall.sh --dry-run    # 削除内容のプレビューのみ
sudo ./werkzeug/uninstall.sh --purge      # ワンショット完全削除(一度だけ確認)
```

アンインストールスクリプトはデプロイと 1 対 1 で対応し、次を削除します:systemd サービス、バイナリ、`/etc/sandkasten` 設定、`/var/lib/sandkasten` 状態、データベースとロール、`/opt` 配下の言語ツールチェーンと `/usr/local/bin` のシンボリックリンク、グローバル npm パッケージ、`/usr/local/go`、ビルドキャッシュ、Nginx サイトと証明書、サービスアカウント。最後に**残留セルフチェック**を実行します。システムの apt 言語パッケージは既定で保持されます(システムの他の部分に共有されている可能性があるため)。

## API

API は HTTP と gRPC の両方を提供します。主な HTTP ルート:

| メソッドとパス | 説明 |
| --- | --- |
| `GET /v1/runtimes` | ランタイム一覧(ブラウザには HTML 一覧ページ、それ以外は JSON) |
| `POST /v1/run` | ジョブ送信(汎用) |
| `POST /v1/{language}/run` | 指定言語のジョブ送信 |
| `GET /v1/jobs/{job_id}` | ジョブのステータスと結果の取得 |
| `GET /healthz` | ヘルスチェック |

**v1 契約**:クライアントは `tar.gz` アーカイブをアップロードするか、単一ファイルのソースを送信します。Go アーカイブには `go.mod` と `vendor/` ディレクトリが必要です。Go 以外のランタイムは、それぞれのエントリポイント(`main.sh`、`main.f90`、`main.md`、`main.dot`、`index.html`、`app/page.tsx`、`main.py`、`main.tex`、`main.vue`、`main.zig` など)を使用します。フロントエンド／ドキュメント系ランタイムは、ソース、コンパイル済み CSS、静的 HTML、または SVG を stdout に出力します。クライアントは HTML/SVG 出力を**信頼できない**プレビューコンテンツとして扱ってください。

詳細は本フォルダ内の `api.md`、`architecture.md`、`deployment.md`、`runner-security.md` を参照してください。

## 対応言語

Go、Assembly、Bash/Shell、C、Cangjie、Clojure、CSS、C++、C#、Coq、Crystal、Dart、Elixir、Erlang、F#、Fortran、GDScript、Gleam、GNU Octave、Graphviz DOT、Haskell、HTML、Java、JavaScript、Julia、Kotlin、LaTeX、Lean4、Lua、Markdown/Mermaid、MDX、Mojo、Next.js、Nextflow、Nim、OCaml、Pascal、Perl、PHP、Prolog、Python、QML、R、Racket、Ruby、Rust、Scala、SCSS、SQL、Swift、Tailwind CSS、TypeScript、TSX/React、Typst、V、Vue 3、WDL、Zig。

## ローカルテスト

```bash
./werkzeug/test.sh                 # ユニットテスト
./werkzeug/smoke-go.sh             # ローカル API + ランナーの Go 実行スモーク
./werkzeug/smoke-languages.sh      # 全言語の HTTP スモーク
```

`SMOKE_LANGUAGES=ocaml` または `SMOKE_LANGUAGES="markdown graphviz"` でサブセットのみを検証できます。

## ライセンス

本リポジトリはまだ独立した LICENSE ファイルを同梱していません。本番環境や再配布で利用する場合は、事前にリポジトリ所有者にライセンス条項を確認してください。
