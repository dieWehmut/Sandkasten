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

export {};