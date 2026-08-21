// reservas/tests/settle-actor.test.ts — DEBT-1: el actor que cierra el folio se COMPRUEBA.
//
// El tipo `SettleActor` estaba bien, pero el único call site era `req.user as SettleActor`
// (`reservas/controller.ts`): un casteo no verifica nada. Un token a medio armar —sin `role`, sin
// `id`— llegaba igual hasta `folios.close`, que es donde se decide la autorización, con `undefined`
// en el campo que la decide.

import { describe, it, expect } from 'bun:test'
import { toSettleActor, settleFolioForCheckout } from '../usecases/settle-port'

describe('toSettleActor', () => {
  it('acepta un usuario completo y normaliza los tipos', () => {
    expect(toSettleActor({ id: 'u1', role: 'hotel_admin', hotelId: 'h1' }))
      .toEqual({ id: 'u1', role: 'hotel_admin', hotelId: 'h1' })
  })

  it('el hotelId es opcional (un super_admin no tiene hotel propio)', () => {
    expect(toSettleActor({ id: 'u1', role: 'super_admin' })).toEqual({ id: 'u1', role: 'super_admin', hotelId: undefined })
  })

  it('sin `role` corta: es el campo con el que folios.close autoriza', () => {
    expect(() => toSettleActor({ id: 'u1' })).toThrow(/no está identificado/)
  })

  it('sin `id` corta: un asiento contable sin responsable no se emite', () => {
    expect(() => toSettleActor({ role: 'hotel_admin' })).toThrow(/no está identificado/)
  })

  it('null / undefined / basura cortan igual', () => {
    for (const bad of [null, undefined, 'u1', 42, {}]) {
      expect(() => toSettleActor(bad)).toThrow(/no está identificado/)
    }
  })
})

describe('settleFolioForCheckout', () => {
  it('sin puerto cableado no hay settlement (comportamiento previo, no un 500)', async () => {
    expect(await settleFolioForCheckout(undefined, { id: 'r1', hotelId: 'h1' }, null, { id: 'u1', role: 'hotel_admin' })).toBeNull()
  })

  it('traduce la fila de la reserva a los parámetros del puerto y propaga el actor', async () => {
    const calls: any[] = []
    const port = async (params: any, user: any) => { calls.push({ params, user }); return { folioId: 'f1', invoiceId: null, balance: 0, amountPaid: 0, invoiceNumber: null } }
    await settleFolioForCheckout(port, { id: 'r1', hotelId: 'h1', guestId: '', roomId: undefined }, { amount: 10, method: 'cash' }, { id: 'u1', role: 'hotel_admin' })
    expect(calls[0].params).toEqual({ reservationId: 'r1', hotelId: 'h1', guestId: null, roomId: null, settle: { amount: 10, method: 'cash' } })
    expect(calls[0].user).toEqual({ id: 'u1', role: 'hotel_admin' })
  })
})
