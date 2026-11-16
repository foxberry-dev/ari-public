import { defineConfig } from 'vite';

export default defineConfig({
  build: {
    emptyOutDir: false,
    target: 'node24',
    lib: { entry: 'src/export-runner.ts', formats: ['es'], fileName: () => 'graph-export.mjs' },
    rollupOptions: { external: ['node:fs', 'playwright'] },
  },
});
