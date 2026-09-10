// canales/tests/booking-sync.test.ts — Ola 1 cron Channex (issue #564)
//
// Cubre el path GLOBAL de ingesta de bookings: resolución propertyId→hotelId, dedupe,
// unmapped, feed vacío y resiliencia (un fallo por item no corta el loop).
// También cubre `mapBookingRevision` como función pura (sin IO).
import { describe, it, expect } from 'bun:test'
import { mapBookingRevision } from '../usecases/booking-ingestion'
import { BookingSyncUseCase } from '../usecases/booking-sync'
import type { BookingRevisionDTO } from '../types'

// `error` incluido: el camino del webhook que no encuentra la revisión lo usa, y sin él el stub
// rompía con "logger.error is not a function" en vez de ejercitar el caso.
const fakeLogger = { info: () => {}, warn: () => {}, error: () => {} }

// ─── Builders de fixtures ───────────────────────────────────────────────
function makeRevision(over: Partial<BookingRevisionDTO> = {}): BookingRevisionDTO {
  return {
    id: 'rev-1',
    propertyId: 'propA',
    bookingId: 'bk-1',
    uniqueId: 'U-1',
    otaReservationCode: 'OTA-1',
    otaName: 'booking.com',
    status: 'new',
    arrivalDate: '2026-09-01',
    departureDate: '2026-09-03',
    amount: '120.50',
    currency: 'USD',
    customer: { name: 'John', surname: 'Doe', mail: 'j@x.com', phone: '+18095550000' },
    rooms: [{
      roomTypeId: 'rt-1', ratePlanId: 'rp-1',
      checkinDate: '2026-09-01', checkoutDate: '2026-09-03', amount: '120.50',
      occupancy: { adults: 2, children: 1, infants: 1 },
    }],
    insertedAt: '2026-08-01T00:00:00Z',
    ...over,
  }
}

function makeChannexStub(feed: BookingRevisionDTO[], opts: { ackFailId?: string } = {}) {
  const ackCalls: string[] = []
  const channex: any = {
    fetchBookingFeed: async () => feed,
    ackBooking: async (_key: string, revId: string) => {
      ackCalls.push(revId)
      if (opts.ackFailId && revId === opts.ackFailId) throw new Error('ack boom')
      return true
    },
    getRoomTypeById: async () => ({ id: 'rt-1', title: 'Double' }),
  }
  return { channex, ackCalls }
}

function makeOrm(opts: {
  configs?: any[]
  existingRes?: any[]
  rooms?: any[]
  createThrowOnCall?: number  // número de llamada a create que lanza (1-based)
} = {}) {
  const created: any[] = []
  let createCalls = 0
  const orm: any = {
    findMany: async (model: string) => {
      if (model === 'Canales') return opts.configs ?? []
      if (model === 'Reservations') return opts.existingRes ?? []
      if (model === 'Rooms') return opts.rooms ?? [{ id: 'room-1', type: 'Double' }]
      return []
    },
    create: async (_model: string, payload: any) => {
      createCalls++
      if (opts.createThrowOnCall && createCalls === opts.createThrowOnCall) {
        throw new Error('DB write failed')
      }
      created.push(payload)
      return payload
    },
    update: async () => {},
  }
  return { orm, created }
}

const deps = (channex: any, orm: any) => ({
  channex, queries: {} as any, orm, logger: fakeLogger as any,
})

// ─── mapBookingRevision — función pura ──────────────────────────────────
describe('mapBookingRevision — función pura', () => {
  it('customer sin name ni surname → otaNotes usa "OTA Guest"', () => {
    const dto = mapBookingRevision(makeRevision({ customer: {} }), 'h1')
    expect(dto.otaNotes).toContain('OTA Guest')
  })

  it('customer con name pero sin surname → usa el name (no "OTA Guest")', () => {
    const dto = mapBookingRevision(makeRevision({ customer: { name: 'Carol' } }), 'h1')
    expect(dto.otaNotes).toContain('Carol')
    expect(dto.otaNotes).not.toContain('OTA Guest')
  })

  it('status cancelled → dto.status "cancelled"; otro status → "confirmed"', () => {
    expect(mapBookingRevision(makeRevision({ status: 'cancelled' }), 'h1').status).toBe('cancelled')
    expect(mapBookingRevision(makeRevision({ status: 'new' }), 'h1').status).toBe('confirmed')
    expect(mapBookingRevision(makeRevision({ status: 'modified' }), 'h1').status).toBe('confirmed')
  })

  it('adults/children desde occupancy: adults directo, children = children + infants', () => {
    // default: adults:2, children:1, infants:1 → adults 2, children 2
    const dto = mapBookingRevision(makeRevision(), 'h1')
    expect(dto.adults).toBe(2)
    expect(dto.children).toBe(2)
  })

  it('occupancy ausente → adults default 2, children 0', () => {
    const rev = makeRevision({
      rooms: [{
        roomTypeId: null, ratePlanId: null, checkinDate: '', checkoutDate: '', amount: '',
        occupancy: undefined as any,
      }],
    })
    const dto = mapBookingRevision(rev, 'h1')
    expect(dto.adults).toBe(2)
    expect(dto.children).toBe(0)
  })

  it('externalLocator = otaReservationCode || uniqueId', () => {
    expect(mapBookingRevision(makeRevision({ otaReservationCode: 'OTA-9' }), 'h1').externalLocator).toBe('OTA-9')
    expect(mapBookingRevision(makeRevision({ otaReservationCode: '', uniqueId: 'UID-9' }), 'h1').externalLocator).toBe('UID-9')
  })

  it('hotelId inyectado por parámetro (no desde cfg)', () => {
    expect(mapBookingRevision(makeRevision(), 'hotelXYZ').hotelId).toBe('hotelXYZ')
  })
})

// ─── BookingSyncUseCase — resolución multi-tenancy ──────────────────────
describe('BookingSyncUseCase — path global (issue #564)', () => {
  it('cada revisión lleva el hotelId de su propertyId', async () => {
    const configs = [
      { hotelId: 'hotelA', channexPropertyId: 'propA', syncEnabled: 1 },
      { hotelId: 'hotelB', channexPropertyId: 'propB', syncEnabled: 1 },
    ]
    const feed = [
      makeRevision({ id: 'r1', propertyId: 'propA', uniqueId: 'u1', otaReservationCode: 'ota1' }),
      makeRevision({ id: 'r2', propertyId: 'propB', uniqueId: 'u2', otaReservationCode: 'ota2' }),
    ]
    const { channex } = makeChannexStub(feed)
    const { orm, created } = makeOrm({ configs })
    const res = await new BookingSyncUseCase(deps(channex, orm)).run()

    expect(res.ingested).toBe(2)
    expect(res.unmapped).toBe(0)
    expect(created.find(c => c.hotelId === 'hotelA')).toBeTruthy()
    expect(created.find(c => c.hotelId === 'hotelB')).toBeTruthy()
  })

  it('propertyId no mapeado → unmapped=1, no se crea ni se ackea', async () => {
    const configs = [{ hotelId: 'hotelA', channexPropertyId: 'propA', syncEnabled: 1 }]
    const feed = [makeRevision({ id: 'r1', propertyId: 'propZ', uniqueId: 'u1' })]
    const { channex, ackCalls } = makeChannexStub(feed)
    const { orm, created } = makeOrm({ configs })
    const res = await new BookingSyncUseCase(deps(channex, orm)).run()

    expect(res.unmapped).toBe(1)
    expect(res.ingested).toBe(0)
    expect(created).toHaveLength(0)
    expect(ackCalls).toHaveLength(0) // NO se ackea (queda para cuando el hotel sincronice)
    expect(res.success).toBe(true)   // unmapped no es un error
  })

  it('dedupe: externalLocator ya existe → skipped sube, ack SÍ se llama', async () => {
    const configs = [{ hotelId: 'hotelA', channexPropertyId: 'propA', syncEnabled: 1 }]
    const feed = [makeRevision({ id: 'r1', propertyId: 'propA', otaReservationCode: 'EXISTING-1' })]
    const { channex, ackCalls } = makeChannexStub(feed)
    const { orm, created } = makeOrm({ configs, existingRes: [{ id: 'res-old' }] })
    const res = await new BookingSyncUseCase(deps(channex, orm)).run()

    expect(res.skipped).toBe(1)
    expect(res.ingested).toBe(0)
    expect(created).toHaveLength(0)
    expect(ackCalls).toHaveLength(1) // se ackea igual → drena el feed
    expect(res.acknowledged).toBe(1)
  })

  it('feed vacío → feedSize 0, métricas en cero, success true', async () => {
    const configs = [{ hotelId: 'hotelA', channexPropertyId: 'propA', syncEnabled: 1 }]
    const { channex } = makeChannexStub([])
    const { orm } = makeOrm({ configs })
    const res = await new BookingSyncUseCase(deps(channex, orm)).run()

    expect(res.feedSize).toBe(0)
    expect(res.ingested).toBe(0)
    expect(res.acknowledged).toBe(0)
    expect(res.skipped).toBe(0)
    expect(res.unmapped).toBe(0)
    expect(res.success).toBe(true)
  })

  it('una revisión que throw → errors sube, el resto del loop continúa, success false', async () => {
    const configs = [{ hotelId: 'hotelA', channexPropertyId: 'propA', syncEnabled: 1 }]
    const feed = [
      makeRevision({ id: 'r1', propertyId: 'propA', uniqueId: 'u1', otaReservationCode: 'ota1' }),
      makeRevision({ id: 'r2', propertyId: 'propA', uniqueId: 'u2', otaReservationCode: 'ota2' }),
    ]
    const { channex } = makeChannexStub(feed)
    // La 2da llamada a create lanza → simula fallo de DB aislado.
    const { orm } = makeOrm({ configs, createThrowOnCall: 2 })
    const res = await new BookingSyncUseCase(deps(channex, orm)).run()

    expect(res.ingested).toBe(1)            // la 1ra sí se creó
    expect(res.errors).toHaveLength(1)      // la 2da falló
    expect(res.errors[0]).toContain('u2')
    expect(res.success).toBe(false)
  })

  it('#542: hotel con suscripción suspendida → suspended sube, no se crea ni se ackea', async () => {
    const configs = [{ hotelId: 'hotelA', channexPropertyId: 'propA', syncEnabled: 1 }]
    const feed = [makeRevision({ id: 'r1', propertyId: 'propA', uniqueId: 'u1', otaReservationCode: 'ota1' })]
    const { channex, ackCalls } = makeChannexStub(feed)
    const { orm, created } = makeOrm({ configs })
    const usecase = new BookingSyncUseCase(deps(channex, orm))
    usecase.setSubscriptionCheck(async () => ({ allowed: false }))
    const res = await usecase.run()

    expect(res.suspended).toBe(1)
    expect(res.ingested).toBe(0)
    expect(created).toHaveLength(0)
    expect(ackCalls).toHaveLength(0) // NO se ackea (se reintenta si el hotel se reactiva)
    expect(res.success).toBe(true)   // suspended no es un error
  })

  it('#542: hotel con suscripción activa (allowed:true) → ingesta normal, sin regresión', async () => {
    const configs = [{ hotelId: 'hotelA', channexPropertyId: 'propA', syncEnabled: 1 }]
    const feed = [makeRevision({ id: 'r1', propertyId: 'propA', uniqueId: 'u1', otaReservationCode: 'ota1' })]
    const { channex } = makeChannexStub(feed)
    const { orm, created } = makeOrm({ configs })
    const usecase = new BookingSyncUseCase(deps(channex, orm))
    usecase.setSubscriptionCheck(async () => ({ allowed: true }))
    const res = await usecase.run()

    expect(res.suspended).toBe(0)
    expect(res.ingested).toBe(1)
    expect(created).toHaveLength(1)
  })

  it('sin setSubscriptionCheck cableado → no bloquea nada (comportamiento previo intacto)', async () => {
    const configs = [{ hotelId: 'hotelA', channexPropertyId: 'propA', syncEnabled: 1 }]
    const feed = [makeRevision({ id: 'r1', propertyId: 'propA', uniqueId: 'u1', otaReservationCode: 'ota1' })]
    const { channex } = makeChannexStub(feed)
    const { orm, created } = makeOrm({ configs })
    const res = await new BookingSyncUseCase(deps(channex, orm)).run()

    expect(res.suspended).toBe(0)
    expect(res.ingested).toBe(1)
    expect(created).toHaveLength(1)
  })

  it('config con channexPropertyId vacío se ignora del mapa', async () => {
    const configs = [
      { hotelId: 'hotelA', channexPropertyId: 'propA', syncEnabled: 1 },
      { hotelId: 'hotelC', channexPropertyId: null, syncEnabled: 1 }, // sin sincronizar
    ]
    const feed = [makeRevision({ id: 'r1', propertyId: 'propA', uniqueId: 'u1', otaReservationCode: 'ota1' })]
    const { channex, ackCalls } = makeChannexStub(feed)
    const { orm } = makeOrm({ configs })
    const res = await new BookingSyncUseCase(deps(channex, orm)).run()

    expect(res.ingested).toBe(1)
    expect(res.unmapped).toBe(0)
    expect(ackCalls).toHaveLength(1)
  })
})

// ─── Drenado del feed: no dejar revisiones esperando al próximo tick ─────
//
// El feed de Channex es una VENTANA DE 30 MINUTOS, no una cola durable: lo que no se ackea
// dentro de ese rato desaparece y no vuelve nunca. Devuelve hasta 50 por llamada, así que una
// tanda grande (un canal que reconecta y vuelca su backlog) no entra en una sola vuelta.
// Antes se procesaban 50 y se dejaba el resto "para el próximo tick": con el cron cada minuto,
// el techo real era 50 reservas/minuto y una tanda de más de ~1500 perdía las últimas.
describe('BookingSyncUseCase.run — drenado del feed', () => {
  /** Devuelve páginas sucesivas del feed, como Channex después de cada ack. */
  function makeChannexPaginado(paginas: BookingRevisionDTO[][]) {
    let vuelta = 0
    const ackCalls: string[] = []
    const channex: any = {
      fetchBookingFeed: async () => paginas[vuelta++] ?? [],
      ackBooking: async (_k: string, revId: string) => { ackCalls.push(revId); return true },
      getRoomTypeById: async () => ({ id: 'rt-1', title: 'Double' }),
    }
    return { channex, ackCalls, vueltas: () => vuelta }
  }

  const lote = (n: number, prefijo: string) =>
    Array.from({ length: n }, (_, i) => makeRevision({ id: `${prefijo}-${i}`, uniqueId: `${prefijo}-U-${i}` }))

  const configs = [{ hotelId: 'hotelA', channexPropertyId: 'propA', syncEnabled: 1 }]

  it('feed lleno → sigue pidiendo hasta vaciarlo, sin esperar al próximo tick', async () => {
    const { channex, vueltas } = makeChannexPaginado([lote(50, 'a'), lote(50, 'b'), lote(3, 'c')])
    const { orm } = makeOrm({ configs })

    const res = await new BookingSyncUseCase(deps(channex, orm)).run()

    expect(vueltas()).toBe(3)        // pidió de nuevo tras cada página llena
    expect(res.feedSize).toBe(103)   // procesó las 103, no sólo las primeras 50
    expect(res.ingested).toBe(103)
  })

  it('una sola página incompleta → una sola llamada al feed', async () => {
    const { channex, vueltas } = makeChannexPaginado([lote(3, 'a')])
    const { orm } = makeOrm({ configs })

    const res = await new BookingSyncUseCase(deps(channex, orm)).run()

    expect(vueltas()).toBe(1)
    expect(res.feedSize).toBe(3)
  })

  // El corte de seguridad: las revisiones sin mapeo NO se ackean a propósito (ackear sería tirar
  // la reserva), así que el feed devuelve exactamente las mismas 50 en cada vuelta. Sin este
  // freno, el drenado giraría para siempre y colgaría el cron.
  it('página llena que no ackea nada → corta en vez de girar para siempre', async () => {
    const paginaFija = lote(50, 'x')
    let vuelta = 0
    const channex: any = {
      fetchBookingFeed: async () => { vuelta++; return paginaFija },
      ackBooking: async () => true,
      getRoomTypeById: async () => ({ id: 'rt-1', title: 'Double' }),
    }
    const { orm } = makeOrm({ configs: [] }) // sin mapeo → todas unmapped, ninguna se ackea

    const res = await new BookingSyncUseCase(deps(channex, orm)).run()

    expect(vuelta).toBeLessThanOrEqual(2)  // detecta que no hay progreso y para
    expect(res.unmapped).toBeGreaterThan(0)
  })
})

// ─── Recuperación después de una caída ──────────────────────────────────
//
// El feed sólo re-sirve lo no ackeado durante 30 minutos. Si el backend estuvo caído más que eso
// —un deploy largo, el server abajo— esas reservas DESAPARECEN del feed y no vuelven nunca: el
// huésped tiene su confirmación de Booking.com y en el PMS no existe. La única fuente que queda
// es `GET /bookings?filter[inserted_at][gte]=`, que no caduca.
//
// Es MANUAL y acotada por fecha a propósito: como cron periódico re-traería los mismos bookings
// para siempre, caro de los dos lados y sin ningún beneficio mientras el poller está sano.
describe('BookingSyncUseCase.recoverSince — reservas perdidas del feed', () => {
  const configs = [{ hotelId: 'hotelA', channexPropertyId: 'propA', syncEnabled: 1 }]

  function makeChannexRecover(bookings: BookingRevisionDTO[]) {
    const pedidos: string[] = []
    const ackCalls: string[] = []
    const channex: any = {
      fetchBookingsSince: async (_k: string, desde: string) => { pedidos.push(desde); return bookings },
      fetchBookingFeed: async () => [],
      ackBooking: async (_k: string, id: string) => { ackCalls.push(id); return true },
      getRoomTypeById: async () => ({ id: 'rt-1', title: 'Double' }),
    }
    return { channex, pedidos, ackCalls }
  }

  it('crea en el PMS las reservas que quedaron afuera', async () => {
    const { channex, pedidos } = makeChannexRecover([
      makeRevision({ id: 'rev-a', uniqueId: 'U-A' }),
      makeRevision({ id: 'rev-b', uniqueId: 'U-B' }),
    ])
    const { orm, created } = makeOrm({ configs })

    const res = await new BookingSyncUseCase(deps(channex, orm)).recoverSince('2026-09-09T18:00:00Z')

    expect(pedidos).toEqual(['2026-09-09T18:00:00Z'])
    expect(res.ingested).toBe(2)
    expect(created).toHaveLength(2)
  })

  // Lo normal en una recuperación es que la mayoría YA esté: se pide un rango generoso y se
  // confía en el dedupe. Si duplicara, el remedio sería peor que la enfermedad.
  it('lo que ya existe no se duplica', async () => {
    const { channex } = makeChannexRecover([makeRevision({ uniqueId: 'U-A' })])
    const { orm, created } = makeOrm({
      configs,
      existingRes: [{ id: 'r1', hotelId: 'hotelA', externalLocator: 'U-A' }],
    })

    const res = await new BookingSyncUseCase(deps(channex, orm)).recoverSince('2026-09-09T18:00:00Z')

    expect(res.ingested).toBe(0)
    expect(res.skipped).toBe(1)
    expect(created).toHaveLength(0)
  })

  // No se ackea: estos bookings vienen de /bookings, no del feed. Su revisión ya expiró (por eso
  // hubo que recuperarlos), así que el ack sólo sumaría una llamada que falla.
  it('no ackea nada', async () => {
    const { channex, ackCalls } = makeChannexRecover([makeRevision({ uniqueId: 'U-A' })])
    const { orm } = makeOrm({ configs })

    await new BookingSyncUseCase(deps(channex, orm)).recoverSince('2026-09-09T18:00:00Z')

    expect(ackCalls).toHaveLength(0)
  })

  it('una property sin mapeo se cuenta pero no rompe la corrida', async () => {
    const { channex } = makeChannexRecover([makeRevision({ propertyId: 'propDesconocida' })])
    const { orm, created } = makeOrm({ configs })

    const res = await new BookingSyncUseCase(deps(channex, orm)).recoverSince('2026-09-09T18:00:00Z')

    expect(res.unmapped).toBe(1)
    expect(created).toHaveLength(0)
    expect(res.success).toBe(true)
  })
})

// ─── Rastro auditable: las tres vías dejan fila en sync_log ──────────────
//
// `sync_log` es lo que se ve en el Historial de Sincronización del panel; `journalctl` no lo mira
// nadie y se rota (en prod arranca ~25 días atrás). Cuando el webhook no existía, auditar sólo el
// cron alcanzaba. Con el webhook como camino PRINCIPAL de las reservas, una que entre mal por ahí
// no puede ser invisible — ni el rescate manual, que es la operación más delicada de todas.
describe('BookingSyncUseCase — rastro en sync_log', () => {
  const configs = [{ hotelId: 'hotelA', channexPropertyId: 'propA', syncEnabled: 1 }]

  function conRastro(channexExtra: any = {}) {
    const filas: any[] = []
    const syncLogRepo: any = { create: async (row: any) => { filas.push(row); return row } }
    const channex: any = {
      fetchBookingFeed: async () => [],
      fetchBookingRevision: async () => makeRevision({ uniqueId: 'U-WH' }),
      fetchBookingsSince: async () => [makeRevision({ uniqueId: 'U-REC' })],
      ackBooking: async () => true,
      getRoomTypeById: async () => ({ id: 'rt-1', title: 'Double' }),
      ...channexExtra,
    }
    return { filas, syncLogRepo, channex }
  }

  const depsCon = (channex: any, orm: any, syncLogRepo: any) => ({
    channex, queries: {} as any, orm, logger: fakeLogger as any, syncLogRepo,
  })

  it('la ingesta por WEBHOOK queda registrada', async () => {
    const { filas, syncLogRepo, channex } = conRastro()
    const { orm } = makeOrm({ configs })

    await new BookingSyncUseCase(depsCon(channex, orm, syncLogRepo)).runOne('rev-webhook-1')

    expect(filas).toHaveLength(1)
    expect(filas[0].action).toBe('ingest_booking_webhook')
    expect(filas[0].status).toBe('success')
    expect(filas[0].details.ingested).toBe(1)
  })

  it('un webhook que no pudo traer la revisión queda registrado como error', async () => {
    const { filas, syncLogRepo, channex } = conRastro({ fetchBookingRevision: async () => null })
    const { orm } = makeOrm({ configs })

    await new BookingSyncUseCase(depsCon(channex, orm, syncLogRepo)).runOne('rev-fantasma')

    expect(filas).toHaveLength(1)
    expect(filas[0].status).toBe('error')
  })

  it('el rescate manual queda registrado', async () => {
    const { filas, syncLogRepo, channex } = conRastro()
    const { orm } = makeOrm({ configs })

    await new BookingSyncUseCase(depsCon(channex, orm, syncLogRepo)).recoverSince('2026-09-09T18:00:00Z')

    expect(filas).toHaveLength(1)
    expect(filas[0].action).toBe('recover_bookings')
    // Sin el "desde", la fila no sirve para reconstruir qué se rescató y qué no.
    expect(filas[0].details.desde).toBe('2026-09-09T18:00:00Z')
  })
})
