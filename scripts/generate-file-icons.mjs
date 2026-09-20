// Regenerate the workbench icon table from the published vscode-icons theme.
//
// The upstream extension ships a generated icon-theme manifest that is exactly
// what VS Code renders, so this reads that manifest instead of re-deriving the
// mapping from the TypeScript sources. The emitted module is committed, so a
// normal build never needs the VSIX:
//
//   curl -L -o tmp/vscode-icons.vsix \
//     https://github.com/vscode-icons/vscode-icons/releases/download/v12.19.0/vscode-icons-12.19.0.vsix
//   node scripts/generate-file-icons.mjs tmp/vscode-icons.vsix
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { dirname, join, resolve } from "node:path";
import { tmpdir } from "node:os";

const VSIX_VERSION = "12.19.0";
const UPSTREAM_COMMIT = "e6daaed43175c6c3f62b84f3ca30a4745df58b3e";
const VSIX_SHA256 = "6891095459234809b9c5161850f2dabc91a80b3eca2daf599d050a88b455e960";
const TARGET = resolve(import.meta.dirname, "..", "apps", "web", "src", "editor", "fileIconTable.ts");

/** Strip metadata while preserving the upstream artwork's coordinates. */
function cleanSvg(svg) {
  return svg
    .replace(/<\?xml[\s\S]*?\?>/g, "")
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/<title>[\s\S]*?<\/title>/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

const vsixPath = process.argv[2];
if (!vsixPath || !existsSync(vsixPath)) {
  throw new Error("usage: node scripts/generate-file-icons.mjs <vscode-icons-<version>.vsix>");
}
if (createHash("sha256").update(readFileSync(vsixPath)).digest("hex") !== VSIX_SHA256) {
  throw new Error(`Expected the pinned vscode-icons ${VSIX_VERSION} archive (${VSIX_SHA256})`);
}

// A VSIX is a zip archive; extract just what the icon theme needs.
const staging = mkdtempSync(join(tmpdir(), "sandkasten-icons-"));
try {
  execFileSync("tar", ["-xf", resolve(vsixPath), "-C", staging], { stdio: "inherit" });
  const manifestPath = join(staging, "extension", "dist", "src", "vsicons-icon-theme.json");
  if (!existsSync(manifestPath)) throw new Error(`icon theme manifest missing from ${vsixPath}`);
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
  const themeDirectory = dirname(manifestPath);

  const pathFor = (iconId) => {
    const iconPath = manifest.iconDefinitions[iconId]?.iconPath;
    if (!iconPath) return undefined;
    const absolute = resolve(themeDirectory, iconPath);
    return existsSync(absolute) ? absolute : undefined;
  };
  const collect = (source) => {
    const output = {};
    for (const [key, iconId] of Object.entries(source ?? {})) {
      if (pathFor(iconId)) output[key.toLowerCase()] = iconId;
    }
    return output;
  };

  const extensions = collect(manifest.fileExtensions);
  const filenames = collect(manifest.fileNames);
  const folders = collect(manifest.folderNames);
  const foldersOpen = collect(manifest.folderNamesExpanded);
  const languages = {};
  for (const [id, iconId] of Object.entries(manifest.languageIds)) {
    if (!(id in languages) && pathFor(iconId)) languages[id] = iconId;
  }

  // Upstream keeps a light-theme override map; VS Code swaps in only the
  // entries that differ, so mirror that instead of duplicating every table.
  const lightOf = (base, light) => {
    const output = {};
    for (const [key, iconId] of Object.entries(light ?? {})) {
      const normalized = key.toLowerCase();
      if (base[normalized] === iconId) continue;
      if (pathFor(iconId)) output[normalized] = iconId;
    }
    return output;
  };
  const light = {
    extensions: lightOf(extensions, manifest.light?.fileExtensions),
    filenames: lightOf(filenames, manifest.light?.fileNames),
    folders: lightOf(folders, manifest.light?.folderNames),
    foldersOpen: lightOf(foldersOpen, manifest.light?.folderNamesExpanded),
    languages: lightOf(languages, manifest.light?.languageIds),
  };

  // VS Code emits a rule only when a definition carries a path, so an entry
  // pointing at an empty definition leaves the base rule in place. The neutral
  // light entries are exactly that, which is why they fall back here.
  const resolveDefault = (iconId, fallback) => (pathFor(iconId) ? iconId : fallback);
  const defaults = { file: manifest.file, folder: manifest.folder, folderOpen: manifest.folderExpanded };
  const lightDefaults = {
    file: resolveDefault(manifest.light?.file, defaults.file),
    folder: resolveDefault(manifest.light?.folder, defaults.folder),
    folderOpen: resolveDefault(manifest.light?.folderExpanded, defaults.folderOpen),
  };

  const needed = new Set([
    ...Object.values(extensions), ...Object.values(filenames), ...Object.values(folders),
    ...Object.values(foldersOpen), ...Object.values(languages), ...Object.values(defaults),
    ...Object.values(lightDefaults),
    ...Object.values(light.extensions), ...Object.values(light.filenames), ...Object.values(light.folders),
    ...Object.values(light.foldersOpen), ...Object.values(light.languages),
  ]);

  const glyphs = {};
  for (const iconId of [...needed].sort()) {
    const glyphPath = pathFor(iconId);
    if (glyphPath) glyphs[iconId] = cleanSvg(readFileSync(glyphPath, "utf8"));
  }

  // Every table stays a flat string map so the resolver can index it by any
  // file name or extension without a literal union of a thousand keys.
  const asTable = (entries) => `export const __NAME__: Readonly<Record<string, string>> = ${JSON.stringify(entries, null, 2)};`;

  const sections = [
    ["DEFAULT_GLYPHS", "Neutral glyphs for files and folders that no rule matches.", JSON.stringify({ dark: defaults, light: lightDefaults }, null, 2) + " as const"],
    ["EXTENSION_ICONS", "Lower-case file extension to an icon id.", asTable(extensions)],
    ["FILE_NAME_ICONS", "Lower-case exact file name to an icon id.", asTable(filenames)],
    ["FOLDER_ICONS", "Lower-case folder name to an icon id.", asTable(folders)],
    ["FOLDER_OPEN_ICONS", "Lower-case folder name to the glyph shown while expanded.", asTable(foldersOpen)],
    ["LANGUAGE_ICONS", "Editor language id to an icon id, used when an extension has no rule.", asTable(languages)],
    ["LIGHT_ICON_OVERRIDES", "Entries the upstream light theme overrides, grouped like the tables above.", `export const __NAME__: LightIconGroups = ${JSON.stringify(light, null, 2)};`],
    ["ICON_GLYPHS", "Icon id to the upstream SVG markup.", asTable(glyphs)],
  ];

  const body = [
    `// Generated by scripts/generate-file-icons.mjs from vscode-icons ${VSIX_VERSION}.`,
    `// Upstream commit: ${UPSTREAM_COMMIT}; VSIX SHA-256: ${VSIX_SHA256}.`,
    "// MIT license: see THIRD_PARTY_NOTICES.md, also included in the built app.js banner.",
    "// Do not edit by hand; re-run the generator and commit the result.",
    "",
    `export const FILE_ICONS_VERSION = ${JSON.stringify(VSIX_VERSION)};`,
    "",
    "/** The override groups the light theme can carry. */",
    "export const LIGHT_ICON_GROUPS = ['extensions', 'filenames', 'folders', 'foldersOpen', 'languages'] as const;",
    "",
    "/** The upstream light theme overrides, grouped like the tables below. */",
    "export type LightIconGroups = { readonly [group in typeof LIGHT_ICON_GROUPS[number]]: Readonly<Record<string, string>> };",
    "",
    ...sections.flatMap(([name, comment, value]) => [
      `/** ${comment} */`,
      value.startsWith("export const ") ? value.replace("__NAME__", name) : `export const ${name} = ${value};`,
      "",
    ]),
  ].join("\n");

  writeFileSync(TARGET, body);

  const bytes = Object.values(glyphs).reduce((sum, value) => sum + value.length, 0);
  console.log(`extensions=${Object.keys(extensions).length} filenames=${Object.keys(filenames).length} folders=${Object.keys(folders).length} languages=${Object.keys(languages).length}`);
  console.log(`glyphs=${Object.keys(glyphs).length} inlineKB=${Math.round(bytes / 1024)}`);
  console.log(`written ${TARGET}`);
} finally {
  rmSync(staging, { recursive: true, force: true });
}
