// bookingengine/tests/public-booking-promo-upsells.test.ts — F2 2.5 (spec booking-widget).
//
// Cubre la materialización del hook F0 0.16: createPublicBookingDirect ahora PROCESA promoCode
// y upsells, calcula totalBreakdown, e incrementa promo.uses atómicamente dentro de la tx.
//
// Aceptancia (tasks.md 2.5):
//  - mismo promo 2 veces con maxUses=1 → 2da falla con max_uses_reached.
//  - reserva exitosa con promo → uses 0→1.
//  - response.body incluye totalBreakdown con {subtotal, promoDiscount, upsellsTotal, taxes, total}.
//
// Casos cubiertos:
//  (1) Sin promo ni upsells → totalBreakdown con subtotal=room×nights, promoDiscount=0.
//  (2) Con promo válido percent → descuento aplicado, uses incrementado, total correcto.
//  (3) Con promo fijo (fixed) → descuento min(value, subtotal).
//  (4) maxUses alcanzado en validación upfront → 400 + max_uses_reached, NO crea reserva.
//  (5) maxUses=1, dos llamadas secuenciales → 2da devuelve max_uses_reached.
//  (6) Upsells → upsellsTotal se suma al subtotal y al total.
//  (7) Upsell inactivo/inexistente → se ignora (no rompe).
//  (8) Promo inválido (expired, etc.) → 400 + reason, no crea reserva.
//  (9) Atomicidad: si tx.update del promo falla (lanza), la reserva NO se persiste.
import { describe, it, expect } from 'bun:test'
import { createPublicBookingDirect } from '../usecases/public-booking'

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

const baseBody = {
  hotelId: 'h1',
  roomId: 'r1',
  guestName: 'Ana',
  guestEmail: 'ana@example.com',
  guestPhone: '+18095550000',
  checkIn: '2026-08-10',
  checkOut: '2026-08-12',
  adults: 2,
  children: 0,
}

/** Construye un orm mock completo. `state.promo` y `state.upsells` son mutables para simular
 *  el estado de la DB entre llamadas (secuencia de aceptancia del task 2.5). */
function makeOrm(state: {
  room?: any
  reservations?: any[]
  promo?: any | null
  upsells?: any[]
  taxesConfig?: any[]
  transactionThrowOnPromo?: boolean
  /** Simula race concurrente: el `updateMany` del promo devuelve 0 (otra tx ganó la fila). */
  racePromoUpdate?: boolean
}) {
  const created: any[] = []
  const updated: any[] = []
  const updateManyCalls: Array<{ model: string; filters: any; changes: any; affected: number }> = []
  const room = state.room ?? { id: 'r1', hotelId: 'h1', basePrice: 100, status: 'available' }

  const orm: any = {
    findById: async (_m: string, id: string) => {
      if (id === room.id) return room
      return null
    },
    findMany: async (model: string, filters?: any) => {
      if (model === 'Reservations') return state.reservations ?? []
      return []
    },
    findOne: async (model: string, filters: any) => {
      if (model === 'PromoCodes') {
        if (!state.promo) return null
        // Match por (hotelId, code).
        if (filters?.hotelId === state.promo.hotelId && filters?.code === state.promo.code) return state.promo
        if (filters?.id === state.promo.id) return state.promo
        return null
      }
      return null
    },
    create: async (model: string, payload: any) => {
      const row = { id: payload.id || crypto.randomUUID(), ...payload }
      created.push({ model, row })
      return row
    },
    update: async (model: string, id: string, patch: any) => {
      updated.push({ model, id, patch })
      if (model === 'PromoCodes' && state.promo && id === state.promo.id) {
        Object.assign(state.promo, patch)
      }
      if (state.transactionThrowOnPromo && model === 'PromoCodes') {
        throw new Error('simulated promo update failure')
      }
      return null
    },
    // B2 fix — Mock de `updateMany` que simula optimistic locking. Si `racePromoUpdate=true`,
    // el affected=0 (simula que otra tx concurrente ya cambió `uses` entre nuestro read y el
    // UPDATE). Si no, aplica el patch al state y devuelve affected=1 (caso normal).
    updateMany: async (model: string, filters: any, changes: any) => {
      if (state.transactionThrowOnPromo && model === 'PromoCodes') {
        throw new Error('simulated promo update failure')
      }
      if (model === 'PromoCodes') {
        if (state.racePromoUpdate) {
          updateManyCalls.push({ model, filters, changes, affected: 0 })
          return 0
        }
        // Solo actualiza si el filter matchea el state actual (optimistic lock real).
        const matches =
          (!filters?.id || filters.id === state.promo?.id) &&
          (!('uses' in (filters ?? {})) || filters.uses === state.promo?.uses)
        if (matches && state.promo) {
          Object.assign(state.promo, changes)
          updateManyCalls.push({ model, filters, changes, affected: 1 })
          return 1
        }
        updateManyCalls.push({ model, filters, changes, affected: 0 })
        return 0
      }
      updateManyCalls.push({ model, filters, changes, affected: 0 })
      return 0
    },
    transaction: async (cb: (tx: any) => Promise<any>) => {
      // El tx expone los mismos métodos que orm (mock simple).
      // IMPORTANTE: si el callback lanza, propagate → el usecase lo atrapa.
      return await cb(orm)
    },
  }
  return { orm, created, updated, updateManyCalls, state }
}

function makeDeps(state: ReturnType<typeof makeOrm>['state']) {
  return {
    promoCodes: {
      findOne: async (filters: any) => {
        if (!state.promo) return null
        if (filters?.hotelId === state.promo.hotelId && filters?.code === state.promo.code) return state.promo
        if (filters?.id === state.promo?.id) return state.promo
        return null
      },
      findMany: async () => state.promo ? [state.promo] : [],
    } as any,
    upsells: {
      findMany: async () => state.upsells ?? [],
    } as any,
    config: {
      findMany: async (filters: any) => {
        if (filters?.key === 'taxes') return state.taxesConfig ?? []
        return []
      },
      findOne: async (filters: any) => {
        if (filters?.key === 'taxes') return (state.taxesConfig ?? [])[0] ?? null
        return null
      },
    } as any,
  }
}

describe('createPublicBookingDirect — F2 2.5 promo + upsells + atomic uses', () => {
  it('sin promo ni upsells → totalBreakdown con subtotal=room×nights', async () => {
    const state = { taxesConfig: [{ value: [{ activo: true, tasa: 18, nombre: 'ITBIS' }] }] }
    const { orm } = makeOrm(state as any)
    const res = await createPublicBookingDirect(orm, baseBody, undefined, undefined, undefined, undefined, undefined, makeDeps(state as any))
    expect(res.status).toBe(201)
    const b = res.body.totalBreakdown
    // 100 × 2 noches = 200 subtotal, 0 descuento, 0 upsells, 18% tax sobre 200 = 36, total 236.
    expect(b).toEqual({ subtotal: 200, promoDiscount: 0, upsellsTotal: 0, taxes: 36, taxBreakdown: [{ name: 'ITBIS', rate: 18, amount: 36 }], total: 236 })
  })

  it('#88: dos impuestos → una línea por impuesto (nombre, %, importe), taxes = suma exacta, y la reserva guarda el desglose', async () => {
    // 200 de base: ITBIS 18% = 36, propina legal 10% = 20 → taxes 56, total 256. Cada línea se
    // redondea aparte y `taxes` es la suma de las líneas: lo que se muestra fila por fila cierra
    // con lo que cobra Stripe (`totalAmount`).
    const state = { taxesConfig: [{ value: [
      { activo: true, tasa: 18, nombre: 'ITBIS' },
      { activo: true, tasa: 10, nombre: 'Propina legal' },
      { activo: false, tasa: 99, nombre: 'Apagado' },
    ] }] }
    const { orm, created } = makeOrm(state as any)
    const res = await createPublicBookingDirect(orm, baseBody, undefined, undefined, undefined, undefined, undefined, makeDeps(state as any))
    expect(res.status).toBe(201)
    const b = res.body.totalBreakdown
    expect(b.taxBreakdown).toEqual([
      { name: 'ITBIS', rate: 18, amount: 36 },
      { name: 'Propina legal', rate: 10, amount: 20 },
    ])
    expect(b.taxes).toBe(56)
    expect(b.total).toBe(256)
    expect(b.taxes).toBe(b.taxBreakdown.reduce((s: number, l: any) => s + l.amount, 0))
    // Lo que cobra la pasarela es el total mostrado, y la reserva guarda ese mismo desglose.
    const reservation = created.find((c: any) => c.model === 'Reservations')?.row
    expect(reservation.totalAmount).toBe(b.total)
    expect(reservation.priceBreakdown).toEqual(b)
  })

  it('promo válido percent → descuento aplicado, uses incrementado, total correcto', async () => {
    const state: any = {
      promo: {
        id: 'p1', hotelId: 'h1', code: 'WELCOME10', kind: 'percent', value: 10,
        minAmount: null, maxUses: 100, uses: 0, validFrom: null, validTo: null, active: true,
      },
      taxesConfig: [{ value: [{ activo: true, tasa: 18, nombre: 'ITBIS' }] }],
    }
    const { orm, updateManyCalls } = makeOrm(state)
    const res = await createPublicBookingDirect(orm, { ...baseBody, promoCode: 'welcome10' },
      undefined, undefined, undefined, undefined, undefined, makeDeps(state))
    expect(res.status).toBe(201)
    // subtotal 200, discount 10% = 20, taxable 180, tax 18% × 180 = 32.4, total 212.4.
    expect(res.body.totalBreakdown).toEqual({
      subtotal: 200, promoDiscount: 20, upsellsTotal: 0, taxes: 32.4, taxBreakdown: [{ name: 'ITBIS', rate: 18, amount: 32.4 }], total: 212.4,
    })
    // B2 fix — uses fue incrementado atómicamente vía updateMany (optimistic lock).
    const promoUpdate = updateManyCalls.find((u) => u.model === 'PromoCodes')
    expect(promoUpdate).toBeDefined()
    expect(promoUpdate!.affected).toBe(1)
    expect(promoUpdate!.changes.uses).toBe(1)
    expect(promoUpdate!.filters).toMatchObject({ id: 'p1', uses: 0 })
    // El code se persiste en uppercase (normalización).
    const reservation = res.body.reservation
    expect(reservation.promoCode).toBe('WELCOME10')
    expect(UUID_RE.test(reservation.accessToken)).toBe(true)
  })

  it('promo fixed → descuento = min(value, subtotal)', async () => {
    const state: any = {
      promo: {
        id: 'p1', hotelId: 'h1', code: 'FIX50', kind: 'fixed', value: 50,
        minAmount: null, maxUses: null, uses: 0, validFrom: null, validTo: null, active: true,
      },
      taxesConfig: [{ value: [{ activo: true, tasa: 0, nombre: 'NONE' }] }],
    }
    const { orm, updateManyCalls } = makeOrm(state)
    const res = await createPublicBookingDirect(orm, { ...baseBody, promoCode: 'FIX50' },
      undefined, undefined, undefined, undefined, undefined, makeDeps(state))
    expect(res.status).toBe(201)
    // subtotal 200, discount 50, taxable 150, tax 0%, total 150.
    expect(res.body.totalBreakdown).toEqual({
      subtotal: 200, promoDiscount: 50, upsellsTotal: 0, taxes: 0, taxBreakdown: [], total: 150,
    })
    expect(updateManyCalls.find((u) => u.model === 'PromoCodes')?.changes.uses).toBe(1)
  })

  it('promo con maxUses alcanzado (upfront) → 400 max_uses_reached, NO crea reserva', async () => {
    const state: any = {
      promo: {
        id: 'p1', hotelId: 'h1', code: 'WELCOME10', kind: 'percent', value: 10,
        minAmount: null, maxUses: 1, uses: 1, validFrom: null, validTo: null, active: true,
      },
      taxesConfig: [{ value: [{ activo: true, tasa: 18, nombre: 'ITBIS' }] }],
    }
    const { orm, created } = makeOrm(state)
    const res = await createPublicBookingDirect(orm, { ...baseBody, promoCode: 'WELCOME10' },
      undefined, undefined, undefined, undefined, undefined, makeDeps(state))
    expect(res.status).toBe(400)
    expect(res.body).toEqual({ error: 'promo_invalid', promoReason: 'max_uses_reached' })
    // NO se persistió nada.
    expect(created.find((c) => c.model === 'Reservations')).toBeUndefined()
    expect(created.find((c) => c.model === 'Guests')).toBeUndefined()
  })

  it('maxUses=1, DOS llamadas secuenciales → 2da devuelve max_uses_reached (acceptance exacto)', async () => {
    // Estado compartido entre las dos llamadas: simula la DB subyacente.
    const sharedState: any = {
      promo: {
        id: 'p1', hotelId: 'h1', code: 'WELCOME10', kind: 'percent', value: 10,
        minAmount: null, maxUses: 1, uses: 0, validFrom: null, validTo: null, active: true,
      },
      taxesConfig: [{ value: [{ activo: true, tasa: 18, nombre: 'ITBIS' }] }],
    }
    // 1ra reserva — success, uses 0→1.
    {
      const { orm, updateManyCalls } = makeOrm(sharedState)
      const res = await createPublicBookingDirect(orm, { ...baseBody, guestEmail: 'one@example.com', promoCode: 'WELCOME10' },
        undefined, undefined, undefined, undefined, undefined, makeDeps(sharedState))
      expect(res.status).toBe(201)
      expect(updateManyCalls.find((u) => u.model === 'PromoCodes')?.changes.uses).toBe(1)
    }
    // El state.promo.uses fue actualizado por el mock (Object.assign en updateMany).
    expect(sharedState.promo.uses).toBe(1)
    // 2da reserva — fails upfront (uses=1 >= maxUses=1).
    {
      const { orm, created, updated, updateManyCalls } = makeOrm(sharedState)
      const res = await createPublicBookingDirect(orm, { ...baseBody, guestEmail: 'two@example.com', promoCode: 'WELCOME10' },
        undefined, undefined, undefined, undefined, undefined, makeDeps(sharedState))
      expect(res.status).toBe(400)
      expect(res.body.promoReason).toBe('max_uses_reached')
      // Nada creado, nada actualizado (no llegó a la tx).
      expect(created).toEqual([])
      expect(updated).toEqual([])
      expect(updateManyCalls).toEqual([])
    }
  })

  it('upsells → upsellsTotal se suma al subtotal y al total', async () => {
    const state: any = {
      upsells: [
        { id: 'u1', hotelId: 'h1', name: 'Desayuno', price: 15, kind: 'per_person', active: true },
        { id: 'u2', hotelId: 'h1', name: 'Transfer', price: 30, kind: 'per_stay', active: true },
      ],
      taxesConfig: [{ value: [{ activo: true, tasa: 10, nombre: 'IVA' }] }],
    }
    const { orm } = makeOrm(state)
    const res = await createPublicBookingDirect(orm, {
      ...baseBody,
      upsells: [{ id: 'u1', quantity: 2 }, { id: 'u2', quantity: 1 }],
    }, undefined, undefined, undefined, undefined, undefined, makeDeps(state))
    expect(res.status).toBe(201)
    // room: 100×2=200, upsells: 15×2 + 30×1 = 60, subtotal 260, tax 10% × 260 = 26, total 286.
    expect(res.body.totalBreakdown).toEqual({
      subtotal: 260, promoDiscount: 0, upsellsTotal: 60, taxes: 26, taxBreakdown: [{ name: 'IVA', rate: 10, amount: 26 }], total: 286,
    })
  })

  it('upsell inactivo/inexistente → se ignora (no rompe el flujo)', async () => {
    const state: any = {
      upsells: [
        { id: 'u1', hotelId: 'h1', name: 'Desayuno', price: 15, kind: 'per_person', active: true },
        { id: 'u2', hotelId: 'h1', name: 'Inactive', price: 999, kind: 'per_stay', active: false },
      ],
      taxesConfig: [{ value: [{ activo: true, tasa: 0, nombre: 'NONE' }] }],
    }
    const { orm } = makeOrm(state)
    const res = await createPublicBookingDirect(orm, {
      ...baseBody,
      upsells: [
        { id: 'u1', quantity: 1 },           // activo → suma 15
        { id: 'u2', quantity: 1 },           // inactivo → se ignora
        { id: 'no-existe', quantity: 1 },    // inexistente → se ignora
      ],
    }, undefined, undefined, undefined, undefined, undefined, makeDeps(state))
    expect(res.status).toBe(201)
    // subtotal 200 + 15 = 215, no tax, total 215.
    expect(res.body.totalBreakdown).toEqual({
      subtotal: 215, promoDiscount: 0, upsellsTotal: 15, taxes: 0, taxBreakdown: [], total: 215,
    })
  })

  it('promo expired → 400 + reason=expired, no crea reserva', async () => {
    const state: any = {
      promo: {
        id: 'p1', hotelId: 'h1', code: 'OLD', kind: 'percent', value: 10,
        minAmount: null, maxUses: null, uses: 0,
        validFrom: null, validTo: '2020-01-01T00:00:00Z', active: true,
      },
      taxesConfig: [{ value: [{ activo: true, tasa: 18, nombre: 'ITBIS' }] }],
    }
    const { orm, created } = makeOrm(state)
    const res = await createPublicBookingDirect(orm, { ...baseBody, promoCode: 'OLD' },
      undefined, undefined, undefined, undefined, undefined, makeDeps(state))
    expect(res.status).toBe(400)
    expect(res.body.promoReason).toBe('expired')
    expect(created.find((c) => c.model === 'Reservations')).toBeUndefined()
  })

  it('atomicidad: si tx.update del promo falla, la reserva NO se persiste', async () => {
    // El mock está configurado para lanzar en tx.update('PromoCodes', ...).
    // En una transacción real, esto haría rollback — el mock no simula rollback, pero el
    // usecase relanza el error → el caller ve un throw (no un 201 silencioso). Verificamos
    // que el error se propaga (no se traga) y el status NO es 201.
    const state: any = {
      promo: {
        id: 'p1', hotelId: 'h1', code: 'WELCOME10', kind: 'percent', value: 10,
        minAmount: null, maxUses: 100, uses: 0, validFrom: null, validTo: null, active: true,
      },
      taxesConfig: [{ value: [{ activo: true, tasa: 18, nombre: 'ITBIS' }] }],
      transactionThrowOnPromo: true,
    }
    const { orm } = makeOrm(state)
    expect(async () => {
      await createPublicBookingDirect(orm, { ...baseBody, promoCode: 'WELCOME10' },
        undefined, undefined, undefined, undefined, undefined, makeDeps(state))
    }).toThrow() // El error se propaga fuera de la tx (no se traga silenciosamente).
  })

  it('B2 race condition: updateMany devuelve 0 → 409 max_uses_reached (optimistic lock detecta la race)', async () => {
    // Escenario: dos tx concurrentes leyeron promo.uses=0. La primera gana (affected=1, uses→1).
    // La segunda hace UPDATE WHERE uses=0 → affected=0 (la fila ya tiene uses=1) → aborta.
    // En SQLite las tx son seriales, así que esto no reproduce la race real; el test valida
    // la LÓGICA del rowCount: si affected===0, el usecase devuelve 409 con max_uses_reached
    // y el state.promo.uses NO cambia (la tx abortó antes del updateMany exitoso).
    // NOTA: el mock de `transaction` no simula rollback de los `create` previos (en DB real,
    // el rollback borra guest+reservation; acá quedan en el array `created` del mock). Por eso
    // no asertamos sobre `created` — solo sobre el resultado del usecase y el filter del UPDATE.
    const state: any = {
      promo: {
        id: 'p1', hotelId: 'h1', code: 'RACE10', kind: 'percent', value: 10,
        minAmount: null, maxUses: 1, uses: 0, validFrom: null, validTo: null, active: true,
      },
      taxesConfig: [{ value: [{ activo: true, tasa: 0, nombre: 'NONE' }] }],
      racePromoUpdate: true, // simula "otra tx ganó la fila"
    }
    const { orm, updateManyCalls } = makeOrm(state)
    const res = await createPublicBookingDirect(orm, { ...baseBody, promoCode: 'RACE10' },
      undefined, undefined, undefined, undefined, undefined, makeDeps(state))
    expect(res.status).toBe(409)
    expect(res.body).toEqual({ error: 'promo_invalid', promoReason: 'max_uses_reached' })
    // El filter del UPDATE lleva uses=freshUses (optimistic lock): ese filter es la prueba
    // de que el código está haciendo el UPDATE condicional correcto (no un UPDATE incondicional).
    // Se filtra por modelo: la transacción también hace un UPDATE sobre `Rooms` para tomar el
    // lock de fila que evita el overbooking (ver public-booking.ts). Este test es sobre el promo.
    const promoUpdates = updateManyCalls.filter(c => c.model === 'PromoCodes')
    expect(promoUpdates).toHaveLength(1)
    expect(promoUpdates[0].affected).toBe(0)
    expect(promoUpdates[0].filters).toMatchObject({ id: 'p1', uses: 0 })
    // El promo no fue mutado en el state compartido (la tx abortó antes del commit lógico).
    expect(state.promo.uses).toBe(0)
  })

  it('sin extraDeps (compat F0 0.16) → no procesa promo, persiste el string sin validar', async () => {
    // Llamada con 2 args, sin extraDeps. El hook F0 0.16 sigue funcionando: persiste
    // promoCode como string sin validarlo (back-compat con callers viejos / tests legacy).
    const state: any = {}
    const { orm, created } = makeOrm(state)
    const res = await createPublicBookingDirect(orm, { ...baseBody, promoCode: 'ANYTHING' })
    expect(res.status).toBe(201)
    const reservation = created.find((c) => c.model === 'Reservations')
    expect(reservation.row.promoCode).toBe('ANYTHING')
    // No se aplica descuento (no se procesó) → total = subtotal + tax sobre subtotal.
    expect(res.body.totalBreakdown).toEqual({
      subtotal: 200, promoDiscount: 0, upsellsTotal: 0, taxes: 0, taxBreakdown: [], total: 200,
    })
  })
})
