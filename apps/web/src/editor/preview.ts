import { decodeOutput, type JobResponse } from '../services/sandkastenApi';

export interface WebPreviewDocument {
  html: string;
  mode: 'live' | 'compiled';
}

const aliases: Record<string, string> = {
  'hypertext-markup-language': 'html', sass: 'scss', tailwind: 'tailwindcss',
  'tailwind-css': 'tailwindcss', vue: 'vue3', next: 'nextjs', jsx: 'tsx',
};
const markupBuilds = new Set(['markdown', 'mdx', 'vue3', 'tsx', 'nextjs']);
const styleBuilds = new Set(['scss', 'tailwindcss']);

function canonical(language: string): string {
  const id = language.trim().toLowerCase();
  return aliases[id] ?? id;
}

function styleDocument(css: string): string {
  // A CSS buffer must not terminate its style element and become executable HTML.
  const escaped = css.replace(/<\/style/gi, '<\\/style');
  return `<!doctype html><html><head><meta charset="utf-8"><style>${escaped}</style></head><body><main class="preview card"><h1>Sandkasten</h1><p class="description">CSS preview</p><button class="button" type="button">Button</button><a href="#sample">Link</a><section id="sample"><h2>Heading</h2><p>Paragraph <strong>bold</strong> <em>italic</em></p><ul><li>List item</li><li>List item</li></ul><input placeholder="Input"><div class="box">Box</div></section></main></body></html>`;
}

export function webPreviewDocument(language: string, source = '', result?: JobResponse): WebPreviewDocument | undefined {
  const id = canonical(language);
  if (id === 'html') return { html: source, mode: 'live' };
  if (id === 'css') return { html: styleDocument(source), mode: 'live' };
  if (!markupBuilds.has(id) && !styleBuilds.has(id)) return undefined;
  // Changing files must never show another language's build as this file's preview.
  if (!result || canonical(result.language ?? result.runtime ?? '') !== id
    || result.status !== 'JOB_STATUS_SUCCEEDED' || result.truncated?.stdout) return undefined;
  const output = decodeOutput(result.stdout, result.stdoutEncoding);
  if (!output.text.trim() || output.undecodable) return undefined;
  return { html: styleBuilds.has(id) ? styleDocument(output.text) : output.text, mode: 'compiled' };
}

export function isolatedPreviewHtml(html: string): string {
  // Insert the policy before user markup, including full documents. The opaque
  // sandbox origin separates script execution from the workbench and desktop bridge.
  return `<meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'unsafe-inline' 'unsafe-eval'; style-src 'unsafe-inline'; img-src data: blob:; font-src data:; connect-src 'none'; form-action 'none'; base-uri 'none'"><meta name="viewport" content="width=device-width, initial-scale=1">${html}`;
}
