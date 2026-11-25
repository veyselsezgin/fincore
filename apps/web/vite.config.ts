import { fileURLToPath } from 'node:url';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [react()],
  resolve: {
    // Use engine sources directly so engine edits hot-reload in the app.
    alias: {
      '@fincore/engine': fileURLToPath(
        new URL('../../packages/engine/src/index.ts', import.meta.url),
      ),
    },
  },
  server: { port: 5173, open: true },
});
