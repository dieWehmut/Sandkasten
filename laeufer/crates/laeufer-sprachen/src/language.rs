pub(crate) fn normalize_language(language: &str) -> Option<String> {
    let normalized = language.trim().to_ascii_lowercase();
    let canonical = match normalized.as_str() {
        "go" | "golang" => "go",
        "bash" | "shell" | "sh" => "bash",
        "c" => "c",
        "cangjie" | "cj" | "cjc" | "仓颉" => "cangjie",
        "cpp" | "c++" => "cpp",
        "csharp" | "cs" | "c#" => "csharp",
        "coq" | "coqtop" | "coqc" => "coq",
        "java" => "java",
        "javascript" | "js" | "node" => "javascript",
        "julia" | "jl" => "julia",
        "kotlin" | "kt" => "kotlin",
        "lean" | "lean4" => "lean4",
        "lua" | "lua5.4" => "lua",
        "nim" | "nimrod" => "nim",
        "perl" | "perl5" => "perl",
        "php" | "php8" | "php8.2" => "php",
        "prolog" | "pl" | "swi-prolog" | "swipl" => "prolog",
        "python" | "py" | "python3" => "python",
        "r" | "rscript" => "r",
        "racket" | "rkt" => "racket",
        "ruby" | "rb" => "ruby",
        "rust" | "rs" => "rust",
        "scala" | "sc" => "scala",
        "sql" | "sqlite" | "sqlite3" => "sql",
        "swift" => "swift",
        "typescript" | "ts" => "typescript",
        "zig" => "zig",
        _ => return None,
    };
    Some(canonical.to_owned())
}
