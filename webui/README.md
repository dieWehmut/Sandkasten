# Sandkasten WebUI

The WebUI is a Vue 3 and TypeScript workbench built with Vite. It loads
`GET /v1/runtimes`, submits source with `POST /v1/{language}/run`, and polls
`GET /v1/jobs/{jobId}`. API-controlled source, errors, and output are rendered
as text; components do not inject them as HTML.

## Develop and test

Use the Node.js release pinned by the Pages workflow (Node 22.18.0):

```sh
cd webui
npm ci
npm run dev -- --host 127.0.0.1
```

The Vite development server expects the Sandkasten API at the same origin, or
behind a local reverse proxy that exposes `/v1/` and `/healthz`. Run the unit
and component suite with:

```sh
cd webui
npm test
```

## Production distribution

Create the production payload with:

```sh
cd webui
npm run build
```

Vite writes exactly four regular files to `webui/dist`:

- `index.html`
- `app.js`
- `styles.css`
- `config.js`

There are no nested assets, source maps, tests, lockfiles, or symbolic links.
The HTML uses relative `./` references and loads `config.js` before `app.js`, so
the same payload works at the GitHub Pages project path `/Sandkasten/` and at an
installer-managed site root. The four files are committed because the server
installer copies this prebuilt payload and never installs Node.js packages.

The source runtime config deliberately keeps its nullish, same-origin default:

```js
globalThis.SANDKASTEN_CONFIG ??= { apiBaseUrl: '' };
```

Validate a clean deterministic build and the committed payload with:

```sh
cd webui
node --test tests/build-contract.test.mjs
cd ..
bash scripts/webui-build-test.sh --test
```

To preview the generated files without the Vite development server:

```sh
python3 -m http.server 8080 --directory webui/dist
```

Execution still needs a same-origin API or reverse proxy unless the staged
`config.js` provides a separate public API base URL.

## GitHub Pages

The public site is <https://diewehmut.github.io/Sandkasten/>. On every push to
`main`, `.github/workflows/pages.yml` installs from `package-lock.json`, runs
the unit tests, builds and validates the four-file distribution, stages it,
and deploys it with the official GitHub Pages actions. The workflow can also be
started manually with `workflow_dispatch`; select **GitHub Actions** as the
Pages source under **Settings > Pages**.

The staged Pages artifact replaces only its copy of `config.js` with a
JSON-escaped direct assignment such as:

```js
globalThis.SANDKASTEN_CONFIG = { apiBaseUrl: "https://runner.example.com" };
```

Set the repository variable `SANDKASTEN_API_BASE_URL` under **Settings >
Secrets and variables > Actions > Variables** to a public HTTPS API origin, or
to an origin plus path prefix. An unset value remains empty and therefore uses
same-origin requests. This value is public: never put tokens, passwords, or
other secrets in it.

When Pages and the API use different origins, the API must allow
`https://diewehmut.github.io` through CORS. The CORS value is the origin only;
do not append `/Sandkasten/`.

Validate the workflow and a representative staged artifact with:

```sh
bash scripts/pages-artifact-test.sh --test
```
