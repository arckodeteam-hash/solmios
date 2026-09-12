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
  adults: 2, children: 1, childrenAges: [4], needsCrib: true, regime: 'breakfast',
  notes: 'Reserva desde widget público | Pedido especial: cuna cerca de la ventana | Total: 150.00 (subtotal 150.00 + tax 0.00)',
}
const GUEST = { id: 'g1', hotelId: 'h1', name: 'Ana Pérez', email: 'ana@example.com', phone: '+34 600 000 000' }

interface Over {
  hotel?: any
  reservas?: any[]
  roles?: any[]
  users?: any[]
  guest?: any
  createThrows?: boolean
  withPush?: boolean
  pushThrows?: boolean
  noEmail?: boolean
  /** Fake viejo: sólo `enqueue`, sin `enqueueNotification` (retrocompatibilidad). */
  legacyEmail?: boolean
}

function harness(over: Over = {}) {
  const created: any[] = []
  /** Lo encolado por `enqueue` (HTML crudo, camino viejo). */
  const sent: any[] = []
  /** Lo encolado por `enqueueNotification` (plantilla `reservation_new_staff`). */
  const notified: any[] = []
  const pushed: any[] = []
  const reservas = over.reservas ?? [RESERVA]
  const users = over.users ?? USERS
  const emailSender = over.noEmail
    ? null
    : over.legacyEmail
      ? { enqueue: async (i: any) => { sent.push(i); return 'q1' } }
      : {
          enqueue: async (i: any) => { sent.push(i); return 'q1' },
          enqueueNotification: async (i: any) => { notified.push(i); return 'q2' },
        }
  const deps: any = {
    notificaciones: {
      create: async (dto: any) => {
        if (over.createThrows) throw new Error('db caída')
        created.push(dto)
        return dto
      },
    },
    users: { list: async (hotelId?: string) => users.filter((u) => u.hotelId === hotelId) },
    roles: { list: async () => ({ data: over.roles ?? ROLES }) },
    reservations: {
      findById: async (id: string) => reservas.find((r) => r.id === id) ?? null,
      findMany: async (where: Record<string, unknown>) =>
        reservas.filter((r) => Object.entries(where).every(([k, v]) => r[k] === v)),
    },
    hotels: { findById: async () => (over.hotel === undefined ? HOTEL : over.hotel) },
    guests: { findById: async () => (over.guest === undefined ? GUEST : over.guest) },
    rooms: { getById: async () => ({ id: 'room1', number: '101', type: 'Doble' }) },
    emailSender,
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
  return { deps, created, sent, notified, pushed }
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

    // El correo va por la plantilla `reservation_new_staff`, no por HTML crudo.
    expect(h.sent).toHaveLength(0)
    expect(h.notified).toHaveLength(1)
    const mail = h.notified[0]
    expect(mail.to).toBe('info@palma.com')
    expect(mail.hotelId).toBe('h1')
    expect(mail.event).toBe('reservation_new_staff')
    expect(mail.language).toBe('es')
    expect(mail.relatedType).toBe('reservation:web')
    expect(mail.relatedId).toBe('r1')
    expect(mail.variables.title).toBe('Nueva reserva web — Ana Pérez')
    expect(mail.variables.hotel_name).toBe('Hotel Boutique Palma')
    expect(mail.variables.platform_name).toBe(PLATFORM.platformName)
    expect(mail.variables.guest_name).toBe('Ana Pérez')
    expect(mail.variables.guest_email).toBe('ana@example.com')
    expect(mail.variables.guest_phone).toBe('+34 600 000 000')
    expect(mail.variables.checkin_date).toBe('2026-09-12')
    expect(mail.variables.checkout_date).toBe('2026-09-14')
    expect(mail.variables.room).toBe('101')
    expect(mail.variables.adults).toBe(2)
    expect(mail.variables.children).toBe(1)
    expect(mail.variables.children_ages).toBe('4')
    expect(mail.variables.crib).toBe('Sí')
    expect(mail.variables.regime).toBe('breakfast')
    expect(mail.variables.total_amount).toBe('150.00 USD')
    expect(mail.variables.payment_status).toBe('Pendiente de pago')
    expect(mail.variables.panel_link).toContain('/panel/reservations?open=r1')
    // `notes` viene con " | " del motor: en `{details}` va una línea por nota, texto plano.
    expect(mail.variables.details).toBe(
      'Reserva desde widget público\nPedido especial: cuna cerca de la ventana\nTotal: 150.00 (subtotal 150.00 + tax 0.00)',
    )
  })

  it('panel_link es absoluto con PUBLIC_URL (sin barra final duplicada)', async () => {
    const prev = process.env.PUBLIC_URL
    process.env.PUBLIC_URL = 'https://app.prueba.test/'
    try {
      const h = harness()
      await notifyReservationReceived(h.deps, { id: 'r1', hotelId: 'h1' }, 'web')
      expect(h.notified[0].variables.panel_link).toBe('https://app.prueba.test/panel/reservations?open=r1')
    } finally {
      if (prev === undefined) delete process.env.PUBLIC_URL
      else process.env.PUBLIC_URL = prev
    }
  })

  it('hasCheckout=false (hotel sin pasarela) → payment_status "SIN PAGO — contactar al huésped"', async () => {
    const h = harness()
    await notifyReservationReceived(h.deps, { id: 'r1', hotelId: 'h1' }, 'web', { hasCheckout: false })
    expect(h.notified).toHaveLength(1)
    expect(h.notified[0].variables.payment_status).toBe('SIN PAGO — contactar al huésped')
  })

  it('paid=true en el alta → payment_status "Pagado" aunque hasCheckout sea false', async () => {
    const h = harness()
    await notifyReservationReceived(h.deps, { id: 'r1', hotelId: 'h1' }, 'web', { paid: true, hasCheckout: false })
    expect(h.notified[0].variables.payment_status).toBe('Pagado')
  })

  it('sin opts (o hasCheckout undefined) → "Pendiente de pago"', async () => {
    const h1 = harness()
    await notifyReservationReceived(h1.deps, { id: 'r1', hotelId: 'h1' }, 'web')
    expect(h1.notified[0].variables.payment_status).toBe('Pendiente de pago')

    const h2 = harness()
    await notifyReservationReceived(h2.deps, { id: 'r1', hotelId: 'h1' }, 'web', { hasCheckout: undefined })
    expect(h2.notified[0].variables.payment_status).toBe('Pendiente de pago')
  })

  it('sin datos opcionales en la fila, las variables caen a "—" / "No" / vacío', async () => {
    const h = harness({
      reservas: [{ ...RESERVA, roomId: undefined, adults: undefined, children: undefined, childrenAges: undefined, needsCrib: false, regime: '', notes: '' }],
      guest: { id: 'g1', name: 'Ana Pérez' },
    })
    await notifyReservationReceived(h.deps, { id: 'r1', hotelId: 'h1' }, 'web')
    const v = h.notified[0].variables
    expect(v.room).toBe('—')
    expect(v.guest_email).toBe('—')
    expect(v.guest_phone).toBe('—')
    expect(v.adults).toBe(0)
    expect(v.children).toBe(0)
    expect(v.children_ages).toBe('—')
    expect(v.crib).toBe('No')
    expect(v.regime).toBe('—')
    expect(v.details).toBe('')
  })

  it('hotels.email vacío pero hay hotel_admin activo con email → el correo va a ese admin', async () => {
    const h = harness({ hotel: { ...HOTEL, email: '' } })
    const res = await notifyReservationReceived(h.deps, { id: 'r1', hotelId: 'h1' }, 'web')
    expect(res).toEqual({ notified: 2, emailed: true })
    expect(h.notified).toHaveLength(1)
    // u-baja (hotel_admin inactivo) NO cuenta: cae al primer admin activo.
    expect(h.notified[0].to).toBe('admin@palma.com')
    expect(h.created).toHaveLength(2)
  })

  it('hotels.email vacío y ningún hotel_admin con email → 0 correos, las notificaciones igual', async () => {
    const users = USERS.map((u) => (u.role === 'hotel_admin' ? { ...u, email: '' } : u))
    const h = harness({ hotel: { ...HOTEL, email: '' }, users })
    const res = await notifyReservationReceived(h.deps, { id: 'r1', hotelId: 'h1' }, 'web')
    expect(res).toEqual({ notified: 2, emailed: false })
    expect(h.notified).toHaveLength(0)
    expect(h.sent).toHaveLength(0)
    expect(h.created).toHaveLength(2)
  })

  it('approvalStatus pending → el título arranca con "Por aprobar: " en campanita y correo', async () => {
    const h = harness({ reservas: [{ ...RESERVA, approvalStatus: 'pending' }] })
    await notifyReservationReceived(h.deps, { id: 'r1', hotelId: 'h1' }, 'web')
    expect(h.created[0].title).toBe('Por aprobar: Nueva reserva web — Ana Pérez')
    expect(h.created[0].title.startsWith('Por aprobar: ')).toBe(true)
    expect(h.notified[0].variables.title).toBe('Por aprobar: Nueva reserva web — Ana Pérez')
  })

  it('emailSender sin enqueueNotification (fake viejo) → sigue usando enqueue con HTML crudo y estado del pago', async () => {
    const h = harness({ legacyEmail: true })
    const res = await notifyReservationReceived(h.deps, { id: 'r1', hotelId: 'h1' }, 'web', { hasCheckout: false })
    expect(res).toEqual({ notified: 2, emailed: true })
    expect(h.sent).toHaveLength(1)
    expect(h.sent[0].to).toBe('info@palma.com')
    expect(h.sent[0].hotelId).toBe('h1')
    expect(h.sent[0].subject).toContain(PLATFORM.platformName)
    expect(h.sent[0].subject).toContain('Nueva reserva web')
    expect(h.sent[0].html).toContain('Ana Pérez')
    expect(h.sent[0].html).toContain('Estado del pago: SIN PAGO — contactar al huésped')
    expect(h.sent[0].html).toContain(`Enviado por ${PLATFORM.platformName}`)
    expect(h.sent[0].relatedId).toBe('r1')
  })

  it('enqueueNotification lanza → resuelve sin lanzar, emailed=false y las campanitas quedan', async () => {
    const h = harness()
    h.deps.emailSender.enqueueNotification = async () => { throw new Error('cola caída') }
    const res = await notifyReservationReceived(h.deps, { id: 'r1', hotelId: 'h1' }, 'web')
    expect(res).toEqual({ notified: 2, emailed: false })
    expect(h.created).toHaveLength(2)
  })

  it('notificaciones.create lanza → resuelve sin lanzar y el correo igual sale', async () => {
    const h = harness({ createThrows: true })
    const res = await notifyReservationReceived(h.deps, { id: 'r1', hotelId: 'h1' }, 'web')
    expect(res).toEqual({ notified: 0, emailed: true })
    expect(h.notified).toHaveLength(1)
  })

  it('reserva inexistente o de otro hotel → nada, sin lanzar', async () => {
    const h = harness()
    expect(await notifyReservationReceived(h.deps, { id: 'nope', hotelId: 'h1' }, 'web')).toEqual({ notified: 0, emailed: false })
    expect(await notifyReservationReceived(h.deps, { id: 'r1', hotelId: 'h2' }, 'web')).toEqual({ notified: 0, emailed: false })
    expect(h.created).toHaveLength(0)
    expect(h.notified).toHaveLength(0)
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
    expect(h.notified).toHaveLength(1)
    expect(h.notified[0].variables.room).toBe('×3')
    expect(h.notified[0].variables.total_amount).toBe('300.00 USD')
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
    expect(h.notified[0].variables.title).toContain('Nueva reserva de Booking.com')
    expect(h.notified[0].relatedType).toBe('reservation:ota')
  })

  it('sin nombre de OTA en el payload usa el canal de la fila', async () => {
    const h = harness({ reservas: [{ ...RESERVA, channel: 'expedia' }] })
    await notifyReservationReceived(h.deps, { id: 'r1', hotelId: 'h1' }, 'ota')
    expect(h.created[0].title).toBe('Nueva reserva de expedia — Ana Pérez')
  })
})

describe('notifyReservationPaid', () => {
  it('título "Pago recibido — {huésped} — {monto}" y mensaje con monto y proveedor', async () => {
    const h = harness()
    const res = await notifyReservationPaid(
      h.deps,
      { id: 'r1', hotelId: 'h1' },
      { totalAmount: 150, currency: 'USD', provider: 'stripe', paymentRef: 'pi_123' },
    )
    expect(res).toEqual({ notified: 2, emailed: true })
    expect(h.created[0].title).toBe('Pago recibido — Ana Pérez — 150.00 USD')
    expect(h.created[0].message).toBe('Ana Pérez, 150.00 USD por stripe')
    expect(h.created[0].metadata).toEqual({ link: reservationPanelLink('r1'), reservationId: 'r1', provider: 'stripe' })
  })

  it('el correo va por reservation_new_staff con payment_status "Pagado"', async () => {
    const h = harness()
    await notifyReservationPaid(
      h.deps,
      { id: 'r1', hotelId: 'h1' },
      { totalAmount: 150, currency: 'USD', provider: 'stripe', paymentRef: 'pi_123' },
    )
    expect(h.sent).toHaveLength(0)
    expect(h.notified).toHaveLength(1)
    expect(h.notified[0].event).toBe('reservation_new_staff')
    expect(h.notified[0].to).toBe('info@palma.com')
    expect(h.notified[0].relatedType).toBe('reservation:paid')
    expect(h.notified[0].variables.title).toBe('Pago recibido — Ana Pérez — 150.00 USD')
    expect(h.notified[0].variables.payment_status).toBe('Pagado')
    expect(h.notified[0].variables.total_amount).toBe('150.00 USD')
  })

  it('con fake viejo (sólo enqueue) el HTML trae la referencia y "Estado del pago: Pagado"', async () => {
    const h = harness({ legacyEmail: true })
    await notifyReservationPaid(
      h.deps,
      { id: 'r1', hotelId: 'h1' },
      { totalAmount: 150, currency: 'USD', provider: 'stripe', paymentRef: 'pi_123' },
    )
    expect(h.sent).toHaveLength(1)
    expect(h.sent[0].subject).toContain('Pago recibido')
    expect(h.sent[0].html).toContain('pi_123')
    expect(h.sent[0].html).toContain('Estado del pago: Pagado')
  })

  it('approvalStatus pending → "Por aprobar: Pago recibido — …"', async () => {
    const h = harness({ reservas: [{ ...RESERVA, approvalStatus: 'pending' }] })
    await notifyReservationPaid(h.deps, { id: 'r1', hotelId: 'h1' }, { totalAmount: 150, currency: 'USD' })
    expect(h.created[0].title).toBe('Por aprobar: Pago recibido — Ana Pérez — 150.00 USD')
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
