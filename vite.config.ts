import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

// `--mode inline` produces the single-file variant: fonts and the logo become
// data URIs so make-single-file.mjs can collapse everything into one HTML file.
export default defineConfig(({ mode }) => {
  const inline = mode === "inline";
  return {
    plugins: [react()],
    base: "./",
    build: {
      outDir: inline ? "dist-inline" : "docs",
      emptyOutDir: true,
      assetsInlineLimit: inline ? 200000 : 0,
      chunkSizeWarningLimit: 2000,
    },
  };
});
