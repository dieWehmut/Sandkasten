# Sandkasten WebUI

This directory is a dependency-free, same-origin client for the Sandkasten HTTP API. Serve it from the same host as the API (the installer configures Nginx to proxy `/v1/` and `/healthz`), then open `index.html` through that site.

The client loads `GET /v1/runtimes`, submits JSON source with `POST /v1/{language}/run`, and polls `GET /v1/jobs/{jobId}` until a terminal status. Responses must be JSON objects and failed HTTP responses are shown as diagnostics. Job output is untrusted and is always assigned with `textContent`.

For a local preview, use any static server from the repository root, for example:

```sh
python3 -m http.server 8080 --directory webui
```

The preview needs an API proxy or same-origin API at `/v1/` to execute jobs.

## GitHub Pages

The `Deploy WebUI to GitHub Pages` workflow publishes only `index.html`,
`app.js`, `styles.css`, and a generated `config.js` whenever `main` is pushed.
It can also be started manually with `workflow_dispatch`.

To connect the public Pages site to a separately deployed API, create the
repository variable `SANDKASTEN_API_BASE_URL` under **Settings > Secrets and
variables > Actions > Variables**. Set it to the API origin, or to an origin
plus path prefix, for example `https://runner.example.com`. An unset or empty
variable generates an empty `apiBaseUrl`, so requests remain same-origin.

The API must use HTTPS and allow the repository's GitHub Pages origin through
CORS when the Pages and API origins differ. The value is published in the
static site and must not contain credentials or other secrets.

Repository maintainers must select **GitHub Actions** as the Pages source under
**Settings → Pages**. The staged artifact can be checked locally on a
Linux/macOS shell (or WSL) with:

```sh
bash scripts/pages-artifact-test.sh --test
```
