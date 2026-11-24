/// <reference types="vitest/config" />
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig({
  plugins: [react(), tailwindcss()],

  // La CSP de la app solo admite recursos propios: nada de fuentes incrustadas como data: (Vite las incrusta si pesan poco)
  build: { assetsInlineLimit: 0 },

  // Tests: lógica pura de src/lib (sin Tauri ni navegador). `npm test`, y `npm run coverage` para la cobertura
  test: {
    include: ["tests/**/*.test.ts"],
    environment: "node",
    coverage: { provider: "v8", include: ["src/lib/**"], reporter: ["text-summary", "text"] },
  },

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