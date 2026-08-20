SHELL := /usr/bin/env bash

.PHONY: help gen-proto test lint docker-build docker-clean preflight dev-up smoke-go smoke-languages

help:
	@printf "sandkasten targets:\n"
	@printf "  gen-proto     Generate Go/Rust protobuf bindings\n"
	@printf "  test          Run available test suites\n"
	@printf "  lint          Run format and static checks\n"
	@printf "  preflight     Check runner host capabilities\n"
	@printf "  smoke-go      Run local API + runner Go execution smoke test\n"
	@printf "  smoke-languages Run local HTTP smoke test for all supported languages\n"
	@printf "  docker-build  Build service images\n"
	@printf "  docker-clean  Remove unused Sandkasten build images and BuildKit cache\n"

gen-proto:
	./werkzeug/development/gen-proto.sh

test:
	./werkzeug/quality/test.sh

lint:
	./werkzeug/quality/lint.sh

preflight:
	./werkzeug/preflight.sh

docker-build:
	docker build -f einsatz/docker/api.Dockerfile -t sandkasten-api:dev .
	docker build -f einsatz/docker/laeufer.Dockerfile -t sandkasten-laeufer:dev .

docker-clean:
	./werkzeug/development/docker-clean.sh

dev-up:
	./werkzeug/development/dev-up.sh

smoke-go:
	./werkzeug/smoke-go.sh

smoke-languages:
	./werkzeug/smoke-languages.sh
