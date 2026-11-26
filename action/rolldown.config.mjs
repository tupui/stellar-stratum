import { resolve } from 'node:path';
import { defineConfig } from 'rolldown';

export default defineConfig({
  input: 'action/propose.ts',
  platform: 'node',
  resolve: { alias: { '@': resolve('src') } },
  // The app reads vite's import.meta.env, which does not exist in Node.
  transform: { define: { 'import.meta.env.DEV': 'false' } },
  output: { file: 'action/dist/propose.mjs', format: 'esm', codeSplitting: false },
});
