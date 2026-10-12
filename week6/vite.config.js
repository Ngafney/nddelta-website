import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

/**
 * Served at nddelta.com/week6/, built into the CRA site's public/ so the
 * existing homepage deploy carries it along untouched — same arrangement as
 * week1. In dev, /api proxies to the local stand-in for the Vercel functions.
 */
export default defineConfig({
  base: "/week6/",
  plugins: [react()],
  build: {
    outDir: "../public/week6",
    emptyOutDir: true,
  },
  server: {
    port: 5178,
    proxy: {
      "/api": "http://localhost:3501",
    },
  },
});
