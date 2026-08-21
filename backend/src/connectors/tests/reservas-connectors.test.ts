// connectors/tests/reservas-connectors.test.ts — TC-01: los 7 conectores `reservas-*`.
//
// Un conector solo DELEGA: estos tests verifican que cablea el socket/puerto correcto y pasa
// los argumentos correctos al módulo destino. La lógica de negocio vive (y se testea) en los
// usecases compartidos. Lo crítico acá: que un fallo del módulo satélite NO tumbe la reserva
// (el checkout no puede romperse porque TTLock o Channex estén caídos).

import { describe, it, expect } from 'bun:test'
import type { ConnectorContext } from 'arckode-framework'
import { silentLogger } from 'arckode-framework/testing'
import { reservasCanalesConnector } from '../reservas-canales'
import { reservasHousekeepingConnector } from '../reservas-housekeeping'
import { reservasTtlockConnector } from '../reservas-ttlock'
import { reservasHuespedesConnector } from '../reservas-huespedes'
import { reservasFoliosSettlementConnector } from '../reservas-folios-settlement'
import { reservasRescheduleChargeConnector } from '../reservas-reschedule-charge'
import { reservasPaymentRequestsConnector } from '../reservas-payment-requests'

const log = silentLogger()

/** ctx mock: resuelve los módulos que le pases y captura lo que el conector le inyecta a reservas. */
function makeCtx(modules: Record<string, any> = {}) {
  const captured: { sockets: any; orchestration: any } = { sockets: {}, orchestration: {} }
  const reservas = {
    setSockets: (s: any) => Object.assign(captured.sockets, s),
    setOrchestrationDeps: (d: any) => Object.assign(captured.orchestration, d),
  }
  const ctx = {
    resolveModule: (name: string) => {
      if (name === 'reservas') return reservas
      if (name in modules) return modules[name]
      throw new Error(`módulo desconocido: ${name}`)
    },
  } as unknown as ConnectorContext
  return { ctx, captured }
}

describe('reservasCanalesConnector', () => {
  it('empuja disponibilidad al canal al crear y al actualizar', async () => {
    const pushes: string[][] = []
    const { ctx, captured } = makeCtx({
      canales: { pushAvailabilityByRoom: async (h: string, r: string) => { pushes.push([h, r]); return { pushed: true } } },
    })
    reservasCanalesConnector(ctx)
    await captured.sockets.onReservasCreated({ hotelId: 'h1', roomId: 'r1' })
    await captured.sockets.onReservasUpdated({ hotelId: 'h1', roomId: 'r2' })
    expect(pushes).toEqual([['h1', 'r1'], ['h1', 'r2']])
  })

  it('si el canal falla, la reserva NO se rompe', async () => {
    const { ctx, captured } = makeCtx({
      canales: { pushAvailabilityByRoom: async () => { throw new Error('channex caído') } },
    })
    reservasCanalesConnector(ctx)
    await expect(captured.sockets.onReservasCreated({ hotelId: 'h1', roomId: 'r1' })).resolves.toBeUndefined()
  })
})

describe('reservasHousekeepingConnector', () => {
  it('al checkout deja la habitación en cleaning y crea la tarea de limpieza', async () => {
    const updates: any[] = []
    const tasks: any[] = []
    const { ctx, captured } = makeCtx({
      habitaciones: { update: async (id: string, dto: any, user: any) => { updates.push({ id, dto, user }); return {} } },
      housekeeping: { create: async (d: any) => { tasks.push(d); return d } },
    })
    reservasHousekeepingConnector(ctx)
    await captured.sockets.onReservationCheckedOut({ reservationId: 'res1', roomId: 'r1', hotelId: 'h1' })

    expect(updates[0].id).toBe('r1')
    expect(updates[0].dto.status).toBe('cleaning')
    expect(updates[0].user.hotelId).toBe('h1') // el connector actúa con el hotel de la reserva
    expect(tasks[0].roomId).toBe('r1')
    expect(tasks[0].hotelId).toBe('h1')
    expect(tasks[0].status).toBe('pending')
    expect(tasks[0].type).toBe('full_cleaning')
  })
})

describe('reservasTtlockConnector', () => {
  it('expira los códigos de puerta de la reserva al checkout', async () => {
    const expired: string[] = []
    const { ctx, captured } = makeCtx({
      ttlock: { expireCodesByReservation: async (id: string) => { expired.push(id) } },
    })
    reservasTtlockConnector(ctx)
    await captured.sockets.onReservationCheckedOut({ reservationId: 'res1' })
    expect(expired).toEqual(['res1'])
  })

  it('si TTLock está caído, el checkout NO se rompe', async () => {
    const { ctx, captured } = makeCtx({
      ttlock: { expireCodesByReservation: async () => { throw new Error('ttlock caído') } },
    })
    reservasTtlockConnector(ctx)
    await expect(captured.sockets.onReservationCheckedOut({ reservationId: 'res1' })).resolves.toBeUndefined()
  })
})

describe('reservasHuespedesConnector (CRM)', () => {
  it('acredita la estadía al CRM en el checkout', async () => {
    const credited: any[] = []
    const { ctx, captured } = makeCtx({
      crm: { onCheckoutComplete: async (r: any) => { credited.push(r) } },
    })
    reservasHuespedesConnector(log)(ctx)
    await captured.sockets.onReservationCheckedOut({ reservationId: 'res1', hotelId: 'h1', guestId: 'g1', totalAmount: 200 })

    expect(credited).toHaveLength(1)
    expect(credited[0].id).toBe('res1')
    expect(credited[0].guestId).toBe('g1')
    expect(credited[0].totalAmount).toBe(200)
  })

  it('NO acredita si la reserva actualizada no está checked_out', async () => {
    const credited: any[] = []
    const { ctx, captured } = makeCtx({
      crm: { onCheckoutComplete: async (r: any) => { credited.push(r) } },
    })
    reservasHuespedesConnector(log)(ctx)
    await captured.sockets.onReservasUpdated({ id: 'res1', hotelId: 'h1', guestId: 'g1', totalAmount: 200, status: 'confirmed' })
    expect(credited).toHaveLength(0)
  })

  it('si el CRM falla, el checkout NO se rompe', async () => {
    const { ctx, captured } = makeCtx({
      crm: { onCheckoutComplete: async () => { throw new Error('crm caído') } },
    })
    reservasHuespedesConnector(log)(ctx)
    await expect(
      captured.sockets.onReservationCheckedOut({ reservationId: 'res1', hotelId: 'h1', guestId: 'g1', totalAmount: 200 }),
    ).resolves.toBeUndefined()
  })
})

describe('reservasFoliosSettlementConnector', () => {
  it('inyecta settleFolio en las orchestration deps de reservas', () => {
    const { ctx, captured } = makeCtx({ folios: {} })
    reservasFoliosSettlementConnector(ctx)
    expect(typeof captured.orchestration.settleFolio).toBe('function')
  })
})

describe('reservasRescheduleChargeConnector', () => {
  it('inyecta chargeReschedule en las orchestration deps de reservas', () => {
    const { ctx, captured } = makeCtx({ folios: {}, payments: {} })
    reservasRescheduleChargeConnector(ctx)
    expect(typeof captured.orchestration.chargeReschedule).toBe('function')
  })
})

describe('reservasPaymentRequestsConnector', () => {
  const prModule = { create: async () => ({}), clampRequestsToCeiling: async () => 0, releaseRequestsOfReservation: async () => 0 }
  it('cablea los tres sockets (created/updated/deleted)', () => {
    const { ctx, captured } = makeCtx({ 'payment-requests': prModule })
    reservasPaymentRequestsConnector({} as any)(ctx)
    expect(typeof captured.sockets.onReservasCreated).toBe('function')
    expect(typeof captured.sockets.onReservasUpdated).toBe('function')
    expect(typeof captured.sockets.onReservasDeleted).toBe('function')
  })

  it('SEC3-2/SEC3-3: inyecta el clamp/liberación de links vivos en las orchestration deps', async () => {
    const calls: string[] = []
    const { ctx, captured } = makeCtx({
      'payment-requests': {
        ...prModule,
        clampRequestsToCeiling: async (h: string, r: string) => { calls.push(`clamp:${h}:${r}`); return 1 },
        releaseRequestsOfReservation: async (h: string, r: string) => { calls.push(`release:${h}:${r}`); return 2 },
      },
    })
    reservasPaymentRequestsConnector({} as any)(ctx)
    await captured.orchestration.paymentRequestsCeiling.clamp('h1', 'r9')
    await captured.orchestration.paymentRequestsCeiling.releaseAll('h1', 'r9')
    expect(calls).toEqual(['clamp:h1:r9', 'release:h1:r9'])
  })
})
