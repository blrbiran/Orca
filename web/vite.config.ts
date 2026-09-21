import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [react()],
  build: {
    // Flat names, no hashed subdirectories: staticFiles.ts serves by exact
    // filename out of a Map and never joins a path, so every emitted asset has
    // to be reachable as one key. See spec §2.2.
    assetsDir: ".",
    rollupOptions: { output: { entryFileNames: "[name].js", assetFileNames: "[name].[ext]" } },
  },
  server: { proxy: { "/api": "http://127.0.0.1:7777" } },
  test: { environment: "node", include: ["tests/**/*.test.ts", "tests/**/*.test.tsx"] },
});
