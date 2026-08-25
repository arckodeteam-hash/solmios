import { createApp } from 'vue'
import { createPinia } from 'pinia'
import router from './router'
import App from './App.vue'
import { registerServiceWorker } from './pwa/register-service-worker'
import './styles/main.css'

// Chunk lazy obsoleto tras un deploy pero fuera del router (componente lazy dentro de una vista):
// Vite emite `vite:preloadError` cuando un modulepreload de un chunk publicado en un build anterior
// ya no existe. Recargamos una sola vez (flag en sessionStorage) para traer los assets nuevos y
// evitar un loop si el chunk falla por una causa real. El caso de rutas lo maneja `router.onError`.
window.addEventListener('vite:preloadError', () => {
  const RELOAD_FLAG = 'vite:preload-reload'
  if (sessionStorage.getItem(RELOAD_FLAG) === '1') return
  sessionStorage.setItem(RELOAD_FLAG, '1')
  window.location.reload()
})
window.addEventListener('load', () => sessionStorage.removeItem('vite:preload-reload'))

const app = createApp(App)
app.use(createPinia())
app.use(router)
app.mount('#app')

// Service Worker (PWA offline). #370. Se registra en producción; en dev estorba (HMR).
// El SW (public/sw.js) hace bypass total de /api/* y navegación network-first: el logout y los
// datos nunca se cachean. La lógica de registro —y la regla de cuándo recargar por una versión
// nueva sin recargar al visitante que entra por primera vez— vive en pwa/register-service-worker.
if ('serviceWorker' in navigator && import.meta.env.PROD) {
  window.addEventListener('load', () => { void registerServiceWorker() })
}
