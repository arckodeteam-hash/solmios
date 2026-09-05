// canales/tests/room-events.test.ts — Qué llega al channel manager cuando cambian las habitaciones.
//
// El caso que motivó estos tests: el hotel carga una habitación de un tipo que YA está publicado y
// la OTA sigue vendiendo el número viejo. `autoProvision` solo reacciona a TIPOS nuevos, así que
// devolvía `already-synced` y no pasaba nada más. Medido en producción el 2026-09-04: 3 suites → 4
// en el PMS, `count_of_rooms` y disponibilidad quietos en 3 hasta apretar "Forzar Sync" a mano.
import { describe, it, expect } from 'bun:test'
import { onRoomCreated, onRoomUpdated, onRoomDeleted, type RoomEventDeps } from '../usecases/room-events'

function makeDeps(over: { provisionOutcome?: unknown; failing?: 'provision' | 'inventory' | 'rates' } = {}) {
  const calls = { autoProvision: [] as string[], syncInventory: [] as string[], pushSeasonalRates: [] as string[] }
  const errors: Array<{ hotelId: string; accion: string }> = []
  const deps: RoomEventDeps = {
    autoProvision: async (hotelId) => {
      calls.autoProvision.push(hotelId)
      if (over.failing === 'provision') throw new Error('channex caído')
      return over.provisionOutcome ?? 'already-synced'
    },
    syncInventory: async (hotelId) => {
      calls.syncInventory.push(hotelId)
      if (over.failing === 'inventory') throw new Error('channex caído')
    },
    pushSeasonalRates: async (hotelId) => {
      calls.pushSeasonalRates.push(hotelId)
      if (over.failing === 'rates') throw new Error('channex caído')
    },
    onError: (hotelId, accion) => { errors.push({ hotelId, accion }) },
  }
  return { deps, calls, errors }
}

/** Los caminos son fire-and-forget: hay que soltar el microtask queue para ver el efecto. */
const settle = () => new Promise<void>((r) => setTimeout(r, 0))

describe('onRoomCreated', () => {
  it('tipo ya publicado (already-synced) → republica el inventario: la habitación nueva se vende', async () => {
    const { deps, calls } = makeDeps({ provisionOutcome: 'already-synced' })
    onRoomCreated(deps, 'h1')
    await settle()
    expect(calls.autoProvision).toEqual(['h1'])
    expect(calls.syncInventory).toEqual(['h1'])
  })

  it('alta del hotel (provisioned) → NO re-sincroniza: el sync ya lo hizo el propio alta', async () => {
    const { deps, calls } = makeDeps({ provisionOutcome: 'provisioned' })
    onRoomCreated(deps, 'h1')
    await settle()
    expect(calls.syncInventory).toEqual([])
  })

  it('tipo nuevo (restructured) → tampoco: el re-sync ya corrió adentro', async () => {
    const { deps, calls } = makeDeps({ provisionOutcome: 'restructured' })
    onRoomCreated(deps, 'h1')
    await settle()
    expect(calls.syncInventory).toEqual([])
  })

  it('hotel sin channel manager en el plan (module-disabled) → no se toca Channex', async () => {
    const { deps, calls } = makeDeps({ provisionOutcome: 'module-disabled' })
    onRoomCreated(deps, 'h1')
    await settle()
    expect(calls.syncInventory).toEqual([])
  })

  it('si Channex falla, el alta de la habitación NO se rompe: se loguea', async () => {
    const { deps, errors } = makeDeps({ failing: 'provision' })
    expect(() => onRoomCreated(deps, 'h1')).not.toThrow()
    await settle()
    expect(errors).toEqual([{ hotelId: 'h1', accion: 'alta automática' }])
  })

  it('un fallo al republicar el inventario tampoco rompe el alta', async () => {
    const { deps, errors } = makeDeps({ failing: 'inventory' })
    onRoomCreated(deps, 'h1')
    await settle()
    expect(errors[0]?.accion).toBe('alta automática')
  })
})

describe('onRoomDeleted', () => {
  it('baja → republica el inventario: la OTA deja de vender una habitación que ya no existe', async () => {
    const { deps, calls } = makeDeps()
    onRoomDeleted(deps, 'h1')
    await settle()
    expect(calls.syncInventory).toEqual(['h1'])
    expect(calls.autoProvision).toEqual([])   // no es un alta: no hay que provisionar nada
  })

  it('si Channex falla, la baja NO se rompe', async () => {
    const { deps, errors } = makeDeps({ failing: 'inventory' })
    expect(() => onRoomDeleted(deps, 'h1')).not.toThrow()
    await settle()
    expect(errors).toEqual([{ hotelId: 'h1', accion: 'baja de habitación' }])
  })
})

describe('onRoomUpdated', () => {
  it('edición → push de tarifas (el precio base sale de la habitación), sin tocar el inventario', async () => {
    const { deps, calls } = makeDeps()
    onRoomUpdated(deps, 'h1')
    await settle()
    expect(calls.pushSeasonalRates).toEqual(['h1'])
    expect(calls.syncInventory).toEqual([])
  })

  it('si el push falla, la edición NO se rompe', async () => {
    const { deps, errors } = makeDeps({ failing: 'rates' })
    onRoomUpdated(deps, 'h1')
    await settle()
    expect(errors).toEqual([{ hotelId: 'h1', accion: 'push de tarifas' }])
  })
})
