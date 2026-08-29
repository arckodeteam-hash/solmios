// room-status.test.ts — Un solo criterio de "vendible" para TODO el camino de venta.
//
// El incidente que origina este archivo (producción, 2026-08-29): el motor publicaba una
// habitación en `cleaning` y la rechazaba al reservar, porque `availability.ts` usaba una lista
// negra y `public-booking.ts` una lista blanca. El huésped elegía fechas, cargaba sus datos,
// aceptaba condiciones y recibía "No hay habitaciones de este tipo disponibles para esas fechas"
// en el último click. `cleaning` es el estado más común que hay: toda habitación pasa por ahí
// entre un huésped y el siguiente.
import { describe, it, expect } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  isRoomSellable, isCleaning, isUnderMaintenance, ROOM_STATUSES, UNSELLABLE_ROOM_STATUS,
} from '../room-status'

describe('isRoomSellable', () => {
  // El corazón del bug: estos dos describen la habitación HOY, no una fecha futura.
  it.each(['cleaning', 'occupied', 'reserved', 'available'])('vende una habitación en "%s"', (s) => {
    expect(isRoomSellable(s)).toBe(true)
  })

  it.each(['out_of_order', 'out_of_service', 'maintenance'])('NO vende una habitación en "%s"', (s) => {
    expect(isRoomSellable(s)).toBe(false)
  })

  // La lista blanca que esto reemplaza aceptaba 'disponible': hay filas en castellano dando
  // vueltas. Con lista negra, el estado que falte se PONE EN VENTA — al revés que antes.
  it.each(['mantenimiento', 'fuera_de_servicio', 'fuera de servicio', 'averiada'])(
    'NO vende el equivalente en español "%s"', (s) => {
      expect(isRoomSellable(s)).toBe(false)
    })

  it('sigue vendiendo el "disponible" en español', () => {
    expect(isRoomSellable('disponible')).toBe(true)
  })

  it('no distingue mayúsculas (el dato viene de la base)', () => {
    expect(isRoomSellable('MAINTENANCE')).toBe(false)
    expect(isRoomSellable('Cleaning')).toBe(true)
  })

  // Default seguro para el ingreso: un dato incompleto no puede sacar inventario de la venta en
  // silencio. Lo grave es lo otro — que un endpoint publique y el otro rechace.
  it.each([null, undefined, ''])('un status ausente (%p) se considera vendible', (s) => {
    expect(isRoomSellable(s)).toBe(true)
  })

  it('cubre TODO el enum: ningún estado queda sin decidir', () => {
    for (const s of ROOM_STATUSES) expect(typeof isRoomSellable(s)).toBe('boolean')
  })
})

describe('contadores del panel', () => {
  // `dirty` y `out_of_service` no existen en el enum: los contadores del dashboard daban SIEMPRE
  // 0 y el panel mostraba el hotel sin limpieza ni mantenimiento pendiente.
  it('cuenta como limpieza el estado REAL del enum', () => {
    expect(isCleaning('cleaning')).toBe(true)
    expect(isCleaning('dirty')).toBe(true)      // valor legacy, se sigue tolerando
    expect(isCleaning('available')).toBe(false)
  })

  it('cuenta como mantenimiento los estados REALES del enum', () => {
    expect(isUnderMaintenance('maintenance')).toBe(true)
    expect(isUnderMaintenance('out_of_order')).toBe(true)
    expect(isUnderMaintenance('available')).toBe(false)
  })

  it('lo invendible y lo que el panel llama mantenimiento son lo mismo', () => {
    for (const s of UNSELLABLE_ROOM_STATUS) expect(isUnderMaintenance(s)).toBe(true)
  })
})

// Este bloque es el que impide que el bug vuelva: no comprueba comportamiento sino que NADIE
// del camino de venta se escriba su propio criterio. Es exactamente cómo divergieron.
describe('ningún archivo del camino de venta define su propio criterio', () => {
  const ROOT = join(import.meta.dir, '../../..')
  const FILES = [
    'modules/bookingengine/usecases/availability.ts',
    'modules/bookingengine/usecases/public-calendar.ts',
    'modules/bookingengine/usecases/public-booking.ts',
    'modules/bookingengine/usecases/public-booking-group.ts',
    'shared/usecases/public-api-availability.ts',
  ]

  it.each(FILES)('%s no filtra por status a mano', (rel) => {
    const src = readFileSync(join(ROOT, rel), 'utf-8')
    // Lista blanca escrita a mano (el criterio que rechazaba lo que el motor publicaba).
    expect(src).not.toMatch(/status\s*===\s*['"](available|disponible)['"]/)
    // Lista negra propia (la constante que estaba duplicada literal en dos archivos).
    expect(src).not.toMatch(/new Set\(\[\s*['"]out_of_order['"]/)
  })

  it.each(FILES)('%s usa la fuente única', (rel) => {
    expect(readFileSync(join(ROOT, rel), 'utf-8')).toContain('isRoomSellable')
  })
})
