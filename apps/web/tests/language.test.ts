import { describe, expect, test } from 'vitest';
import { languageForPath, languageModeLabel } from '../src/editor/language';

describe('language labels', () => {
  test('names the language mode the way VS Code does', () => {
    expect(languageModeLabel('python')).toBe('Python');
    expect(languageModeLabel('javascript')).toBe('JavaScript');
    expect(languageModeLabel('typescript')).toBe('TypeScript');
    // Branded and punctuated runtime names keep their own spelling.
    expect(languageModeLabel('toml')).toBe('TOML');
    expect(languageModeLabel('csharp')).toBe('C#');
    expect(languageModeLabel('cpp')).toBe('C++');
    expect(languageModeLabel('tsx')).toBe('TSX');
    expect(languageModeLabel('vue3')).toBe('Vue');
    expect(languageModeLabel('nextjs')).toBe('Next.js');
    expect(languageModeLabel('octave')).toBe('GNU Octave');
    // The runtime select can hand over a name the table does not know.
    expect(languageModeLabel('brainfuck')).toBe('Brainfuck');
    expect(languageModeLabel('  rust  ')).toBe('Rust');
    expect(languageModeLabel('')).toBe('');
    expect(languageModeLabel(undefined)).toBe('');
  });

  test('maps file extensions to canonical runtimes', () => {
    expect(languageForPath('src/main.py')).toBe('python');
    expect(languageForPath('app.TSX')).toBe('tsx');
  });
});