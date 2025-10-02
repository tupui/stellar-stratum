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
        manualChunks: {
          // Core React libraries
          vendor: ['react', 'react-dom'],
          
          // Stellar SDK and related crypto libraries - large bundle
          stellar: ['@stellar/stellar-sdk', 'buffer'],
          
          // Wallet integration modules - loaded on demand
          wallets: [
            '@creit.tech/stellar-wallets-kit',
            '@creit.tech/stellar-wallets-kit/modules/ledger.module',
            '@creit.tech/stellar-wallets-kit/modules/walletconnect.module',
            '@creit.tech/stellar-wallets-kit/modules/trezor.module'
          ],
          
          // QR code libraries - separate chunk for better caching
          qr: ['qrcode', 'qrcode.react', 'jsqr', '@zxing/browser', '@zxing/library'],
          
          // UI components and utilities
          ui: ['@radix-ui/react-dialog', '@radix-ui/react-dropdown-menu', '@radix-ui/react-tabs'],
          
          // Data fetching and state management
          query: ['@tanstack/react-query'],
          
          // Chart and visualization libraries
          charts: ['recharts'],
          
          // Utilities and validation
          utils: ['clsx', 'class-variance-authority', 'zod', 'date-fns']
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
