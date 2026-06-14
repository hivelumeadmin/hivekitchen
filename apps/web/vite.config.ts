import { defineConfig, createLogger } from "vite";
import react from "@vitejs/plugin-react";
import path from "path";
import { VitePWA } from "vite-plugin-pwa";

const logger = createLogger();
const loggerWarn = logger.warn.bind(logger);
logger.warn = (msg, options) => {
  if (msg.includes("vad-react") && msg.includes("sourcemap")) return;
  loggerWarn(msg, options);
};

export default defineConfig({
  customLogger: logger,
  plugins: [
    react(),
    VitePWA({
      registerType: "autoUpdate",
      // No web app manifest — HiveKitchen is not a PWA and must not show an
      // install prompt on the child's device.
      manifest: false,
      // generateSW: Workbox auto-generates a service worker that precaches the
      // SPA shell so /lunch/* routes load offline without a custom SW file.
      strategies: "generateSW",
      workbox: {
        // Only precache the shell assets. The API is cross-origin
        // (VITE_API_BASE_URL); API caching is handled in localStorage from
        // within lunch-link.tsx.
        globPatterns: ["**/*.{js,css,html}"],
        disableDevLogs: true,
      },
      // SW only active in production builds. Vite HMR and the SW conflict in
      // dev mode — keep devOptions disabled.
      devOptions: {
        enabled: false,
      },
    }),
  ],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
});
