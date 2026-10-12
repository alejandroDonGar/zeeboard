import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig({
  plugins: [react(), tailwindcss()],

  // La CSP de la app solo admite recursos propios: nada de fuentes incrustadas como data: (Vite las incrusta si pesan poco)
  build: { assetsInlineLimit: 0 },

  server: {
    port: 1420,
    strictPort: true,
    watch: {
      ignored: [
        "**/src-tauri/target/**",
      ],
    },
  },
});