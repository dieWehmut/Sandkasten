import { snippetCompletion, type Completion } from '@codemirror/autocomplete';

// Lightweight language assistance works offline, including the runtimes for
// which no CodeMirror grammar is installed. It is deliberately a keyword and
// snippet catalog rather than a language server or a type checker.
const keywords: Readonly<Record<string, string>> = {
  assembly: 'section global extern mov lea add sub mul div cmp jmp je jne call ret push pop syscall db dw dd dq',
  bash: 'if then elif else fi for in do done while until case esac function local export readonly return source echo printf read exit',
  c: 'auto break case char const continue default do double else enum extern float for goto if inline int long register restrict return short signed sizeof static struct switch typedef union unsigned void volatile while',
  cangjie: 'package import class struct enum interface extend func let var const public private protected internal static override open abstract if else for in while do match case break continue return try catch finally throw true false',
  clojure: 'def defn defmacro let fn if if-let when when-let cond case do loop recur doseq for ns require import quote try catch finally throw nil true false',
  coq: 'Definition Fixpoint CoFixpoint Inductive CoInductive Record Theorem Lemma Proof Qed Defined Admitted Require Import Export Module Section End Variable Variables Hypothesis Check Compute reflexivity intros apply exact rewrite simpl induction destruct',
  cpp: 'alignas alignof auto bool break case catch char class const constexpr continue decltype default delete do double else enum explicit extern false float for friend if inline int long namespace new noexcept nullptr operator override private protected public return short signed sizeof static struct switch template this throw true try typedef typename union unsigned using virtual void volatile while',
  crystal: 'abstract alias annotation as begin break case class def do else elsif end ensure enum extend false for if include instance_sizeof is_a? lib macro module next nil of out private protected require rescue return select self sizeof struct super then true typeof unless until when while yield',
  csharp: 'abstract as async await base bool break case catch char class const continue decimal default delegate do double else enum event false finally float for foreach if in int interface internal is lock long namespace new null object out override partial private protected public readonly record ref return sealed short static string struct switch this throw true try typeof uint ulong unsafe using var virtual void volatile while yield',
  css: 'display position color background background-color font-family font-size font-weight line-height width height max-width min-height margin padding border border-radius box-shadow opacity overflow flex grid gap align-items justify-content transform transition animation content',
  dart: 'abstract as async await break case catch class const continue covariant default deferred do dynamic else enum export extends extension external factory false final finally for get hide if implements import in interface is late library mixin new null on operator part required rethrow return set show static super switch sync this throw true try typedef var void while with yield',
  elixir: 'def defp defmodule defmacro defstruct defprotocol defimpl do end if unless case cond with for fn when try rescue catch after receive import alias require use quote unquote true false nil',
  erlang: 'after begin case catch cond end fun if let of receive try when and andalso band bnot bor bsl bsr bxor div not or orelse rem xor true false',
  fsharp: 'abstract and as assert async base begin class default delegate do done downcast downto elif else end exception extern false finally for fun function global if in inherit inline interface internal lazy let match member module mutable namespace new null of open or override private public rec return sig static struct then to true try type upcast use val void when while with yield',
  fortran: 'program end implicit none integer real complex logical character parameter allocatable dimension allocate deallocate do if then else elseif endif select case cycle exit subroutine function module use contains intent in out inout call return print write read stop',
  gdscript: 'class class_name extends signal func static const enum var export onready if elif else for in while match break continue pass return assert await self super true false null preload load print',
  gleam: 'pub fn let assert case if type opaque import as const panic todo echo use Nil True False',
  go: 'break case chan const continue default defer else fallthrough for func go goto if import interface map package range return select struct switch type var true false nil make len cap append copy delete close panic recover',
  graphviz: 'strict graph digraph subgraph node edge label shape color fillcolor style rankdir rank fontsize fontname penwidth arrowhead arrowsize weight splines bgcolor',
  haskell: 'case class data default deriving do else foreign if import in infix infixl infixr instance let module newtype of then type where qualified hiding True False',
  html: 'html head title meta link style body header nav main section article aside footer div span p a img button input form label select option textarea table ul ol li script',
  java: 'abstract assert boolean break byte case catch char class const continue default do double else enum extends final finally float for if implements import instanceof int interface long native new null package private protected public record return short static strictfp super switch synchronized this throw throws transient true false try var void volatile while',
  javascript: 'async await break case catch class const continue debugger default delete do else export extends false finally for function if import in instanceof let new null of return static super switch this throw true try typeof undefined var void while yield console document window Math JSON Object Array Promise Set Map',
  julia: 'baremodule begin break catch const continue do else elseif end export false finally for function global if import let local macro module mutable primitive quote return struct true try using where while',
  kotlin: 'as break class continue do else false for fun if in interface is null object package return super this throw true try typealias typeof val var when while by constructor delegate dynamic field file finally get import init param property receiver set setparam where actual abstract annotation companion const crossinline data enum expect external final infix inline inner internal lateinit noinline open operator out override private protected public reified sealed suspend tailrec vararg',
  lean4: 'def theorem lemma example axiom constant inductive structure class instance namespace section end variable open import universe opaque abbrev if then else match with do let have show by exact apply intro simp rfl constructor cases induction',
  latex: 'documentclass usepackage begin end section subsection subsubsection paragraph textbf textit emph item label ref cite include input table figure equation align frac sqrt sum int alpha beta gamma',
  lua: 'and break do else elseif end false for function goto if in local nil not or repeat return then true until while print pairs ipairs require tonumber tostring',
  markdown: 'heading link image code table quote task',
  mdx: 'import export const heading link image code table component',
  mojo: 'fn def struct trait var let alias if elif else for in while break continue return raise try except finally with as import from True False None print Int Float64 String SIMD',
  nextflow: 'nextflow enable process workflow input output script shell exec when publishDir container conda cpus memory time tag emit take main Channel fromPath fromList of map filter collect join combine tuple val path stdout',
  nim: 'addr and as asm bind block break case cast concept const continue converter defer discard distinct div do elif else end enum except export finally for from func if import in include interface is isnot iterator let macro method mixin mod nil not notin object of or out proc ptr raise ref return shl shr static template try tuple type using var when while xor yield',
  octave: 'break case catch classdef continue do else elseif end endfor endfunction endif endswitch endwhile for function global if otherwise persistent return switch try until unwind_protect while disp printf zeros ones size length',
  ocaml: 'and as assert begin class constraint do done downto else end exception external false for fun function functor if in include inherit initializer lazy let match method module mutable new nonrec object of open or private rec sig struct then to true try type val virtual when while with',
  pascal: 'program uses var const type begin end procedure function if then else case of for to downto do while repeat until array record set file packed with goto label nil and or not div mod writeln readln',
  perl: 'my our local sub use require package if elsif else unless while until for foreach continue last next redo goto return given when default state undef print say chomp push pop shift unshift splice split join map grep sort',
  php: 'abstract and array as break callable case catch class clone const continue declare default die do echo else elseif empty endfor endforeach endif endwhile enum eval exit extends final finally fn for foreach function global if implements include include_once instanceof interface isset list match namespace new null or print private protected public readonly require require_once return static switch throw trait true false try unset use var while xor yield',
  prolog: 'is true fail repeat cut dynamic multifile discontiguous module use_module consult assertz asserta retract findall bagof setof member append length write writeln read format nl halt',
  python: 'False None True and as assert async await break class continue def del elif else except finally for from global if import in is lambda nonlocal not or pass raise return try while with yield print len range str int float list dict set tuple enumerate zip open input',
  qml: 'import as pragma property readonly required default alias signal function id Item Rectangle Text Image MouseArea Column Row Grid anchors width height color text visible enabled Component Connections Timer onClicked',
  r: 'if else repeat while function for in next break TRUE FALSE NULL Inf NaN NA library require print cat paste data.frame list c matrix length mean sum seq lapply sapply',
  racket: 'define define-syntax lambda let let* letrec if cond case begin set! quote quasiquote unquote require provide module struct match for for/list when unless and or displayln printf list cons car cdr map filter',
  ruby: 'BEGIN END alias and begin break case class def defined? do else elsif end ensure false for if in module next nil not or redo rescue retry return self super then true undef unless until when while yield puts print require attr_reader attr_accessor',
  rust: 'as async await break const continue crate dyn else enum extern false fn for if impl in let loop match mod move mut pub ref return self Self static struct super trait true type unsafe use where while String Vec Option Result Some None Ok Err println',
  scala: 'abstract case catch class def do else enum export extends false final finally for given if implicit import inline lazy match new null object opaque override package private protected return sealed super then this throw trait transparent true try type using val var while with yield',
  scss: 'use forward import mixin include extend function return if else each for while at-root debug warn error content display color background margin padding border font-size width height flex grid gap',
  sql: 'SELECT FROM WHERE INSERT INTO VALUES UPDATE SET DELETE CREATE TABLE ALTER DROP JOIN INNER LEFT RIGHT FULL ON GROUP BY ORDER HAVING LIMIT OFFSET AS DISTINCT UNION ALL WITH CASE WHEN THEN ELSE END AND OR NOT NULL IS IN EXISTS BETWEEN LIKE ASC DESC PRIMARY KEY FOREIGN REFERENCES COUNT SUM AVG MIN MAX',
  swift: 'associatedtype actor async await as break case catch class continue default defer deinit do else enum extension fallthrough false fileprivate for func guard if import in init inout internal is let nil open operator private protocol public repeat rethrows return self Self some static struct subscript super switch throw throws true try typealias var where while',
  tailwindcss: 'flex inline-flex grid block hidden relative absolute fixed sticky items-center justify-center justify-between gap-2 gap-4 p-2 p-4 px-4 py-2 m-0 mx-auto w-full h-full min-h-screen max-w-screen-lg rounded rounded-lg border shadow text-sm text-lg font-medium font-bold text-center bg-white text-black',
  typescript: 'abstract any as async await boolean break case catch class const continue declare default delete do else enum export extends false finally for from function if implements import in infer instanceof interface keyof let namespace never new null number object of private protected public readonly record return satisfies static string super switch symbol this throw true try type typeof undefined unknown var void while yield console document window Math JSON Object Array Promise Set Map',
  typst: 'let set show import include as if else for in while break continue return context none auto true false text heading par page align stack grid table image figure caption link ref cite bibliography math rect circle line rgb luma',
  vlang: 'module import as pub fn struct enum interface type const mut shared static unsafe defer if else for in match return break continue go spawn select assert true false none map string int bool println',
  wdl: 'version workflow task call as input output command runtime requirements hints meta parameter_meta scatter in if alias import after Array Map Pair Object Boolean Int Float String File Directory true false None select_first select_all defined length range zip cross flatten transpose read_lines read_json write_lines write_json stdout stderr glob basename sub sep prefix suffix',
  zig: 'addrspace align allowzero and anyframe anytype asm async await break callconv catch comptime const continue defer else enum errdefer error export extern false fn for if inline linksection noalias noinline nosuspend null opaque or orelse packed pub resume return section struct suspend switch test threadlocal true try undefined union unreachable usingnamespace var volatile while',
  json: 'true false null',
  yaml: 'true false null',
  toml: 'true false',
  mermaid: 'flowchart graph subgraph end direction sequenceDiagram participant actor loop alt else opt par and rect note over autonumber classDiagram class stateDiagram-v2 state gantt dateFormat section journey pie mindmap timeline',
  xml: 'xml xmlns version encoding',
};

const aliases: Readonly<Record<string, string>> = {
  js: 'javascript', node: 'javascript', ts: 'typescript', py: 'python', python3: 'python', golang: 'go', rs: 'rust',
  'c++': 'cpp', sh: 'bash', zsh: 'bash', vue: 'html', vue3: 'html', jsx: 'typescript', tsx: 'typescript',
  nextjs: 'typescript', md: 'markdown', tailwind: 'tailwindcss', less: 'scss', sass: 'scss', lean: 'lean4',
};

export function completionRuntime(runtime: string): string {
  const name = runtime.trim().toLowerCase();
  return aliases[name] ?? name;
}

// `#{field}` uses CodeMirror's snippet fields: accepting a template selects its
// first field, and Tab/Shift+Tab walks through the remaining fields.
const snippets: Readonly<Record<string, ReadonlyArray<readonly [string, string, string]>>> = {
  javascript: [
    ['log', 'console.log(#{value});', 'Log a value'],
    ['function', 'function #{name}(#{params}) {\n\t#{0}\n}', 'Function declaration'],
    ['for', 'for (let #{index} = 0; #{index} < #{length}; #{index}++) {\n\t#{0}\n}', 'For loop'],
    ['async', 'async function #{name}(#{params}) {\n\t#{0}\n}', 'Async function'],
  ],
  typescript: [
    ['log', 'console.log(#{value});', 'Log a value'],
    ['function', 'function #{name}(#{params}): #{void} {\n\t#{0}\n}', 'Typed function'],
    ['interface', 'interface #{Name} {\n\t#{property}: #{string};\n}', 'Interface declaration'],
  ],
  python: [
    ['print', 'print(#{value})', 'Print a value'],
    ['def', 'def #{name}(#{params}):\n\t#{pass}', 'Function declaration'],
    ['for', 'for #{item} in #{items}:\n\t#{pass}', 'For loop'],
    ['ifmain', 'if __name__ == "__main__":\n\t#{main()}', 'Main entry point'],
  ],
  go: [['func', 'func #{name}(#{params}) {\n\t#{0}\n}', 'Function declaration'], ['for', 'for #{index} := 0; #{index} < #{length}; #{index}++ {\n\t#{0}\n}', 'For loop']],
  rust: [['fn', 'fn #{name}(#{params}) {\n\t#{0}\n}', 'Function declaration'], ['println', 'println!("#{message}");', 'Print a line']],
  c: [['main', 'int main(void) {\n\t#{0}\n\treturn 0;\n}', 'Main entry point']],
  cpp: [['main', 'int main() {\n\t#{0}\n\treturn 0;\n}', 'Main entry point']],
  java: [['main', 'public static void main(String[] args) {\n\t#{0}\n}', 'Main entry point'], ['sout', 'System.out.println(#{value});', 'Print a line']],
  bash: [['if', 'if #{condition}; then\n\t#{0}\nfi', 'Conditional block'], ['for', 'for #{item} in #{items}; do\n\t#{0}\ndone', 'For loop']],
  ruby: [['def', 'def #{name}(#{params})\n\t#{0}\nend', 'Method declaration']],
  lua: [['function', 'function #{name}(#{params})\n\t#{0}\nend', 'Function declaration']],
  sql: [['select', 'SELECT #{columns}\nFROM #{table}\nWHERE #{condition};', 'Select rows'], ['create', 'CREATE TABLE #{table} (\n\t#{id} INTEGER PRIMARY KEY\n);', 'Create a table']],
  html: [
    ['html', '<!doctype html>\n<html lang="#{en}">\n<head>\n\t<meta charset="utf-8">\n\t<meta name="viewport" content="width=device-width, initial-scale=1">\n\t<title>#{Title}</title>\n</head>\n<body>\n\t#{0}\n</body>\n</html>', 'HTML document'],
    ['div', '<div class="#{container}">#{0}</div>', 'Container element'],
    ['script', '<script type="module">\n\t#{0}\n</script>', 'Module script'],
  ],
  css: [['rule', '#{.selector} {\n\t#{property}: #{value};\n}', 'Style rule'], ['media', '@media (max-width: #{768px}) {\n\t#{0}\n}', 'Responsive media query']],
  scss: [['mixin', '@mixin #{name}(#{params}) {\n\t#{0}\n}', 'SCSS mixin'], ['media', '@media (max-width: #{768px}) {\n\t#{0}\n}', 'Responsive media query']],
  markdown: [['heading', '# #{Title}', 'Heading'], ['link', '[#{text}](#{https://example.com})', 'Link'], ['image', '![#{description}](#{image.png})', 'Image'], ['code', '```#{language}\n#{0}\n```', 'Fenced code block'], ['task', '- [ ] #{task}', 'Task item'], ['table', '| #{Column} | #{Column} |\n| --- | --- |\n| #{value} | #{value} |', 'Table']],
  mdx: [['component', '<#{Component}>\n\t#{0}\n</#{Component}>', 'JSX component'], ['import', 'import #{Component} from "#{./component}";', 'Import a component']],
  graphviz: [['digraph', 'digraph #{G} {\n\trankdir=#{LR};\n\t#{A} -> #{B};\n}', 'Directed graph'], ['graph', 'graph #{G} {\n\t#{A} -- #{B};\n}', 'Undirected graph'], ['node', '#{node} [label="#{Label}", shape=#{box}];', 'Node attributes']],
  latex: [['document', '\\documentclass{#{article}}\n\\usepackage[utf8]{inputenc}\n\\begin{document}\n#{0}\n\\end{document}', 'LaTeX document'], ['section', '\\section{#{Title}}\n#{0}', 'Section'], ['frac', '\\frac{#{numerator}}{#{denominator}}', 'Fraction']],
  typst: [['heading', '= #{Title}', 'Heading'], ['table', '#table(columns: #{2},\n\t[#{First}], [#{Second}],\n)', 'Table'], ['figure', '#figure(\n\timage("#{image.png}"),\n\tcaption: [#{Caption}],\n)', 'Figure'], ['let', '#let #{name} = #{value}', 'Variable binding']],
  qml: [['Rectangle', 'Rectangle {\n\twidth: #{320}\n\theight: #{240}\n\tcolor: "#{white}"\n\t#{0}\n}', 'Rectangle item'], ['property', 'property #{string} #{name}: #{value}', 'QML property']],
  nextflow: [['process', 'process #{NAME} {\n\tinput:\n\tval #{value}\n\n\toutput:\n\tstdout\n\n\tscript:\n\t"""\n\techo #{value}\n\t"""\n}', 'Process with input and output'], ['workflow', 'workflow {\n\t#{0}\n}', 'Workflow block']],
  wdl: [['task', 'task #{name} {\n\tinput {\n\t\tString #{message}\n\t}\n\tcommand <<<\n\t\techo "~{#{message}}"\n\t>>>\n\toutput {\n\t\tFile result = stdout()\n\t}\n}', 'WDL task'], ['workflow', 'workflow #{name} {\n\tcall #{task}\n}', 'Workflow block']],
  mermaid: [['flowchart', 'flowchart #{TD}\n\t#{A}[#{Start}] --> #{B}[#{End}]', 'Flowchart'], ['sequenceDiagram', 'sequenceDiagram\n\tparticipant #{Alice}\n\tparticipant #{Bob}\n\t#{Alice}->>#{Bob}: #{Message}', 'Sequence diagram']],
};

const memberWords: Readonly<Record<string, Readonly<Record<string, string>>>> = {
  javascript: {
    console: 'log info warn error debug table time timeEnd clear assert',
    Math: 'abs ceil floor round max min random sqrt pow trunc PI E',
    JSON: 'parse stringify', Object: 'keys values entries assign fromEntries freeze',
    Array: 'from isArray of', Promise: 'all allSettled race any resolve reject',
    document: 'querySelector querySelectorAll getElementById createElement body title addEventListener',
    window: 'addEventListener setTimeout setInterval localStorage location fetch',
  },
  python: { math: 'sqrt ceil floor fabs pow sin cos pi e', os: 'path environ getcwd listdir makedirs', sys: 'argv exit stdin stdout stderr version', json: 'loads dumps load dump' },
};

export function catalogCompletions(runtime: string): Completion[] {
  const name = completionRuntime(runtime);
  const languageKeywords = (keywords[name] ?? '').split(/\s+/).filter(Boolean);
  const templates = snippets[name] ?? [];
  return [
    ...templates.map(([label, template, detail]) => snippetCompletion(template, { label, detail, type: 'snippet', boost: 10 })),
    ...languageKeywords.map((label) => ({ label, type: 'keyword', detail: name })),
  ];
}

export function memberCompletions(runtime: string, object: string): Completion[] {
  const name = completionRuntime(runtime);
  const members = memberWords[name === 'typescript' ? 'javascript' : name]?.[object];
  return members?.split(' ').map((label) => ({ label, type: 'property', detail: object })) ?? [];
}
