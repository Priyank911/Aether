import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  plugins: [react()],
  root: path.join(here, 'renderer'),
  build: {
    outDir: path.join(here, '..', 'renderer-dist'),
    emptyOutDir: true,
  },
});
