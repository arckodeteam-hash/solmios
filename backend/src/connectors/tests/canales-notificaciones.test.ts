// connectors/tests/canales-notificaciones.test.ts — Wiring canales → notificaciones (#246).
//
// El connector cablea dos cosas sobre `canales`: el puerto de campanita de las solicitudes de OTA
// (lo de siempre) y el socket `onOtaBookingIngested`, que tiene que terminar en el aviso al hotel
// de `notifyReservationReceived(…, 'ota')`. Acá se verifica el cableado, no el usecase.

import { describe, it, expect } from 'bun:test'
import type { ConnectorContext } from 'arckode-framework'
import { silentLogger } from 'arckode-framework/testing'
import { accumulateSockets } from '../../shared/utils/accumulate-sockets'
import { canalesNotificacionesConnector, canalesNotificacionesConnectorWithLogger } from '../canales-notificaciones'

const RESERVATION = {
  id: 'r1', hotelId: 'h1', roomId: 'rm1', guestId: 'g1', status: 'confirmed', channel: 'Booking.com', source: 'ota',
  checkIn: '2026-10-01T15:00:00.000Z', checkOut: '2026-10-04T11:00:00.000Z', totalAmount: 300, currency: 'USD',
}

const USERS = [
  { id: 'u-admin', hotelId: 'h1', name: 'Admin', email: 'admin@palma.com', role: 'hotel_admin', active: 1 },
  { id: 'u-recep', hotelId: 'h1', name: 'Recepción', email: 'recep@palma.com', role: 'receptionist', active: 1 },
  { id: 'u-cama', hotelId: 'h1', name: 'Camarera', email: 'cama@palma.com', role: 'housekeeper', active: 1 },
]

function makeCtx(opts: { notifCreateThrows?: boolean; withEmail?: boolean } = {}) {
  const notifications: any[] = []
  /** Lo encolado por `enqueueNotification` cuando `withEmail` (correo al buzón del hotel). */
  const emails: any[] = []
  const sockets: Record<string, any> = {}
  const captured: { ports?: any; sockets: Record<string, any> } = { sockets }
  // Stub de canales: acumula como el service real (shared/utils/accumulate-sockets.ts).
  const canales = {
    setChannelRequestNotifyPorts: (p: any) => { captured.ports = p },
    setSockets: (s: any) => accumulateSockets(sockets, s),
  }
  const notificaciones = {
    create: async (dto: any) => {
      if (opts.notifCreateThrows) throw new Error('notifications caída')
      notifications.push(dto)
      return { id: `n-${notifications.length}`, ...dto }
    },
    hotelEmailDeps: () => opts.withEmail
      ? {
          emailSender: {
            enqueue: async () => 'q-raw',
            enqueueNotification: async (i: any) => { emails.push(i); return 'q1' },
          },
          platformIdentity: async () => ({ platformName: 'Plataforma Prueba', supportEmail: '', supportPhone: '' }),
        }
      : null,
  }
  const modules: Record<string, any> = {
    canales,
    notificaciones,
    reservas: {
      getById: async (id: string) => { if (id !== RESERVATION.id) throw new Error('Reserva no encontrada'); return { ...RESERVATION } },
      list: async () => ({ data: [{ ...RESERVATION }] }),
    },
    usuarios: { list: async (hotelId?: string) => USERS.filter((u) => u.hotelId === hotelId) },
    roles: { list: async () => ({ data: [] }) },
    hoteles: { getById: async () => ({ id: 'h1', name: 'Hotel Palma', email: opts.withEmail ? 'info@palma.com' : '' }) },
    huespedes: { getById: async () => ({ id: 'g1', name: 'Ana Pérez' }) },
    habitaciones: { getById: async () => ({ id: 'rm1', number: '101' }) },
  }
  const ctx = {
    resolveModule: (name: string) => {
      if (name in modules) return modules[name]
      throw new Error(`módulo desconocido: ${name}`)
    },
  } as unknown as ConnectorContext
  return { ctx, captured, notifications, emails }
}

const INGESTED = { hotelId: 'h1', reservationId: 'r1', ota: 'Booking.com' }

describe('canalesNotificacionesConnector — wiring (#246)', () => {
  it('registra el puerto de solicitudes de OTA Y el socket onOtaBookingIngested', () => {
    const { ctx, captured } = makeCtx()
    canalesNotificacionesConnector(ctx)

    expect(typeof captured.ports?.notificaciones?.create).toBe('function')
    expect(typeof captured.sockets.onOtaBookingIngested).toBe('function')
  })

  it('el puerto de solicitudes sigue delegando en notificaciones.create', async () => {
    const { ctx, captured, notifications } = makeCtx()
    canalesNotificacionesConnector(ctx)

    await captured.ports.notificaciones.create({ userId: 'u-admin', type: 'system', title: 'Pedido' }, { id: 'system' })
    expect(notifications).toEqual([{ userId: 'u-admin', type: 'system', title: 'Pedido' }])
  })

  it('onOtaBookingIngested → campanita "Nueva reserva de Booking.com" a quien ve reservas, con link al modal', async () => {
    const { ctx, captured, notifications } = makeCtx()
    canalesNotificacionesConnector(ctx)

    await captured.sockets.onOtaBookingIngested(INGESTED)

    // admin + recepción ven reservas; la camarera no.
    expect(notifications).toHaveLength(2)
    expect(notifications.map((n) => n.userId).sort()).toEqual(['u-admin', 'u-recep'])
    for (const n of notifications) {
      expect(n.type).toBe('reservation')
      expect(n.hotelId).toBe('h1')
      expect(n.title.startsWith('Nueva reserva de Booking.com')).toBe(true)
      expect(n.metadata.link).toBe('/panel/reservations?open=r1')
      expect(n.metadata.origin).toBe('ota')
    }
  })

  // El correo al hotel de una reserva OTA sale por SU plantilla: la de motor web decía "Entró una
  // reserva desde el motor web" y "Pendiente de pago" sobre una reserva que la OTA ya cobró.
  it('onOtaBookingIngested → correo al buzón del hotel por reservation_new_ota_staff con el canal', async () => {
    const { ctx, captured, emails } = makeCtx({ withEmail: true })
    canalesNotificacionesConnector(ctx)

    await captured.sockets.onOtaBookingIngested(INGESTED)

    expect(emails).toHaveLength(1)
    expect(emails[0].to).toBe('info@palma.com')
    expect(emails[0].event).toBe('reservation_new_ota_staff')
    expect(emails[0].variables.channel_name).toBe('Booking.com')
    expect(emails[0].variables.payment_status).toBe('')
    expect(emails[0].relatedType).toBe('reservation:ota')
  })

  it('notificaciones.create lanza → el socket resuelve igual (no frena la ingesta ni el ack)', async () => {
    const { ctx, captured, notifications } = makeCtx({ notifCreateThrows: true })
    canalesNotificacionesConnector(ctx)

    await expect(captured.sockets.onOtaBookingIngested(INGESTED)).resolves.toBeUndefined()
    expect(notifications).toHaveLength(0)
  })

  it('un módulo núcleo ausente al avisar no tumba el socket', async () => {
    const { ctx, captured } = makeCtx()
    canalesNotificacionesConnector(ctx)
    const real = ctx.resolveModule
    ;(ctx as any).resolveModule = (name: string) => {
      if (name === 'usuarios') throw new Error('usuarios no registrado')
      return real.call(ctx, name)
    }

    await expect(captured.sockets.onOtaBookingIngested(INGESTED)).resolves.toBeUndefined()
  })

  it('la variante con logger cablea lo mismo y avisa igual', async () => {
    const { ctx, captured, notifications } = makeCtx()
    canalesNotificacionesConnectorWithLogger(silentLogger())(ctx)

    await captured.sockets.onOtaBookingIngested(INGESTED)
    expect(notifications).toHaveLength(2)
    expect(typeof captured.ports?.notificaciones?.create).toBe('function')
  })
})
