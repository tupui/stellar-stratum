import { defineConfig } from "vite";
import react from "@vitejs/plugin-react-swc";
import { nodePolyfills } from "vite-plugin-node-polyfills";
import path from "path";

// https://vitejs.dev/config/
export default defineConfig({
  server: {
    host: "::",
    port: 8080,
  },
  build: {
    target: 'es2020',
    minify: 'esbuild',
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
          if (id.includes('clsx') || id.includes('class-variance-authority') || id.includes('date-fns')) return 'utils';
          if (id.match(/node_modules\/react(-dom)?\//)) return 'vendor';
        },
      },
    },
  },
  esbuild: {
    target: 'es2020',
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
  ],
  define: {
    global: 'globalThis',
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
    dedupe: ["react", "react-dom"],
  },
  optimizeDeps: {
    include: ["buffer", "process"],
    esbuildOptions: {
      target: 'es2020',
    },
  },
});
