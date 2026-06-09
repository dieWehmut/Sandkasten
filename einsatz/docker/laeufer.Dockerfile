# syntax=docker/dockerfile:1.7

FROM rust:1.82-bookworm AS build

WORKDIR /src

COPY laeufer/Cargo.toml ./laeufer/Cargo.toml
COPY laeufer/crates/laeufer-core/Cargo.toml ./laeufer/crates/laeufer-core/Cargo.toml
COPY laeufer/crates/laeufer-go/Cargo.toml ./laeufer/crates/laeufer-go/Cargo.toml
COPY laeufer/crates/laeufer-sandbox/Cargo.toml ./laeufer/crates/laeufer-sandbox/Cargo.toml
COPY laeufer/crates/laeufer-store/Cargo.toml ./laeufer/crates/laeufer-store/Cargo.toml
WORKDIR /src/laeufer

RUN mkdir -p src crates/laeufer-core/src crates/laeufer-go/src crates/laeufer-sandbox/src crates/laeufer-store/src && \
    printf 'pub fn _cargo_cache_probe() {}\n' > src/lib.rs && \
    mkdir -p src/bin && \
    printf 'fn main() {}\n' > src/bin/laeufer.rs && \
    printf 'pub fn _cargo_cache_probe() {}\n' > crates/laeufer-core/src/lib.rs && \
    printf 'pub fn _cargo_cache_probe() {}\n' > crates/laeufer-go/src/lib.rs && \
    printf 'pub fn _cargo_cache_probe() {}\n' > crates/laeufer-sandbox/src/lib.rs && \
    printf 'pub fn _cargo_cache_probe() {}\n' > crates/laeufer-store/src/lib.rs
RUN --mount=type=cache,target=/usr/local/cargo/registry \
    --mount=type=cache,target=/src/laeufer/target \
    cargo fetch

WORKDIR /src
COPY vertrag ./vertrag
COPY laeufer ./laeufer

WORKDIR /src/laeufer
RUN test -f src/bin/laeufer.rs || test -f src/main.rs || (echo "missing laeufer runner binary source; add src/bin/laeufer.rs or src/main.rs before building the runner image" >&2; exit 1)
RUN --mount=type=cache,target=/usr/local/cargo/registry \
    --mount=type=cache,target=/src/laeufer/target \
    cargo build --release --bin laeufer && \
    cp target/release/laeufer /out-laeufer

FROM golang:1.23-bookworm

RUN apt-get update && \
    apt-get install -y --no-install-recommends ca-certificates tini && \
    rm -rf /var/lib/apt/lists/* && \
    mkdir -p /var/lib/sandkasten/laeufer /opt/sandkasten/wurzelwerk

COPY --from=build /out-laeufer /usr/local/bin/laeufer
COPY wurzelwerk /opt/sandkasten/wurzelwerk

ENV LAEUFER_WORK_DIR=/var/lib/sandkasten/laeufer
ENV PATH=/usr/local/go/bin:/usr/local/bin:/usr/bin:/bin

ENTRYPOINT ["/usr/bin/tini", "--", "/usr/local/bin/laeufer"]
