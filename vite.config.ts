/// <reference types="vitest" />
import { defineConfig } from 'vite';
import { viteSingleFile } from 'vite-plugin-singlefile';
import { mapLink } from './vite-plugins/mapLink';

export default defineConfig(({ mode }) => ({
  base: './',
  plugins: mode === 'single' ? [viteSingleFile()] : [mapLink()],
  // CLI undo snapshots are of no interest to the page
  server: { watch: { ignored: ['**/maps/.history/**'] } },
  build: {
    outDir: mode === 'single' ? 'dist-single' : 'dist',
    target: 'es2022',
    chunkSizeWarningLimit: 2000,
  },
  test: { include: ['tests/**/*.test.ts'], environment: 'node' },
}));
