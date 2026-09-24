// jsdom ships no canvas backend, so it installs a `getContext` that throws and
// logs "Not implemented" on every call. The minimap must draw to a context to
// mount, and nothing under test reads pixels back, so replace that stub with a
// no-op context. The check is whether the optional `canvas` package is
// installed: when it is, jsdom renders for real and this shim stays out of the
// way.
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
let canvasInstalled = true;
try {
  require.resolve('canvas');
} catch {
  canvasInstalled = false;
}

const noopContext = new Proxy({}, {
  get: (target: Record<string, unknown>, property: string) => {
    if (property === 'canvas') return undefined;
    return target[property] ?? (() => undefined);
  },
  set: (target: Record<string, unknown>, property: string, value: unknown) => {
    target[property] = value;
    return true;
  },
});

if (!canvasInstalled && typeof HTMLCanvasElement !== 'undefined') {
  HTMLCanvasElement.prototype.getContext = (() => noopContext) as unknown as HTMLCanvasElement['getContext'];
}

// jsdom implements neither `Range.getClientRects` nor `Range.getBoundingClientRect`,
// and CodeMirror measures a range when it scrolls a search result into view.
// Nothing under test reads that geometry, so empty measurements keep the path
// working instead of raising an unhandled error.
if (typeof Range !== 'undefined') {
  if (typeof Range.prototype.getClientRects !== 'function') {
    Range.prototype.getClientRects = () => [] as unknown as DOMRectList;
  }
  if (typeof Range.prototype.getBoundingClientRect !== 'function') {
    Range.prototype.getBoundingClientRect = () => new DOMRect(0, 0, 0, 0);
  }
}

export {};