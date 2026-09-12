// public-booking-race.test.ts — Overbooking: dos huéspedes, la última unidad del tipo, al mismo tiempo.
//
// El `availableOfType` de `createPublicBookingDirect` ocurre FUERA de la transacción, y el insert
// adentro. Entre esos dos puntos hay una ventana: dos requests concurrentes pasaban ambos el
// chequeo y se creaban DOS reservas del mismo tipo sobre una sola unidad y las mismas fechas.
//
// Reproducido antes del fix congelando al primer comprador justo después de su chequeo (los dos
// devolvían 201, quedaban 2 filas). Ahora la transacción toma el lock de las filas del tipo y
// REPITE `availableOfType` adentro (REQ-HAC-05: la reserva nace sin unidad, así que el re-chequeo
// es por tipo, no por `roomId`): el que llega tarde ve la reserva del otro y recibe 409.
//
// El lock (`updateMany` sobre `Rooms`) existe para SERIALIZAR, no para juzgar: quien decide es la
// re-lectura. Por eso no se aborta por `affected === 0` — bastaría que alguien hubiera editado la
// habitación por cualquier otro motivo para rechazar una venta legítima.
import { describe, it, expect } from 'bun:test'
import { createPublicBookingDirect } from '../usecases/public-booking'

const CHECK_IN = '2026-12-01'
const CHECK_OUT = '2026-12-03'

function makeWorld() {
  const rooms: any[] = [
    { id: 'room-1', hotelId: 'h1', type: 'double', number: '101', basePrice: 100, capacity: 2, status: 'available' },
  ]
  const hotels: any[] = [
    { id: 'h1', slug: 'demo', name: 'Demo', currency: 'USD', onlineBookingStatus: 'active', taxRate: 0 },
  ]
  const reservations: any[] = []

  const pick = (model: string) =>
    model === 'Reservations' ? reservations : model === 'Rooms' ? rooms : model === 'Hotels' ? hotels : []
  const match = (row: any, filter: any) => Object.entries(filter ?? {}).every(([k, v]) => row[k] === v)

  /** `gate` congela la lectura por tipo (`Reservations {hotelId, roomType}`) del `availableOfType` de
   *  afuera de la tx del comprador marcado como lento. */
  let gate: Promise<void> | null = null
  let openGate: (() => void) | null = null
  let slowBuyerActive = false

  const orm: any = {
    async findMany(model: string, filter: any = {}) {
      const rows = pick(model).filter((r: any) => match(r, filter))
      if (model === 'Reservations' && filter?.roomType && slowBuyerActive && gate) {
        const wait = gate
        gate = null
        await wait
      }
      return rows
    },
    async findOne(model: string, filter: any = {}) {
      return (await orm.findMany(model, filter))[0] ?? null
    },
    async transaction(fn: (tx: any) => Promise<void>) {
      const tx = {
        async create(model: string, data: any) {
          const row = { ...data }
          pick(model).push(row)
          return row
        },
        async update() { return null },
        async updateMany(model: string, filter: any, patch: any) {
          const hit = pick(model).filter((r: any) => match(r, filter))
          hit.forEach((r: any) => Object.assign(r, patch))
          return hit.length
        },
        async findOne(model: string, filter: any = {}) {
          return pick(model).filter((r: any) => match(r, filter))[0] ?? null
        },
        async findMany(model: string, filter: any = {}) {
          return pick(model).filter((r: any) => match(r, filter))
        },
      }
      await fn(tx)
    },
  }

  return {
    orm, reservations,
    armGate() { gate = new Promise<void>(res => { openGate = res }); slowBuyerActive = true },
    release() { slowBuyerActive = false; openGate?.() },
  }
}

const BODY = {
  hotelId: 'h1', roomType: 'double',
  checkIn: CHECK_IN, checkOut: CHECK_OUT,
  guestName: 'Huesped', guestPhone: '809', adults: 2, children: 0,
}

describe('createPublicBookingDirect — carrera por la última habitación', () => {
  it('el comprador que chequeó primero pero insertó último recibe 409, no una segunda reserva', async () => {
    const w = makeWorld()
    w.armGate()

    // A entra y queda congelado con su chequeo de solape ya hecho y en verde.
    const pA = createPublicBookingDirect(w.orm, { ...BODY, guestEmail: 'a@a.com' })
    await new Promise(r => setTimeout(r, 20))

    // B hace todo el flujo y se lleva la habitación.
    const b = await createPublicBookingDirect(w.orm, { ...BODY, guestEmail: 'b@b.com' })
    expect(b.status).toBe(201)

    // A retoma: su chequeo decía "libre", pero el re-chequeo por tipo dentro de la tx ve la de B.
    w.release()
    const a = await pA

    expect(a.status).toBe(409)
    expect(w.reservations).toHaveLength(1)
  })

  it('sin concurrencia la reserva se crea normalmente (el guard no molesta al caso feliz)', async () => {
    const w = makeWorld()
    const res = await createPublicBookingDirect(w.orm, { ...BODY, guestEmail: 'solo@a.com' })

    expect(res.status).toBe(201)
    expect(w.reservations).toHaveLength(1)
  })

  it('dos reservas que NO se solapan en fechas conviven en el mismo tipo de una sola unidad', async () => {
    const w = makeWorld()
    const first = await createPublicBookingDirect(w.orm, { ...BODY, guestEmail: 'uno@a.com' })
    const second = await createPublicBookingDirect(w.orm, {
      ...BODY, guestEmail: 'dos@a.com', checkIn: '2026-12-03', checkOut: '2026-12-05',
    })

    expect(first.status).toBe(201)
    expect(second.status).toBe(201)
    expect(w.reservations).toHaveLength(2)
  })
})
