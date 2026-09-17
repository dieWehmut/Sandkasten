import path from 'node:path';
import { fileURLToPath } from 'node:url';

// This config lives in apps/desktop, so the app root is its own directory and
// the repository root is two levels up.
const appRoot = path.dirname(fileURLToPath(import.meta.url));
const repositoryRoot = path.resolve(appRoot, '..', '..');

export default {
  appId: 'tech.diesw.sandkasten',
  productName: 'Sandkasten',
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
  ],
  win: {
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