import { describe, it, expect } from 'bun:test'
import { silentLogger } from 'arckode-framework/testing'
import { createPrearrivalPassCron } from '../prearrival-pass-cron'

const HOTEL = { id: 'h1', checkIn: '15:00', checkOut: '12:00', timezone: 'America/Santo_Domingo' }
// Llegada real: 2026-09-12 15:00 RD = 19:00 UTC.
const ARRIVAL = Date.parse('2026-09-12T19:00:00.000Z')
const RESERVA = { id: 'res1', hotelId: 'h1', checkIn: '2026-09-12', checkOut: '2026-09-13', status: 'confirmed' }

function harness(over: { pass?: any; reserva?: any; sendOk?: boolean } = {}) {
  const pass = over.pass === undefined ? { id: 'p1', reservationId: 'res1', lockCode: '401697' } : over.pass
  const updates: any[] = []
  const sends: string[] = []
  const orm = {
    findMany: async (t: string) => (t === 'WalletPasses' && pass ? [pass] : []),
    findById: async (t: string, id: string) => {
      if (t === 'Reservations') return over.reserva === undefined ? RESERVA : over.reserva
      if (t === 'Hotels') return HOTEL
      return null
    },
    update: async (t: string, id: string, data: any) => { updates.push({ t, id, data }) },
  }
  const wallet = {
    sendPassEmailNow: async (rid: string) => { sends.push(rid); return over.sendOk !== false },
  }
  const cron = createPrearrivalPassCron(orm, (n: string) => (n === 'wallet-pass' ? wallet : null), silentLogger())
  return { cron, updates, sends }
}

const hoursBefore = (h: number) => new Date(ARRIVAL - h * 3_600_000)

describe('cron de pase 24 h antes', () => {
  it('NO manda nada cuando faltan más de 24 h', async () => {
    const h = harness()
    const r = await h.cron(hoursBefore(30))
    expect(r.sent).toBe(0)
    expect(h.sends).toHaveLength(0)
  })

  it('manda cuando entra en la ventana de 24 h', async () => {
    const h = harness()
    const r = await h.cron(hoursBefore(23))
    expect(r.sent).toBe(1)
    expect(h.sends).toEqual(['res1'])
  })

  it('justo en el borde de las 24 h ya manda', async () => {
    const h = harness()
    expect((await h.cron(hoursBefore(24))).sent).toBe(1)
  })

  it('marca emailSentAt para no reenviar en el próximo tick', async () => {
    const h = harness()
    await h.cron(hoursBefore(10))
    expect(h.updates[0].t).toBe('WalletPasses')
    expect(h.updates[0].data.emailSentAt).toBeTruthy()
  })

  it('un pase ya avisado se saltea', async () => {
    const h = harness({ pass: { id: 'p1', reservationId: 'res1', emailSentAt: '2026-09-11T00:00:00Z' } })
    const r = await h.cron(hoursBefore(10))
    expect(r.sent).toBe(0)
    expect(r.skipped).toBe(1)
  })

  it('un pase obsoleto (habitación reasignada) NO se manda: su código ya no abre', async () => {
    const h = harness({ pass: { id: 'p1', reservationId: 'res1', obsoleteAt: '2026-09-11T00:00:00Z' } })
    expect((await h.cron(hoursBefore(10))).sent).toBe(0)
  })

  it('una reserva cancelada no recibe el código', async () => {
    const h = harness({ reserva: { ...RESERVA, status: 'cancelled' } })
    expect((await h.cron(hoursBefore(10))).sent).toBe(0)
  })

  it('una reserva SIN PAGAR (pending) no recibe el código de la puerta', async () => {
    const h = harness({ reserva: { ...RESERVA, status: 'pending' } })
    expect((await h.cron(hoursBefore(10))).sent).toBe(0)
    expect(h.sends).toHaveLength(0)
  })

  it('el huésped que ya hizo check-in sí puede recibirlo (reenvío)', async () => {
    const h = harness({ reserva: { ...RESERVA, status: 'checked_in' } })
    expect((await h.cron(hoursBefore(10))).sent).toBe(1)
  })

  it('un estado desconocido queda FUERA por default (lista blanca)', async () => {
    const h = harness({ reserva: { ...RESERVA, status: 'estado_nuevo_del_futuro' } })
    expect((await h.cron(hoursBefore(10))).sent).toBe(0)
  })

  it('si el envío falla NO marca emailSentAt: se reintenta al tick siguiente', async () => {
    const h = harness({ sendOk: false })
    const r = await h.cron(hoursBefore(10))
    expect(r.sent).toBe(0)
    expect(h.updates).toHaveLength(0)
  })

  it('el huésped que ya llegó igual recibe su código (el corte es solo por arriba)', async () => {
    const h = harness()
    expect((await h.cron(new Date(ARRIVAL + 3_600_000))).sent).toBe(1)
  })

  it('sin módulo wallet-pass no revienta', async () => {
    const cron = createPrearrivalPassCron(
      { findMany: async () => [], findById: async () => null, update: async () => {} },
      () => null, silentLogger(),
    )
    expect((await cron(new Date())).sent).toBe(0)
  })
})
