// ticket-form-values.test.ts — Los desplegables del ticket tienen que mandar lo que el backend acepta.
//
// El formulario del hotel ofrecía `value="Técnico"` y `value="Baja"` contra un backend que valida
// `technical|billing|…` y `low|medium|high|urgent`. Los dos campos son obligatorios, así que
// **ningún hotel podía abrir un ticket de soporte**: el POST moría en 400 y la pantalla mostraba
// "Error al crear ticket", sin decir qué. Era el mismo desajuste que el epic #120 arregló en
// /admin/support ("mapea abierto/alta pero el backend guarda open/high") y que del lado del hotel
// había quedado vivo.
//
// El test lee el .vue y compara contra la lista canónica, que es la única forma de que esto no
// vuelva a divergir en silencio: un `<option>` mal tipeado no lo atrapa ni el typecheck ni un test
// de componente que no envíe el formulario.
import { describe, it, expect } from 'vitest'

/** Espejo de `backend/src/modules/tickets/types.ts`. */
const CATEGORIAS = ['technical', 'billing', 'reservation', 'housekeeping', 'maintenance', 'general']
const PRIORIDADES = ['low', 'medium', 'high', 'urgent']

// Test sobre el FUENTE, mismo criterio que `form-fields-a11y.test.ts` y `restaurante/carta-ui.test.ts`:
// el defecto es declarativo (un `value` de `<option>`), y montar la página exige router, Pinia y
// varios services mockeados para terminar comprobando una cadena de texto.
const RAW = import.meta.glob('./*.vue', { query: '?raw', import: 'default', eager: true }) as Record<string, string>
const vue = RAW['./index.vue']!

/** Los `<option value>` del `<select>` cuyo id se pasa. */
function opciones(selectId: string): string[] {
  const bloque = vue.split(`id="${selectId}"`)[1]?.split('</select>')[0] ?? ''
  return [...bloque.matchAll(/<option value="([^"]*)"/g)].map((m) => m[1]!).filter(Boolean)
}

describe('formulario de ticket del hotel — valores que viajan al backend', () => {
  it('las categorías son las que el backend valida, no el texto en español', () => {
    const vals = opciones('support-categoria')
    expect(vals.length).toBeGreaterThan(0)
    for (const v of vals) expect(CATEGORIAS, `categoría "${v}" no existe en el backend`).toContain(v)
  })

  it('las prioridades son las que el backend valida', () => {
    const vals = opciones('support-prioridad')
    expect(vals.length).toBeGreaterThan(0)
    for (const v of vals) expect(PRIORIDADES, `prioridad "${v}" no existe en el backend`).toContain(v)
  })

  it('ofrece las cuatro prioridades, sin inventar una quinta', () => {
    expect(opciones('support-prioridad').sort()).toEqual([...PRIORIDADES].sort())
  })

  it('el valor por defecto de prioridad existe entre las opciones', () => {
    // Si no, el campo se ve VACÍO aunque sea obligatorio: fue exactamente lo que pasaba con
    // `priority: 'medium'` y opciones "Baja"/"Normal"/"Alta"/"Urgente".
    const porDefecto = vue.match(/priority:\s*'([a-z]+)'/)?.[1]
    expect(porDefecto).toBeTruthy()
    expect(opciones('support-prioridad')).toContain(porDefecto!)
  })

  it('ninguna opción quedó con el texto en español como value', () => {
    const sospechosos = [...vue.matchAll(/<option value="([^"]*)"/g)]
      .map((m) => m[1]!)
      .filter((v) => /[ÁÉÍÓÚáéíóúñÑ]|^[A-ZÁ]/.test(v))
    expect(sospechosos, `values con texto humano: ${sospechosos.join(', ')}`).toEqual([])
  })
})
