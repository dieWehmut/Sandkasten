import path from 'node:path';
import { fileURLToPath } from 'node:url';

// This config lives in apps/desktop, so the app root is its own directory and
// the repository root is two levels up.
const appRoot = path.dirname(fileURLToPath(import.meta.url));
const repositoryRoot = path.resolve(appRoot, '..', '..');

// 7-Zip 24 applies the ARM64 branch-converter filter to arm64 PE files by
// default, but the nsis7z plugin shipped with electron-builder predates that
// filter and silently skips such entries, producing installers without the
// application executable. Pin the classic BCJ filter so the payload stays
// readable for the plugin on every build host.
export const NSIS_ARCHIVE_FILTER = 'BCJ';
process.env.ELECTRON_BUILDER_7Z_FILTER ??= NSIS_ARCHIVE_FILTER;

export default {
  appId: 'tech.diesw.sandkasten',
  productName: 'Sandkasten',
  // node-pty 1.1 ships N-API prebuilds for both Windows targets. Rebuilding on
  // the host would discard these and make cross-architecture packages fragile.
  npmRebuild: process.platform !== 'win32',
  asarUnpack: ['node_modules/node-pty/**/*', 'src/terminal-worker.mjs'],
  directories: {
    output: path.join(repositoryRoot, 'tmp', 'desktop-dist'),
    buildResources: path.join(appRoot, 'build'),
  },
  files: [
    'src/**/*',
    'package.json',
  ],
  extraResources: [
    {
      from: path.join(repositoryRoot, 'apps', 'web', 'dist'),
      to: 'web-dist',
    },
    {
      from: path.join(appRoot, 'build', 'icon.png'),
      to: 'icon.png',
    },
  ],
  win: {
    icon: path.join(appRoot, 'build', 'icon.ico'),
    target: [
      { target: 'nsis', arch: ['x64', 'arm64'] },
    ],
  },
  mac: {
    target: ['dir'],
  },
  linux: {
    target: ['dir'],
  },
  nsis: {
    oneClick: false,
    perMachine: false,
    allowToChangeInstallationDirectory: true,
    createDesktopShortcut: true,
    createStartMenuShortcut: true,
    shortcutName: 'Sandkasten',
    artifactName: 'Sandkasten-${version}-Setup.${ext}',
  },
};
