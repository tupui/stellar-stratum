import { defineConfig } from "vite";
import react from "@vitejs/plugin-react-swc";
import { nodePolyfills } from "vite-plugin-node-polyfills";
import path from "path";
import { componentTagger } from "lovable-tagger";

// https://vitejs.dev/config/
export default defineConfig(({ mode }) => ({
  server: {
    host: "::",
    port: 8080,
  },
  build: {
    target: 'es2020', // Target modern browsers to avoid legacy transforms
    minify: 'esbuild',
    rollupOptions: {
      output: {
        manualChunks: {
          vendor: ['react', 'react-dom'],
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
    mode === 'development' && componentTagger(),
  ].filter(Boolean),
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
      target: 'es2020', // Modern target for dependency optimization
    },
  },
}));
