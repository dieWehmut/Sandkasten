mod compiled;
mod interpreted;
mod systems;

pub(super) use self::compiled::{
    plan_assembly, plan_c, plan_cangjie, plan_coq, plan_cpp, plan_crystal, plan_csharp, plan_dart,
    plan_erlang, plan_fortran, plan_fsharp, plan_haskell, plan_java, plan_kotlin, plan_lean4,
    plan_mojo, plan_nim, plan_ocaml, plan_pascal, plan_rust, plan_scala, plan_swift, plan_vlang,
    plan_zig,
};
pub(super) use self::interpreted::{
    plan_bash, plan_clojure, plan_css, plan_elixir, plan_gdscript, plan_gleam, plan_graphviz,
    plan_html, plan_javascript, plan_julia, plan_latex, plan_lua, plan_markdown, plan_mdx,
    plan_nextflow, plan_nextjs, plan_octave, plan_perl, plan_php, plan_prolog, plan_python,
    plan_qml, plan_r, plan_racket, plan_ruby, plan_scss, plan_sql, plan_tailwindcss, plan_tsx,
    plan_typescript, plan_typst, plan_vue3, plan_wdl,
};
pub(super) use self::systems::plan_go;
