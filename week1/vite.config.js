import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

/**
 * Served at nddelta.com/week1/, built into the CRA site's public/ so the
 * existing homepage deploy carries it along untouched.
 * In dev, /api proxies to the local stand-in for the Vercel functions.
 */
export default defineConfig({
  base: "/week1/",
  plugins: [react()],
  build: {
    outDir: "../public/week1",
    emptyOutDir: true,
  },
  server: {
    port: 5173,
    proxy: {
      "/api": "http://localhost:3100",
    },
  },
});
