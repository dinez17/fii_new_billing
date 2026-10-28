import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// All /api traffic goes through the api-gateway, which routes per path.
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      "/api": {
        target: process.env.VITE_API_TARGET ?? "http://localhost:18080",
        changeOrigin: true,
      },
    },
  },
});
