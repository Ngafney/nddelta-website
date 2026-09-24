import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

/**
 * Served at nddelta.com/week4/, built into the CRA site's public/ so the
 * existing homepage deploy carries it along untouched — same arrangement as
 * week1. In dev, /api proxies to the local stand-in for the Vercel functions.
 */
export default defineConfig({
  base: "/week4/",
  plugins: [react()],
  build: {
    outDir: "../public/week4",
    emptyOutDir: true,
  },
  server: {
    port: 5176,
    proxy: {
      "/api": "http://localhost:3400",
    },
  },
});
