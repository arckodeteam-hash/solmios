// connectors/tests/bookingengine-notificaciones.test.ts — Wiring del aviso al hotel (#246).
//
// El motor tiene TRES suscriptos a sus sockets (reservas, payments y notificaciones; el push a
// Channex lo hace el propio usecase del motor vía `pushAvailability`, no un connector — #276).
// `setSockets` acumula, así que acá se registran todos sobre un stub que usa la MISMA
// `accumulateSockets` del proyecto y se verifica que un evento los corre a TODOS — un aviso que
// falla no puede dejar sin correr al que asienta la plata.

import { describe, it, expect } from 'bun:test'
import type { ConnectorContext } from 'arckode-framework'
import { silentLogger } from 'arckode-framework/testing'
import { accumulateSockets } from '../../shared/utils/accumulate-sockets'
import { reservasBookingengineConnector } from '../reservas-bookingengine'
import { bookingenginePaymentsConnector } from '../bookingengine-payments'
import { bookingengineNotificacionesConnector } from '../bookingengine-notificaciones'

const RESERVATION = {
  id: 'res-1', hotelId: 'h1', roomId: 'rm1', guestId: 'g1', status: 'confirmed',
  checkIn: '2026-10-01T15:00:00.000Z', checkOut: '2026-10-04T11:00:00.000Z', totalAmount: 300, currency: 'USD',
}

const USERS = [
  { id: 'u-admin', hotelId: 'h1', name: 'Admin', email: 'admin@palma.com', role: 'hotel_admin', active: 1 },
  { id: 'u-recep', hotelId: 'h1', name: 'Recepción', email: 'recep@palma.com', role: 'receptionist', active: 1 },
  { id: 'u-cama', hotelId: 'h1', name: 'Camarera', email: 'cama@palma.com', role: 'housekeeper', active: 1 },
]

interface Calls {
  invalidated: string[]
  payments: any[]
  notifications: any[]
  /** `enqueue` (HTML crudo: inyector viejo). */
  emails: any[]
  /** `enqueueNotification` (plantilla `reservation_new_staff`). */
  templated: any[]
}

interface CtxOpts {
  notifCreateThrows?: boolean
  hotelEmail?: string
  withEmail?: boolean
  /** El emailSender inyectado sólo expone `enqueue` (sin plantilla). */
  legacyEmail?: boolean
}

function makeCtx(opts: CtxOpts = {}) {
  const calls: Calls = { invalidated: [], payments: [], notifications: [], emails: [], templated: [] }
  const sockets: Record<string, any> = {}
  // Stub del motor: acumula como el service real (shared/utils/accumulate-sockets.ts).
  const bookingengine = { setSockets: (s: any) => accumulateSockets(sockets, s) }

  const notificaciones = {
    create: async (dto: any) => {
      if (opts.notifCreateThrows) throw new Error('notifications caída')
      calls.notifications.push(dto)
      return { id: `n-${calls.notifications.length}`, ...dto }
    },
    hotelEmailDeps: () => opts.withEmail
      ? {
        emailSender: {
          enqueue: async (input: any) => { calls.emails.push(input); return 'q-1' },
          ...(opts.legacyEmail
            ? {}
            : { enqueueNotification: async (input: any) => { calls.templated.push(input); return 'q-2' } }),
        },
        platformIdentity: async () => ({ platformName: 'Plataforma', supportEmail: '', supportPhone: '' }),
      }
      : null,
  }

  const modules: Record<string, any> = {
    bookingengine,
    notificaciones,
    reservas: {
      invalidateListCache: async (hotelId: string) => { calls.invalidated.push(hotelId) },
      getById: async (id: string) => { if (id !== RESERVATION.id) throw new Error('Reserva no encontrada'); return { ...RESERVATION } },
      list: async () => ({ data: [{ ...RESERVATION }] }),
    },
    payments: {
      findByStripeSession: async () => null,
      createPayment: async (dto: any) => { calls.payments.push(dto); return { id: 'p-1', status: 'completed' } },
    },
    usuarios: { list: async (hotelId?: string) => USERS.filter((u) => u.hotelId === hotelId) },
    roles: { list: async () => ({ data: [] }) },
    hoteles: { getById: async () => ({ id: 'h1', name: 'Hotel Palma', email: opts.hotelEmail ?? '' }) },
    huespedes: { getById: async () => ({ id: 'g1', name: 'Ana Pérez', email: 'ana@example.com', phone: '+1 809 000 0000' }) },
    habitaciones: { getById: async () => ({ id: 'rm1', number: '101' }) },
    // pushtokens no registrado: el aviso sale sin push.
  }
  const ctx = {
    resolveModule: (name: string) => {
      if (name in modules) return modules[name]
      throw new Error(`módulo desconocido: ${name}`)
    },
  } as unknown as ConnectorContext

  const wireAll = () => {
    reservasBookingengineConnector(ctx)
    bookingenginePaymentsConnector(ctx)
    bookingengineNotificacionesConnector(silentLogger())(ctx)
  }
  return { ctx, sockets, calls, wireAll }
}

const CREATED = { id: 'res-1', hotelId: 'h1', roomId: 'rm1', status: 'confirmed', checkIn: '2026-10-01', guestName: 'Ana Pérez' }
const PAID = { id: 'res-1', hotelId: 'h1', totalAmount: 300, currency: 'USD', checkIn: '2026-10-01', paymentRef: 'cs_001', provider: 'stripe' }

describe('bookingengineNotificacionesConnector — wiring con los otros connectors del motor', () => {
  it('onBookingCreated corre TODOS los handlers: invalidación de reservas y campanita', async () => {
    const { sockets, calls, wireAll } = makeCtx()
    wireAll()

    await sockets.onBookingCreated(CREATED)

    expect(calls.invalidated).toEqual(['h1'])
    // admin + recepción ven reservas; la camarera no.
    expect(calls.notifications).toHaveLength(2)
    expect(calls.notifications.map((n) => n.userId).sort()).toEqual(['u-admin', 'u-recep'])
    for (const n of calls.notifications) {
      expect(n.type).toBe('reservation')
      expect(n.hotelId).toBe('h1')
      expect(n.metadata.link).toBe('/panel/reservations?open=res-1')
      expect(n.title).toBe('Nueva reserva web — Ana Pérez')
    }
    expect(calls.notifications[0].message).toContain('hab. 101')
    // sin correo inyectado todavía (hotelEmailDeps null) → 0 correos
    expect(calls.emails).toHaveLength(0)
  })

  it('onBookingPaid corre el asiento en payments Y el aviso de pago con el proveedor', async () => {
    const { sockets, calls, wireAll } = makeCtx()
    wireAll()

    await sockets.onBookingPaid(PAID)

    expect(calls.payments).toHaveLength(1)
    expect(calls.payments[0].reservationId).toBe('res-1')
    expect(calls.payments[0].stripeSessionId).toBe('cs_001')
    expect(calls.notifications).toHaveLength(2)
    expect(calls.notifications[0].title).toBe('Pago recibido — Ana Pérez — 300.00 USD')
    expect(calls.notifications[0].message).toBe('Ana Pérez, 300.00 USD por stripe')
    expect(calls.notifications[0].metadata.link).toBe('/panel/reservations?open=res-1')
    expect(calls.notifications[0].metadata.provider).toBe('stripe')
  })

  it('notificaciones.create lanza → onBookingCreated resuelve igual y los otros handlers corrieron', async () => {
    const { sockets, calls, wireAll } = makeCtx({ notifCreateThrows: true })
    wireAll()

    await expect(sockets.onBookingCreated(CREATED)).resolves.toBeUndefined()

    expect(calls.notifications).toHaveLength(0)
    expect(calls.invalidated).toEqual(['h1'])
  })

  it('un módulo núcleo ausente al avisar no tumba el evento (el aviso es best-effort)', async () => {
    const { ctx, sockets, calls, wireAll } = makeCtx()
    wireAll()
    const real = ctx.resolveModule
    ;(ctx as any).resolveModule = (name: string) => {
      if (name === 'usuarios') throw new Error('usuarios no registrado')
      return real.call(ctx, name)
    }

    await expect(sockets.onBookingPaid(PAID)).resolves.toBeUndefined()
    expect(calls.payments).toHaveLength(1)
  })

  it('con hotelEmailDeps inyectado y hotel con email → 1 correo por plantilla reservation_new_staff al buzón del hotel', async () => {
    const { sockets, calls, wireAll } = makeCtx({ withEmail: true, hotelEmail: 'recepcion@palma.com' })
    wireAll()

    await sockets.onBookingCreated(CREATED)

    expect(calls.emails).toHaveLength(0)
    expect(calls.templated).toHaveLength(1)
    const mail = calls.templated[0]
    expect(mail.to).toBe('recepcion@palma.com')
    expect(mail.hotelId).toBe('h1')
    expect(mail.event).toBe('reservation_new_staff')
    expect(mail.language).toBe('es')
    expect(mail.relatedId).toBe('res-1')
    expect(mail.variables.title).toBe('Nueva reserva web — Ana Pérez')
    expect(mail.variables.hotel_name).toBe('Hotel Palma')
    expect(mail.variables.platform_name).toBe('Plataforma')
    expect(mail.variables.guest_email).toBe('ana@example.com')
    expect(mail.variables.guest_phone).toBe('+1 809 000 0000')
    expect(mail.variables.room).toBe('101')
    expect(mail.variables.panel_link).toContain('/panel/reservations?open=res-1')
    // Sin `hasCheckout` en el evento el estado queda como antes: pendiente.
    expect(mail.variables.payment_status).toBe('Pendiente de pago')
    expect(calls.notifications).toHaveLength(2)
  })

  it('el evento con hasCheckout:false llega al usecase como opts → payment_status "SIN PAGO — contactar al huésped"', async () => {
    const { sockets, calls, wireAll } = makeCtx({ withEmail: true, hotelEmail: 'recepcion@palma.com' })
    wireAll()

    await sockets.onBookingCreated({ ...CREATED, guestEmail: 'ana@example.com', guestPhone: '+1 809 000 0000', paid: false, hasCheckout: false })

    expect(calls.templated).toHaveLength(1)
    expect(calls.templated[0].variables.payment_status).toBe('SIN PAGO — contactar al huésped')
  })

  it('el evento con paid:true llega al usecase como opts → payment_status "Pagado"', async () => {
    const { sockets, calls, wireAll } = makeCtx({ withEmail: true, hotelEmail: 'recepcion@palma.com' })
    wireAll()

    await sockets.onBookingCreated({ ...CREATED, paid: true, hasCheckout: true })

    expect(calls.templated[0].variables.payment_status).toBe('Pagado')
  })

  it('onBookingPaid → correo por plantilla con payment_status "Pagado" y título "Pago recibido"', async () => {
    const { sockets, calls, wireAll } = makeCtx({ withEmail: true, hotelEmail: 'recepcion@palma.com' })
    wireAll()

    await sockets.onBookingPaid(PAID)

    expect(calls.templated).toHaveLength(1)
    expect(calls.templated[0].event).toBe('reservation_new_staff')
    expect(calls.templated[0].relatedType).toBe('reservation:paid')
    expect(calls.templated[0].variables.title).toBe('Pago recibido — Ana Pérez — 300.00 USD')
    expect(calls.templated[0].variables.payment_status).toBe('Pagado')
  })

  it('con hotelEmailDeps inyectado pero hotel sin email → cae al email del hotel_admin activo', async () => {
    const { sockets, calls, wireAll } = makeCtx({ withEmail: true, hotelEmail: '' })
    wireAll()

    await sockets.onBookingPaid(PAID)

    expect(calls.templated).toHaveLength(1)
    expect(calls.templated[0].to).toBe('admin@palma.com')
    expect(calls.notifications).toHaveLength(2)
  })

  it('inyector viejo (sólo enqueue) → sigue saliendo el HTML crudo con el estado del pago', async () => {
    const { sockets, calls, wireAll } = makeCtx({ withEmail: true, legacyEmail: true, hotelEmail: 'recepcion@palma.com' })
    wireAll()

    await sockets.onBookingCreated(CREATED)

    expect(calls.templated).toHaveLength(0)
    expect(calls.emails).toHaveLength(1)
    expect(calls.emails[0].to).toBe('recepcion@palma.com')
    expect(calls.emails[0].subject).toBe('[Plataforma] Nueva reserva web — Ana Pérez')
    expect(calls.emails[0].relatedId).toBe('res-1')
    expect(calls.emails[0].html).toContain('/panel/reservations?open=res-1')
    expect(calls.emails[0].html).toContain('Estado del pago: Pendiente de pago')
  })

  it('sin id o sin hotelId en el evento no hace nada', async () => {
    const { sockets, calls, wireAll } = makeCtx()
    wireAll()

    await sockets.onBookingPaid({ hotelId: 'h1', totalAmount: 0, paymentRef: '' })

    expect(calls.notifications).toHaveLength(0)
  })
})
