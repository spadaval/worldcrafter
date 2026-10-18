import { fileURLToPath } from "node:url";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

// A static, browser-only build: `bun run build` writes dist/, which any static
// host can serve. Routing uses the URL hash, so no server rewrites are needed.
export default defineConfig({
  base: "./",
  plugins: [react()],
  resolve: {
    alias: { "~": fileURLToPath(new URL("./src", import.meta.url)) },
  },
});
