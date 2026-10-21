import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { VitePWA } from "vite-plugin-pwa";

const apiTarget = `http://127.0.0.1:${process.env.PORT || 3000}`;

export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    VitePWA({
      strategies: "injectManifest",
      srcDir: "src",
      filename: "sw.ts",
      registerType: "autoUpdate",
      manifest: {
        name: "Omnivex Academy",
        short_name: "Omnivex",
        description:
          "Premium Amazon KDP mentorship and community platform for authors and publishers.",
        start_url: "/",
        scope: "/",
        display: "standalone",
        orientation: "portrait-primary",
        theme_color: "#05070c",
        background_color: "#05070c",
        categories: ["education", "business"],
        icons: [
          { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png" },
          { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png" },
          {
            src: "/icons/icon-maskable-512.png",
            sizes: "512x512",
            type: "image/png",
            purpose: "maskable",
          },
        ],
      },
      injectManifest: {
        globPatterns: ["**/*.{js,css,html,svg,png,ico,woff2}"],
        maximumFileSizeToCacheInBytes: 6 * 1024 * 1024,
      },
      devOptions: { enabled: false },
    }),
  ],
  server: {
    host: "0.0.0.0",
    port: Number(process.env.PORT) || 5173,
    proxy: {
      "/api": { target: apiTarget, changeOrigin: true },
      "/media": { target: apiTarget, changeOrigin: true },
      "/socket.io": { target: apiTarget, ws: true, changeOrigin: true },
    },
  },
  build: {
    outDir: "dist",
    chunkSizeWarningLimit: 1500,
  },
});
