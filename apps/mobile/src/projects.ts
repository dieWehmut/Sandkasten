export interface Project {
  id: string;
  name: string;
  language: string;
  source: string;
  entrypoint: string;
  stdin: string;
  args: string;
  files: { name: string; content: string }[];
  runTimeoutMs: number;
}
const examples: Record<string, string> = {
  go: 'package main\n\nimport "fmt"\n\nfunc main() {\n    fmt.Println("Hello from Sandkasten")\n}\n',
  python: 'print("Hello from Sandkasten")\n',
  javascript: 'console.log("Hello from Sandkasten");\n',
  typescript: 'const message: string = "Hello from Sandkasten";\nconsole.log(message);\n',
  rust: 'fn main() { println!("Hello from Sandkasten"); }\n',
  c: '#include <stdio.h>\nint main(void) { puts("Hello from Sandkasten"); return 0; }\n',
  cpp: '#include <iostream>\nint main() { std::cout << "Hello from Sandkasten" << std::endl; }\n',
  java: 'public class Main { public static void main(String[] args) { System.out.println("Hello from Sandkasten"); } }\n',
  bash: 'echo "Hello from Sandkasten"\n',
  ruby: 'puts "Hello from Sandkasten"\n',
  php: '<?php\necho "Hello from Sandkasten\\n";\n',
  sql: 'SELECT 1 AS hello;\n',
};
export function exampleSource(language: string): string { return examples[language] ?? ''; }
export function newProject(language = 'go'): Project {
  return { id: crypto.randomUUID(), name: `${language} 项目`, language, source: exampleSource(language), entrypoint: '', stdin: '', args: '[]', files: [], runTimeoutMs: 0 };
}
export function readProjects(): Project[] {
  try {
    const saved: unknown = JSON.parse(localStorage.getItem('sandkasten.projects') ?? 'null');
    if (Array.isArray(saved)) return saved.filter((p) => p && typeof p.id === 'string' && typeof p.name === 'string' && typeof p.language === 'string' && typeof p.source === 'string').map((p) => ({ ...newProject(p.language), ...p, files: Array.isArray(p.files) ? p.files.filter((f: {name?: unknown;content?:unknown}) => typeof f.name === 'string' && typeof f.content === 'string') : [] }));
  } catch {}
  return [newProject('go'), newProject('python')];
}
