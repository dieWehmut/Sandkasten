// Build adapters for languages whose output is a document, module, or project.
// Every adapter executes its compiler/runtime; none marks registration as success.
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { mkdir, readFile, writeFile, copyFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const require = createRequire(import.meta.url);
const [language, phase, file, executable] = process.argv.slice(2);
const packages = {
  html: ['jsdom'], css: ['postcss'], scss: ['sass'], tailwindcss: ['tailwindcss'],
  typescript: ['typescript'], markdown: ['markdown-it', 'mermaid', 'jsdom', 'dompurify'],
  mdx: ['@mdx-js/mdx', 'react', 'react-dom/server'],
  tsx: ['esbuild', 'react', 'react-dom/server'],
  nextjs: ['esbuild', 'next', 'react', 'react-dom/server'],
  vue3: ['esbuild', 'vue', '@vue/compiler-sfc', '@vue/server-renderer'],
};
const output = executable ? path.dirname(executable) : '';
const artifact = `${executable}.output`;

async function execute(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd: options.cwd ?? process.cwd(), env: { ...process.env, ...options.env }, stdio: ['pipe', 'pipe', 'pipe'] });
    let stdout = '', stderr = '';
    child.stdout.setEncoding('utf8'); child.stderr.setEncoding('utf8');
    child.stdout.on('data', (chunk) => { stdout += chunk; });
    child.stderr.on('data', (chunk) => { stderr += chunk; });
    child.on('error', reject);
    child.on('close', (code) => code === 0 ? resolve({ stdout, stderr }) : reject(new Error(`${command} exited ${code}\n${stderr}\n${stdout}`)));
    child.stdin.end(options.stdin ?? '');
  });
}

function esbuildOptions() {
  return { bundle: true, platform: 'node', format: 'cjs', jsx: 'automatic', nodePaths: (process.env.NODE_PATH ?? '').split(path.delimiter).filter(Boolean), logLevel: 'silent' };
}
async function renderReact(entry, kind) {
  const esbuild = require('esbuild');
  const compiled = path.join(output, 'component.cjs');
  await esbuild.build({ ...esbuildOptions(), entryPoints: [entry], outfile: compiled });
  const React = require('react');
  const { renderToStaticMarkup } = require('react-dom/server');
  const module = require(compiled);
  const Component = module.default ?? module.App ?? module.Component;
  if (typeof Component !== 'function') throw new Error(`${kind} must export a component function`);
  let element;
  if (Component.constructor.name === 'AsyncFunction') element = await Component({ params: {}, searchParams: {} });
  else element = React.createElement(Component, kind === 'nextjs' ? { params: {}, searchParams: {} } : {});
  const body = renderToStaticMarkup(element);
  return kind === 'nextjs' ? `<!doctype html><html><body>${body}</body></html>` : body;
}
async function renderMarkdown(source) {
  const MarkdownIt = require('markdown-it');
  const { JSDOM } = require('jsdom');
  const dom = new JSDOM('<!doctype html><html><body></body></html>', { pretendToBeVisual: true });
  const { window } = dom;
  Object.assign(globalThis, { window, document: window.document, Element: window.Element, HTMLElement: window.HTMLElement, SVGElement: window.SVGElement, Node: window.Node });
  Object.defineProperty(globalThis, 'navigator', { value: window.navigator, configurable: true });
  window.SVGElement.prototype.getBBox ??= function () { return { x: 0, y: 0, width: Math.max(20, (this.textContent ?? '').length * 8), height: 20 }; };
  window.SVGElement.prototype.getComputedTextLength ??= function () { return (this.textContent ?? '').length * 8; };
  const DOMPurify = require('dompurify')(window);
  const mermaid = (await import(pathToFileURL(require.resolve('mermaid')).href)).default;
  mermaid.initialize({ startOnLoad: false, securityLevel: 'strict', theme: 'default' });
  const md = new MarkdownIt({ html: false });
  const tokens = md.parse(source, {});
  let counter = 0;
  for (const token of tokens) {
    if (token.type === 'fence' && token.info.trim() === 'mermaid') {
      const { svg } = await mermaid.render(`sandkasten-mermaid-${counter++}`, token.content);
      token.type = 'html_block'; token.content = DOMPurify.sanitize(svg, { USE_PROFILES: { svg: true, svgFilters: true } });
    }
  }
  return md.renderer.render(tokens, md.options, {});
}

async function build() {
  await mkdir(output, { recursive: true });
  const source = await readFile(file, 'utf8');
  let rendered;
  if (language === 'html') {
    const { JSDOM } = require('jsdom');
    if (!/<[a-zA-Z][\s\S]*>/.test(source)) throw new Error('HTML source must contain an element');
    rendered = new JSDOM(source).serialize();
  } else if (language === 'css') {
    rendered = require('postcss').parse(source, { from: file }).toString();
  } else if (language === 'scss') {
    rendered = require('sass').compile(file, { style: 'expanded' }).css;
  } else if (language === 'tailwindcss') {
    const postcss = require('postcss');
    rendered = (await postcss([require('tailwindcss')({ content: [{ raw: source, extension: 'html' }, path.join(path.dirname(file), '**/*.{html,js,jsx,ts,tsx,vue}')], corePlugins: { preflight: false } })]).process(source, { from: file })).css;
  } else if (language === 'typescript') {
    const ts = require('typescript');
    const program = ts.createProgram([file], { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.NodeNext, moduleResolution: ts.ModuleResolutionKind.NodeNext, noEmitOnError: true, strict: true, outDir: output, skipLibCheck: true });
    const result = program.emit();
    const diagnostics = ts.getPreEmitDiagnostics(program).concat(result.diagnostics);
    if (diagnostics.length) throw new Error(ts.formatDiagnosticsWithColorAndContext(diagnostics, { getCanonicalFileName: (f) => f, getCurrentDirectory: () => process.cwd(), getNewLine: () => '\n' }));
    const ext = file.endsWith('.mts') ? '.mjs' : file.endsWith('.cts') ? '.cjs' : '.js';
    await writeFile(artifact, path.join(output, path.basename(file).replace(/\.[^.]+$/, ext)));
    return;
  } else if (language === 'markdown') {
    rendered = await renderMarkdown(source);
  } else if (language === 'mdx') {
    const { evaluate } = await import(pathToFileURL(require.resolve('@mdx-js/mdx')).href);
    const React = require('react');
    const { renderToStaticMarkup } = require('react-dom/server');
    const module = await evaluate(source, { ...require('react/jsx-runtime'), useMDXComponents: () => ({}) });
    rendered = renderToStaticMarkup(React.createElement(module.default));
  } else if (language === 'tsx' || language === 'nextjs') {
    rendered = await renderReact(file, language);
  } else if (language === 'vue3') {
    const { parse, compileScript, compileTemplate, rewriteDefault } = require('@vue/compiler-sfc');
    const { descriptor, errors } = parse(source, { filename: file });
    if (errors.length) throw new Error(errors.map(String).join('\n'));
    let script;
    if (descriptor.script || descriptor.scriptSetup) {
      script = rewriteDefault(compileScript(descriptor, { id: 'sandkasten-local', inlineTemplate: true, templateOptions: { ssr: true } }).content, '__sfc__');
    } else {
      const template = compileTemplate({ source: descriptor.template?.content ?? '', filename: file, id: 'sandkasten-local', ssr: true, cssVars: [] });
      if (template.errors.length) throw new Error(template.errors.map(String).join('\n'));
      script = template.code.replace('export function ssrRender', 'function ssrRender') + '\nconst __sfc__ = { ssrRender };';
    }
    const entry = path.join(output, 'vue-entry.ts');
    await writeFile(entry, `${script}\nexport default __sfc__;`);
    const bundle = path.join(output, 'vue.cjs');
    await require('esbuild').build({ ...esbuildOptions(), entryPoints: [entry], outfile: bundle });
    const { createSSRApp } = require('vue');
    const { renderToString } = require('@vue/server-renderer');
    const html = await renderToString(createSSRApp(require(bundle).default));
    const style = descriptor.styles.map((block) => block.content).join('\n');
    rendered = (style ? `<style>${style}</style>` : '') + html;
  } else if (language === 'csharp' || language === 'fsharp') {
    const extension = language === 'csharp' ? 'cs' : 'fs';
    const project = path.join(output, 'project');
    await mkdir(project, { recursive: true });
    const sdk = await execute('dotnet', ['--version']);
    const target = `net${sdk.stdout.trim().split('.')[0]}.0`;
    await copyFile(file, path.join(project, `Program.${extension}`));
    await writeFile(path.join(project, `app.${extension}proj`), `<Project Sdk="Microsoft.NET.Sdk"><PropertyGroup><OutputType>Exe</OutputType><TargetFramework>${target}</TargetFramework><NuGetAudit>false</NuGetAudit></PropertyGroup>${language === 'fsharp' ? '<ItemGroup><Compile Include="Program.fs" /></ItemGroup>' : ''}</Project>`);
    await execute('dotnet', ['build', project, '--nologo', '-o', path.join(output, 'dotnet'), '-p:NuGetAudit=false', '-p:UseSharedCompilation=false']);
    return;
  } else if (language === 'coq') {
    const copied = path.join(output, 'main.v');
    await copyFile(file, copied);
    await execute('coqc', ['-q', copied]);
    if (!(await stat(path.join(output, 'main.vo'))).isFile()) throw new Error('Coq produced no checked proof');
    rendered = '';
  } else if (language === 'ocaml') {
    const copied = path.join(output, path.basename(file));
    await copyFile(file, copied);
    await execute('ocamlopt', [copied, '-o', executable]);
    return;
  } else if (language === 'gleam') {
    const project = path.join(output, 'gleam');
    await mkdir(path.join(project, 'src'), { recursive: true });
    await copyFile(file, path.join(project, 'src', 'main.gleam'));
    await writeFile(path.join(project, 'gleam.toml'), 'name = "sandkasten_local"\nversion = "1.0.0"\ntarget = "erlang"\n[dependencies]\ngleam_stdlib = "1.0.3"\n');
    await execute('gleam', ['build', '--no-print-progress'], { cwd: project });
    return;
  } else if (language === 'latex') {
    await execute('tectonic', ['--untrusted', '--outdir', output, file]);
    await execute('pdftocairo', ['-svg', path.join(output, path.basename(file).replace(/\.tex$/, '.pdf')), `${executable}.svg`]);
    return;
  } else if (language === 'wdl') {
    await execute('miniwdl', ['check', file]);
    return;
  } else if (language === 'qml' || language === 'sql') {
    // Their actual interpreters are invoked in the run phase.
    return;
  } else throw new Error(`Unknown build adapter: ${language}`);
  await writeFile(artifact, rendered);
}

async function run() {
  if (language === 'typescript') {
    const result = await execute(process.execPath, [(await readFile(artifact, 'utf8')).trim()]);
    process.stdout.write(result.stdout); process.stderr.write(result.stderr);
  } else if (language === 'csharp' || language === 'fsharp') {
    const result = await execute('dotnet', [path.join(output, 'dotnet', 'app.dll')]);
    process.stdout.write(result.stdout); process.stderr.write(result.stderr);
  } else if (language === 'ocaml') {
    const result = await execute(executable, []); process.stdout.write(result.stdout);
  } else if (language === 'gleam') {
    const result = await execute('gleam', ['run', '--no-print-progress', '--module', 'main'], { cwd: path.join(output, 'gleam') });
    process.stdout.write(result.stdout); process.stderr.write(result.stderr);
  } else if (language === 'sql') {
    const result = await execute('sqlite3', ['-batch', '-bail', ':memory:'], { stdin: await readFile(file, 'utf8') });
    process.stdout.write(result.stdout);
  } else if (language === 'wdl') {
    const outputs = path.join(output, 'wdl-output.json');
    await execute('miniwdl', ['run', '--no-color', '--dir', path.join(output, 'wdl-run'), '-o', outputs, file]);
    const result = JSON.parse(await readFile(outputs, 'utf8'));
    for (const key of Object.keys(result.outputs ?? {}).sort()) process.stdout.write(String(result.outputs[key]) + '\n');
  } else if (language === 'qml') {
    const result = await execute('qml', ['--headless', file], { env: { QT_QPA_PLATFORM: 'offscreen' } });
    process.stdout.write(result.stdout); process.stdout.write(result.stderr.replace(/^qml: /gm, ''));
  } else if (['graphviz', 'typst', 'latex'].includes(language)) {
    process.stdout.write(await readFile(`${executable}.svg`, 'utf8'));
  } else {
    process.stdout.write(await readFile(artifact, 'utf8'));
  }
}

try {
  if (phase === 'probe') {
    for (const name of packages[language] ?? []) require.resolve(name);
  } else if (phase === 'build') await build();
  else if (phase === 'run') await run();
  else throw new Error(`Unknown phase: ${phase}`);
} catch (error) {
  console.error(error instanceof Error ? error.stack : error);
  process.exitCode = 1;
}
