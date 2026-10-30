import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { pwaBuild } from "../../packages/browser/src/pwa-build";

export default defineConfig({
  plugins: [react(), pwaBuild("portal")],
  server: {
    port: 5174,
    proxy: {
      "/api": {
        target: process.env.VITE_API_TARGET ?? "http://localhost:18080",
        changeOrigin: true,
      },
    },
  },
});
