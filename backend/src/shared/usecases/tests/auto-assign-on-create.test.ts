// shared/usecases/tests/auto-assign-on-create.test.ts — recorrido "una unidad por fila, nunca tirar" que
// comparten reservas-bookingengine (widget/grupo) y canales-reservas (OTA). Corrección 2026-09-13 a REQ-HAC-05.
import { describe, it, expect } from 'bun:test'
import { autoAssignOnCreate, reservationIdsOf } from '../auto-assign-on-create'

function port(script: Record<string, any>) {
  const calls: Array<[string, string]> = []
  return {
    calls,
    reservas: {
      autoAssignRoom: async (id: string, hotelId: string) => {
        calls.push([id, hotelId])
        const out = script[id]
        if (out instanceof Error) throw out
        return out ?? { assigned: true, roomId: `room-${id}`, roomNumber: id }
      },
    },
  }
}
const silent = { warn: () => {} }

describe('autoAssignOnCreate', () => {
  it('pide una unidad por cada id, en orden, con el hotel del evento', async () => {
    const p = port({})
    const out = await autoAssignOnCreate(p.reservas, 'h1', ['r1', 'r2', 'r3'], silent, 'test')
    expect(p.calls).toEqual([['r1', 'h1'], ['r2', 'h1'], ['r3', 'h1']])
    expect(out).toEqual({ assigned: ['r1', 'r2', 'r3'], unassigned: {} })
  })

  it('already_assigned cuenta como asignada; no_rooms/no_fit y errores quedan en unassigned con su motivo, y sigue con las demás', async () => {
    const warned: string[] = []
    const p = port({ r1: { assigned: false, reason: 'already_assigned' }, r2: { assigned: false, reason: 'no_fit' }, r3: new Error('boom') })
    const out = await autoAssignOnCreate(p.reservas, 'h1', ['r1', 'r2', 'r3', 'r4'], { warn: (m) => warned.push(m) }, 'origen')
    expect(out.assigned).toEqual(['r1', 'r4'])
    expect(out.unassigned).toEqual({ r2: 'no_fit', r3: 'boom' })
    expect(warned).toHaveLength(2)
    expect(warned[0]).toContain('[origen]')
  })

  it('sin puerto, sin hotel o sin ids → no llama a nadie', async () => {
    const p = port({})
    expect(await autoAssignOnCreate(null, 'h1', ['r1'], silent, 't')).toEqual({ assigned: [], unassigned: {} })
    expect(await autoAssignOnCreate(p.reservas, '', ['r1'], silent, 't')).toEqual({ assigned: [], unassigned: {} })
    expect(await autoAssignOnCreate(p.reservas, 'h1', [undefined, '', null], silent, 't')).toEqual({ assigned: [], unassigned: {} })
    expect(p.calls).toEqual([])
  })
})

describe('reservationIdsOf', () => {
  it('grupo: todas las filas; sin reservationIds: la líder; vacío: nada', () => {
    expect(reservationIdsOf({ id: 'r1', reservationIds: ['r1', 'r2'] })).toEqual(['r1', 'r2'])
    expect(reservationIdsOf({ id: 'r1' })).toEqual(['r1'])
    expect(reservationIdsOf({ id: 'r1', reservationIds: [] })).toEqual(['r1'])
    expect(reservationIdsOf({})).toEqual([])
  })
})
