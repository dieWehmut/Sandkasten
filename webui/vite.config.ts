/// <reference types="vitest/config" />

import { defineConfig } from 'vite';
import vue from '@vitejs/plugin-vue';

export default defineConfig({
  base: './',
  plugins: [vue()],
  build: {
    assetsDir: '',
    cssCodeSplit: false,
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
  },
});
