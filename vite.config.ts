import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

// In docker compose the server is reachable as "server"; outside it, localhost.
const apiTarget = process.env.API_TARGET ?? "http://localhost:8787";

export default defineConfig({
  root: "web",
  plugins: [react()],
  server: {
    host: true,
    port: 5173,
    strictPort: true,
    // Same-Wi-Fi phones reach the Mac by IP or *.local name.
    allowedHosts: true,
    proxy: {
      "/api": { target: apiTarget, changeOrigin: true },
    },
    watch: process.env.CHOKIDAR_USEPOLLING ? { usePolling: true } : undefined,
  },
});
