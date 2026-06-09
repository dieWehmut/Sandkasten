SHELL := /usr/bin/env bash

.PHONY: help gen-proto test lint docker-build preflight dev-up

help:
	@printf "sandkasten targets:\n"
	@printf "  gen-proto     Generate Go/Rust protobuf bindings\n"
	@printf "  test          Run available test suites\n"
	@printf "  lint          Run format and static checks\n"
	@printf "  preflight     Check runner host capabilities\n"
	@printf "  docker-build  Build service images\n"

gen-proto:
	./werkzeug/gen-proto.sh

test:
	./werkzeug/test.sh

lint:
	./werkzeug/lint.sh

preflight:
	./werkzeug/preflight.sh

docker-build:
	docker build -f einsatz/docker/api.Dockerfile -t sandkasten-api:dev .
	docker build -f einsatz/docker/laeufer.Dockerfile -t sandkasten-laeufer:dev .

dev-up:
	./werkzeug/dev-up.sh
