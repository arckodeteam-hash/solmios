// CONFIG TEMPORAL de QA (auditoría /panel/config) — NO commitear.
// Igual que vite.config.ts pero puerto 5174 y proxy a mi backend aislado :3002.
import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import tailwindcss from '@tailwindcss/vite'
import { resolve } from 'path'

export default defineConfig({
  plugins: [vue(), tailwindcss()],
  resolve: { alias: { '@': resolve(__dirname, 'src') } },
  server: {
    host: true,
    port: 5174,
    strictPort: true,
    proxy: {
      '/api': { target: 'http://localhost:3002', changeOrigin: true, secure: false, ws: true },
      '/uploads': { target: 'http://localhost:3002', changeOrigin: true, secure: false },
    },
    hmr: { protocol: 'ws', host: 'localhost', port: 5174 },
  },
})
