// El menú del planning se salía de la pantalla en las filas de abajo y tapaba el tramo que
// acababas de marcar. Estos casos son ese bug, escrito como prueba.
import { describe, it, expect } from 'vitest'
import { placePopover, type Rect, type Viewport } from './popover-position'

const VP: Viewport = { width: 1440, height: 900 }
const MENU = { width: 264, height: 300 }
/** Una celda del planning: 68px de ancho, 48 de alto. */
const celda = (left: number, top: number, width = 68): Rect => ({ left, top, width, height: 48 })

describe('placePopover', () => {
  it('lo pone al lado del ancla, nunca encima', () => {
    const p = placePopover({ anchor: celda(400, 300), size: MENU, viewport: VP })
    expect(p.side).toBe('right')
    expect(p.left).toBeGreaterThanOrEqual(400 + 68)   // arranca después de la celda
    expect(p.top).toBe(300)
  })

  it('cerca del borde derecho se voltea a la izquierda', () => {
    const p = placePopover({ anchor: celda(1340, 300), size: MENU, viewport: VP })
    expect(p.side).toBe('left')
    expect(p.left + MENU.width).toBeLessThanOrEqual(1340)   // termina antes de la celda
    expect(p.left).toBeGreaterThanOrEqual(8)
  })

  it('en la última fila NO se sale por abajo', () => {
    const p = placePopover({ anchor: celda(400, 860), size: MENU, viewport: VP })
    expect(p.top + MENU.height).toBeLessThanOrEqual(VP.height - 8)
    expect(p.top).toBeGreaterThanOrEqual(8)
  })

  it('en la primera fila NO se sale por arriba', () => {
    const p = placePopover({ anchor: celda(400, 4), size: MENU, viewport: VP })
    expect(p.top).toBeGreaterThanOrEqual(8)
  })

  it('pantalla angosta: si no entra a ningún lado, va debajo', () => {
    const p = placePopover({ anchor: celda(120, 200), size: MENU, viewport: { width: 390, height: 800 } })
    expect(p.side).toBe('below')
    expect(p.top).toBeGreaterThanOrEqual(200 + 48)
    expect(p.left).toBeGreaterThanOrEqual(8)
    expect(p.left + MENU.width).toBeLessThanOrEqual(390 - 8)
  })

  it('pantalla angosta y ancla abajo de todo: va arriba del ancla', () => {
    const p = placePopover({ anchor: celda(120, 700), size: MENU, viewport: { width: 390, height: 800 } })
    expect(p.side).toBe('above')
    expect(p.top + MENU.height).toBeLessThanOrEqual(700)
  })

  it('un tramo de varias noches ancla contra su borde derecho, no contra el izquierdo', () => {
    const tramo = celda(400, 300, 68 * 5)   // 5 noches seleccionadas
    const p = placePopover({ anchor: tramo, size: MENU, viewport: VP })
    expect(p.left).toBeGreaterThanOrEqual(400 + 68 * 5)   // no tapa ninguna de las 5 celdas
  })

  it('sin ancla medible cae al centro, no a 0,0', () => {
    const p = placePopover({ anchor: null, size: MENU, viewport: VP })
    expect(p.left).toBeCloseTo((1440 - 264) / 2)
    expect(p.top).toBeCloseTo((900 - 300) / 2)
  })

  it('un menú más alto que la pantalla se pega arriba (no queda con el encabezado cortado)', () => {
    const p = placePopover({ anchor: celda(400, 300), size: { width: 264, height: 2000 }, viewport: VP })
    expect(p.top).toBe(8)
  })

  it('respeta un margen distinto', () => {
    const p = placePopover({ anchor: celda(400, 880), size: MENU, viewport: VP, margin: 24 })
    expect(p.top + MENU.height).toBeLessThanOrEqual(VP.height - 24)
  })
})
