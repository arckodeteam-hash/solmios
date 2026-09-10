// shared/usecases/tests/booking-sync-cron.test.ts — Cron de ingesta GLOBAL de bookings (issue #564).
//
// Cubre el factory del cron a nivel función (sin red, sin timer). El uso real del orm lo hace
// el usecase del módulo canales; acá solo se valida que el cron resuelve el módulo, propaga
// métricas, y NUNCA propaga excepciones (catch externo → zero result).
//
// Casos:
//  (1) service presente → métricas propagan a logger.info, sin warn.
//  (2) resolveModule null → warn + zero result, no throw.
//  (3) syncAllBookingRevisions lanza → catch + zero result, no propaga.
import { describe, it, expect } from 'bun:test'
import { createBookingSyncCron, DEFAULT_BOOKING_SYNC_TICK_MS } from '../booking-sync-cron'

describe('createBookingSyncCron — issue #564', () => {
  it('service presente → métricas propagan a logger.info', async () => {
    const infoCalls: any[] = []
    const warnCalls: any[] = []
    const fakeLogger = {
      info: (...a: any[]) => infoCalls.push(a),
      warn: (...a: any[]) => warnCalls.push(a),
    }
    const metrics = {
      success: true, feedSize: 3, ingested: 2, skipped: 1,
      acknowledged: 3, unmapped: 0, suspended: 0, errors: [],
    }
    const resolveModule = () => ({ syncAllBookingRevisions: async () => metrics })
    const cron = createBookingSyncCron(null, resolveModule, fakeLogger as any)

    const result = await cron()

    expect(result).toEqual(metrics)
    expect(infoCalls.length).toBeGreaterThanOrEqual(1)
    expect(warnCalls).toHaveLength(0)
  })

  it('resolveModule null → warn + zero, no throw', async () => {
    const warnCalls: any[] = []
    const fakeLogger = { info: () => {}, warn: (...a: any[]) => warnCalls.push(a) }
    const resolveModule = () => null
    const cron = createBookingSyncCron(null, resolveModule, fakeLogger as any)

    const result = await cron()

    expect(result.success).toBe(false)
    expect(result.feedSize).toBe(0)
    expect(result.ingested).toBe(0)
    expect(result.acknowledged).toBe(0)
    expect(warnCalls.length).toBeGreaterThanOrEqual(1)
  })

  it('syncAllBookingRevisions lanza → catch + zero, no propaga', async () => {
    const warnCalls: any[] = []
    const fakeLogger = { info: () => {}, warn: (...a: any[]) => warnCalls.push(a) }
    const resolveModule = () => ({
      syncAllBookingRevisions: async () => { throw new Error('boom') },
    })
    const cron = createBookingSyncCron(null, resolveModule, fakeLogger as any)

    const result = await cron()

    expect(result.success).toBe(false)
    expect(result.ingested).toBe(0)
    expect(warnCalls.length).toBeGreaterThanOrEqual(1)
  })

  it('exporta DEFAULT_BOOKING_SYNC_TICK_MS = 60 s', () => {
    expect(DEFAULT_BOOKING_SYNC_TICK_MS).toBe(60_000)
  })
})

// ─── Alerta de feed estancado ───────────────────────────────────────────
//
// El feed es una ventana de 30 minutos: lo que no se ackea dentro de ese rato desaparece y no
// vuelve nunca. Si el cron viene fallando (creds vencidas, Channex caído, red cortada) y NADIE se
// entera, las reservas de esa media hora se pierden en silencio — el huésped tiene su
// confirmación de la OTA y en el PMS no hay nada. La alerta salta ANTES de que se cierre la
// ventana, y dice desde qué momento hay que recuperar.
describe('createBookingSyncCron — alerta de feed estancado', () => {
  function armar(reloj: { t: number }, correr: () => Promise<any>) {
    const lineas: Array<{ nivel: string; msg: string; meta: any }> = []
    const logger = {
      info: (msg: string, meta?: any) => lineas.push({ nivel: 'info', msg, meta }),
      warn: (msg: string, meta?: any) => lineas.push({ nivel: 'warn', msg, meta }),
      error: (msg: string, meta?: any) => lineas.push({ nivel: 'error', msg, meta }),
    }
    const cron = createBookingSyncCron(
      null,
      () => ({ syncAllBookingRevisions: correr }),
      logger as any,
      { now: () => reloj.t },
    )
    return { cron, lineas }
  }

  const FALLO = { success: false, feedSize: 0, ingested: 0, acknowledged: 0, skipped: 0, unmapped: 0, suspended: 0, errors: ['feed: connection refused'] }
  const OK = { success: true, feedSize: 0, ingested: 0, acknowledged: 0, skipped: 0, unmapped: 0, suspended: 0, errors: [] }

  it('fallar unos minutos no alerta: puede ser un hipo de red', async () => {
    const reloj = { t: 0 }
    const { cron, lineas } = armar(reloj, async () => FALLO)

    for (let min = 0; min < 5; min++) { reloj.t = min * 60_000; await cron() }

    expect(lineas.some((l) => l.nivel === 'error')).toBe(false)
  })

  it('sin contacto con el feed cerca de los 30 min → error con el punto desde el cual recuperar', async () => {
    const reloj = { t: 0 }
    const { cron, lineas } = armar(reloj, async () => FALLO)

    reloj.t = 26 * 60_000
    await cron()

    const alerta = lineas.find((l) => l.nivel === 'error')
    expect(alerta).toBeTruthy()
    // Sin el `since`, el operador sabe que algo pasó pero no desde cuándo recuperar.
    expect(alerta!.meta?.recuperarDesde).toBeTruthy()
  })

  it('un tick exitoso reinicia el contador', async () => {
    const reloj = { t: 0 }
    let caer = true
    const { cron, lineas } = armar(reloj, async () => (caer ? FALLO : OK))

    reloj.t = 20 * 60_000; await cron()   // 20 min fallando
    caer = false
    reloj.t = 21 * 60_000; await cron()   // se recupera
    caer = true
    reloj.t = 40 * 60_000; await cron()   // 19 min desde el último éxito: todavía no alerta

    expect(lineas.some((l) => l.nivel === 'error')).toBe(false)
  })

  // Leer el feed y que UNA revisión falle no es un estancamiento: el contacto existe y las demás
  // se ackearon. Alertar acá sería ruido que enseña a ignorar la alerta que sí importa.
  it('feed leído con una revisión rota no cuenta como estancamiento', async () => {
    const reloj = { t: 0 }
    const conRevisionRota = { ...OK, success: false, feedSize: 4, ingested: 3, errors: ['U-9: DB write failed'] }
    const { cron, lineas } = armar(reloj, async () => conRevisionRota)

    for (let min = 0; min <= 40; min += 5) { reloj.t = min * 60_000; await cron() }

    expect(lineas.some((l) => l.nivel === 'error')).toBe(false)
  })
})
