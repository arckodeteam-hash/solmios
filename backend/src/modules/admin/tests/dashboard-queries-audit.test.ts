// dashboard-queries-audit.test.ts — Listado de audit log del super-admin (GET /api/admin/audit).
//
// Cubre lo de siempre (resolver `hotelName` sin N+1, orden por fecha) y lo de #142: la consulta
// pagina y filtra en la BASE. Antes hacía `orm.findMany('Auditlog', {})` —la tabla entera, 414
// filas en producción y sin techo— y ordenaba en memoria del backend.
import { describe, it, expect, vi, beforeEach } from 'bun:test'
import { DashboardQueries } from '../usecases/dashboard-queries'

const HOTELS = [{ id: 'h1', name: 'Hotel Alpha' }, { id: 'h2', name: 'Hotel Beta' }]

const AUDIT = [
  { id: 'a1', hotelId: 'h1', userId: 'u1', action: 'room.delete', entity: 'room', createdAt: '2026-08-10T12:00:00.000Z' },
  // Sin hotelId: acción de plataforma (login de super-admin, etc) — no hay hotel que resolver.
  { id: 'a2', userId: 'u2', action: 'user.login', entity: 'auth', createdAt: '2026-08-11T09:00:00.000Z' },
  // Huérfano: el hotel al que apunta el hotelId fue borrado.
  { id: 'a3', hotelId: 'borrado', action: 'hotel.update', entity: 'hotel', createdAt: '2026-08-09T18:00:00.000Z' },
  { id: 'a4', hotelId: 'h1', userId: 'u1', action: 'invoice.delete', entity: 'invoice', createdAt: '2026-07-02T08:00:00.000Z' },
]

/**
 * ORM falso que respeta lo que se le pide: filtros por igualdad, `orderBy`, `limit` y `offset`.
 * Si el código volviera a traerse la tabla y ordenar en memoria, los tests de paginación fallan.
 */
function makeOrm() {
  const calls = { findMany: [] as any[], paginate: [] as any[] }
  const query = (rows: any[], filters: any = {}, opts: any = {}) => {
    let out = rows.filter((r) => Object.entries(filters).every(([k, v]) => r[k] === v))
    const order = Array.isArray(opts.orderBy) ? opts.orderBy[0] : opts.orderBy
    if (order?.field) {
      const dir = String(order.dir ?? order.direction ?? 'ASC').toUpperCase() === 'DESC' ? -1 : 1
      out = [...out].sort((a, b) => String(a[order.field] ?? '').localeCompare(String(b[order.field] ?? '')) * dir)
    }
    const total = out.length
    const offset = opts.offset ?? 0
    if (opts.limit !== undefined) out = out.slice(offset, offset + opts.limit)
    return { rows: out, total }
  }
  const orm: any = {
    calls,
    findMany: vi.fn(async (table: string, filters?: any, opts?: any) => {
      calls.findMany.push({ table, filters, opts })
      if (table === 'Auditlog') return query(AUDIT.map((r) => ({ ...r })), filters, opts).rows
      if (table === 'Hotels') return HOTELS.map((h) => ({ ...h }))
      return []
    }),
    paginate: vi.fn(async (table: string, filters?: any, opts?: any) => {
      calls.paginate.push({ table, filters, opts })
      const { rows, total } = query(AUDIT.map((r) => ({ ...r })), filters, opts)
      return { data: rows, total, limit: opts?.limit ?? 20, offset: opts?.offset ?? 0, pages: 1 }
    }),
  }
  return orm
}

describe('DashboardQueries.listAuditLogs — hotel y orden', () => {
  let orm: any
  beforeEach(() => { orm = makeOrm() })

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

  it('consulta hoteles UNA sola vez (sin N+1 por registro)', async () => {
    await new DashboardQueries(orm).listAuditLogs()
    expect(orm.calls.findMany.filter((c: any) => c.table === 'Hotels')).toHaveLength(1)
  })

  it('ordena por createdAt DESC: lo más reciente primero', async () => {
    const { data } = await new DashboardQueries(orm).listAuditLogs()
    expect(data.map((r: any) => r.id)).toEqual(['a2', 'a1', 'a3', 'a4'])
  })
})

describe('#142 — la página la arma la base, no el backend en memoria', () => {
  let orm: any
  beforeEach(() => { orm = makeOrm() })

  it('el orden y el recorte van en la CONSULTA (ORDER BY + LIMIT/OFFSET)', async () => {
    await new DashboardQueries(orm).listAuditLogs({ page: 1, limit: 2 })
    const call = orm.calls.paginate[0]
    expect(call.table).toBe('Auditlog')
    expect(call.opts.limit).toBe(2)
    expect(call.opts.offset).toBe(0)
    expect(call.opts.orderBy[0]).toMatchObject({ field: 'createdAt', dir: 'DESC' })
  })

  it('devuelve SOLO la página pedida, con el total del log completo para el pie', async () => {
    const page1 = await new DashboardQueries(orm).listAuditLogs({ page: 1, limit: 2 })
    const page2 = await new DashboardQueries(orm).listAuditLogs({ page: 2, limit: 2 })

    expect(page1.data.map((r: any) => r.id)).toEqual(['a2', 'a1'])
    expect(page2.data.map((r: any) => r.id)).toEqual(['a3', 'a4'])
    expect(page1.total).toBe(4) // "1-2 de 4"
  })

  it('un `limit` desmedido se recorta al techo: nadie se lleva la tabla pidiendo 100000', async () => {
    await new DashboardQueries(orm).listAuditLogs({ limit: 100000 })
    expect(orm.calls.paginate[0].opts.limit).toBe(200)
  })

  it('los filtros de hotel, usuario, acción y entidad viajan al WHERE', async () => {
    await new DashboardQueries(orm).listAuditLogs({ hotelId: 'h1', userId: 'u1', action: 'room.delete', entity: 'room' })
    expect(orm.calls.paginate[0].filters).toEqual({ hotelId: 'h1', userId: 'u1', action: 'room.delete', entity: 'room' })
  })

  it('filtrar por hotel devuelve sólo ese hotel', async () => {
    const { data, total } = await new DashboardQueries(orm).listAuditLogs({ hotelId: 'h1' })
    expect(data.map((r: any) => r.id)).toEqual(['a1', 'a4'])
    expect(total).toBe(2)
  })
})

describe('#142 — rango de fechas', () => {
  let orm: any
  beforeEach(() => { orm = makeOrm() })

  it('acota por `from`/`to` con los dos límites inclusive', async () => {
    const { data, total } = await new DashboardQueries(orm).listAuditLogs({ from: '2026-08-09', to: '2026-08-10' })
    expect(data.map((r: any) => r.id)).toEqual(['a1', 'a3'])
    expect(total).toBe(2)
  })

  it('sólo `from`: de esa fecha en adelante', async () => {
    const { data } = await new DashboardQueries(orm).listAuditLogs({ from: '2026-08-11' })
    expect(data.map((r: any) => r.id)).toEqual(['a2'])
  })

  it('el barrido pide bloques ordenados y acotados, no la tabla entera', async () => {
    await new DashboardQueries(orm).listAuditLogs({ from: '2026-08-01' })
    const scan = orm.calls.findMany.filter((c: any) => c.table === 'Auditlog')
    expect(scan.length).toBeGreaterThan(0)
    for (const call of scan) {
      expect(call.opts.limit).toBe(500)
      expect(call.opts.orderBy[0]).toMatchObject({ field: 'createdAt', dir: 'DESC' })
    }
  })

  it('el rango también resuelve hotelName', async () => {
    const { data } = await new DashboardQueries(orm).listAuditLogs({ from: '2026-08-10', to: '2026-08-10' })
    expect(data[0].hotelName).toBe('Hotel Alpha')
  })

  it('el rango combina con los filtros de igualdad', async () => {
    const { data, total } = await new DashboardQueries(orm).listAuditLogs({ hotelId: 'h1', from: '2026-08-01' })
    expect(data.map((r: any) => r.id)).toEqual(['a1'])
    expect(total).toBe(1)
  })
})
