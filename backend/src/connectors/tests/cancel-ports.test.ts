// connectors/tests/cancel-ports.test.ts
//
// Los tres flujos automáticos (OTA vía Channex, ai-recepcionista, ai-gerente) cancelan
// delegando en `reservas.cancelBySystem()`. Acá se verifica el CABLEADO: que cada connector
// inyecta el puerto en su módulo y que le pasa el `penaltyMode` correcto.
//
// El matiz de negocio está en la última expectativa: en una cancelación que llega de una OTA la
// penalidad comercial la maneja el canal, así que el hotel NO aplica sus tiers
// (`channel-managed`); en las dos de IA sí aplica su política (default `hotel-policy`).
import { describe, it, expect } from 'bun:test'
import { canalesReservasConnector } from '../canales-reservas'
import { aiRecepcionistaReservasConnector } from '../ai-recepcionista-reservas'
import { aiGerenteReservasConnector } from '../ai-gerente-reservas'

/** ctx mock: `reservas` registra las llamadas a cancelBySystem; el consumidor guarda el puerto. */
function makeCtx(consumerName: string, consumer: any, calls: any[]) {
  return {
    resolveModule: (name: string) => {
      if (name === 'reservas') {
        return {
          cancelBySystem: async (id: string, input: any) => {
            calls.push({ id, ...input })
            return { ok: true, reservationId: id, idempotent: false, refundAmount: 100, cancellationFee: 0, policyApplied: {} }
          },
        }
      }
      if (name === consumerName) return consumer
      throw new Error(`módulo inesperado: ${name}`)
    },
  } as any
}

describe('canales-reservas — cancelación OTA', () => {
  it('inyecta el puerto y cancela con penaltyMode channel-managed', async () => {
    const calls: any[] = []
    let port: any = null
    const canales = { setReservationCancelPort: (fn: any) => { port = fn } }
    canalesReservasConnector(makeCtx('canales', canales, calls))

    expect(typeof port).toBe('function')
    const out = await port('r1', 'hotel-a', 'Cancelada por el canal Booking.com')

    expect(out.ok).toBe(true)
    expect(calls).toEqual([{
      id: 'r1', hotelId: 'hotel-a',
      reason: 'Cancelada por el canal Booking.com',
      penaltyMode: 'channel-managed',
    }])
  })
})

describe('canales-reservas — auto-asignación de unidad al ingresar una reserva OTA (corrección a REQ-HAC-05)', () => {
  function ctxWithAssign(canales: any, opts: { throws?: boolean; result?: any } = {}) {
    const assigned: Array<{ reservationId: string; hotelId: string }> = []
    const ctx = {
      resolveModule: (name: string) => {
        if (name === 'reservas') {
          return {
            cancelBySystem: async () => ({ ok: true }),
            autoAssignRoom: async (reservationId: string, hotelId: string) => {
              if (opts.throws) throw new Error('boom')
              assigned.push({ reservationId, hotelId })
              return opts.result ?? { assigned: true, roomId: 'rm1', roomNumber: '101' }
            },
          }
        }
        if (name === 'canales') return canales
        throw new Error(`módulo inesperado: ${name}`)
      },
    } as any
    return { ctx, assigned }
  }

  it('onOtaBookingIngested → autoAssignRoom(reservationId, hotelId)', async () => {
    let sockets: any = {}
    const canales = { setReservationCancelPort: () => {}, setSockets: (s: any) => { sockets = { ...sockets, ...s } } }
    const { ctx, assigned } = ctxWithAssign(canales)
    canalesReservasConnector(ctx)

    expect(typeof sockets.onOtaBookingIngested).toBe('function')
    await sockets.onOtaBookingIngested({ hotelId: 'hotel-a', reservationId: 'r1', ota: 'Booking.com' })
    expect(assigned).toEqual([{ reservationId: 'r1', hotelId: 'hotel-a' }])
  })

  it('sin unidad libre o con error → la ingesta no se entera (resuelve igual)', async () => {
    let sockets: any = {}
    const canales = { setReservationCancelPort: () => {}, setSockets: (s: any) => { sockets = { ...sockets, ...s } } }
    canalesReservasConnector(ctxWithAssign(canales, { throws: true }).ctx)
    await expect(sockets.onOtaBookingIngested({ hotelId: 'hotel-a', reservationId: 'r1', ota: 'Booking.com' })).resolves.toBeUndefined()

    let sockets2: any = {}
    const canales2 = { setReservationCancelPort: () => {}, setSockets: (s: any) => { sockets2 = { ...sockets2, ...s } } }
    canalesReservasConnector(ctxWithAssign(canales2, { result: { assigned: false, reason: 'no_rooms' } }).ctx)
    await expect(sockets2.onOtaBookingIngested({ hotelId: 'hotel-a', reservationId: 'r1', ota: 'Booking.com' })).resolves.toBeUndefined()
  })

  it('payload incompleto → no llama a reservas', async () => {
    let sockets: any = {}
    const canales = { setReservationCancelPort: () => {}, setSockets: (s: any) => { sockets = { ...sockets, ...s } } }
    const { ctx, assigned } = ctxWithAssign(canales)
    canalesReservasConnector(ctx)
    await sockets.onOtaBookingIngested({ hotelId: 'hotel-a', ota: 'Booking.com' })
    expect(assigned).toEqual([])
  })
})

describe('ai-recepcionista-reservas / ai-gerente-reservas — cancelación directa', () => {
  it('el asistente cancela con la política del hotel (sin penaltyMode)', async () => {
    const calls: any[] = []
    const bot: any = { cancelReservationPort: null }
    aiRecepcionistaReservasConnector(makeCtx('ai-recepcionista', bot, calls))

    expect(typeof bot.cancelReservationPort).toBe('function')
    const out = await bot.cancelReservationPort('r1', 'hotel-a', 'Cancelada por el huésped')

    expect(out).toMatchObject({ ok: true, refundAmount: 100, cancellationFee: 0 })
    expect(calls).toEqual([{ id: 'r1', hotelId: 'hotel-a', reason: 'Cancelada por el huésped' }])
  })

  it('el Gerente IA cancela con la política del hotel (sin penaltyMode)', async () => {
    const calls: any[] = []
    let port: any = null
    const gerente = { setReservationCancelPort: (fn: any) => { port = fn } }
    aiGerenteReservasConnector(makeCtx('ai-gerente', gerente, calls))

    expect(typeof port).toBe('function')
    await port('r1', 'hotel-a', 'Cancelada por el gerente')

    expect(calls).toEqual([{ id: 'r1', hotelId: 'hotel-a', reason: 'Cancelada por el gerente' }])
  })
})

// El camino de FALLO es el que importa: un connector que se traga el error hace que el caller
// crea que canceló. Y para la ingesta de OTAs no alcanza con saber QUE falló: necesita el CÓDIGO
// para decidir si reintentar. Pisarlo con el mensaje humano dejaba la revisión rebotando en cada
// tick del cron, porque `invalid_state` (el canal cancela una reserva que ya hizo check-in) nunca
// se resuelve solo. Ninguna de estas dos cosas estaba cubierta.
describe('los tres puertos — qué devuelven cuando la cancelación NO se pudo hacer', () => {
  /** ctx cuyo `reservas.cancelBySystem` siempre falla con código + mensaje separados. */
  function failingCtx(consumerName: string, consumer: any) {
    return {
      resolveModule: (name: string) => {
        if (name === 'reservas') {
          return {
            cancelBySystem: async () => ({
              ok: false, error: 'invalid_state', message: 'No se puede cancelar una reserva con check-in',
            }),
          }
        }
        if (name === consumerName) return consumer
        throw new Error(`módulo inesperado: ${name}`)
      },
    } as any
  }

  it('OTA: propaga el CÓDIGO en `error` (no el mensaje) para poder decidir el reintento', async () => {
    let port: any = null
    canalesReservasConnector(failingCtx('canales', { setReservationCancelPort: (fn: any) => { port = fn } }))

    const out = await port('r1', 'hotel-a', 'Cancelada por el canal')

    expect(out.ok).toBe(false)
    expect(out.error).toBe('invalid_state')                                   // el código, intacto
    expect(out.message).toBe('No se puede cancelar una reserva con check-in') // y el texto, aparte
  })

  it('ai-recepcionista: el fallo llega con texto para el huésped', async () => {
    const bot: any = { cancelReservationPort: null }
    aiRecepcionistaReservasConnector(failingCtx('ai-recepcionista', bot))

    const out = await bot.cancelReservationPort('r1', 'hotel-a', 'Cancelada por el huésped')

    expect(out.ok).toBe(false)
    expect(out.error).toBeTruthy()   // el bot lo lee al huésped: no puede quedar vacío
  })

  it('ai-gerente: el fallo llega con texto', async () => {
    let port: any = null
    aiGerenteReservasConnector(failingCtx('ai-gerente', { setReservationCancelPort: (fn: any) => { port = fn } }))

    const out = await port('r1', 'hotel-a', 'Cancelada por el gerente')

    expect(out.ok).toBe(false)
    expect(out.error).toBeTruthy()
  })
})
