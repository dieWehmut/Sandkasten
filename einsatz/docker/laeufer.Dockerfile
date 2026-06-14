FROM rust:1.96-bookworm AS build

WORKDIR /src

COPY laeufer/Cargo.toml ./laeufer/Cargo.toml
COPY laeufer/crates/laeufer-core/Cargo.toml ./laeufer/crates/laeufer-core/Cargo.toml
COPY laeufer/crates/laeufer-go/Cargo.toml ./laeufer/crates/laeufer-go/Cargo.toml
COPY laeufer/crates/laeufer-sandbox/Cargo.toml ./laeufer/crates/laeufer-sandbox/Cargo.toml
COPY laeufer/crates/laeufer-sprachen/Cargo.toml ./laeufer/crates/laeufer-sprachen/Cargo.toml
COPY laeufer/crates/laeufer-store/Cargo.toml ./laeufer/crates/laeufer-store/Cargo.toml
WORKDIR /src/laeufer

RUN mkdir -p src crates/laeufer-core/src crates/laeufer-go/src crates/laeufer-sandbox/src crates/laeufer-sprachen/src crates/laeufer-store/src && \
    printf 'pub fn _cargo_cache_probe() {}\n' > src/lib.rs && \
    mkdir -p src/bin && \
    printf 'fn main() {}\n' > src/bin/laeufer.rs && \
    printf 'pub fn _cargo_cache_probe() {}\n' > crates/laeufer-core/src/lib.rs && \
    printf 'pub fn _cargo_cache_probe() {}\n' > crates/laeufer-go/src/lib.rs && \
    printf 'pub fn _cargo_cache_probe() {}\n' > crates/laeufer-sandbox/src/lib.rs && \
    printf 'pub fn _cargo_cache_probe() {}\n' > crates/laeufer-sprachen/src/lib.rs && \
    printf 'pub fn _cargo_cache_probe() {}\n' > crates/laeufer-store/src/lib.rs
RUN cargo fetch

WORKDIR /src
COPY vertrag ./vertrag
COPY laeufer ./laeufer

WORKDIR /src/laeufer
RUN test -f src/bin/laeufer.rs || test -f src/main.rs || (echo "missing laeufer runner binary source; add src/bin/laeufer.rs or src/main.rs before building the runner image" >&2; exit 1)
RUN cargo build --release --bin laeufer && \
    cp target/release/laeufer /out-laeufer

FROM golang:1.26-bookworm

ARG JULIA_VERSION=1.10.10
ARG JULIA_MINOR_VERSION=1.10
ARG LEAN_VERSION=4.23.0
ARG SWIFT_VERSION=6.3.2
ARG ZIG_VERSION=0.16.0
ARG DART_VERSION=3.12.2
ARG DOTNET_SDK_VERSION=10.0.301
ARG PIXI_VERSION=0.70.2
ARG NEXTFLOW_VERSION=26.04.3
ARG CANGJIE_VERSION=1.1.3
ARG CANGJIE_SHA256=2b68905afc466e665ae181595c63f96c18d75fd2c1fb6c6f0cb64e179c28d61a
ARG GLEAM_VERSION=1.17.0
ARG GLEAM_SHA256=c0d1eaadac40c88ac93ea45fc150f6363f4ceb8c925b5ac90f371b1665613cc4
ARG V_VERSION=weekly.2026.08
ARG V_SHA256=9a71226a554a184d7d4dac9898bc5a9a65b496da26ec1ad0d412721b775be789
ARG TYPST_VERSION=0.14.2
ARG TYPST_SHA256=a6044cbad2a954deb921167e257e120ac0a16b20339ec01121194ff9d394996d
ARG TECTONIC_VERSION=0.16.9
ARG TECTONIC_SHA256=60b13a0826ae7ad9ce34b4a2df06bff2cfcfa6dda8a915477c0cbb84e1a4a902
ARG CURL_RETRY_ARGS="--retry 5 --retry-delay 2 --retry-connrefused --retry-all-errors --http1.1"

RUN apt-get update && \
    apt-get install -y --no-install-recommends \
      ca-certificates \
      bash \
      chromium \
      clojure \
      curl \
      coq \
      crystal \
      elixir \
      erlang-dev \
      fpc \
      g++ \
      gcc \
      git \
      godot3-server \
      gfortran \
      ghc \
      graphviz \
      kotlin \
      libcurl4-openssl-dev \
      libedit2 \
      libgcc-12-dev \
      libpython3.11 \
      libsqlite3-0 \
      libstdc++-12-dev \
      libxml2-dev \
      libz3-dev \
      lua5.4 \
      mono-mcs \
      mono-runtime \
      nim \
      node-typescript \
      nodejs \
      npm \
      ocaml-nox \
      octave \
      perl \
      php-cli \
      poppler-utils \
      openjdk-17-jdk-headless \
      python3 \
      python3-pip \
      python3-venv \
      qml \
      qml-module-qtquick2 \
      qml-module-qtquick-controls2 \
      qml-module-qtquick-window2 \
      qml6-module-qtqml \
      qml6-module-qtqml-workerscript \
      qml6-module-qtquick \
      qml6-module-qtquick-controls \
      qml6-module-qtquick-window \
      qmlscene \
      qtbase5-dev \
      qt6-base-dev \
      qt6-declarative-dev \
      qt6-tools-dev-tools \
      qtdeclarative5-dev \
      qtquickcontrols2-5-dev \
      r-base-core \
      racket \
      ruby \
      rustc \
      scala \
      sqlite3 \
      swi-prolog \
      tini \
      tzdata \
      xz-utils \
      zstd && \
    PUPPETEER_SKIP_DOWNLOAD=true npm install -g --prefix /usr/local \
      sass@1.99.0 \
      esbuild@0.24.2 \
      react@18.3.1 \
      react-dom@18.3.1 \
      vue@3.5.38 \
      @vue/compiler-sfc@3.5.38 \
      @vue/server-renderer@3.5.38 \
      next@14.2.35 \
      tailwindcss@3.4.19 \
      postcss@8.4.49 \
      autoprefixer@10.4.20 \
      markdown-it@14.2.0 \
      mermaid@11.15.0 \
      jsdom@26.1.0 \
      dompurify@3.3.1 \
      @mdx-js/mdx@3.1.1 \
      @mermaid-js/mermaid-cli@11.15.0 \
      puppeteer@23.11.1 \
      typescript@5.8.3 \
      @types/react@18.3.23 \
      @types/react-dom@18.3.7 \
      @types/node@20.19.1 && \
    curl ${CURL_RETRY_ARGS} -fL "https://github.com/gleam-lang/gleam/releases/download/v${GLEAM_VERSION}/gleam-v${GLEAM_VERSION}-x86_64-unknown-linux-musl.tar.gz" -o /tmp/gleam.tar.gz && \
    echo "${GLEAM_SHA256}  /tmp/gleam.tar.gz" | sha256sum -c - && \
    tar -xzf /tmp/gleam.tar.gz -C /usr/local/bin gleam && \
    chmod 0755 /usr/local/bin/gleam && \
    mkdir -p /tmp/gleam-warm/src && \
    printf '%s\n' \
      'name = "sandkasten_warm"' \
      'version = "1.0.0"' \
      'target = "erlang"' \
      '' \
      '[dependencies]' \
      'gleam_stdlib = "1.0.3"' > /tmp/gleam-warm/gleam.toml && \
    printf '%s\n' 'pub fn main() { Nil }' > /tmp/gleam-warm/src/main.gleam && \
    (cd /tmp/gleam-warm && XDG_CACHE_HOME=/tmp/gleam-cache gleam build --target erlang --no-print-progress) && \
    mkdir -p /opt/sandkasten/gleam-cache && \
    cp -R /tmp/gleam-cache/. /opt/sandkasten/gleam-cache/ && \
    curl ${CURL_RETRY_ARGS} -fL "https://github.com/vlang/v/releases/download/${V_VERSION}/v_linux.zip" -o /tmp/v_linux.zip && \
    echo "${V_SHA256}  /tmp/v_linux.zip" | sha256sum -c - && \
    unzip -q /tmp/v_linux.zip -d /opt && \
    ln -s /opt/v/v /usr/local/bin/v && \
    curl ${CURL_RETRY_ARGS} -fL "https://github.com/typst/typst/releases/download/v${TYPST_VERSION}/typst-x86_64-unknown-linux-musl.tar.xz" -o /tmp/typst.tar.xz && \
    echo "${TYPST_SHA256}  /tmp/typst.tar.xz" | sha256sum -c - && \
    tar -xJf /tmp/typst.tar.xz -C /opt && \
    ln -s "/opt/typst-x86_64-unknown-linux-musl/typst" /usr/local/bin/typst && \
    curl ${CURL_RETRY_ARGS} -fL "https://github.com/tectonic-typesetting/tectonic/releases/download/tectonic%40${TECTONIC_VERSION}/tectonic-${TECTONIC_VERSION}-x86_64-unknown-linux-musl.tar.gz" -o /tmp/tectonic.tar.gz && \
    echo "${TECTONIC_SHA256}  /tmp/tectonic.tar.gz" | sha256sum -c - && \
    tar -xzf /tmp/tectonic.tar.gz -C /usr/local/bin tectonic && \
    chmod 0755 /usr/local/bin/tectonic && \
    mkdir -p /tmp/tectonic-warm/out && \
    printf '%s\n' \
      '\documentclass{article}' \
      '\begin{document}' \
      'sandkasten latex warmup' \
      '\end{document}' > /tmp/tectonic-warm/main.tex && \
    XDG_CACHE_HOME=/tmp/tectonic-cache tectonic --keep-logs --outdir /tmp/tectonic-warm/out /tmp/tectonic-warm/main.tex && \
    mkdir -p /opt/sandkasten/tectonic-cache && \
    cp -R /tmp/tectonic-cache/. /opt/sandkasten/tectonic-cache/ && \
    chmod -R a+rX /opt/sandkasten/gleam-cache /opt/sandkasten/tectonic-cache && \
    curl ${CURL_RETRY_ARGS} -fsSL "https://ziglang.org/download/${ZIG_VERSION}/zig-x86_64-linux-${ZIG_VERSION}.tar.xz" -o /tmp/zig.tar.xz && \
    tar -xJf /tmp/zig.tar.xz -C /opt && \
    ln -s "/opt/zig-x86_64-linux-${ZIG_VERSION}/zig" /usr/local/bin/zig && \
    curl ${CURL_RETRY_ARGS} -fsSL "https://julialang-s3.julialang.org/bin/linux/x64/${JULIA_MINOR_VERSION}/julia-${JULIA_VERSION}-linux-x86_64.tar.gz" -o /tmp/julia.tar.gz && \
    tar -xzf /tmp/julia.tar.gz -C /opt && \
    ln -s "/opt/julia-${JULIA_VERSION}/bin/julia" /usr/local/bin/julia && \
    curl ${CURL_RETRY_ARGS} -fsSL "https://storage.googleapis.com/dart-archive/channels/stable/release/${DART_VERSION}/sdk/dartsdk-linux-x64-release.zip.sha256sum" -o /tmp/dart.sha256sum && \
    curl ${CURL_RETRY_ARGS} -fL "https://storage.googleapis.com/dart-archive/channels/stable/release/${DART_VERSION}/sdk/dartsdk-linux-x64-release.zip" -o /tmp/dart-sdk.zip && \
    awk '{print $1 "  /tmp/dart-sdk.zip"}' /tmp/dart.sha256sum | sha256sum -c - && \
    unzip -q /tmp/dart-sdk.zip -d /opt && \
    mv /opt/dart-sdk "/opt/dart-sdk-${DART_VERSION}" && \
    ln -s "/opt/dart-sdk-${DART_VERSION}" /opt/dart-sdk && \
    ln -s /opt/dart-sdk/bin/dart /usr/local/bin/dart && \
    curl ${CURL_RETRY_ARGS} -fsSL https://dot.net/v1/dotnet-install.sh -o /tmp/dotnet-install.sh && \
    bash /tmp/dotnet-install.sh --version "${DOTNET_SDK_VERSION}" --install-dir /opt/dotnet --no-path && \
    ln -s /opt/dotnet/dotnet /usr/local/bin/dotnet && \
    python3 -m venv /opt/miniwdl && \
    /opt/miniwdl/bin/pip install --upgrade pip setuptools wheel && \
    /opt/miniwdl/bin/pip install miniwdl && \
    ln -s /opt/miniwdl/bin/miniwdl /usr/local/bin/miniwdl && \
    curl ${CURL_RETRY_ARGS} -fsSL https://pixi.sh/install.sh -o /tmp/pixi-install.sh && \
    PIXI_VERSION="${PIXI_VERSION}" PIXI_HOME=/opt/pixi PIXI_BIN_DIR=/opt/pixi/bin sh /tmp/pixi-install.sh && \
    ln -s /opt/pixi/bin/pixi /usr/local/bin/pixi && \
    pixi init /opt/mojo -c https://conda.modular.com/max/ -c conda-forge && \
    cd /opt/mojo && pixi add mojo && pixi run mojo --version && cd / && \
    printf '\n[crash_reporting]\nenabled = false\n' >> /opt/mojo/.pixi/envs/default/share/max/modular.cfg && \
    find /opt/pixi /opt/mojo -type d -exec chmod 0755 {} + && \
    find /opt/pixi /opt/mojo -type f -exec chmod a+r {} + && \
    find /opt/pixi/bin /opt/mojo/.pixi -type f -perm /111 -exec chmod 0755 {} + && \
    { \
      printf '%s\n' '#!/bin/sh'; \
      printf '%s\n' 'exec /usr/local/bin/pixi run --frozen --no-install -q --manifest-path /opt/mojo/pixi.toml --executable mojo "$@"'; \
    } > /usr/local/bin/mojo && \
    chmod 0755 /usr/local/bin/mojo && \
    mkdir -p /opt/nextflow && \
    curl ${CURL_RETRY_ARGS} -fsSL https://get.nextflow.io -o /usr/local/bin/nextflow-launcher && \
    chmod 0755 /usr/local/bin/nextflow-launcher && \
    NXF_HOME=/opt/nextflow NXF_VER="${NEXTFLOW_VERSION}" /usr/local/bin/nextflow-launcher -version && \
    find /opt/nextflow -type d -exec chmod 0755 {} + && \
    find /opt/nextflow -type f -exec chmod 0644 {} + && \
    { \
      printf '%s\n' '#!/bin/sh'; \
      printf '%s\n' 'export NXF_HOME="${NXF_HOME:-/opt/nextflow}"'; \
      printf '%s\n' 'exec /usr/local/bin/nextflow-launcher "$@"'; \
    } > /usr/local/bin/nextflow && \
    chmod 0755 /usr/local/bin/nextflow && \
    curl ${CURL_RETRY_ARGS} -fsSL "https://github.com/leanprover/lean4/releases/download/v${LEAN_VERSION}/lean-${LEAN_VERSION}-linux.tar.zst" -o /tmp/lean.tar.zst && \
    tar --zstd -xf /tmp/lean.tar.zst -C /opt && \
    ln -s "/opt/lean-${LEAN_VERSION}-linux/bin/lean" /usr/local/bin/lean && \
    ln -s "/opt/lean-${LEAN_VERSION}-linux/bin/lake" /usr/local/bin/lake && \
    curl ${CURL_RETRY_ARGS} -fL "https://download.swift.org/swift-${SWIFT_VERSION}-release/debian12/swift-${SWIFT_VERSION}-RELEASE/swift-${SWIFT_VERSION}-RELEASE-debian12.tar.gz" -o /tmp/swift.tar.gz && \
    tar -xzf /tmp/swift.tar.gz -C /opt && \
    ln -s "/opt/swift-${SWIFT_VERSION}-RELEASE-debian12/usr/bin/swift" /usr/local/bin/swift && \
    ln -s "/opt/swift-${SWIFT_VERSION}-RELEASE-debian12/usr/bin/swiftc" /usr/local/bin/swiftc && \
    curl ${CURL_RETRY_ARGS} -fL "https://cangjie-lang.cn/v1/files/auth/downLoad?nsId=142267&fileName=cangjie-sdk-linux-x64-${CANGJIE_VERSION}.tar.gz&objectKey=6a19349d21f5a8178d6fd22b" -o /tmp/cangjie.tar.gz && \
    echo "${CANGJIE_SHA256}  /tmp/cangjie.tar.gz" | sha256sum -c - && \
    tar -xzf /tmp/cangjie.tar.gz -C /opt && \
    find /opt/cangjie -type d -exec chmod 0755 {} + && \
    find /opt/cangjie -type f -exec chmod 0644 {} + && \
    find /opt/cangjie/bin /opt/cangjie/tools/bin /opt/cangjie/third_party/llvm/bin -type f -exec chmod 0755 {} + && \
    { \
      printf '%s\n' '#!/bin/sh'; \
      printf '%s\n' 'export CANGJIE_HOME="${CANGJIE_HOME:-/opt/cangjie}"'; \
      printf '%s\n' 'if [ -n "${LD_LIBRARY_PATH:-}" ]; then'; \
      printf '%s\n' '  export LD_LIBRARY_PATH="/opt/cangjie/runtime/lib/linux_x86_64_cjnative:/opt/cangjie/tools/lib:${LD_LIBRARY_PATH}"'; \
      printf '%s\n' 'else'; \
      printf '%s\n' '  export LD_LIBRARY_PATH="/opt/cangjie/runtime/lib/linux_x86_64_cjnative:/opt/cangjie/tools/lib"'; \
      printf '%s\n' 'fi'; \
      printf '%s\n' 'exec /opt/cangjie/bin/cjc "$@"'; \
    } > /usr/local/bin/cjc && \
    chmod 0755 /usr/local/bin/cjc && \
    ln -sf /usr/bin/lua5.4 /usr/local/bin/lua && \
    ln -sf /usr/bin/luac5.4 /usr/local/bin/luac && \
    rm -f /tmp/gleam.tar.gz /tmp/v_linux.zip /tmp/typst.tar.xz /tmp/tectonic.tar.gz /tmp/zig.tar.xz /tmp/julia.tar.gz /tmp/dart-sdk.zip /tmp/dart.sha256sum /tmp/dotnet-install.sh /tmp/pixi-install.sh /tmp/lean.tar.zst /tmp/swift.tar.gz /tmp/cangjie.tar.gz && \
    rm -rf /tmp/gleam-cache /tmp/gleam-warm /tmp/tectonic-cache /tmp/tectonic-warm && \
    rm -rf /var/lib/apt/lists/* && \
    mkdir -p /var/lib/sandkasten/laeufer /opt/sandkasten/wurzelwerk

COPY --from=build /out-laeufer /usr/local/bin/laeufer
COPY wurzelwerk /opt/sandkasten/wurzelwerk

ENV CANGJIE_HOME=/opt/cangjie
ENV LAEUFER_WORK_DIR=/var/lib/sandkasten/laeufer
ENV PATH=/usr/local/go/bin:/usr/local/bin:/usr/bin:/bin
ENV LAEUFER_RUNTIME_PATH=/usr/local/go/bin:/usr/local/bin:/usr/bin:/bin
ENV NODE_PATH=/usr/local/lib/node_modules
ENV PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium
ENV NEXT_TELEMETRY_DISABLED=1
ENV BROWSERSLIST_IGNORE_OLD_DATA=1

ENTRYPOINT ["/usr/bin/tini", "--", "/usr/local/bin/laeufer"]
