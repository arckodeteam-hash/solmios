/**
 * #210 (REST-08) — la comanda deja de ser ciega después de "Enviar a cocina".
 *
 * Tres reglas que el mozo ve en pantalla y que se rompen en silencio si alguien toca el marcado:
 *   1. Badge de estado POR LÍNEA, con el color del KDS (`LINE_STATUS_BADGE`), y "Sin enviar" para lo
 *      que se cargó después del envío.
 *   2. Nota por línea → `updateLine({ notes })`, el mismo PUT que la cantidad.
 *   3. Re-envío parcial: el botón "Enviar N nueva(s)" existe solo si hay líneas sin confirmar, y el
 *      contador NO puede salir de `status === 'new'` a secas (una línea ya enviada sigue en 'new').
 *
 * Test sobre el FUENTE, mismo criterio que `carta-ui.test.ts` y `form-fields-a11y.test.ts`: montar
 * la página exige router, Pinia y ~5 services mockeados, y lo que se cuida acá es declarativo. La
 * lógica del contador sí se ejecuta de verdad (abajo), replicada desde el mismo predicado.
 */
import { describe, it, expect } from 'vitest'
import { LINE_STATUS_BADGE, LINE_STATUS_LABELS, type OrderLine } from '@/services/Restaurant.service'

const RAW_PAGES = import.meta.glob('./*.vue', {
  query: '?raw',
  import: 'default',
  eager: true,
}) as Record<string, string>

function comanda(): string {
  const src = RAW_PAGES['./comanda.vue']
  expect(src, 'no se pudo leer el fuente de comanda.vue').toBeTypeOf('string')
  return src
}
function templateOf(src: string): string {
  const m = src.match(/<template>([\s\S]*)<\/template>/)
  expect(m, 'comanda.vue: no se encontró el bloque <template>').not.toBeNull()
  return m![1]
}

describe('#210 — badge de estado de cocina por línea', () => {
  it('el ticket pinta un badge por línea usando el mapa compartido con el KDS', () => {
    const tpl = templateOf(comanda())
    expect(tpl, 'la línea del ticket no muestra el badge de estado').toMatch(/lineBadges\.get\(l\.id\)/)
    expect(comanda(), 'el color del badge debe salir de LINE_STATUS_BADGE (misma paleta que el KDS)')
      .toMatch(/LINE_STATUS_BADGE/)
  })

  it('el estado del combo se deriva de sus componentes y se rotula con las etiquetas compartidas', () => {
    const src = comanda()
    expect(src).toMatch(/function comboAggregateStatus\(headerId: string\): LineStatus \| ''/)
    expect(src, 'el badge no debe hardcodear textos: sale de LINE_STATUS_LABELS').toMatch(/LINE_STATUS_LABELS\[status\]/)
  })

  it('LINE_STATUS_BADGE cubre los cinco estados de línea', () => {
    for (const status of Object.keys(LINE_STATUS_LABELS)) {
      expect(LINE_STATUS_BADGE[status], `falta el color de la línea "${status}"`).toBeTypeOf('string')
    }
  })
})

describe('#210 — nota por línea', () => {
  it('cada línea ofrece agregar/editar la nota y la nota guardada se muestra', () => {
    const tpl = templateOf(comanda())
    expect(tpl, 'no hay control para cargar la nota de la línea').toMatch(/@click="openNotes\(l\)"/)
    expect(tpl, 'la nota guardada no se ve en el ticket').toMatch(/l\.notes/)
  })

  it('la nota se persiste con el MISMO PUT que la cantidad (updateLine con notes)', () => {
    const src = comanda()
    expect(src).toMatch(/RestaurantService\.updateLine\(orderId\.value, line\.id, \{ notes: notesDraft\.value\.trim\(\) \}\)/)
  })

  it('el header de un combo NO ofrece nota: el KDS no lo ve y sus componentes rechazan el PUT', () => {
    const src = comanda()
    const btn = (templateOf(src).match(/<button[^>]*openNotes\(l\)[^>]*>/g) ?? [])[0]
    expect(btn, 'no se encontró el botón de nota').toBeDefined()
    expect(btn, 'el botón de nota se muestra sobre el header de un combo').toMatch(/l\.kind !== 'combo_header'/)
    expect(src, 'el guard del handler también tiene que excluir el header').toMatch(/l\.kind === 'combo_header'\) return/)
  })

  it('el input de la nota tiene id y su label lo apunta (a11y)', () => {
    const tpl = templateOf(comanda())
    expect(tpl).toMatch(/<label for="linea-nota"/)
    expect(tpl).toMatch(/id="linea-nota"/)
  })
})

describe('#210 — re-envío parcial de las líneas agregadas después', () => {
  it('el botón "Enviar N nueva(s)" existe y depende de canResend', () => {
    const tpl = templateOf(comanda())
    expect(tpl).toMatch(/v-if="canResend"/)
    expect(tpl).toMatch(/Enviar \{\{ unsentCount \}\} nueva\(s\) a cocina/)
  })

  it('el contador de pendientes mira sentAt, no solo el status (una línea enviada sigue en "new")', () => {
    const src = comanda()
    const decl = src.match(/const unsentCount = computed\([^\n]*\n?[^\n]*/)?.[0] ?? ''
    expect(decl, 'no se encontró unsentCount').not.toBe('')
    expect(decl, 'sin `!l.sentAt` el botón no desaparece nunca: toda línea sin tocar por cocina es "new"')
      .toMatch(/!l\.sentAt/)
  })

  it('el re-envío solo se ofrece con la comanda en fase de cocina y permiso de edición', () => {
    const src = comanda()
    const decl = src.match(/const canResend = computed\([\s\S]*?\n/)?.[0] ?? ''
    expect(decl).toMatch(/editPerm\.value/)
    expect(decl).toMatch(/inKitchen\.value/)
    expect(decl).toMatch(/unsentCount\.value > 0/)
  })

  // El predicado de `unsentCount`, ejecutado de verdad sobre las cuatro combinaciones que importan.
  it('predicado: cuenta solo lo cargado y no confirmado', () => {
    const pending = (l: Pick<OrderLine, 'status' | 'sentAt'>) => l.status === 'new' && !l.sentAt
    expect(pending({ status: 'new' })).toBe(true)                                       // recién cargada
    expect(pending({ status: 'new', sentAt: '2026-09-11T10:00:00.000Z' })).toBe(false)  // ya despachada
    expect(pending({ status: 'preparing' })).toBe(false)                                // cocina la tomó
    expect(pending({ status: 'cancelled' })).toBe(false)
  })
})

describe('#210 — refresco automático y bloqueo acotado', () => {
  it('refresca cada 15 s solo mientras la comanda está en cocina', () => {
    const src = comanda()
    expect(src).toMatch(/const REFRESH_MS = 15000/)
    expect(src).toMatch(/const KITCHEN_STATES = \['sent', 'preparing', 'ready', 'served'\]/)
    expect(src, 'el intervalo debe apagarse al desmontar la vista').toMatch(/onUnmounted\(stopPolling\)/)
  })

  it('ya no hay un `busy` global: el bloqueo al agregar es por ítem (300 ms)', () => {
    const src = comanda()
    expect(src, 'volvió el candado global que apagaba toda la carta').not.toMatch(/\bconst busy = ref\(/)
    expect(src).toMatch(/const ADD_COOLDOWN_MS = 300/)
    expect(templateOf(src), 'el botón del ítem debe deshabilitarse solo a sí mismo').toMatch(/:disabled="cooling\.has\(i\.id\)/)
  })

  it('los toques se encolan en vez de descartarse (tocar 5 ítems agrega 5)', () => {
    const src = comanda()
    expect(src).toMatch(/addChain = addChain/)
    expect(src, 'el early-return por `busy` perdía el toque siguiente').not.toMatch(/if \(busy\.value\) return/)
  })
})

describe('#210 — accesibilidad del selector de modificadores', () => {
  it('el radio de un grupo `single` tiene nombre accesible, igual que el checkbox', () => {
    const tpl = templateOf(comanda())
    const radio = (tpl.match(/<input[^>]*type="radio"[^>]*>/g) ?? [])[0]
    expect(radio, 'no se encontró el radio de modificadores').toBeDefined()
    expect(radio, 'un radio sin aria-label se anuncia como "radio button" a secas').toMatch(/:aria-label="m\.name"/)
    expect(radio).toMatch(/:id="`modificador-\$\{g\.id\}-\$\{m\.id\}`"/)
  })
})

describe('#210 — comensales', () => {
  it('la comanda muestra los comensales cuando los tiene', () => {
    expect(templateOf(comanda())).toMatch(/order\.covers/)
  })

  it('el salón los pide al abrir la comanda de una mesa y los manda en openOrder', () => {
    const salon = RAW_PAGES['./salon.vue']
    expect(salon, 'no se pudo leer el fuente de salon.vue').toBeTypeOf('string')
    expect(salon).toMatch(/RestaurantService\.openOrder\(\{ type: 'dine_in', tableId: t\.id, covers \}\)/)
    expect(salon, 'el campo de comensales necesita id para el label').toMatch(/id="mesa-comensales"/)
  })
})

describe('#216 — imprimir precuenta y comanda de cocina desde la comanda', () => {
  it('los dos botones existen, abren la pestaña con openPrintTab y la comanda de cocina solo se ofrece con líneas ya enviadas', () => {
    const src = comanda()
    const tpl = templateOf(src)
    expect(tpl).toMatch(/data-testid="print-precuenta"[^>]*/)
    expect(tpl).toMatch(/data-testid="print-kitchen"/)
    expect(tpl).toMatch(/@click="print\('precuenta'\)"/)
    expect(tpl).toMatch(/@click="print\('kitchen'\)"/)
    expect(src).toMatch(/import \{ openPrintTab \} from '\.\/imprimir'/)
    expect(src).toMatch(/openPrintTab\(orderId\.value, doc\)/)
    // La cocina imprime lo confirmado (`sentAt`): sin envío no hay comanda de cocina que imprimir.
    expect(src).toMatch(/canPrintKitchen = computed\(\(\) => [^\n]*order\.value\.status !== 'open'[^\n]*\.some\(\(l\) => !!l\.sentAt\)/)
    // Nada de fetch() ni de <a href> a la API: se pasa por el servicio.
    expect(src).not.toMatch(/fetch\(/)
    expect(tpl).not.toMatch(/href="\/api/)
  })
})
