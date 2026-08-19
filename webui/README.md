# Sandkasten WebUI

This directory is a dependency-free, same-origin client for the Sandkasten HTTP API. Serve it from the same host as the API (the installer configures Nginx to proxy `/v1/` and `/healthz`), then open `index.html` through that site.

The client loads `GET /v1/runtimes`, submits JSON source with `POST /v1/{language}/run`, and polls `GET /v1/jobs/{jobId}` until a terminal status. Responses must be JSON objects and failed HTTP responses are shown as diagnostics. Job output is untrusted and is always assigned with `textContent`.

For a local preview, use any static server from the repository root, for example:

```sh
python3 -m http.server 8080 --directory webui
```

The preview needs an API proxy or same-origin API at `/v1/` to execute jobs.
