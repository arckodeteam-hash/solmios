// dashboard-queries-audit.test.ts — Listado de audit log del super-admin (GET /api/admin/audit).
import { describe, it, expect, vi, beforeEach } from 'bun:test'
import { DashboardQueries } from '../usecases/dashboard-queries'

const AUDIT = [
  { id: 'a1', hotelId: 'h1', userId: 'u1', action: 'room.delete', createdAt: '2026-08-10T12:00:00.000Z' },
  // Sin hotelId: acción de plataforma (login de super-admin, etc) — no hay hotel que resolver.
  { id: 'a2', action: 'user.login', createdAt: '2026-08-11T09:00:00.000Z' },
  // Huérfano: el hotel al que apunta el hotelId fue borrado.
  { id: 'a3', hotelId: 'borrado', action: 'hotel.update', createdAt: '2026-08-09T18:00:00.000Z' },
]
const HOTELS = [{ id: 'h1', name: 'Hotel Alpha' }, { id: 'h2', name: 'Hotel Beta' }]

describe('DashboardQueries.listAuditLogs', () => {
  let orm: any

  beforeEach(() => {
    orm = {
      findMany: vi.fn(async (table: string) => {
        if (table === 'Auditlog') return AUDIT.map((r) => ({ ...r }))
        if (table === 'Hotels') return HOTELS.map((h) => ({ ...h }))
        return []
      }),
    }
  })

  it('resuelve hotelName del hotel del registro', async () => {
    const { data } = await new DashboardQueries(orm).listAuditLogs()
    expect(data.find((r: any) => r.id === 'a1').hotelName).toBe('Hotel Alpha')
  })

  it('deja hotelName vacío para un registro sin hotelId', async () => {
    const { data } = await new DashboardQueries(orm).listAuditLogs()
    expect(data.find((r: any) => r.id === 'a2').hotelName).toBe('')
  })

  it('no rompe si el hotelId ya no existe: hotelName vacío', async () => {
    const { data } = await new DashboardQueries(orm).listAuditLogs()
    expect(data.find((r: any) => r.id === 'a3').hotelName).toBe('')
  })

  it('consulta cada tabla UNA sola vez (sin N+1 por registro)', async () => {
    await new DashboardQueries(orm).listAuditLogs()
    const tables = orm.findMany.mock.calls.map((c: any[]) => c[0])
    expect(tables.filter((t: string) => t === 'Auditlog')).toHaveLength(1)
    expect(tables.filter((t: string) => t === 'Hotels')).toHaveLength(1)
    expect(orm.findMany).toHaveBeenCalledTimes(2)
  })

  it('ordena por createdAt DESC: lo más reciente primero', async () => {
    const { data, total } = await new DashboardQueries(orm).listAuditLogs()
    expect(data.map((r: any) => r.id)).toEqual(['a2', 'a1', 'a3'])
    expect(total).toBe(AUDIT.length)
  })
})
