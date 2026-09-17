import { HighlightStyle, syntaxHighlighting } from '@codemirror/language';
import type { Extension } from '@codemirror/state';
import { tags } from '@lezer/highlight';

/**
 * Syntax colors that follow the VS Code default themes.
 *
 * The palette is expressed as CSS custom properties instead of fixed colors so
 * one highlight style serves both surface themes: the tokens cascade from
 * `tokens.css`, and toggling `data-theme` recolors the editor without
 * reconfiguring CodeMirror. Every value was checked for WCAG AA (>= 4.5:1)
 * against the surfaces the editor actually renders (`#ffffff` light,
 * `#17231b` dark).
 */
export const vscodeDarkPlusColors = {
  comment: '#6A9955',
  keyword: '#569CD6',
  controlKeyword: '#C586C0',
  string: '#CE9178',
  number: '#B5CEA8',
  constant: '#4FC1FF',
  function: '#DCDCAA',
  type: '#4EC9B0',
  variable: '#9CDCFE',
  property: '#9CDCFE',
  operator: '#D4D4D4',
  punctuation: '#D4D4D4',
  meta: '#9B9B9B',
  regexp: '#D16969',
  escape: '#D7BA7D',
  invalid: '#F44747',
  inserted: '#B5CEA8',
  deleted: '#F14C4C',
  changed: '#E2C08D',
  link: '#4FC1FF',
} as const;

export const vscodeLightPlusColors = {
  comment: '#008000',
  keyword: '#0000FF',
  controlKeyword: '#AF00DB',
  string: '#A31515',
  number: '#098658',
  constant: '#0070C1',
  function: '#795E26',
  type: '#267F99',
  variable: '#001080',
  property: '#0451A5',
  operator: '#000000',
  punctuation: '#000000',
  meta: '#800000',
  regexp: '#811F3F',
  escape: '#EE0000',
  invalid: '#CD3131',
  inserted: '#008000',
  deleted: '#CD3131',
  changed: '#795E26',
  link: '#0000FF',
} as const;

export const vscodeHighlightStyle = HighlightStyle.define([
  { tag: [tags.comment, tags.lineComment, tags.blockComment, tags.docComment], color: 'var(--syntax-comment)' },
  { tag: [tags.controlKeyword], color: 'var(--syntax-control-keyword)' },
  {
    tag: [
      tags.keyword,
      tags.moduleKeyword,
      tags.definitionKeyword,
      tags.operatorKeyword,
      tags.modifier,
      tags.self,
      tags.null,
      tags.bool,
      tags.atom,
      tags.unit,
    ],
    color: 'var(--syntax-keyword)',
  },
  { tag: [tags.string, tags.special(tags.string), tags.character, tags.attributeValue, tags.docString], color: 'var(--syntax-string)' },
  { tag: [tags.number, tags.integer, tags.float], color: 'var(--syntax-number)' },
  { tag: [tags.constant(tags.name), tags.constant(tags.variableName), tags.standard(tags.name), tags.standard(tags.typeName)], color: 'var(--syntax-constant)' },
  { tag: [tags.function(tags.variableName), tags.function(tags.propertyName), tags.function(tags.definition(tags.variableName)), tags.macroName], color: 'var(--syntax-function)' },
  { tag: [tags.typeName, tags.className, tags.tagName, tags.namespace], color: 'var(--syntax-type)' },
  { tag: [tags.special(tags.brace)], color: 'var(--syntax-punctuation)' },
  {
    tag: [tags.variableName, tags.labelName, tags.definition(tags.variableName), tags.local(tags.variableName)],
    color: 'var(--syntax-variable)',
  },
  { tag: [tags.propertyName, tags.attributeName, tags.definition(tags.propertyName)], color: 'var(--syntax-property)' },
  {
    tag: [
      tags.operator,
      tags.definitionOperator,
      tags.derefOperator,
      tags.compareOperator,
      tags.arithmeticOperator,
      tags.logicOperator,
      tags.bitwiseOperator,
      tags.updateOperator,
      tags.typeOperator,
    ],
    color: 'var(--syntax-operator)',
  },
  {
    tag: [
      tags.punctuation,
      tags.separator,
      tags.bracket,
      tags.brace,
      tags.paren,
      tags.squareBracket,
      tags.angleBracket,
    ],
    color: 'var(--syntax-punctuation)',
  },
  { tag: [tags.meta, tags.annotation, tags.processingInstruction, tags.documentMeta], color: 'var(--syntax-meta)' },
  { tag: [tags.regexp], color: 'var(--syntax-regexp)' },
  { tag: [tags.escape], color: 'var(--syntax-escape)' },
  { tag: [tags.invalid], color: 'var(--syntax-invalid)' },
  { tag: [tags.inserted], color: 'var(--syntax-inserted)' },
  { tag: [tags.deleted], color: 'var(--syntax-deleted)' },
  { tag: [tags.changed], color: 'var(--syntax-changed)' },
  { tag: [tags.link, tags.url], color: 'var(--syntax-link)', textDecoration: 'underline' },
  { tag: [tags.heading, tags.strong], fontWeight: '700' },
  { tag: [tags.emphasis], fontStyle: 'italic' },
  { tag: [tags.strikethrough], textDecoration: 'line-through' },
]);

/** Editor extension that applies the VS Code-style syntax colors. */
export function sourceHighlighting(): Extension {
  return syntaxHighlighting(vscodeHighlightStyle, { fallback: true });
}
