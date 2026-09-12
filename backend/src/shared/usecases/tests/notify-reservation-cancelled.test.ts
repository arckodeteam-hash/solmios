import { describe, it, expect } from 'bun:test'
import { silentLogger } from 'arckode-framework/testing'
import {
  notifyReservationCancelled,
  notifySystemToViewers,
  RESERVATION_NOTIFICATION_TYPE,
} from '../notify-reservation-received'

const HOTEL = { id: 'h1', name: 'Hotel Boutique Palma', email: 'info@palma.com' }
const PLATFORM = { platformName: 'Plataforma Prueba', supportEmail: 'soporte@prueba.test', supportPhone: '' }

const USERS = [
  { id: 'u-admin', hotelId: 'h1', name: 'Admin', email: 'admin@palma.com', role: 'hotel_admin', active: 1 },
  { id: 'u-recep', hotelId: 'h1', name: 'Recepción', email: 'recep@palma.com', role: 'receptionist', active: 1 },
  { id: 'u-cama', hotelId: 'h1', name: 'Camarera', email: 'cama@palma.com', role: 'housekeeper', active: 1 },
  { id: 'u-baja', hotelId: 'h1', name: 'Ex admin', email: 'ex@palma.com', role: 'hotel_admin', active: 0 },
]

const ROLES = [
  { id: 'ro1', hotelId: 'h1', name: 'hotel_admin', permissions: ['reservations:view', 'reservations:create', 'settings:view'] },
  { id: 'ro2', hotelId: 'h1', name: 'receptionist', permissions: ['reservations:view', 'guests:view'] },
  { id: 'ro3', hotelId: 'h1', name: 'housekeeper', permissions: ['housekeeping:view'] },
]

const RESERVA = {
  id: 'r1', hotelId: 'h1', guestId: 'g1', roomId: 'room1',
  checkIn: '2026-09-12T00:00:00.000Z', checkOut: '2026-09-14T00:00:00.000Z',
  totalAmount: 150, currency: 'USD', channel: 'direct', status: 'cancelled',
}
const GUEST = { id: 'g1', hotelId: 'h1', name: 'Ana Pérez' }

interface Over {
  reservas?: any[]
  createThrows?: boolean
  withPush?: boolean
}

function harness(over: Over = {}) {
  const created: any[] = []
  const sent: any[] = []
  const pushed: any[] = []
  const reservas = over.reservas ?? [RESERVA]
  const deps: any = {
    notificaciones: {
      create: async (dto: any) => {
        if (over.createThrows) throw new Error('db caída')
        created.push(dto)
        return dto
      },
    },
    users: { list: async (hotelId?: string) => USERS.filter((u) => u.hotelId === hotelId) },
    roles: { list: async () => ({ data: ROLES }) },
    reservations: {
      findById: async (id: string) => reservas.find((r) => r.id === id) ?? null,
      findMany: async (where: Record<string, unknown>) =>
        reservas.filter((r) => Object.entries(where).every(([k, v]) => r[k] === v)),
    },
    hotels: { findById: async () => HOTEL },
    guests: { findById: async () => GUEST },
    rooms: { getById: async () => ({ id: 'room1', number: '101', type: 'Doble' }) },
    emailSender: { enqueue: async (i: any) => { sent.push(i); return 'q1' } },
    push: over.withPush
      ? { notifyUser: async (userId: string, hotelId: string, n: any) => { pushed.push({ userId, hotelId, ...n }); return 1 } }
      : null,
    platformIdentity: async () => PLATFORM,
    logger: silentLogger(),
  }
  return { deps, created, sent, pushed }
}

describe('notifyReservationCancelled (#272)', () => {
  it('crea campanitas type reservation "Cancelación web · <guest>" para los viewers y NO encola correo', async () => {
    const h = harness({ withPush: true })
    const res = await notifyReservationCancelled(h.deps, { id: 'r1', hotelId: 'h1' }, {
      refundAmount: 100, cancellationFee: 50, refundStatus: 'done',
    })

    expect(res).toEqual({ notified: 2, emailed: false })
    expect(h.sent).toHaveLength(0)
    expect(h.created).toHaveLength(2)
    expect(h.created.map((c) => c.userId).sort()).toEqual(['u-admin', 'u-recep'])
    for (const c of h.created) {
      expect(c.hotelId).toBe('h1')
      expect(c.type).toBe(RESERVATION_NOTIFICATION_TYPE)
      expect(c.title).toBe('Cancelación web · Ana Pérez')
      expect(c.message).toBe('Ana Pérez, hab. 101, 2026-09-12 → 2026-09-14, reembolso 100.00 USD (reembolsado)')
      expect(c.read).toBe(0)
      expect(c.metadata).toMatchObject({
        reservationId: 'r1', refundAmount: 100, refundStatus: 'done', link: '/panel/reservations?open=r1',
      })
    }
    expect(h.pushed).toHaveLength(2)
    expect(h.pushed[0].title).toBe('Cancelación web · Ana Pérez')
  })

  it('refundStatus failed → "reembolso pendiente"; refundAmount 0 → "sin reembolso"', async () => {
    const a = harness()
    await notifyReservationCancelled(a.deps, { id: 'r1', hotelId: 'h1' }, { refundAmount: 100, cancellationFee: 50, refundStatus: 'failed' })
    expect(a.created[0].message).toContain('reembolso 100.00 USD (reembolso pendiente)')

    const b = harness()
    await notifyReservationCancelled(b.deps, { id: 'r1', hotelId: 'h1' }, { refundAmount: 0, cancellationFee: 150, refundStatus: 'none' })
    expect(b.created[0].message).toContain('reembolso 0.00 USD (sin reembolso)')
    expect(b.created[0].metadata.refundStatus).toBe('none')
  })

  it('grupo: una sola tanda de campanitas con "hab. ×3"', async () => {
    const reservas = ['r1', 'r2', 'r3'].map((id) => ({ ...RESERVA, id, groupId: 'g1', totalAmount: 100 }))
    const h = harness({ reservas })
    const res = await notifyReservationCancelled(h.deps, { id: 'r2', hotelId: 'h1' }, { refundAmount: 300, cancellationFee: 0, refundStatus: 'done', roomsCount: 3 })
    expect(res.notified).toBe(2)
    expect(h.created[0].message).toContain('hab. ×3')
    expect(h.sent).toHaveLength(0)
  })

  it('reserva inexistente → 0 sin tirar; create que falla → 0 sin tirar', async () => {
    const a = harness()
    expect(await notifyReservationCancelled(a.deps, { id: 'nope', hotelId: 'h1' }, { refundAmount: 1, cancellationFee: 0 }))
      .toEqual({ notified: 0, emailed: false })
    const b = harness({ createThrows: true })
    expect(await notifyReservationCancelled(b.deps, { id: 'r1', hotelId: 'h1' }, { refundAmount: 1, cancellationFee: 0 }))
      .toEqual({ notified: 0, emailed: false })
  })
})

describe('notifySystemToViewers (#272)', () => {
  it('crea una campanita type system con el título dado por cada viewer, sin correo ni push', async () => {
    const h = harness({ withPush: true })
    const res = await notifySystemToViewers(h.deps, 'h1', {
      title: 'Reembolso de 100.00 USD pendiente — reintentar desde la reserva',
      message: 'La pasarela no devolvió',
      metadata: { reservationId: 'r1', refundAmount: 100 },
    })
    expect(res).toEqual({ notified: 2 })
    expect(h.created).toHaveLength(2)
    expect(h.created.map((c) => c.userId).sort()).toEqual(['u-admin', 'u-recep'])
    for (const c of h.created) {
      expect(c.type).toBe('system')
      expect(c.title).toBe('Reembolso de 100.00 USD pendiente — reintentar desde la reserva')
      expect(c.metadata).toEqual({ reservationId: 'r1', refundAmount: 100 })
    }
    expect(h.sent).toHaveLength(0)
    expect(h.pushed).toHaveLength(0)
  })

  it('si create falla no tira y devuelve 0', async () => {
    const h = harness({ createThrows: true })
    expect(await notifySystemToViewers(h.deps, 'h1', { title: 'x', message: 'y' })).toEqual({ notified: 0 })
  })
})
