import { defineConfig } from "vite";
import react from "@vitejs/plugin-react-swc";
import { nodePolyfills } from "vite-plugin-node-polyfills";
import path from "path";
import type { Plugin } from "vite";

// index.html allows no inline script. The dev server injects one (the React Refresh preamble),
// so only there is the policy relaxed; builds keep it strict.
const allowInlineScriptsInDev = (): Plugin => ({
  name: "dev-csp-inline-scripts",
  apply: "serve",
  transformIndexHtml: (html) => html.replace("script-src 'self';", "script-src 'self' 'unsafe-inline';"),
});

// https://vitejs.dev/config/
export default defineConfig({
  server: {
    // Local only: the dev server serves every file in the project. `npm run dev -- --host`
    // exposes it on the network when testing from a phone.
    host: "localhost",
    port: 8080,
  },
  build: {
    target: 'es2020',
    sourcemap: true,
    rollupOptions: {
      output: {
        manualChunks(id: string) {
          if (!id.includes('node_modules')) return;
          if (id.includes('@stellar/stellar-sdk') || id.match(/node_modules\/buffer\//)) return 'stellar';
          if (id.includes('stellar-wallets-kit')) return 'wallets';
          if (id.includes('qrcode') || id.includes('jsqr') || id.includes('@zxing')) return 'qr';
          if (id.includes('@radix-ui')) return 'ui';
          if (id.includes('@tanstack/react-query')) return 'query';
          if (id.includes('recharts')) return 'charts';
          if (id.includes('clsx') || id.includes('class-variance-authority') || id.includes('date-fns')) return 'utils';
          if (id.match(/node_modules\/react(-dom)?\//)) return 'vendor';
        },
      },
    },
  },
  plugins: [
    nodePolyfills({
      include: ['buffer', 'process', 'crypto'],
      globals: {
        Buffer: true,
        global: true,
        process: true,
      },
    }),
    react(),
    allowInlineScriptsInDev(),
  ],
  define: {
    global: 'globalThis',
  },
  resolve: {
    alias: [
      { find: '@', replacement: path.resolve(import.meta.dirname, './src') },
    ],
    dedupe: ["react", "react-dom"],
  },

  optimizeDeps: {
    include: ["buffer", "process"],
  },
});
