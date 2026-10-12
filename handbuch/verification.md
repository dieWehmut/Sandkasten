# Verification

One place to look up what each entry point proves, what it needs, and how to read
its output. Every command here has been run on a Windows workstation with WSL2,
Docker installed but stopped, and no Postgres; the notes say what that means for
each one.

## How to read a result

- **ok** — the property was checked, in the real thing rather than a double.
- **unavailable** — the tool or backend is not installed. This is not a failure:
  a machine without WSL2 cannot run the isolated backend, and saying so is the
  honest answer.
- **failed** — installed but not working: a toolchain that cannot link, a shell
  that cannot run a command, a sandbox that leaks.
- **unsupported** — a language the check has no fixture for. The aggregate counts
  it as a failure, because it means coverage is missing rather than absent.

## The whole gate

| Command | Proves |
| --- | --- |
| `make test` → `werkzeug/quality/test.sh` | Go API tests, Rust runner tests, WebUI unit tests + production build + distribution freshness + Pages artifact contract, apps layout contract, CLI tests, desktop shell tests. Missing tools are reported as failures here, so it is the repository's strictest entry. |
| `make verify-desktop` → `apps/desktop npm run verify` | The three machine checks below, with one summary line each. |

## Server

| Command | Proves | Needs |
| --- | --- | --- |
| `cd schnittstelle && go test ./...` | API packages: config, gRPC, HTTP, jobs, Postgres access. | Go 1.25+. |
| `cd laeufer && cargo test --all` | The runner: leases, cgroup limits, sandbox setup. | A Rust toolchain whose linker works; on Windows an MSYS2 `link.exe` on `PATH` shadows MSVC and the failure names it. |
| `make smoke-go` | A real job through the API and runner. | Postgres, the API, and the runner. |
| `make smoke-languages` | One HTTP job per enabled language. | The same, plus the installed toolchains and network. |
| `node werkzeug/smoke/smoke-concurrency.mjs` | Queue behaviour under concurrent jobs. | The same stack. |

## WebUI

| Command | Proves | Needs |
| --- | --- | --- |
| `cd apps/web && npm test` | The documented entry: vitest suites plus the node tests for the dev server, the Pages artifact and the browser smoke contract. | `npm ci` first. |
| `cd apps/web && npm run test:loaded` | The same suite with two workers, for a workstation busy with other applications. | The same. |
| `cd apps/web && npm run test:browser` | The built distribution in a real Chrome at three viewports. | A Chrome or Edge executable; never downloads one. |
| `cd apps/web && node --test tests/build-contract.test.mjs` | A clean `npm ci && npm run build` emits exactly the four tracked files, and they match what is committed. | Node and git. |
| `scripts/pages-artifact-test.sh --test` | The shape of the published Pages artifact. | bash. |
| `scripts/apps-layout-test.sh` | The apps layout the release assumes. | bash. |

The shell also carries a Content-Security-Policy in `index.html`; `npm run serve`
repeats it as a response header, because the packaged app and GitHub Pages set no
headers at all.

## Desktop

| Command | Proves | Needs |
| --- | --- | --- |
| `cd apps/desktop && npm test` | The shell: terminal host, PTY, command discovery, all three runners, IPC and preload contracts, the verification scripts' own verdicts, the workflow file, and the end-to-end reports' honesty. | Node. |
| `npm run verify:shells` | Every discovered shell runs a command, finds a probe in its own directory, and publishes a command list that resolves in the shell — including the commands it reports about itself. | The installed shells. |
| `npm run verify:runtimes` | Hello-world through the real local runner for every installed runtime; add `--failures` and each one also proves that a failing program comes back as a failure with its own exit code and stderr. | The installed toolchains. |
| `npm run verify:isolated` | Seven languages inside the WSL2 namespace, the network refused, PID 1 being the payload, the host filesystem out of reach, a cancelled run leaving nothing behind, and an output flood stopped at the cap. | WSL2 with `unshare`; unavailable without it. |
| `npm run e2e` | The running app: explorer, local run, save, file creation, panels, title row and menu, close-to-tray, tray update, both themes — and, when WSL2 can sandbox, an isolated run that reports PID 1 and a blocked network. | Electron, Python on `PATH`, a Chromium-based browser for `playwright-core`. |
| `npm run e2e:refinement` | A real terminal session: state and directory retention, split panes, a PTY resize, Ctrl+C, close, the suggestion strip (commands, arguments, folders, nested paths, the folder the shell moved into, the command stack), four languages run in that session, and the marker on the commands the shell reports about itself. | The same, plus installed shells. |
| `npm run verify:installer` | The packaged installer's dry run. | A packaged build. |

## CLI

| Command | Proves | Needs |
| --- | --- | --- |
| `cd apps/cli && npm test` | Argument parsing, request building, output, and an end-to-end run against an in-process mock API. | Node. |

## In CI

`.github/workflows/verify.yml` runs, on Node 22.18.0 and ubuntu-latest: each app's
documented `npm test`, the WebUI browser smoke, the WebUI distribution contract,
the repository contracts (apps layout, Pages artifact), and `npm run verify` for
the machine checks. On that runner the isolated backend reports unavailable (no
WSL2), which is the honest result rather than a failure.

## What this repository does not prove here

- **GitHub Actions itself.** Every command in the workflow has been run locally;
  whether the runner behaves the same is not observable from a workstation.
- **The container path.** The API's Docker/rootfs backend needs a Docker daemon
  and Postgres; the desktop's WSL2 sandbox is checked instead, and its README says
  plainly that it is not a hardened container.
- **Cross-platform byte equality** of the committed WebUI bundle. Freshness is
  checked on the machine that builds it, and the WSL distro available here only
  has Node 20, so it cannot stand in for the Node 22 runner.
- **Every language the API offers.** The API ships 58 runtimes; this workstation
  can verify 11 locally and 7 in the sandbox, and the rest are reported as
  unavailable rather than assumed to work.