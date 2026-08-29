import { describe, it, expect } from 'bun:test'
import { generateCodeForReservation } from '../usecases/ttlock-config'

// Fix 2026-08-29 (reporte de cliente): la ventana del PIN se calculaba con
// `new Date('2026-09-12').getTime()` = medianoche UTC, ignorando el horario del hotel.
// En America/Santo_Domingo (UTC-4) eso abría el código el día anterior a las 20:00 y lo
// cerraba a las 20:00 de la víspera de la salida → el huésped sin acceso su última noche.
// Estos tests miran los ms EXACTOS que se le mandan a TTLock.

const HOTEL = { id: 'h1', checkIn: '15:00', checkOut: '12:00', timezone: 'America/Santo_Domingo' }
const RESERVA = { id: 'res1', hotelId: 'h1', roomId: 'rm1', checkIn: '2026-09-12', checkOut: '2026-09-13' }

function harness(opts: { reserva?: any; hotel?: any; lockStatus?: string } = {}) {
  const calls: { startMs: number; endMs: number }[] = []
  const created: any[] = []
  const deps = [
    'res1', 'h1',
    { findMany: async () => [{ id: 'l1', ttlockLockId: '123', status: opts.lockStatus ?? 'online' }] },
    { findMany: async () => [], create: async (d: any) => { created.push(d); return { id: 'code1', ...d } } },
    async () => 'tok',
    async (_c: any, _l: number, _p: string, startMs: number, endMs: number) => {
      calls.push({ startMs, endMs }); return { keyboardPwdId: 'kpw1' }
    },
    () => '4321',
    async () => ({ accessToken: 'tok', clientId: 'cid', region: 'eu' }),
    async () => opts.reserva ?? RESERVA,
    async () => (opts.hotel === undefined ? HOTEL : opts.hotel),
  ] as const
  return { calls, created, run: () => (generateCodeForReservation as any)(...deps) }
}

describe('ventana del código de la cerradura', () => {
  it('abre a la hora de entrada del hotel en SU zona horaria', async () => {
    const h = harness(); await h.run()
    expect(new Date(h.calls[0].startMs).toISOString()).toBe('2026-09-12T19:00:00.000Z') // 15:00 RD
  })

  it('cierra a la hora de salida del ÚLTIMO día, no la víspera', async () => {
    const h = harness(); await h.run()
    expect(new Date(h.calls[0].endMs).toISOString()).toBe('2026-09-13T16:00:00.000Z') // 12:00 RD
  })

  it('REGRESIÓN: cubre la última noche que el cálculo viejo dejaba afuera', async () => {
    const h = harness(); await h.run()
    const viejoEnd = new Date(RESERVA.checkOut).getTime() // lo que hacía antes
    // 12 sept 23:00 RD = 13 sept 03:00 UTC — el huésped en su última noche.
    const ultimaNoche = Date.UTC(2026, 8, 13, 3, 0)
    expect(ultimaNoche).toBeGreaterThan(viejoEnd)            // antes: FUERA
    expect(ultimaNoche).toBeLessThan(h.calls[0].endMs)        // ahora: DENTRO
  })

  it('el early check-in de la reserva adelanta la apertura', async () => {
    const h = harness({ reserva: { ...RESERVA, checkInTime: '09:00' } }); await h.run()
    expect(new Date(h.calls[0].startMs).toISOString()).toBe('2026-09-12T13:00:00.000Z')
  })

  it('el late checkout de la reserva extiende el cierre', async () => {
    const h = harness({ reserva: { ...RESERVA, checkOutTime: '20:00' } }); await h.run()
    expect(new Date(h.calls[0].endMs).toISOString()).toBe('2026-09-14T00:00:00.000Z')
  })

  it('sin registro de hotel usa los defaults del modelo y NO revienta', async () => {
    const h = harness({ hotel: null }); await h.run()
    expect(new Date(h.calls[0].startMs).toISOString()).toBe('2026-09-12T19:00:00.000Z') // 15:00
  })

  it('rechaza fechas inválidas en vez de mandarle NaN a la cerradura', async () => {
    const h = harness({ reserva: { ...RESERVA, checkIn: '', checkOut: '' } })
    await expect(h.run()).rejects.toThrow(/inválidas/)
    expect(h.calls).toHaveLength(0)
  })

  it('cerradura offline: registra pending sin llamar al hardware', async () => {
    const h = harness({ lockStatus: 'offline' }); await h.run()
    expect(h.calls).toHaveLength(0)
    expect(h.created[0].status).toBe('pending')
  })
})
