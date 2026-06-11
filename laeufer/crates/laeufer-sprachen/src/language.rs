pub(crate) fn normalize_language(language: &str) -> Option<String> {
    let normalized = language.trim().to_ascii_lowercase();
    let canonical = match normalized.as_str() {
        "go" | "golang" => "go",
        "bash" | "shell" | "sh" => "bash",
        "c" => "c",
        "cpp" | "c++" => "cpp",
        "csharp" | "cs" | "c#" => "csharp",
        "java" => "java",
        "javascript" | "js" | "node" => "javascript",
        "julia" | "jl" => "julia",
        "kotlin" | "kt" => "kotlin",
        "lean" | "lean4" => "lean4",
        "lua" | "lua5.4" => "lua",
        "php" | "php8" | "php8.2" => "php",
        "prolog" | "pl" | "swi-prolog" | "swipl" => "prolog",
        "python" | "py" | "python3" => "python",
        "r" | "rscript" => "r",
        "ruby" | "rb" => "ruby",
        "rust" | "rs" => "rust",
        "scala" | "sc" => "scala",
        "sql" | "sqlite" | "sqlite3" => "sql",
        "typescript" | "ts" => "typescript",
        _ => return None,
    };
    Some(canonical.to_owned())
}
