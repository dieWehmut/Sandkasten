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

RUN apt-get update && \
    apt-get install -y --no-install-recommends \
      ca-certificates \
      bash \
      clojure \
      curl \
      coq \
      crystal \
      elixir \
      g++ \
      gcc \
      git \
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
      perl \
      php-cli \
      openjdk-17-jdk-headless \
      python3 \
      python3-pip \
      python3-venv \
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
    curl -fsSL "https://ziglang.org/download/${ZIG_VERSION}/zig-x86_64-linux-${ZIG_VERSION}.tar.xz" -o /tmp/zig.tar.xz && \
    tar -xJf /tmp/zig.tar.xz -C /opt && \
    ln -s "/opt/zig-x86_64-linux-${ZIG_VERSION}/zig" /usr/local/bin/zig && \
    curl -fsSL "https://julialang-s3.julialang.org/bin/linux/x64/${JULIA_MINOR_VERSION}/julia-${JULIA_VERSION}-linux-x86_64.tar.gz" -o /tmp/julia.tar.gz && \
    tar -xzf /tmp/julia.tar.gz -C /opt && \
    ln -s "/opt/julia-${JULIA_VERSION}/bin/julia" /usr/local/bin/julia && \
    curl -fsSL "https://storage.googleapis.com/dart-archive/channels/stable/release/${DART_VERSION}/sdk/dartsdk-linux-x64-release.zip.sha256sum" -o /tmp/dart.sha256sum && \
    curl -fL "https://storage.googleapis.com/dart-archive/channels/stable/release/${DART_VERSION}/sdk/dartsdk-linux-x64-release.zip" -o /tmp/dart-sdk.zip && \
    awk '{print $1 "  /tmp/dart-sdk.zip"}' /tmp/dart.sha256sum | sha256sum -c - && \
    unzip -q /tmp/dart-sdk.zip -d /opt && \
    mv /opt/dart-sdk "/opt/dart-sdk-${DART_VERSION}" && \
    ln -s "/opt/dart-sdk-${DART_VERSION}" /opt/dart-sdk && \
    ln -s /opt/dart-sdk/bin/dart /usr/local/bin/dart && \
    curl -fsSL https://dot.net/v1/dotnet-install.sh -o /tmp/dotnet-install.sh && \
    bash /tmp/dotnet-install.sh --version "${DOTNET_SDK_VERSION}" --install-dir /opt/dotnet --no-path && \
    ln -s /opt/dotnet/dotnet /usr/local/bin/dotnet && \
    python3 -m venv /opt/miniwdl && \
    /opt/miniwdl/bin/pip install --upgrade pip setuptools wheel && \
    /opt/miniwdl/bin/pip install miniwdl && \
    ln -s /opt/miniwdl/bin/miniwdl /usr/local/bin/miniwdl && \
    curl -fsSL https://pixi.sh/install.sh -o /tmp/pixi-install.sh && \
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
    curl -fsSL https://get.nextflow.io -o /usr/local/bin/nextflow-launcher && \
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
    curl -fsSL "https://github.com/leanprover/lean4/releases/download/v${LEAN_VERSION}/lean-${LEAN_VERSION}-linux.tar.zst" -o /tmp/lean.tar.zst && \
    tar --zstd -xf /tmp/lean.tar.zst -C /opt && \
    ln -s "/opt/lean-${LEAN_VERSION}-linux/bin/lean" /usr/local/bin/lean && \
    ln -s "/opt/lean-${LEAN_VERSION}-linux/bin/lake" /usr/local/bin/lake && \
    curl -fL "https://download.swift.org/swift-${SWIFT_VERSION}-release/debian12/swift-${SWIFT_VERSION}-RELEASE/swift-${SWIFT_VERSION}-RELEASE-debian12.tar.gz" -o /tmp/swift.tar.gz && \
    tar -xzf /tmp/swift.tar.gz -C /opt && \
    ln -s "/opt/swift-${SWIFT_VERSION}-RELEASE-debian12/usr/bin/swift" /usr/local/bin/swift && \
    ln -s "/opt/swift-${SWIFT_VERSION}-RELEASE-debian12/usr/bin/swiftc" /usr/local/bin/swiftc && \
    curl -fL "https://cangjie-lang.cn/v1/files/auth/downLoad?nsId=142267&fileName=cangjie-sdk-linux-x64-${CANGJIE_VERSION}.tar.gz&objectKey=6a19349d21f5a8178d6fd22b" -o /tmp/cangjie.tar.gz && \
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
    rm -f /tmp/zig.tar.xz /tmp/julia.tar.gz /tmp/dart-sdk.zip /tmp/dart.sha256sum /tmp/dotnet-install.sh /tmp/pixi-install.sh /tmp/lean.tar.zst /tmp/swift.tar.gz /tmp/cangjie.tar.gz && \
    rm -rf /var/lib/apt/lists/* && \
    mkdir -p /var/lib/sandkasten/laeufer /opt/sandkasten/wurzelwerk

COPY --from=build /out-laeufer /usr/local/bin/laeufer
COPY wurzelwerk /opt/sandkasten/wurzelwerk

ENV CANGJIE_HOME=/opt/cangjie
ENV LAEUFER_WORK_DIR=/var/lib/sandkasten/laeufer
ENV PATH=/usr/local/go/bin:/usr/local/bin:/usr/bin:/bin
ENV LAEUFER_RUNTIME_PATH=/usr/local/go/bin:/usr/local/bin:/usr/bin:/bin

ENTRYPOINT ["/usr/bin/tini", "--", "/usr/local/bin/laeufer"]
