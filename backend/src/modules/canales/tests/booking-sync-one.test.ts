// canales/tests/booking-sync-one.test.ts — runOne(revisionId): disparador del webhook (CH-07, issue #50)
//
// El webhook no abre un segundo camino de ingesta: corre el MISMO `processRevision` que el cron.
// Por eso lo que se verifica acá no es "que ingrese", sino que se comporte IGUAL que el feed:
//  - CA-3: GET → apply → ack, con el ack SIEMPRE último (nunca se ackea lo que no se aplicó).
//  - CA-6: dos callbacks de la misma revisión crean una sola reserva (dedupe por externalLocator).
//  - CA-7: si el GET o el apply fallan, NO se ackea → la revisión queda en el feed y el cron la recupera.
//  - CA-4: la reserva del webhook es idéntica, campo por campo, a la del cron.
// Sin base de datos ni HTTP: fakes de orm/channex que además registran el ORDEN de las llamadas.
import { describe, it, expect } from 'bun:test'
import { BookingSyncUseCase } from '../usecases/booking-sync'
import type { BookingRevisionDTO } from '../types'

// ─── Builders de fixtures (molde: booking-sync.test.ts) ─────────────────
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

/** Logger fake que guarda cada nivel por separado (CA-7 exige que quede un `error` registrado). */
function makeLogger() {
  const errors: Array<{ msg: string; meta?: any }> = []
  const warns: Array<{ msg: string; meta?: any }> = []
  const logger: any = {
    info: () => {},
    warn: (msg: string, meta?: any) => { warns.push({ msg, meta }) },
    error: (msg: string, meta?: any) => { errors.push({ msg, meta }) },
  }
  return { logger, errors, warns }
}

/**
 * Channex fake. `calls` es COMPARTIDO con el orm para poder afirmar el orden global
 * (GET → escritura → ack), que es el corazón de CA-3.
 */
function makeChannexStub(opts: {
  calls: string[]
  revision?: BookingRevisionDTO | null
  fetchThrows?: boolean
  feed?: BookingRevisionDTO[]
}) {
  const ackCalls: string[] = []
  const channex: any = {
    fetchBookingRevision: async (_key: string, revId: string) => {
      opts.calls.push('fetchBookingRevision')
      if (opts.fetchThrows) throw new Error(`channex 500 en ${revId}`)
      return opts.revision ?? null
    },
    fetchBookingFeed: async () => {
      opts.calls.push('fetchBookingFeed')
      return opts.feed ?? []
    },
    ackBooking: async (_key: string, revId: string) => {
      opts.calls.push('ackBooking')
      ackCalls.push(revId)
      return true
    },
    getRoomTypeById: async () => ({ id: 'rt-1', title: 'Double' }),
  }
  return { channex, ackCalls }
}

/**
 * ORM fake. A diferencia del de booking-sync.test.ts, ACUMULA lo creado y lo devuelve en el
 * siguiente `findMany('Reservations')`: sin eso el dedupe por externalLocator nunca se ejercita
 * y la idempotencia (CA-6) quedaría sin probar.
 */
function makeOrm(opts: { calls?: string[]; configs?: any[]; createThrows?: boolean } = {}) {
  const created: any[] = []
  const orm: any = {
    findMany: async (model: string, where?: any) => {
      if (model === 'Canales') return opts.configs ?? []
      if (model === 'Reservations') {
        return created.filter(r => !where?.externalLocator || r.externalLocator === where.externalLocator)
      }
      if (model === 'Rooms') return [{ id: 'room-1', type: 'double' }]
      return []
    },
    create: async (_model: string, payload: any) => {
      opts.calls?.push('create')
      if (opts.createThrows) throw new Error('DB write failed')
      created.push(payload)
      return payload
    },
    update: async () => {},
  }
  return { orm, created }
}

const deps = (channex: any, orm: any, logger: any) => ({
  channex, queries: {} as any, orm, logger,
})

const CONFIGS = [{ hotelId: 'hotelA', channexPropertyId: 'propA', syncEnabled: 1 }]

describe('BookingSyncUseCase.runOne — webhook de reservas (CH-07)', () => {
  it('CA-3: el orden es GET → apply → ack, con el ack al final', async () => {
    const calls: string[] = []
    const { channex } = makeChannexStub({ calls, revision: makeRevision() })
    const { orm, created } = makeOrm({ calls, configs: CONFIGS })
    const { logger } = makeLogger()

    const res = await new BookingSyncUseCase(deps(channex, orm, logger)).runOne('rev-1')

    expect(calls).toEqual(['fetchBookingRevision', 'create', 'ackBooking'])
    expect(res.feedSize).toBe(1)
    expect(res.ingested).toBe(1)
    expect(res.acknowledged).toBe(1)
    expect(res.success).toBe(true)
    expect(created).toHaveLength(1)
  })

  it('CA-6: dos callbacks de la misma revisión → una sola reserva; el 2do es skipped y ackea igual', async () => {
    const calls: string[] = []
    const { channex, ackCalls } = makeChannexStub({ calls, revision: makeRevision() })
    const { orm, created } = makeOrm({ calls, configs: CONFIGS })
    const { logger } = makeLogger()
    const usecase = new BookingSyncUseCase(deps(channex, orm, logger))

    const first = await usecase.runOne('rev-1')
    const second = await usecase.runOne('rev-1')

    expect(calls.filter(c => c === 'create')).toHaveLength(1) // el dedupe corta la 2da escritura
    expect(created).toHaveLength(1)
    expect(first.ingested).toBe(1)
    expect(second.ingested).toBe(0)
    expect(second.skipped).toBe(1)
    expect(ackCalls).toEqual(['rev-1', 'rev-1']) // se ackea igual: drena el feed
    expect(second.success).toBe(true)
  })

  it('CA-7: si el GET falla → no se ackea nada, success false y queda un error en el logger', async () => {
    const calls: string[] = []
    const { channex, ackCalls } = makeChannexStub({ calls, fetchThrows: true })
    const { orm, created } = makeOrm({ calls, configs: CONFIGS })
    const { logger, errors } = makeLogger()

    const res = await new BookingSyncUseCase(deps(channex, orm, logger)).runOne('rev-1')

    expect(ackCalls).toHaveLength(0) // la revisión sigue en el feed → la recupera el cron de 15'
    expect(created).toHaveLength(0)
    expect(res.success).toBe(false)
    expect(res.errors).toHaveLength(1)
    expect(errors).toHaveLength(1)
    expect(errors[0].meta?.revisionId).toBe('rev-1')
  })

  it('CA-7: revisión inexistente (null) → mismo trato que el fallo del GET', async () => {
    const calls: string[] = []
    const { channex, ackCalls } = makeChannexStub({ calls, revision: null })
    const { orm } = makeOrm({ calls, configs: CONFIGS })
    const { logger, errors } = makeLogger()

    const res = await new BookingSyncUseCase(deps(channex, orm, logger)).runOne('rev-404')

    expect(ackCalls).toHaveLength(0)
    expect(res.success).toBe(false)
    expect(errors).toHaveLength(1)
  })

  it('CA-7: si el apply falla → no se ackea y el error queda en result.errors', async () => {
    const calls: string[] = []
    const { channex, ackCalls } = makeChannexStub({ calls, revision: makeRevision() })
    const { orm, created } = makeOrm({ calls, configs: CONFIGS, createThrows: true })
    const { logger } = makeLogger()

    const res = await new BookingSyncUseCase(deps(channex, orm, logger)).runOne('rev-1')

    expect(ackCalls).toHaveLength(0) // el ack es posterior al apply: si el apply revienta, no ocurre
    expect(created).toHaveLength(0)
    expect(res.errors).toHaveLength(1)
    expect(res.errors[0]).toContain('U-1')
    expect(res.success).toBe(false)
  })

  it('CA-4: la reserva del webhook es idéntica a la del cron para la misma revisión', async () => {
    const rev = makeRevision()

    const callsCron: string[] = []
    const { channex: channexCron } = makeChannexStub({ calls: callsCron, feed: [rev] })
    const { orm: ormCron, created: createdCron } = makeOrm({ calls: callsCron, configs: CONFIGS })
    const { logger: loggerCron } = makeLogger()
    await new BookingSyncUseCase(deps(channexCron, ormCron, loggerCron)).run()

    const callsHook: string[] = []
    const { channex: channexHook } = makeChannexStub({ calls: callsHook, revision: rev })
    const { orm: ormHook, created: createdHook } = makeOrm({ calls: callsHook, configs: CONFIGS })
    const { logger: loggerHook } = makeLogger()
    await new BookingSyncUseCase(deps(channexHook, ormHook, loggerHook)).runOne(rev.id)

    expect(createdCron).toHaveLength(1)
    expect(createdHook).toHaveLength(1)
    // Se descarta sólo `id`: lo genera crypto.randomUUID() en applyBookingRevision, así que es
    // distinto por definición en cada corrida. No hay timestamps en el payload de la reserva OTA.
    const { id: _idCron, ...cron } = createdCron[0]
    const { id: _idHook, ...hook } = createdHook[0]
    expect(hook).toEqual(cron)
  })

  it('propertyId sin mapeo → unmapped=1 y NO se ackea (igual que el cron)', async () => {
    const calls: string[] = []
    const { channex, ackCalls } = makeChannexStub({ calls, revision: makeRevision({ propertyId: 'propZ' }) })
    const { orm, created } = makeOrm({ calls, configs: CONFIGS })
    const { logger, warns } = makeLogger()

    const res = await new BookingSyncUseCase(deps(channex, orm, logger)).runOne('rev-1')

    expect(res.unmapped).toBe(1)
    expect(res.ingested).toBe(0)
    expect(created).toHaveLength(0)
    expect(ackCalls).toHaveLength(0)
    expect(res.success).toBe(true) // unmapped no es un error, igual que en run()
    expect(warns).toHaveLength(1)
  })
})
