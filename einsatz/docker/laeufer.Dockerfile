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

RUN apt-get update && \
    apt-get install -y --no-install-recommends \
      ca-certificates \
      bash \
      curl \
      g++ \
      gcc \
      kotlin \
      lua5.4 \
      mono-mcs \
      mono-runtime \
      node-typescript \
      nodejs \
      php-cli \
      openjdk-17-jdk-headless \
      python3 \
      r-base-core \
      ruby \
      rustc \
      scala \
      tini \
      zstd && \
    curl -fsSL "https://julialang-s3.julialang.org/bin/linux/x64/${JULIA_MINOR_VERSION}/julia-${JULIA_VERSION}-linux-x86_64.tar.gz" -o /tmp/julia.tar.gz && \
    tar -xzf /tmp/julia.tar.gz -C /opt && \
    ln -s "/opt/julia-${JULIA_VERSION}/bin/julia" /usr/local/bin/julia && \
    curl -fsSL "https://github.com/leanprover/lean4/releases/download/v${LEAN_VERSION}/lean-${LEAN_VERSION}-linux.tar.zst" -o /tmp/lean.tar.zst && \
    tar --zstd -xf /tmp/lean.tar.zst -C /opt && \
    ln -s "/opt/lean-${LEAN_VERSION}-linux/bin/lean" /usr/local/bin/lean && \
    ln -s "/opt/lean-${LEAN_VERSION}-linux/bin/lake" /usr/local/bin/lake && \
    ln -sf /usr/bin/lua5.4 /usr/local/bin/lua && \
    ln -sf /usr/bin/luac5.4 /usr/local/bin/luac && \
    rm -f /tmp/julia.tar.gz /tmp/lean.tar.zst && \
    rm -rf /var/lib/apt/lists/* && \
    mkdir -p /var/lib/sandkasten/laeufer /opt/sandkasten/wurzelwerk

COPY --from=build /out-laeufer /usr/local/bin/laeufer
COPY wurzelwerk /opt/sandkasten/wurzelwerk

ENV LAEUFER_WORK_DIR=/var/lib/sandkasten/laeufer
ENV PATH=/usr/local/go/bin:/usr/local/bin:/usr/bin:/bin
ENV LAEUFER_RUNTIME_PATH=/usr/local/go/bin:/usr/local/bin:/usr/bin:/bin

ENTRYPOINT ["/usr/bin/tini", "--", "/usr/local/bin/laeufer"]
