import type { Extension } from '@codemirror/state';
import { cpp } from '@codemirror/lang-cpp';
import { go } from '@codemirror/lang-go';
import { java } from '@codemirror/lang-java';
import { javascript } from '@codemirror/lang-javascript';
import { json } from '@codemirror/lang-json';
import { python } from '@codemirror/lang-python';
import { rust } from '@codemirror/lang-rust';

/** Return a syntax extension for the runtime name, or null for plain text. */
export function languageExtensionForRuntime(runtime: string | undefined | null): Extension | null {
  const name = String(runtime ?? '').trim().toLowerCase();
  switch (name) {
    case 'javascript':
    case 'js':
    case 'node':
      return javascript();
    case 'typescript':
    case 'ts':
      return javascript({ typescript: true });
    case 'python':
    case 'py':
    case 'python3':
      return python();
    case 'go':
    case 'golang':
      return go();
    case 'rust':
    case 'rs':
      return rust();
    case 'c':
      return cpp();
    case 'cpp':
    case 'c++':
      return cpp();
    case 'java':
      return java();
    case 'json':
      return json();
    default:
      return null;
  }
}
