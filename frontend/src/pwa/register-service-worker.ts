// pwa/register-service-worker.ts — registro del Service Worker (public/sw.js) y recarga
// controlada cuando llega una versión nueva tras un deploy.
//
// Vive acá y no inline en main.ts porque tiene una regla sutil que hay que poder testear:
// CUÁNDO una activación es una ACTUALIZACIÓN y cuándo es la PRIMERA instalación.
//
// El bug que arregla (T-registro-ref): la condición para recargar era
// `sw.state === 'activated' && navigator.serviceWorker.controller`. La intención era "ya había
// un SW controlando, o sea esto es una versión nueva". Pero `sw.js` hace `clients.claim()` en su
// `activate`, y eso pone `navigator.serviceWorker.controller` en la PRIMERA instalación también.
// Resultado: todo visitante nuevo se comía un `location.reload()` a mitad de la primera carga.
// Justo la audiencia de un link de referido (`/registro?ref=`), que por definición entra por
// primera vez. La recarga aborta los chunks de la ruta que estaban en vuelo y deja la pantalla
// en blanco si alguno no llega a resolver.
//
// La corrección: mirar si había controller ANTES de registrar. Si no había, esta es la primera
// instalación y no hay nada viejo que reemplazar → no se recarga.

/** Una sola recarga por pestaña: si tras recargar sigue apareciendo un SW nuevo, no loopear. */
const RELOADED_FLAG = 'sw:reloaded'

export function registerServiceWorker(scriptUrl = '/sw.js'): Promise<void> {
  // Se lee ANTES de `register()`: en este punto `controller` solo puede venir de un SW instalado
  // en una visita anterior. Después de registrar ya no distingue (lo pisa `clients.claim()`).
  const hadController = !!navigator.serviceWorker.controller

  return navigator.serviceWorker.register(scriptUrl).then((reg) => {
    reg.addEventListener('updatefound', () => {
      const sw = reg.installing
      if (!sw) return
      sw.addEventListener('statechange', () => {
        if (sw.state !== 'activated') return
        // Primera instalación: la página ya está corriendo la última versión, recargar no aporta.
        if (!hadController) return
        if (sessionStorage.getItem(RELOADED_FLAG) === '1') return
        sessionStorage.setItem(RELOADED_FLAG, '1')
        window.location.reload()
      })
    })
  }).catch(() => { /* sin SW la app funciona igual, solo sin offline */ })
}
