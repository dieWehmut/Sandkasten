FROM golang:1.22-bookworm AS build

WORKDIR /src

COPY schnittstelle/go.mod ./schnittstelle/go.mod
WORKDIR /src/schnittstelle
RUN go mod download

WORKDIR /src
COPY vertrag ./vertrag
COPY schnittstelle ./schnittstelle

WORKDIR /src/schnittstelle
RUN test -d gen || (echo "missing schnittstelle/gen; run ./werkzeug/gen-proto.sh before building the API image" >&2; exit 1)
RUN CGO_ENABLED=0 GOOS=linux go build -trimpath -ldflags="-s -w" -o /out/sandkasten-api ./cmd/sandkasten-api

FROM gcr.io/distroless/static-debian12:nonroot

COPY --from=build /out/sandkasten-api /usr/local/bin/sandkasten-api

USER nonroot:nonroot
EXPOSE 50051
ENTRYPOINT ["/usr/local/bin/sandkasten-api"]
