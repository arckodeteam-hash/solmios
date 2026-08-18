import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import tailwindcss from '@tailwindcss/vite'
import { resolve } from 'path'

// Plugin: endpoint /__alive que SOLO responde cuando Vite está corriendo.
// El monitor en index.html lo usa para detectar si el servidor vuelve después de un restart.
function alivePlugin() {
  return {
    name: 'alive-endpoint',
    configureServer(server: any) {
      server.middlewares.use('/__alive', (_req: any, res: any) => {
        res.writeHead(200, { 'Content-Type': 'text/plain' })
        res.end('ok')
      })
    },
  }
}

export default defineConfig({
  plugins: [vue(), tailwindcss(), alivePlugin()],
  resolve: {
    alias: {
      '@': resolve(__dirname, 'src'),
    },
  },
  build: {
    // Sube el umbral de warning para reducir ruido: con el vendor ya troceado
    // ningún chunk debería acercarse a este límite.
    chunkSizeWarningLimit: 900,
    rollupOptions: {
      output: {
        // Separa las librerías pesadas de node_modules en chunks propios para que
        // el chunk principal no las arrastre y se carguen solo cuando la ruta las use.
        manualChunks(id: string) {
          if (id.includes('node_modules')) {
            if (id.includes('@fullcalendar')) return 'vendor-calendar'
            if (id.includes('leaflet')) return 'vendor-map'
            if (id.includes('@vueup/vue-quill') || id.includes('quill')) return 'vendor-editor'
            if (id.includes('html2canvas') || id.includes('qrcode')) return 'vendor-export'
            if (id.includes('simple-icons')) return 'vendor-icons'
            // OCR del pre-checkin público (escaneo de documento): chunk propio, sin mezclar con el
            // 'vendor' genérico que cargan casi todas las páginas. Solo se pide con
            // `await import('tesseract.js')` cuando el huésped elige escanear.
            if (id.includes('/tesseract')) return 'vendor-ocr'
            if (
              id.includes('/vue/') ||
              id.includes('/vue-router/') ||
              id.includes('/pinia/') ||
              id.includes('/@vue/')
            )
              return 'vendor-vue'
            return 'vendor'
          }
        },
      },
    },
  },
  server: {
    host: true,
    port: 5173,
    proxy: {
      '/api': {
        target: 'http://localhost:3001',
        changeOrigin: true,
        secure: false,
        ws: true,
      },
      // Evidencia fotográfica de housekeeping y otros archivos estáticos servidos por el backend.
      // Mismo puerto que /api (PORT del .env del backend) — apuntaba a 3000 y las fotos no cargaban en dev.
      '/uploads': {
        target: 'http://localhost:3001',
        changeOrigin: true,
        secure: false,
      },
    },
    hmr: {
      protocol: 'ws',
      host: 'localhost',
      port: 5173,
    },
  },
})
