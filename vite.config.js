import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { resolve } from 'node:path';

/**
 * Multi-page build for the Chrome MV3 extension.
 *
 * `npm run build` produces a clean `dist/` folder containing:
 *   - manifest.json      (copied from public/)
 *   - background.js      (module service worker, bundled dependency-free)
 *   - popup.html         (+ bundled popup assets)
 *   - dashboard.html     (+ bundled dashboard assets)
 *
 * `base: './'` forces relative asset URLs so Chrome loads every bundle
 * from the extension package without CSP violations.
 */
export default defineConfig({
  base: './',
  plugins: [react()],
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    rollupOptions: {
      input: {
        popup: resolve(__dirname, 'popup.html'),
        dashboard: resolve(__dirname, 'dashboard.html'),
        background: resolve(__dirname, 'src/background.js'),
      },
      output: {
        // Keep the module service worker at the dist root as `background.js`
        // to match manifest.json exactly.
        entryFileNames: '[name].js',
        chunkFileNames: 'assets/[name]-[hash].js',
        assetFileNames: 'assets/[name]-[hash].[ext]',
        format: 'es',
      },
    },
  },
});
