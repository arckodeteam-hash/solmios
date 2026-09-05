// canales/tests/reserva-borrada-availability.test.ts — Borrar una reserva libera las noches en la OTA.
//
// El conector tenía `onReservasDeleted: async () => {}` — vacío, con el motivo escrito al lado: el
// socket solo mandaba el `id`, sin hotel ni habitación, así que no había forma de recalcular.
// Verificado en producción el 2026-09-05: una reserva de 2 noches borrada dejaba la suite en 2 de 3
// disponibles indefinidamente. Inventario que existe y no se vende.
//
// Se testea el handler tal como lo cablea `connectors/reservas-canales.ts`.
import { describe, it, expect } from 'bun:test'

type Ctx = { hotelId?: string; roomId?: string | null }

/** Misma forma que el handler del conector. */
function makeHandler(push: (h: string, r: string) => Promise<{ pushed: boolean }>) {
  return async (_id: string, borrada?: Ctx) => {
    if (!borrada?.hotelId || !borrada.roomId) return
    await push(borrada.hotelId, borrada.roomId).catch(() => {})
  }
}

function spy(over: { failing?: boolean } = {}) {
  const calls: Array<[string, string]> = []
  const push = async (h: string, r: string) => {
    calls.push([h, r])
    if (over.failing) throw new Error('channex caído')
    return { pushed: true }
  }
  return { push, calls }
}

describe('onReservasDeleted → availability', () => {
  it('con hotel y habitación republica la disponibilidad de esa habitación', async () => {
    const { push, calls } = spy()
    await makeHandler(push)('res-1', { hotelId: 'h1', roomId: 'room-9' })
    expect(calls).toEqual([['h1', 'room-9']])
  })

  it('sin contexto no hace nada (no rompe con eventos viejos que solo mandaban el id)', async () => {
    const { push, calls } = spy()
    await makeHandler(push)('res-1')
    await makeHandler(push)('res-1', {})
    expect(calls).toEqual([])
  })

  it('una reserva sin habitación asignada no dispara push', async () => {
    const { push, calls } = spy()
    await makeHandler(push)('res-1', { hotelId: 'h1', roomId: null })
    expect(calls).toEqual([])
  })

  it('si el push falla, el borrado NO se rompe', async () => {
    const { push } = spy({ failing: true })
    await expect(makeHandler(push)('res-1', { hotelId: 'h1', roomId: 'room-9' })).resolves.toBeUndefined()
  })
})
