import { defineConfig } from "vitest/config";
import path from "path";

export default defineConfig({
  resolve: {
    alias: [{ find: "@", replacement: path.resolve(import.meta.dirname, "./src") }],
  },
  test: {
    include: ["src/**/*.test.ts"],
    environment: "node",
  },
});
