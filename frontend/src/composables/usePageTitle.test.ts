// usePageTitle.test.ts — El título de cada página del panel.
//
// El bug: `moduleLabelForPath` recorría los segmentos de atrás hacia adelante y devolvía el
// primero que estuviera en el diccionario. Como `panel` está mapeado a 'Inicio', toda ruta cuyo
// último segmento faltara se anunciaba como "Inicio" — 27 de las 117 páginas del panel — y las
// que colgaban de un padre mapeado heredaban el nombre del padre (/panel/pagina-publica/media
// decía "Página pública"). Afecta al <h1>, a la pestaña del navegador y a los lectores de pantalla.
import { describe, it, expect } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'

import { ref, nextTick } from 'vue'
import { moduleLabelForPath, capitalizeSegment, ROUTE_LABELS, PAGE_TITLES, useDocumentTitle } from './usePageTitle'
import router from '@/router'

setActivePinia(createPinia())

/** Rutas reales del panel, sin params ni catch-all: lo que un usuario puede tener en pantalla. */
const PANEL_ROUTES = router.getRoutes()
  .map(r => r.path)
  .filter(p => p.startsWith('/panel/') && !p.includes(':') && !p.includes('*'))

describe('moduleLabelForPath — cada página dice dónde estás', () => {
  it('hay rutas de panel para auditar (si esto falla, el filtro quedó mal)', () => {
    expect(PANEL_ROUTES.length).toBeGreaterThan(50)
  })

  it('NINGUNA página del panel se anuncia como "Inicio"', () => {
    // El bug original, tal cual lo reportaron: "varias dicen Inicio estando en otros lados".
    const wrong = PANEL_ROUTES.filter(p => moduleLabelForPath(p) === 'Inicio')
    expect(wrong, `rutas que dicen "Inicio": ${wrong.join(', ')}`).toEqual([])
  })

  it('TODAS tienen un título curado (ni derivado ni heredado del padre)', () => {
    // Este es el guardián: una ruta nueva sin entrada en el diccionario hace fallar el test
    // en vez de aparecer en producción con el nombre de otra sección.
    const missing = PANEL_ROUTES.filter(p => {
      const last = p.split('/').filter(Boolean).pop()!
      return !PAGE_TITLES[p] && !ROUTE_LABELS[last]
    })
    expect(missing, `sin label: ${missing.join(', ')}`).toEqual([])
  })

  it('nunca hereda el título de un ancestro', () => {
    // /panel/pagina-publica/media es "Media", no "Página pública".
    expect(moduleLabelForPath('/panel/pagina-publica/media')).toBe('Media')
    expect(moduleLabelForPath('/panel/pagina-publica/reputacion')).toBe('Reputación')
    expect(moduleLabelForPath('/panel/config/auditoria')).toBe('Auditoría')
  })

  it('el path exacto gana cuando el mismo segmento significa cosas distintas', () => {
    // `dashboard` y `config` cuelgan de varios padres con nombres propios en el menú.
    expect(moduleLabelForPath('/panel/dashboard')).toBe('Dashboard')
    expect(moduleLabelForPath('/panel/tesoreria/dashboard')).toBe('Liquidez')
    expect(moduleLabelForPath('/panel/rrhh/dashboard')).toBe('Panel RRHH')
    expect(moduleLabelForPath('/panel/config')).toBe('Configuración Base')
    expect(moduleLabelForPath('/panel/ia/recepcionista/config')).toBe('Configuración IA')
    expect(moduleLabelForPath('/panel/operaciones/proveedores')).toBe('Proveedores de servicios')
    expect(moduleLabelForPath('/panel/tesoreria/proveedores')).toBe('Proveedores')
  })

  it('un :param no es el nombre de la página: usa el segmento anterior', () => {
    expect(moduleLabelForPath('/panel/reservas/abc-123', { id: 'abc-123' })).toBe('Reservas')
  })

  it('una ruta desconocida deriva del propio segmento, no de un ancestro', () => {
    // Imperfecto pero honesto: nombra el lugar donde estás.
    expect(moduleLabelForPath('/panel/modulo-nuevo')).toBe('Modulo nuevo')
    expect(moduleLabelForPath('/panel/x/sub-seccion')).toBe('Sub seccion')
  })

  it('/panel a secas sí es "Inicio"', () => {
    expect(moduleLabelForPath('/panel')).toBe('Inicio')
  })

  it('ningún título queda vacío', () => {
    for (const p of PANEL_ROUTES) expect(moduleLabelForPath(p).length, p).toBeGreaterThan(0)
  })
})

describe('capitalizeSegment', () => {
  it('convierte el slug en algo legible', () => {
    expect(capitalizeSegment('caja-chica')).toBe('Caja chica')
    expect(capitalizeSegment('libro-diario')).toBe('Libro diario')
    expect(capitalizeSegment('crm')).toBe('Crm')
  })
})

describe('useDocumentTitle — la pestaña sigue al layout', () => {
  // SuperAdminLayout resolvía bien su <h1> pero nunca tocaba `document.title`: navegando por
  // /admin el navegador seguía mostrando el título de la pantalla anterior.
  it('escribe el título apenas se usa, sin esperar un cambio', () => {
    const label = ref('Gestión de Hoteles')
    useDocumentTitle(label)
    expect(document.title).toBe('Gestión de Hoteles — SolmiOS')
  })

  it('sigue los cambios del label al navegar', async () => {
    const label = ref('Suscripciones')
    useDocumentTitle(label)
    label.value = 'Monitoreo del Sistema'
    await nextTick()
    expect(document.title).toBe('Monitoreo del Sistema — SolmiOS')
  })

  it('usa el mismo sufijo de marca que el resto de la app', () => {
    const label = ref('X')
    useDocumentTitle(label)
    expect(document.title.endsWith(' — SolmiOS')).toBe(true)
  })
})
