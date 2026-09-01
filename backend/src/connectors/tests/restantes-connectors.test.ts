// connectors/tests/restantes-connectors.test.ts — TC-05: conectores restantes + roles-auditlog.
//
// booking-channex, bookingengine-payments, habitaciones-canales, messages-*, pushtokens-usuarios,
// payment-requests-payments y roles-auditlog (el connector de SC-05, que había quedado sin test).

import { describe, it, expect } from 'bun:test'
import type { ConnectorContext } from 'arckode-framework'
import { bookingChannexConnector } from '../booking-channex'
import { pricingCanalesConnector } from '../pricing-canales'
import { bookingenginePaymentsConnector } from '../bookingengine-payments'
import { habitacionesCanalesConnector } from '../habitaciones-canales'
import { messagesPushtokensConnector } from '../messages-pushtokens'
import { messagesUsuariosConnector } from '../messages-usuarios'
import { pushtokensUsuariosConnector } from '../pushtokens-usuarios'
import { paymentRequestsPaymentsConnector } from '../payment-requests-payments'
import { rolesAuditlogConnector } from '../roles-auditlog'

function makeCtx(hosts: string[], modules: Record<string, any> = {}) {
  const captured: any = { sockets: {}, audit: {}, payment: {}, userDirectory: null, staffDirectory: null }
  const hostStub = {
    setSockets: (s: any) => Object.assign(captured.sockets, s),
    setAuditDeps: (p: any) => Object.assign(captured.audit, p),
    setPaymentDeps: (p: any) => Object.assign(captured.payment, p),
    setUserDirectory: (d: any) => { captured.userDirectory = d },
    setStaffDirectory: (d: any) => { captured.staffDirectory = d },
  }
  const ctx = {
    resolveModule: (name: string) => {
      if (hosts.includes(name)) return { ...hostStub, ...(modules[name] ?? {}) }
      if (name in modules) return modules[name]
      throw new Error(`módulo desconocido: ${name}`)
    },
  } as unknown as ConnectorContext
  return { ctx, captured }
}

describe('rolesAuditlogConnector (SC-05)', () => {
  it('delega el registro al auditlog con entity=role', async () => {
    const entries: any[] = []
    const { ctx, captured } = makeCtx(['roles'], { auditlog: { create: async (d: any) => { entries.push(d); return d } } })
    rolesAuditlogConnector(ctx)
    await captured.audit.record({ hotelId: 'h1', userId: 'u1', action: 'role.delete', entityId: 'role-1', detail: 'Rol "Cajero" eliminado' })

    expect(entries[0].entity).toBe('role')
    expect(entries[0].action).toBe('role.delete')
    expect(entries[0].entityId).toBe('role-1')
    expect(entries[0].userId).toBe('u1') // queda quién lo hizo
  })
})

describe('bookingChannexConnector', () => {
  it('empuja disponibilidad SOLO si la reserva del motor queda confirmada', async () => {
    const pushes: any[] = []
    const { ctx, captured } = makeCtx(['bookingengine'], {
      canales: { pushAvailabilityByRoom: async (h: string, r: string) => { pushes.push([h, r]); return { pushed: true } } },
    })
    bookingChannexConnector(ctx)

    await captured.sockets.onBookingCreated({ hotelId: 'h1', roomType: 'suite', roomId: 'rm1', checkIn: '2026-08-01', status: 'confirmed' })
    await captured.sockets.onBookingCreated({ hotelId: 'h1', roomType: 'suite', roomId: 'rm2', checkIn: '2026-08-02', status: 'pending' })

    expect(pushes).toHaveLength(1) // la pendiente NO empuja
    expect(pushes[0]).toEqual(['h1', 'rm1']) // por roomId: resuelve el room type real
  })

  it('si Channex falla, la reserva del motor NO se rompe', async () => {
    const { ctx, captured } = makeCtx(['bookingengine'], {
      canales: { pushAvailabilityByRoom: async () => { throw new Error('channex caído') } },
    })
    bookingChannexConnector(ctx)
    await expect(
      captured.sockets.onBookingCreated({ hotelId: 'h1', roomType: 'suite', checkIn: '2026-08-01', status: 'confirmed' }),
    ).resolves.toBeUndefined()
  })
})

describe('bookingenginePaymentsConnector', () => {
  it('una reserva del motor pagada se asienta en payments', async () => {
    const created: any[] = []
    const { ctx, captured } = makeCtx(['bookingengine'], {
      payments: {
        findByStripeSession: async () => null, // sin pago previo → no hay dedup
        createPayment: async (d: any) => { created.push(d); return { id: 'pay1', status: 'completed' } },
      },
    })
    bookingenginePaymentsConnector(ctx)
    await captured.sockets.onBookingPaid({
      id: 'b1', hotelId: 'h1', totalAmount: 400, paymentRef: 'cs_1',
      guestName: 'Ana', checkIn: '2026-08-01', currency: 'usd',
    } as any)
    expect(created).toHaveLength(1)
    expect(created[0].hotelId).toBe('h1')
    expect(created[0].method).toBe('link')      // entra por checkout web, no mostrador
    expect(created[0].status).toBe('completed') // Stripe ya confirmó: es dinero recibido
    expect(created[0].currency).toBe('USD')     // normaliza a mayúsculas
  })
})

describe('habitacionesCanalesConnector', () => {
  it('al cambiar el precio de la habitación empuja las tarifas por temporada al canal', async () => {
    const calls: any[] = []
    const { ctx, captured } = makeCtx(['habitaciones'], {
      canales: { pushSeasonalRates: async (h: string, channel?: string) => { calls.push([h, channel]); return { pushed: 1 } } },
    })
    habitacionesCanalesConnector(ctx)
    await captured.sockets.onHabitacionesUpdated({ hotelId: 'h1', type: 'double', basePrice: '150' })

    // Sin canal: la ruta base por temporada (antes pushRate plano 30d que pisaba temporadas).
    expect(calls).toEqual([['h1', undefined]])
  })
})

describe('pricingCanalesConnector — coalescing (un push por ráfaga de guardado)', () => {
  const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms))

  it('rates + restrictions del mismo guardado → UN solo push, con el canal del override', async () => {
    const pushes: Array<[string, string | undefined]> = []
    const { ctx, captured } = makeCtx(['pricing'], {
      canales: { pushSeasonalRates: async (h: string, channel?: string) => { pushes.push([h, channel]); return { pushed: 1 } } },
    })
    pricingCanalesConnector(ctx, 40) // debounce corto para el test

    // La ráfaga real de la UI: PUT /rates (con canal) + PUT /rate-restrictions seguidos.
    await captured.sockets.onRatesUpdated('h1', 16, ['OpenChannel'])
    await captured.sockets.onRateRestrictionsUpdated('h1', 16)
    await sleep(90)

    expect(pushes).toEqual([['h1', 'OpenChannel']])   // UN push, del canal tocado
  })

  it('hoteles distintos no se mezclan: un push cada uno', async () => {
    const pushes: Array<[string, string | undefined]> = []
    const { ctx, captured } = makeCtx(['pricing'], {
      canales: { pushSeasonalRates: async (h: string, channel?: string) => { pushes.push([h, channel]); return { pushed: 1 } } },
    })
    pricingCanalesConnector(ctx, 40)

    await captured.sockets.onRatesUpdated('h1', 1)
    await captured.sockets.onRatesUpdated('h2', 1, ['booking'])
    await sleep(90)

    expect(pushes.sort()).toEqual([['h1', undefined], ['h2', 'booking']])
  })

  it('un segundo guardado dentro de la ventana retrasa el push (se acumulan los canales)', async () => {
    const pushes: Array<[string, string | undefined]> = []
    const { ctx, captured } = makeCtx(['pricing'], {
      canales: { pushSeasonalRates: async (h: string, channel?: string) => { pushes.push([h, channel]); return { pushed: 1 } } },
    })
    pricingCanalesConnector(ctx, 60)

    await captured.sockets.onRatesUpdated('h1', 1, ['booking'])
    await sleep(30)                                    // todavía dentro de la ventana
    await captured.sockets.onRatesUpdated('h1', 1, ['airbnb'])
    await sleep(120)

    expect(pushes.length).toBe(2)                      // un push por canal, ambos al final
    expect(pushes.map((p) => p[1]).sort()).toEqual(['airbnb', 'booking'])
  })
})

describe('messagesPushtokensConnector', () => {
  it('un mensaje enviado dispara el push al destinatario', async () => {
    const pushes: any[] = []
    const { ctx, captured } = makeCtx(['messages'], {
      pushtokens: { notifyChatMessage: async (i: any) => { pushes.push(i); return 1 } },
    })
    messagesPushtokensConnector(ctx)
    await captured.sockets.onMessageSent({
      hotelId: 'h1', fromUserId: 'u1', toUserId: 'u2', message: 'Hola', photoUrl: null,
    } as any)

    expect(pushes[0].toUserId).toBe('u2')
    expect(pushes[0].text).toBe('Hola')
    expect(pushes[0].hasPhoto).toBe(false)
  })

  it('marca hasPhoto cuando el mensaje trae foto', async () => {
    const pushes: any[] = []
    const { ctx, captured } = makeCtx(['messages'], {
      pushtokens: { notifyChatMessage: async (i: any) => { pushes.push(i); return 1 } },
    })
    messagesPushtokensConnector(ctx)
    await captured.sockets.onMessageSent({
      hotelId: 'h1', fromUserId: 'u1', toUserId: 'u2', message: '', photoUrl: '/uploads/a.jpg',
    } as any)
    expect(pushes[0].hasPhoto).toBe(true)
  })
})

describe('messagesUsuariosConnector', () => {
  it('el directorio de chat mapea usuarios → contactos', async () => {
    const { ctx, captured } = makeCtx(['messages'], {
      usuarios: { list: async () => [{ id: 1, name: 'Ana', role: 'receptionist', avatar: null }] },
    })
    messagesUsuariosConnector(ctx)
    const staff = await captured.userDirectory.listStaff('h1')

    expect(staff).toHaveLength(1)
    expect(staff[0].id).toBe('1') // normaliza a string
    expect(staff[0].name).toBe('Ana')
    expect(staff[0].role).toBe('receptionist')
  })
})

describe('pushtokensUsuariosConnector', () => {
  it('resuelve el nombre del staff para el push', async () => {
    const { ctx, captured } = makeCtx(['pushtokens'], {
      usuarios: { list: async () => [{ id: 'u1', name: 'Rosa' }, { id: 'u2', name: 'Luis' }] },
    })
    pushtokensUsuariosConnector(ctx)

    expect(await captured.staffDirectory.nameOf('h1', 'u2')).toBe('Luis')
    expect(await captured.staffDirectory.nameOf('h1', 'nadie')).toBe('') // desconocido → vacío, no rompe
  })
})

describe('paymentRequestsPaymentsConnector', () => {
  it('busca el pago por sesión de Stripe delegando en payments', async () => {
    const { ctx, captured } = makeCtx(['payment-requests'], {
      payments: {
        findByStripeSession: async (h: string, s: string) => (s === 'cs_1' ? { id: 'pay1', status: 'completed' } : null),
        createPayment: async (d: any) => ({ id: 'pay2', status: 'completed', ...d }),
      },
    })
    paymentRequestsPaymentsConnector(ctx)

    const found = await captured.payment.paymentPort.findBySession('h1', 'cs_1')
    expect(found?.id).toBe('pay1')
    expect(await captured.payment.paymentPort.findBySession('h1', 'cs_inexistente')).toBeNull()
  })
})
