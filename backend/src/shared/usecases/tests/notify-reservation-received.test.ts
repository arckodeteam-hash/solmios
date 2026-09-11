import { describe, it, expect } from 'bun:test'
import { silentLogger } from 'arckode-framework/testing'
import {
  findReservationViewers,
  notifyReservationPaid,
  notifyReservationReceived,
  reservationPanelLink,
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

/** Filas `roles` del hotel con permisos reales: de acá salen los efectivos, no del mapa estático. */
const ROLES = [
  { id: 'ro1', hotelId: 'h1', name: 'hotel_admin', permissions: ['reservations:view', 'reservations:create', 'settings:view'] },
  { id: 'ro2', hotelId: 'h1', name: 'receptionist', permissions: ['reservations:view', 'guests:view'] },
  { id: 'ro3', hotelId: 'h1', name: 'housekeeper', permissions: ['housekeeping:view'] },
]

const RESERVA = {
  id: 'r1', hotelId: 'h1', guestId: 'g1', roomId: 'room1',
  checkIn: '2026-09-12T00:00:00.000Z', checkOut: '2026-09-14T00:00:00.000Z',
  totalAmount: 150, currency: 'USD', channel: 'direct',
}
const GUEST = { id: 'g1', hotelId: 'h1', name: 'Ana Pérez' }

interface Over {
  hotel?: any
  reservas?: any[]
  roles?: any[]
  guest?: any
  createThrows?: boolean
  withPush?: boolean
  pushThrows?: boolean
  noEmail?: boolean
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
    roles: { list: async () => ({ data: over.roles ?? ROLES }) },
    reservations: {
      findById: async (id: string) => reservas.find((r) => r.id === id) ?? null,
      findMany: async (where: Record<string, unknown>) =>
        reservas.filter((r) => Object.entries(where).every(([k, v]) => r[k] === v)),
    },
    hotels: { findById: async () => (over.hotel === undefined ? HOTEL : over.hotel) },
    guests: { findById: async () => (over.guest === undefined ? GUEST : over.guest) },
    rooms: { getById: async () => ({ id: 'room1', number: '101', type: 'Doble' }) },
    emailSender: over.noEmail ? null : { enqueue: async (i: any) => { sent.push(i); return 'q1' } },
    push: over.withPush
      ? {
          notifyUser: async (userId: string, hotelId: string, n: any) => {
            if (over.pushThrows) throw new Error('firebase caído')
            pushed.push({ userId, hotelId, ...n })
            return 1
          },
        }
      : null,
    platformIdentity: async () => PLATFORM,
    logger: silentLogger(),
  }
  return { deps, created, sent, pushed }
}

describe('findReservationViewers', () => {
  it('usa los permisos de la fila roles: admin y recepción sí, camarera no, inactivo no', async () => {
    const h = harness()
    const viewers = await findReservationViewers(h.deps, 'h1')
    expect(viewers.map((v) => v.id).sort()).toEqual(['u-admin', 'u-recep'])
  })

  it('sin fila roles cae al default del rol de sistema', async () => {
    const h = harness({ roles: [] })
    const viewers = await findReservationViewers(h.deps, 'h1')
    expect(viewers.map((v) => v.id).sort()).toEqual(['u-admin', 'u-recep'])
  })

  it('la fila roles manda: si el hotel le quitó reservations:view a recepción, no recibe', async () => {
    const h = harness({
      roles: [
        { name: 'hotel_admin', permissions: ['reservations:view'] },
        { name: 'receptionist', permissions: ['guests:view'] },
      ],
    })
    const viewers = await findReservationViewers(h.deps, 'h1')
    expect(viewers.map((v) => v.id)).toEqual(['u-admin'])
  })
})

describe('notifyReservationReceived — web', () => {
  it('crea 2 notificaciones (admin + recepción) y 1 correo al buzón del hotel', async () => {
    const h = harness()
    const res = await notifyReservationReceived(h.deps, { id: 'r1', hotelId: 'h1' }, 'web')

    expect(res).toEqual({ notified: 2, emailed: true })
    expect(h.created).toHaveLength(2)
    expect(h.created.map((c) => c.userId).sort()).toEqual(['u-admin', 'u-recep'])
    for (const c of h.created) {
      expect(c.hotelId).toBe('h1')
      expect(c.type).toBe(RESERVATION_NOTIFICATION_TYPE)
      expect(c.type).toBe('reservation')
      expect(c.read).toBe(0)
      expect(c.title).toBe('Nueva reserva web — Ana Pérez')
      expect(c.message).toBe('Ana Pérez, hab. 101, 2026-09-12 → 2026-09-14, 150.00 USD')
      expect(c.metadata).toEqual({ link: '/panel/reservations?open=r1', reservationId: 'r1', origin: 'web' })
    }

    expect(h.sent).toHaveLength(1)
    expect(h.sent[0].to).toBe('info@palma.com')
    expect(h.sent[0].hotelId).toBe('h1')
    expect(h.sent[0].subject).toContain(PLATFORM.platformName)
    expect(h.sent[0].subject).toContain('Nueva reserva web')
    expect(h.sent[0].html).toContain('Ana Pérez')
    expect(h.sent[0].html).toContain(`Enviado por ${PLATFORM.platformName}`)
    expect(h.sent[0].relatedId).toBe('r1')
  })

  it('hotels.email vacío → 0 correos, las 2 notificaciones igual', async () => {
    const h = harness({ hotel: { ...HOTEL, email: '' } })
    const res = await notifyReservationReceived(h.deps, { id: 'r1', hotelId: 'h1' }, 'web')
    expect(res).toEqual({ notified: 2, emailed: false })
    expect(h.sent).toHaveLength(0)
    expect(h.created).toHaveLength(2)
  })

  it('notificaciones.create lanza → resuelve sin lanzar y el correo igual sale', async () => {
    const h = harness({ createThrows: true })
    const res = await notifyReservationReceived(h.deps, { id: 'r1', hotelId: 'h1' }, 'web')
    expect(res).toEqual({ notified: 0, emailed: true })
    expect(h.sent).toHaveLength(1)
  })

  it('reserva inexistente o de otro hotel → nada, sin lanzar', async () => {
    const h = harness()
    expect(await notifyReservationReceived(h.deps, { id: 'nope', hotelId: 'h1' }, 'web')).toEqual({ notified: 0, emailed: false })
    expect(await notifyReservationReceived(h.deps, { id: 'r1', hotelId: 'h2' }, 'web')).toEqual({ notified: 0, emailed: false })
    expect(h.created).toHaveLength(0)
    expect(h.sent).toHaveLength(0)
  })

  it('grupo de 3 hermanas → 1 aviso por usuario con "×3" y el total sumado', async () => {
    const hermanas = [
      { ...RESERVA, id: 'r1', groupId: 'grp1', totalAmount: 100 },
      { ...RESERVA, id: 'r2', groupId: 'grp1', totalAmount: 120, roomId: 'room2' },
      { ...RESERVA, id: 'r3', groupId: 'grp1', totalAmount: 80, roomId: 'room3' },
    ]
    const h = harness({ reservas: hermanas })
    const res = await notifyReservationReceived(h.deps, { id: 'r1', hotelId: 'h1' }, 'web')
    expect(res.notified).toBe(2)
    expect(h.created).toHaveLength(2)
    expect(h.created[0].message).toContain('hab. ×3')
    expect(h.created[0].message).toContain('300.00 USD')
    expect(h.sent).toHaveLength(1)
    expect(h.sent[0].html).toContain('×3')
  })

  it('sin guestId usa guestName, y sin nada el genérico', async () => {
    const h1 = harness({ reservas: [{ ...RESERVA, guestId: undefined, guestName: 'Booking Guest' }] })
    await notifyReservationReceived(h1.deps, { id: 'r1', hotelId: 'h1' }, 'web')
    expect(h1.created[0].title).toBe('Nueva reserva web — Booking Guest')

    const h2 = harness({ reservas: [{ ...RESERVA, guestId: undefined }] })
    await notifyReservationReceived(h2.deps, { id: 'r1', hotelId: 'h1' }, 'web')
    expect(h2.created[0].title).toBe('Nueva reserva web — Huésped sin nombre')
  })

  it('sin habitación cargada cae al tipo, y sin tipo lo omite', async () => {
    const h1 = harness({ reservas: [{ ...RESERVA, roomId: undefined, roomType: 'Suite' }] })
    await notifyReservationReceived(h1.deps, { id: 'r1', hotelId: 'h1' }, 'web')
    expect(h1.created[0].message).toContain('hab. Suite')

    const h2 = harness({ reservas: [{ ...RESERVA, roomId: undefined }] })
    await notifyReservationReceived(h2.deps, { id: 'r1', hotelId: 'h1' }, 'web')
    expect(h2.created[0].message).toBe('Ana Pérez, 2026-09-12 → 2026-09-14, 150.00 USD')
  })
})

describe('notifyReservationReceived — OTA', () => {
  it('el título nombra a la OTA', async () => {
    const h = harness()
    await notifyReservationReceived(h.deps, { id: 'r1', hotelId: 'h1', ota: 'Booking.com' }, 'ota')
    expect(h.created[0].title).toBe('Nueva reserva de Booking.com — Ana Pérez')
    expect(h.created[0].metadata.origin).toBe('ota')
    expect(h.sent[0].subject).toContain('Nueva reserva de Booking.com')
  })

  it('sin nombre de OTA en el payload usa el canal de la fila', async () => {
    const h = harness({ reservas: [{ ...RESERVA, channel: 'expedia' }] })
    await notifyReservationReceived(h.deps, { id: 'r1', hotelId: 'h1' }, 'ota')
    expect(h.created[0].title).toBe('Nueva reserva de expedia — Ana Pérez')
  })
})

describe('notifyReservationPaid', () => {
  it('título "Pago confirmado — …" y mensaje con monto y proveedor', async () => {
    const h = harness()
    const res = await notifyReservationPaid(
      h.deps,
      { id: 'r1', hotelId: 'h1' },
      { totalAmount: 150, currency: 'USD', provider: 'stripe', paymentRef: 'pi_123' },
    )
    expect(res).toEqual({ notified: 2, emailed: true })
    expect(h.created[0].title).toBe('Pago confirmado — Ana Pérez')
    expect(h.created[0].message).toBe('Ana Pérez, 150.00 USD por stripe')
    expect(h.created[0].metadata).toEqual({ link: reservationPanelLink('r1'), reservationId: 'r1', provider: 'stripe' })
    expect(h.sent[0].subject).toContain('Pago confirmado')
    expect(h.sent[0].html).toContain('pi_123')
  })

  it('sin proveedor dice "la pasarela"', async () => {
    const h = harness()
    await notifyReservationPaid(h.deps, { id: 'r1', hotelId: 'h1' }, { totalAmount: 150 })
    expect(h.created[0].message).toBe('Ana Pérez, 150.00 USD por la pasarela')
  })
})

describe('push', () => {
  it('con push presente avisa a cada destinatario con el link', async () => {
    const h = harness({ withPush: true })
    await notifyReservationReceived(h.deps, { id: 'r1', hotelId: 'h1' }, 'web')
    expect(h.pushed).toHaveLength(2)
    expect(h.pushed.map((p) => p.userId).sort()).toEqual(['u-admin', 'u-recep'])
    expect(h.pushed[0].title).toBe('Nueva reserva web — Ana Pérez')
    expect(h.pushed[0].data).toEqual({ link: '/panel/reservations?open=r1', reservationId: 'r1' })
  })

  it('push que lanza no rompe: las notificaciones y el correo quedan', async () => {
    const h = harness({ withPush: true, pushThrows: true })
    const res = await notifyReservationReceived(h.deps, { id: 'r1', hotelId: 'h1' }, 'web')
    expect(res).toEqual({ notified: 2, emailed: true })
  })
})

describe('reservationPanelLink', () => {
  it('apunta al listado con la reserva abierta', () => {
    expect(reservationPanelLink('abc')).toBe('/panel/reservations?open=abc')
  })
})
