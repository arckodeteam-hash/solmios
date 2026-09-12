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
// (10) #270: priceBreakdown.upsells[] (snapshot por línea, precio congelado del catálogo) se
//      persiste en la reserva, y esta guarda estimatedArrival/specialRequests estructurados.
//
// MR-10 (#275) — bloque `describe` aparte al final:
//  - `children` plano sin edades cotiza IGUAL que `childrenAges:[maxChildAge, ...]` (Opción A).
//  - upsells por `kind`: per_person_per_night / per_night multiplican por noches (qty ignorado),
//    per_person con qty > huéspedes → 400 `upsell_quantity_out_of_range`.
//  - `priceBreakdown.upsells[]` por línea, y los addons #269 cuadran con el total cobrado.
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
  /** MR-10 (#275) — fila `configuration(key:'child_policy')` del hotel (value ya parseado). */
  childPolicy?: any
  transactionThrowOnPromo?: boolean
  /** Simula race concurrente: el `updateMany` del promo devuelve 0 (otra tx ganó la fila). */
  racePromoUpdate?: boolean
}) {
  const created: any[] = []
  const updated: any[] = []
  const updateManyCalls: Array<{ model: string; filters: any; changes: any; affected: number }> = []
  // REQ-HAC-05 (#260): la venta es por TIPO — la unidad necesita `type` y `findMany('Rooms')` la devuelve.
  const room = { type: 'double', ...(state.room ?? { id: 'r1', hotelId: 'h1', basePrice: 100, status: 'available' }) }

  const orm: any = {
    findById: async (_m: string, id: string) => {
      if (id === room.id) return room
      return null
    },
    findMany: async (model: string, filters?: any) => {
      if (model === 'Reservations') return state.reservations ?? []
      if (model === 'Rooms') return [room]
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
        if (filters?.key === 'child_policy') return state.childPolicy ? { value: state.childPolicy } : null
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
    expect(b).toEqual({ subtotal: 200, promoDiscount: 0, upsellsTotal: 0, upsells: [], childAmenitiesTotal: 0, roomAmenitiesTotal: 0, mealPlanTotal: 0, taxes: 36, taxBreakdown: [{ name: 'ITBIS', rate: 18, amount: 36 }], total: 236 })
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
      subtotal: 200, promoDiscount: 20, upsellsTotal: 0, upsells: [], childAmenitiesTotal: 0, roomAmenitiesTotal: 0, mealPlanTotal: 0, taxes: 32.4, taxBreakdown: [{ name: 'ITBIS', rate: 18, amount: 32.4 }], total: 212.4,
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
      subtotal: 200, promoDiscount: 50, upsellsTotal: 0, upsells: [], childAmenitiesTotal: 0, roomAmenitiesTotal: 0, mealPlanTotal: 0, taxes: 0, taxBreakdown: [], total: 150,
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
      subtotal: 260, promoDiscount: 0, upsellsTotal: 60,
      // MR-10 (#275) — cada línea con su kind/unitario/cantidad/noches/total.
      upsells: [
        { id: 'u1', name: 'Desayuno', kind: 'per_person', unitPrice: 15, quantity: 2, nights: 1, total: 30 },
        { id: 'u2', name: 'Transfer', kind: 'per_stay', unitPrice: 30, quantity: 1, nights: 1, total: 30 },
      ],
      childAmenitiesTotal: 0, roomAmenitiesTotal: 0, mealPlanTotal: 0, taxes: 26, taxBreakdown: [{ name: 'IVA', rate: 10, amount: 26 }], total: 286,
    })
  })

  it('#270: priceBreakdown.upsells lleva el snapshot por línea y la reserva guarda estimatedArrival/specialRequests', async () => {
    const state: any = {
      upsells: [
        { id: 'u1', hotelId: 'h1', name: 'Desayuno', price: 15, kind: 'per_person', active: true },
      ],
      taxesConfig: [{ value: [{ activo: true, tasa: 0, nombre: 'NONE' }] }],
    }
    const { orm, created } = makeOrm(state)
    const res = await createPublicBookingDirect(orm, {
      ...baseBody,
      upsells: [{ id: 'u1', quantity: 2 }],
      estimatedArrival: ' 18:30 ',
      specialRequests: '  Cama extra y piso alto  ',
    }, undefined, undefined, undefined, undefined, undefined, makeDeps(state))
    expect(res.status).toBe(201)
    const b = res.body.totalBreakdown
    // Una línea por upsell válido, precio congelado del catálogo (no del body), total = unitPrice × qty.
    expect(b.upsells).toEqual([{ id: 'u1', name: 'Desayuno', kind: 'per_person', unitPrice: 15, quantity: 2, nights: 1, total: 30 }])
    expect(b.upsells[0].total).toBe(b.upsells[0].unitPrice * b.upsells[0].quantity)
    expect(b.upsellsTotal).toBe(30)
    const reservation = created.find((c: any) => c.model === 'Reservations')?.row
    // La reserva guarda el mismo desglose (con las líneas) que el huésped vio.
    expect(reservation.priceBreakdown.upsells).toEqual(b.upsells)
    // Estructurados (trim) además del texto que ya iba en `notes`, que no cambia.
    expect(reservation.estimatedArrival).toBe('18:30')
    expect(reservation.specialRequests).toBe('Cama extra y piso alto')
    expect(reservation.notes).toContain('Llegada estimada: 18:30')
    expect(reservation.notes).toContain('Pedido especial: Cama extra y piso alto')
  })

  it('#270: sin estimatedArrival/specialRequests en el body → columnas undefined (no string vacío)', async () => {
    const state: any = { taxesConfig: [{ value: [{ activo: true, tasa: 0, nombre: 'NONE' }] }] }
    const { orm, created } = makeOrm(state)
    const res = await createPublicBookingDirect(orm, { ...baseBody, estimatedArrival: '   ' }, undefined, undefined, undefined, undefined, undefined, makeDeps(state))
    expect(res.status).toBe(201)
    const reservation = created.find((c: any) => c.model === 'Reservations')?.row
    expect(reservation.estimatedArrival).toBeUndefined()
    expect(reservation.specialRequests).toBeUndefined()
    expect(reservation.priceBreakdown.upsells).toEqual([])
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
      subtotal: 215, promoDiscount: 0, upsellsTotal: 15,
      upsells: [{ id: 'u1', name: 'Desayuno', kind: 'per_person', unitPrice: 15, quantity: 1, nights: 1, total: 15 }],
      childAmenitiesTotal: 0, roomAmenitiesTotal: 0, mealPlanTotal: 0, taxes: 0, taxBreakdown: [], total: 215,
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
      subtotal: 200, promoDiscount: 0, upsellsTotal: 0, upsells: [], childAmenitiesTotal: 0, roomAmenitiesTotal: 0, mealPlanTotal: 0, taxes: 0, taxBreakdown: [], total: 200,
    })
  })
})

describe('createPublicBookingDirect — MR-10 (#275) niños sin edades (Opción A) + upsells por kind', () => {
  // Política con descuento por niño con plaza: maxChildAge 12, nada libre/bebé, 50 %.
  const policy = { acceptChildren: true, maxChildAge: 12, maxFreeAge: 0, maxBabyAge: 0, childrenDiscountEnabled: true, childrenRatePercent: 50 }
  const noTax = [{ value: [{ activo: true, tasa: 0, nombre: 'NONE' }] }]
  // 3 noches a 100 = 300 de habitación (basePrice plano, sin temporadas).
  const threeNights = { ...baseBody, checkIn: '2026-08-10', checkOut: '2026-08-13' }

  async function book(state: any, body: any) {
    const { orm, created } = makeOrm(state)
    const res = await createPublicBookingDirect(orm, body, undefined, undefined, undefined, undefined, undefined, makeDeps(state))
    const reservation = created.find((c: any) => c.model === 'Reservations')?.row
    const addons = created.filter((c: any) => c.model === 'ReservationAddons').map((c: any) => c.row)
    return { res, reservation, addons }
  }

  it('children:2 sin edades cotiza IGUAL que childrenAges:[12,12] (niños con plaza a maxChildAge, con el % del hotel)', async () => {
    const plain = await book({ taxesConfig: noTax, childPolicy: policy }, { ...baseBody, adults: 2, children: 2 })
    const withAges = await book({ taxesConfig: noTax, childPolicy: policy }, { ...baseBody, adults: 2, children: 2, childrenAges: [12, 12] })
    expect(plain.res.status).toBe(201)
    expect(withAges.res.status).toBe(201)
    // 2 noches × 100 = 200 para los adultos; cada niño con plaza paga 50 % de "un adulto"
    // (200 / 2 = 100 → 50 c/u) → 200 + 2 × 50 = 300. MISMO total por las dos puertas.
    expect(plain.reservation.totalAmount).toBe(300)
    expect(withAges.reservation.totalAmount).toBe(plain.reservation.totalAmount)
    expect(plain.reservation.childrenRatePercentApplied).toBe(50)
    expect(withAges.reservation.childrenRatePercentApplied).toBe(50)
    expect(plain.reservation.children).toBe(2)
    // Opción A persiste las edades sintetizadas: son la base del precio cobrado (un reagendado
    // vuelve a cotizar con ellas, no por adultos).
    expect(plain.reservation.childrenAges).toEqual([12, 12])
    expect(plain.reservation.childrenAgesAsOf).toBe('2026-08-10')
    // Y es MÁS caro que sin niños: antes de MR-10 el caller plano pagaba 200 (adultos solamente).
    const noKids = await book({ taxesConfig: noTax, childPolicy: policy }, { ...baseBody, adults: 2, children: 0 })
    expect(noKids.reservation.totalAmount).toBe(200)
    expect(noKids.reservation.childrenRatePercentApplied).toBeNull()
  })

  it('children plano en un hotel que NO acepta niños → 400 (antes pasaba en silencio como adultos)', async () => {
    const { res, reservation } = await book(
      { taxesConfig: noTax, childPolicy: { ...policy, acceptChildren: false } },
      { ...baseBody, adults: 2, children: 1 },
    )
    expect(res.status).toBe(400)
    expect(res.body.error).toBe('Este hotel no acepta niños en la reserva')
    expect(reservation).toBeUndefined()
  })

  it('children plano cuenta para capacidad: 2 adultos + 2 niños no entran en capacity 3 → 409', async () => {
    const { res } = await book(
      { taxesConfig: noTax, childPolicy: policy, room: { id: 'r1', hotelId: 'h1', basePrice: 100, status: 'available', capacity: 3 } },
      { ...baseBody, adults: 2, children: 2 },
    )
    expect(res.status).toBe(409)
  })

  it('per_person_per_night 10 × 2 adultos × 3 noches = 60; qty:4 del body se ignora; addon #269 cuadra', async () => {
    const state = {
      taxesConfig: noTax,
      upsells: [{ id: 'ppn', hotelId: 'h1', name: 'Desayuno', price: 10, kind: 'per_person_per_night', active: true }],
    }
    const { res, reservation, addons } = await book(state, { ...threeNights, upsells: [{ id: 'ppn', quantity: 4 }] })
    expect(res.status).toBe(201)
    const b = res.body.totalBreakdown
    expect(b.upsells).toHaveLength(1)
    expect(b.upsells[0]).toEqual({ id: 'ppn', name: 'Desayuno', kind: 'per_person_per_night', unitPrice: 10, quantity: 1, nights: 3, persons: 2, total: 60 })
    expect(b.upsellsTotal).toBe(60)
    expect(b.subtotal).toBe(360)
    expect(b.total).toBe(360)
    // Se persiste con la reserva (es lo que muestra la confirmación pública).
    expect(reservation.priceBreakdown.upsells).toEqual(b.upsells)
    expect(reservation.notes).toContain('Upsells: Desayuno×2p×3n=60.00')
    // #269 — el folio asienta quantity × unitPrice: quantity lleva el multiplicador (2 × 3 = 6).
    const addon = addons.find((a: any) => a.description === 'Desayuno')
    expect(addon).toBeDefined()
    expect(Number(addon.quantity)).toBe(6)
    expect(Number(addon.unitPrice)).toBe(10)
    expect(Number(addon.amount) * Number(addon.quantity)).toBe(60)
  })

  it('per_night 15 × 3 noches = 45 (qty ignorado)', async () => {
    const state = {
      taxesConfig: noTax,
      upsells: [{ id: 'pn', hotelId: 'h1', name: 'Parking', price: 15, kind: 'per_night', active: true }],
    }
    const { res } = await book(state, { ...threeNights, upsells: [{ id: 'pn', quantity: 7 }] })
    expect(res.status).toBe(201)
    expect(res.body.totalBreakdown.upsells[0]).toEqual({ id: 'pn', name: 'Parking', kind: 'per_night', unitPrice: 15, quantity: 1, nights: 3, total: 45 })
    expect(res.body.totalBreakdown.upsellsTotal).toBe(45)
    expect(res.body.totalBreakdown.total).toBe(345)
  })

  it('per_person qty:5 con 2 huéspedes → 400 upsell_quantity_out_of_range (no crea nada); qty:2 → OK', async () => {
    const state = {
      taxesConfig: noTax,
      upsells: [{ id: 'pp', hotelId: 'h1', name: 'Transfer', price: 20, kind: 'per_person', active: true }],
    }
    const bad = await book(state, { ...baseBody, upsells: [{ id: 'pp', quantity: 5 }] })
    expect(bad.res.status).toBe(400)
    expect(bad.res.body.error).toBe('upsell_quantity_out_of_range')
    expect(bad.res.body).toMatchObject({ upsellId: 'pp', name: 'Transfer', kind: 'per_person', quantity: 5, max: 2 })
    expect(typeof bad.res.body.message).toBe('string')
    expect(bad.reservation).toBeUndefined()

    const ok = await book(state, { ...baseBody, upsells: [{ id: 'pp', quantity: 2 }] })
    expect(ok.res.status).toBe(201)
    expect(ok.res.body.totalBreakdown.upsells[0]).toMatchObject({ kind: 'per_person', quantity: 2, total: 40 })
    expect(ok.res.body.totalBreakdown.upsellsTotal).toBe(40)
  })

  it('per_person: los niños (con plaza o libres) cuentan como personas, los bebés no', async () => {
    // 2 adultos + 1 niño con plaza (10) + 1 bebé (1, maxBabyAge 2 ≤ maxFreeAge 2) → 3 personas.
    const state = {
      taxesConfig: noTax,
      childPolicy: { ...policy, maxFreeAge: 2, maxBabyAge: 2, childrenDiscountEnabled: false },
      upsells: [{ id: 'pp', hotelId: 'h1', name: 'Transfer', price: 20, kind: 'per_person', active: true }],
    }
    const body = { ...baseBody, adults: 2, children: 2, childrenAges: [10, 1] }
    const bad = await book(state, { ...body, upsells: [{ id: 'pp', quantity: 4 }] })
    expect(bad.res.status).toBe(400)
    expect(bad.res.body.max).toBe(3)
    const ok = await book(state, { ...body, upsells: [{ id: 'pp', quantity: 3 }] })
    expect(ok.res.status).toBe(201)
  })
})
