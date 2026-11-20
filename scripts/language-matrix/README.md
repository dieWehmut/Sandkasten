# Local WSL / Conda language matrix

This matrix executes all 58 entries in `LOCAL_RUNTIMES` through the desktop's
real local runner. It requires WSL and a Node executable inside the active Conda
prefix. No Docker, remote execution service, or mocked compiler is used.
The runner removes Windows-mounted `/mnt/<drive>` entries from the child `PATH`
so Linux compilers do not inspect Windows tools through a transient WSL mount.

## Re-run the verified local environment

```bash
source /home/han/miniconda3/etc/profile.d/conda.sh
conda activate sandkasten-languages-58-20261022
hash -r
SANDKASTEN_MATRIX_OUTPUT=.sandkasten/language-matrix-final-verified-20261104 \
  "$CONDA_PREFIX/bin/node" scripts/language-matrix/run.mjs
```

`bootstrap.sh` installs the Conda/npm baseline; it does not alone install every
vendor toolchain. The verified prefix also contains SDKs under `toolchains/`
and executable wrappers under `bin/`. Installation notes and wrapper snapshots
are in `.sandkasten/language-matrix-final-20261104/extras-install-notes.md` and
`wrappers/`; downloaded archives are under `.sandkasten/language-matrix/downloads/`.
The activation script sources the Cangjie SDK, adds the npm tools, and sets the
Nextflow cache. Assembly/C/C++ use host GCC, and Bash/Perl use the host tools visible inside
the activated environment. Crystal's final linker uses `/usr/bin/gcc`; its compiler
and libraries are installed in the dedicated prefix. Mojo uses a nested Conda
prefix. Neither setup changes the base Conda environment.

## Evidence and scope

- `environment.json`: WSL kernel, hostname, Conda prefix, Node executable and
  detected runtime commands with resolved executable paths.
- `results.json` and `<language>.json`: actual compiler/run stdout, stderr, exit
  status and timing, plus asserted fixture output.
- `summary.json`: `expected: 58`, tested/passed/failed counts, `completeMatrix`,
  and `all58Passed`. A filtered diagnostic run cannot claim all 58 passed.
- Next.js uses a real local App Router HTTP request, including `next/headers`,
  and shuts down the temporary server after rendering.
- HTML, CSS/SCSS/Tailwind, Vue, TSX, MDX, Markdown, Next.js and document outputs
  also run browser assertions where applicable and save wide/compact screenshots.

The fixtures verify representative execution, proof checking, or generated
output for each language; they are not exhaustive language conformance suites.
`SANDKASTEN_MATRIX_LANGUAGES=python,rust` selects diagnostics only. The process
exit status covers the selected cases; use `all58Passed` for the full gate.
