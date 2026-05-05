import { defineConfig } from "vite";
import react from "@vitejs/plugin-react-swc";
import { nodePolyfills } from "vite-plugin-node-polyfills";
import path from "path";

// https://vitejs.dev/config/
export default defineConfig(({ mode }) => ({
  server: {
    host: "::",
    port: 8080,
  },
  build: {
    target: 'es2020', // Target modern browsers to avoid legacy transforms
    minify: 'esbuild',
    sourcemap: true, // Generate source maps for better debugging and SEO compliance
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
  esbuild: {
    target: 'es2020', // Ensure esbuild also targets modern browsers
  },
  plugins: [
    nodePolyfills({
      // Only include essential polyfills for crypto/buffer functionality
      include: ['buffer', 'process', 'crypto'],
      globals: {
        Buffer: true,
        global: true,
        process: true,
      },
    }),
    react(),
    // Temporarily disabled component tagger to avoid ESM issues
    // mode === 'development' && componentTagger(),
  ].filter(Boolean),
  define: {
    global: 'globalThis',
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
      // Stub out native 'usb' module - not needed in browser (uses WebUSB instead)
      "usb": path.resolve(__dirname, "./src/lib/empty-module.ts"),
    },
    dedupe: ["react", "react-dom"],
  },
  optimizeDeps: {
    include: ["buffer", "process"],
    esbuildOptions: {
      target: 'es2020', // Modern target for dependency optimization
    },
  },
}));
