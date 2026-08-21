/// <reference types="vitest/config" />

import { readdir } from 'node:fs/promises';
import { defineConfig } from 'vite';
import type { Plugin, ResolvedConfig } from 'vite';
import { configDefaults } from 'vitest/config';
import vue from '@vitejs/plugin-vue';

const distributionFiles = ['app.js', 'config.js', 'index.html', 'styles.css'];

function enforceDistributionContract(): Plugin {
  let resolvedConfig: ResolvedConfig;

  return {
    name: 'sandkasten-distribution-contract',
    apply: 'build',
    configResolved(config) {
      resolvedConfig = config;
    },
    async closeBundle() {
      const entries = await readdir(resolvedConfig.build.outDir, { withFileTypes: true });
      const names = entries.map((entry) => entry.name).sort();

      if (
        names.length !== distributionFiles.length
        || names.some((name, index) => name !== distributionFiles[index])
        || entries.some((entry) => !entry.isFile())
      ) {
        throw new Error(
          `WebUI distribution must contain exactly four regular files: ${distributionFiles.join(', ')}; received: ${names.join(', ')}`,
        );
      }
    },
  };
}

export default defineConfig({
  base: './',
  plugins: [vue(), enforceDistributionContract()],
  build: {
    assetsDir: '',
    cssCodeSplit: false,
    emptyOutDir: true,
    sourcemap: false,
    rollupOptions: {
      output: {
        entryFileNames: 'app.js',
        chunkFileNames: 'app.js',
        assetFileNames: (assetInfo) => assetInfo.names.some((name) => name.endsWith('.css')) ? 'styles.css' : '[name][extname]',
      },
    },
  },
  test: {
    environment: 'jsdom',
    exclude: [...configDefaults.exclude, 'tests/build-contract.test.mjs'],
  },
});
