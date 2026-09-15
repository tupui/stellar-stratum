import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react-swc";
import { nodePolyfills } from "vite-plugin-node-polyfills";
import path from "path";
import { createRequire } from "module";

// @trezor/connect-plugin-stellar 9.2.6 imports "@trezor/utils/libESM/bigNumber",
// a deep path that @trezor/utils' exports map does not expose. Resolve it from the
// importing package instead of from our own src/, so it works under every package
// manager layout (npm hoisting, bun, and pnpm's strict symlinked node_modules).
function trezorBigNumber(): Plugin {
  const BROKEN_ID = '@trezor/utils/libESM/bigNumber';
  return {
    name: 'trezor-bignumber-resolver',
    enforce: 'pre',
    resolveId(source, importer) {
      if (source !== BROKEN_ID || !importer) return null;
      try {
        // "./lib/bigNumber" *is* in the exports map; swap the CJS build for the ESM one.
        const cjs = createRequire(importer).resolve('@trezor/utils/lib/bigNumber');
        return cjs.replace(/lib([\\/])bigNumber\.js$/, 'libESM$1bigNumber.js');
      } catch {
        return null;
      }
    },
  };
}

// https://vitejs.dev/config/
export default defineConfig({
  server: {
    host: "::",
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
    trezorBigNumber(),
    nodePolyfills({
      include: ['buffer', 'process', 'crypto'],
      globals: {
        Buffer: true,
        global: true,
        process: true,
      },
    }),
    react(),
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
    include: ["buffer", "process", "@stellar/stellar-base"],
    exclude: ["@trezor/connect-plugin-stellar"],
  },
});
