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
import { canalesAriOutboxConnector } from '../canales-ari-outbox'

// Los encolados son fire-and-forget (`void schedule(...)`): hay que dejar correr una vuelta
// del event loop antes de mirar lo capturado.
const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms))

function makeCtx(hosts: string[], modules: Record<string, any> = {}) {
  const captured: any = { sockets: {}, audit: {}, payment: {}, userDirectory: null, staffDirectory: null, scheduled: [], publishers: {} }
  // Los conectores de ARI ya no agrupan en memoria: ENCOLAN en la outbox persistente. El doble
  // registra las llamadas para poder afirmar qué kind y qué canales se encolaron.
  const ariOutboxStub = {
    schedule: async (hotelId: string, kind: string, channels?: Array<string | undefined>) => {
      captured.scheduled.push([hotelId, kind, channels])
    },
    registerPublisher: (kind: string, publisher: any) => { captured.publishers[kind] = publisher },
    // El connector también cablea el hook de la config de la cola (el techo de peticiones/minuto
    // contra Channex): sin este método el doble no es el módulo y el connector se cae al armarse.
    setSockets: (sockets: any) => Object.assign(captured.sockets, sockets),
  }
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
      if (name === 'ari-outbox') return ariOutboxStub
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

  it('la baja de una habitación ENCOLA el sync de inventario en vez de dispararlo a mano', async () => {
    const { ctx, captured } = makeCtx(['habitaciones'], {
      canales: { syncHotel: async () => ({ ok: true }), autoProvision: async () => 'already-synced', pushSeasonalRates: async () => ({}) },
    })
    habitacionesCanalesConnector(ctx)
    await captured.sockets.onHabitacionesDeleted('rm1', { hotelId: 'h1' })
    await sleep(5)

    // kind 'inventory' y SIN canales: el inventario es uno por hotel, no se publica por canal.
    expect(captured.scheduled).toEqual([['h1', 'inventory', undefined]])
  })

  it('una carga en lote encola inventario por cada alta (juntarlas es trabajo de la outbox)', async () => {
    const { ctx, captured } = makeCtx(['habitaciones'], {
      canales: { syncHotel: async () => ({ ok: true }), autoProvision: async () => 'already-synced', pushSeasonalRates: async () => ({}) },
    })
    habitacionesCanalesConnector(ctx)
    for (let i = 0; i < 3; i++) await captured.sockets.onHabitacionesCreated({ hotelId: 'h1', type: 'double' })
    await sleep(5)

    // "12 altas = 1 solo push" ya no se prueba acá: eso lo garantiza la agrupación de la outbox
    // (src/modules/ari-outbox/tests/outbox-queue.test.ts). Acá se prueba QUÉ se encola.
    expect(captured.scheduled).toEqual([['h1', 'inventory', undefined], ['h1', 'inventory', undefined], ['h1', 'inventory', undefined]])
  })
})

describe('pricingCanalesConnector — encola en la outbox de ARI', () => {
  it('rates + restrictions del mismo guardado encolan kind rates, con el canal del override', async () => {
    const { ctx, captured } = makeCtx(['pricing'], {
      canales: { pushSeasonalRates: async () => ({ pushed: 1 }) },
    })
    pricingCanalesConnector(ctx)

    // La ráfaga real de la UI: PUT /rates (con canal) + PUT /rate-restrictions seguidos.
    await captured.sockets.onRatesUpdated('h1', 16, ['OpenChannel'])
    await captured.sockets.onRateRestrictionsUpdated('h1', 16)
    await sleep(5)

    // Las dos entran a la cola; que salga UN solo push es responsabilidad de la outbox, que las
    // fusiona por (hotel, kind) antes de que venza el debounce.
    expect(captured.scheduled).toEqual([
      ['h1', 'rates', ['OpenChannel']],
      ['h1', 'rates', [undefined]],
    ])
  })

  it('hoteles distintos no se mezclan: una fila de cola por hotel', async () => {
    const { ctx, captured } = makeCtx(['pricing'], {
      canales: { pushSeasonalRates: async () => ({ pushed: 1 }) },
    })
    pricingCanalesConnector(ctx)

    await captured.sockets.onRatesUpdated('h1', 1)
    await captured.sockets.onRatesUpdated('h2', 1, ['booking'])
    await sleep(5)

    expect(captured.scheduled).toEqual([
      ['h1', 'rates', [undefined]],   // global: la base y después los canales con override
      ['h2', 'rates', ['booking']],   // explícito: solo ese canal
    ])
  })

  it('un segundo guardado con otro canal encola ese canal (la unión la hace la outbox)', async () => {
    const { ctx, captured } = makeCtx(['pricing'], {
      canales: { pushSeasonalRates: async () => ({ pushed: 1 }) },
    })
    pricingCanalesConnector(ctx)

    await captured.sockets.onRatesUpdated('h1', 1, ['booking'])
    await captured.sockets.onRatesUpdated('h1', 1, ['airbnb'])
    await sleep(5)

    expect(captured.scheduled.map((c: any[]) => c[2][0]).sort()).toEqual(['airbnb', 'booking'])
    expect(captured.scheduled.every((c: any[]) => c[0] === 'h1' && c[1] === 'rates')).toBe(true)
  })

  it('temporadas editadas / copiadas / días pintados → misma cola consolidada de tarifas', async () => {
    const { ctx, captured } = makeCtx(['pricing'], {
      canales: { pushSeasonalRates: async () => ({ pushed: 1 }) },
    })
    pricingCanalesConnector(ctx)

    await captured.sockets.onSeasonsUpdated('h1', 4)
    await captured.sockets.onRatesCopied('h1', 8)
    await captured.sockets.onSeasonAssignmentsUpdated('h1', 3)
    await sleep(5)

    // Los tres son cambios GLOBALES: se encolan sin canal para que el drain publique la base y
    // DESPUÉS los canales con tarifa propia. Publicar solo la base borraba los precios por canal
    // en cada cambio de temporada (bug medido en producción el 2026-09-05).
    expect(captured.scheduled).toEqual([
      ['h1', 'rates', [undefined]],
      ['h1', 'rates', [undefined]],
      ['h1', 'rates', [undefined]],
    ])
  })

  it('la grilla por fecha manda el delta INMEDIATO sin pasar por la cola; revertir sí encola', async () => {
    const deltas: any[] = []
    const { ctx, captured } = makeCtx(['pricing'], {
      canales: { pushRateOverrides: async (h: string, items: any[]) => { deltas.push([h, items]); return { pushed: items.length } } },
    })
    pricingCanalesConnector(ctx)

    // Celdas guardadas → delta directo: el mapa consolidado de temporadas es justo lo que el
    // test 13 de la certificación pide NO mandar en cada cambio.
    await captured.sockets.onRateOverridesUpdated('h1', [{ date: '2026-08-01', price: 330 }], 0)
    await sleep(5)
    expect(deltas).toEqual([['h1', [{ date: '2026-08-01', price: 330 }]]])
    expect(captured.scheduled).toEqual([])

    // Celdas revertidas → sí hace falta el consolidado: Channex tiene publicado el precio del
    // override y solo el mapa de temporadas sabe con qué reemplazarlo.
    await captured.sockets.onRateOverridesUpdated('h1', [], 2)
    await sleep(5)
    expect(captured.scheduled).toEqual([['h1', 'rates', [undefined]]])
  })

  it('bloquear/desbloquear habitaciones → push de availability POR habitación', async () => {
    const avail: Array<[string, string]> = []
    const { ctx, captured } = makeCtx(['pricing'], {
      canales: { pushAvailabilityByRoom: async (h: string, r: string) => { avail.push([h, r]); return { pushed: true } } },
    })
    pricingCanalesConnector(ctx)

    await captured.sockets.onBlocksChanged('h1', ['rm1', 'rm2'])
    await sleep(50)

    // La disponibilidad por habitación NO pasa por la outbox: es un push puntual, no una ráfaga.
    expect(avail).toEqual([['h1', 'rm1'], ['h1', 'rm2']])
    expect(captured.scheduled).toEqual([])
  })
})

describe('canalesAriOutboxConnector', () => {
  it('registra quién publica cada kind: rates por canal, inventory por hotel', async () => {
    const rates: any[] = []
    const { ctx, captured } = makeCtx([], {
      canales: {
        pushSeasonalRates: async (h: string, channel?: string) => { rates.push([h, channel]); return { pushed: 1 } },
        overrideChannels: async () => ['OpenChannel'],
        syncHotel: async (h: string) => ({ synced: h }),
      },
    })
    canalesAriOutboxConnector(ctx)

    expect(Object.keys(captured.publishers).sort()).toEqual(['inventory', 'rates'])
    await captured.publishers.rates.push('h1', 'OpenChannel')
    expect(rates).toEqual([['h1', 'OpenChannel']])
    // En un cambio global el drain necesita saber a qué canales republicarles su tarifa propia.
    expect(await captured.publishers.rates.overrideChannels('h1')).toEqual(['OpenChannel'])
    // El inventario no se publica por canal: sin overrideChannels a propósito.
    expect(captured.publishers.inventory.overrideChannels).toBeUndefined()
    expect(await captured.publishers.inventory.push('h1')).toEqual({ synced: 'h1' })
  })

  it('cablea el techo de peticiones/minuto que el operador guarda en el Super Admin', async () => {
    const { ctx, captured } = makeCtx([], {
      canales: {
        pushSeasonalRates: async () => ({ pushed: 0 }),
        overrideChannels: async () => [],
        syncHotel: async () => ({}),
      },
    })
    canalesAriOutboxConnector(ctx)

    // El hook existe: sin él, el límite guardado nunca llegaría al transporte HTTP de Channex.
    expect(typeof captured.sockets.onQueueConfigChanged).toBe('function')
    await captured.sockets.onQueueConfigChanged({ maxAttempts: 5, maxPerMinute: 7 })
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
