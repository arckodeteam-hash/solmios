// connectors/tests/promo-connectors.test.ts — PC-1/PC-5 (auditoría 2026-08-19).
//
// Los conectores promo solo DELEGA (patrón reservas-connectors.test.ts): verifican que
// cablean el puerto correcto al módulo reservas (consume/release en vez del viejo
// incrementUses) y que la cancelación —panel (onReservationCancelled) y widget público
// (onBookingCancelled)— devuelve el uso del código sin romper la cancelación si falla.
import { describe, it, expect } from 'bun:test'
import type { ConnectorContext, Logger } from 'arckode-framework'
import { silentLogger } from 'arckode-framework/testing'
import { reservasPromocodesConnector } from '../reservas-promocodes'
import { bookingenginePromocodesConnector } from '../bookingengine-promocodes'

function makeCtx(modules: Record<string, any>) {
  const captured: Record<string, any> = {}
  const mk = (name: string, key: string) => ({
    [`set${key}`]: (s: any) => Object.assign((captured[key] = captured[key] ?? {}), s),
  })
  const ctx = {
    resolveModule: (name: string) => {
      if (name === 'reservas') return { ...mk('reservas', 'Sockets'), setOrchestrationDeps: (d: any) => Object.assign((captured.orchestration = captured.orchestration ?? {}), d) }
      if (name === 'bookingengine') return mk('bookingengine', 'Sockets')
      if (name in modules) return modules[name]
      throw new Error(`módulo desconocido: ${name}`)
    },
  } as unknown as ConnectorContext
  return { ctx, captured }
}

describe('reservasPromocodesConnector (PC-1/PC-5)', () => {
  it('cablea el puerto con consumeUse/releaseUse (ya NO incrementUses)', () => {
    const { ctx, captured } = makeCtx({
      'promo-codes': {
        validate: async () => ({ valid: true, discount: 0 }),
        consumeUseByCode: async () => {},
        releaseUseByCode: async () => {},
      },
    })
    reservasPromocodesConnector(ctx)
    const port = captured.orchestration.promoCodes
    expect(typeof port.validate).toBe('function')
    expect(typeof port.consumeUse).toBe('function')
    expect(typeof port.releaseUse).toBe('function')
    expect((port as any).incrementUses).toBeUndefined()
  })

  it('onReservationCancelled con promoCode → releaseUseByCode con hotel+code', async () => {
    const releases: string[][] = []
    const { ctx, captured } = makeCtx({
      'promo-codes': {
        validate: async () => ({ valid: true, discount: 0 }),
        consumeUseByCode: async () => {},
        releaseUseByCode: async (h: string, c: string) => { releases.push([h, c]) },
      },
    })
    reservasPromocodesConnector(ctx)
    await captured.Sockets.onReservationCancelled({ reservationId: 'r1', hotelId: 'h1', promoCode: 'POINTS-ABC' })
    expect(releases).toEqual([['h1', 'POINTS-ABC']])
  })

  it('reserva SIN promoCode → no llama a release (y si promo falla, no rompe)', async () => {
    const releases: string[][] = []
    const { ctx, captured } = makeCtx({
      'promo-codes': {
        validate: async () => ({ valid: true, discount: 0 }),
        consumeUseByCode: async () => {},
        releaseUseByCode: async (h: string, c: string) => { releases.push([h, c]) },
      },
    })
    reservasPromocodesConnector(ctx)
    await captured.Sockets.onReservationCancelled({ reservationId: 'r1', hotelId: 'h1', promoCode: null })
    expect(releases).toEqual([])

    const failing = makeCtx({
      'promo-codes': {
        validate: async () => ({ valid: true, discount: 0 }),
        consumeUseByCode: async () => {},
        releaseUseByCode: async () => { throw new Error('db caída') },
      },
    })
    reservasPromocodesConnector(failing.ctx)
    await expect(failing.captured.Sockets.onReservationCancelled({ reservationId: 'r1', hotelId: 'h1', promoCode: 'X' }))
      .resolves.toBeUndefined()
  })
})

describe('bookingenginePromocodesConnector (PC-5 — cancelar desde el widget)', () => {
  it('onBookingCancelled con promoCode → releaseUseByCode', async () => {
    const releases: string[][] = []
    const { ctx, captured } = makeCtx({
      'promo-codes': { releaseUseByCode: async (h: string, c: string) => { releases.push([h, c]) } },
    })
    bookingenginePromocodesConnector(ctx)
    await captured.Sockets.onBookingCancelled({ reservationId: 'r1', hotelId: 'h1', promoCode: 'POINTS-XYZ' })
    expect(releases).toEqual([['h1', 'POINTS-XYZ']])
  })

  it('sin promoCode → no-op; promo caído → no rompe la cancelación del huésped', async () => {
    const releases: string[][] = []
    const { ctx, captured } = makeCtx({
      'promo-codes': { releaseUseByCode: async (h: string, c: string) => { releases.push([h, c]) } },
    })
    bookingenginePromocodesConnector(ctx)
    await captured.Sockets.onBookingCancelled({ reservationId: 'r1', hotelId: 'h1' })
    expect(releases).toEqual([])

    const failing = makeCtx({
      'promo-codes': { releaseUseByCode: async () => { throw new Error('db caída') } },
    })
    bookingenginePromocodesConnector(failing.ctx)
    await expect(failing.captured.Sockets.onBookingCancelled({ reservationId: 'r1', hotelId: 'h1', promoCode: 'X' }))
      .resolves.toBeUndefined()
  })
})

// ─── C-1 (2026-08-19): TTLock expira al cancelar ─────────────────────────────────────────
import { reservasTtlockConnector } from '../reservas-ttlock'
import { bookingengineTtlockConnector } from '../bookingengine-ttlock'

describe('reservasTtlockConnector — checkout Y cancelación (C-1)', () => {
  it('onReservationCheckedOut → expireCodesByReservation', async () => {
    const expired: string[] = []
    const captured: any = {}
    const ctx = {
      resolveModule: (name: string) => {
        if (name === 'reservas') return { setSockets: (s: any) => Object.assign(captured, s) }
        if (name === 'ttlock') return { expireCodesByReservation: async (id: string) => { expired.push(id) } }
        throw new Error(`módulo desconocido: ${name}`)
      },
    } as any
    reservasTtlockConnector(ctx)
    await captured.onReservationCheckedOut({ reservationId: 'r1' })
    expect(expired).toEqual(['r1'])
  })

  it('onReservationCancelled → TAMBIÉN expira (antes: el PIN quedaba activo)', async () => {
    const expired: string[] = []
    const captured: any = {}
    const ctx = {
      resolveModule: (name: string) => {
        if (name === 'reservas') return { setSockets: (s: any) => Object.assign(captured, s) }
        if (name === 'ttlock') return { expireCodesByReservation: async (id: string) => { expired.push(id) } }
        throw new Error(`módulo desconocido: ${name}`)
      },
    } as any
    reservasTtlockConnector(ctx)
    await captured.onReservationCancelled({ reservationId: 'r2', hotelId: 'h1' })
    expect(expired).toEqual(['r2'])
  })

  it('ttlock caído → no rompe la cancelación', async () => {
    const captured: any = {}
    const ctx = {
      resolveModule: (name: string) => {
        if (name === 'reservas') return { setSockets: (s: any) => Object.assign(captured, s) }
        if (name === 'ttlock') return { expireCodesByReservation: async () => { throw new Error('ttlock api down') } }
        throw new Error(`módulo desconocido: ${name}`)
      },
    } as any
    reservasTtlockConnector(ctx)
    await expect(captured.onReservationCancelled({ reservationId: 'r3', hotelId: 'h1' })).resolves.toBeUndefined()
  })
})

describe('bookingengineTtlockConnector — cancelación desde el widget (C-1)', () => {
  it('onBookingCancelled → expireCodesByReservation', async () => {
    const expired: string[] = []
    const captured: any = {}
    const ctx = {
      resolveModule: (name: string) => {
        if (name === 'bookingengine') return { setSockets: (s: any) => Object.assign(captured, s) }
        if (name === 'ttlock') return { expireCodesByReservation: async (id: string) => { expired.push(id) } }
        throw new Error(`módulo desconocido: ${name}`)
      },
    } as any
    bookingengineTtlockConnector(silentLogger())(ctx)
    await captured.onBookingCancelled({ reservationId: 'r9', hotelId: 'h1' })
    expect(expired).toEqual(['r9'])
  })

  it('ttlock caído → no rompe la cancelación y DEJA telemetría (SEC-1: PIN vivo logueado)', async () => {
    const warnings: string[] = []
    const log = { warn: (m: string) => { warnings.push(m) }, child: () => log } as unknown as Logger
    const captured: { onBookingCancelled?: (d: { reservationId: string; hotelId: string }) => Promise<void> } = {}
    const ctx = {
      resolveModule: (name: string) => {
        if (name === 'bookingengine') return { setSockets: (s: Record<string, unknown>) => Object.assign(captured, s) }
        if (name === 'ttlock') return { expireCodesByReservation: async () => { throw new Error('ttlock api down') } }
        throw new Error(`módulo desconocido: ${name}`)
      },
    } as unknown as ConnectorContext
    bookingengineTtlockConnector(log)(ctx)
    if (!captured.onBookingCancelled) throw new Error('el connector no cableó onBookingCancelled')
    // La cancelación del huésped no se cae…
    await expect(captured.onBookingCancelled({ reservationId: 'r10', hotelId: 'h1' })).resolves.toBeUndefined()
    // …pero el PIN que quedó vivo no pasa en silencio: hay que poder rastrearlo y revocarlo a mano.
    expect(warnings.length).toBe(1)
    expect(warnings[0]).toContain('r10')
  })
})
