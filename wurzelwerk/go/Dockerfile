# syntax=docker/dockerfile:1.7

FROM golang:1.23-bookworm

LABEL org.opencontainers.image.title="sandkasten-go-rootfs"
LABEL org.opencontainers.image.description="Go rootfs skeleton for Sandkasten v1 vendored builds"

RUN apt-get update && \
    apt-get install -y --no-install-recommends ca-certificates tzdata && \
    rm -rf /var/lib/apt/lists/* && \
    mkdir -p /workspace /tmp/gocache /tmp/gopath /tmp/gomodcache && \
    chown -R 65534:65534 /workspace /tmp/gocache /tmp/gopath /tmp/gomodcache

ENV GOTOOLCHAIN=local
ENV CGO_ENABLED=0
ENV GOPATH=/tmp/gopath
ENV GOCACHE=/tmp/gocache
ENV GOMODCACHE=/tmp/gomodcache
ENV PATH=/usr/local/go/bin:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin

WORKDIR /workspace
USER 65534:65534

CMD ["/bin/sh"]
