// rate-overrides.test.ts — Grilla de tarifas por fecha (capa que cierra los tests 2 a 8 de la
// certificación PMS de Channex). Cubre normalización, el borrado por "override vacío", el tracking
// de dimensiones apagadas (que es lo que evita dejar un stop_sell colgado en la OTA) y la elección
// del override más específico para una fecha.
import { describe, it, expect } from 'bun:test'
import {
  normalizeRateOverride, isEmptyOverride, listRateOverrides, upsertRateOverrides,
  deleteRateOverride, pickOverrideForDate, type RateOverrideRow,
} from '../usecases/rate-overrides'

/** Repo en memoria con la superficie que usa el usecase (findMany/create/update/delete). */
function fakeRepo(seed: RateOverrideRow[] = []) {
  const rows: RateOverrideRow[] = [...seed]
  let n = 0
  return {
    rows,
    findMany: async (q: any) => rows.filter((r) => Object.entries(q).every(([k, v]) => (r as any)[k] === v)),
    create: async (data: any) => { const row = { ...data, id: data.id || `id-${++n}` }; rows.push(row); return row },
    update: async (id: string, patch: any) => {
      const i = rows.findIndex((r) => r.id === id)
      if (i < 0) return null
      rows[i] = { ...rows[i]!, ...patch }
      return rows[i]
    },
    delete: async (id: string) => { const i = rows.findIndex((r) => r.id === id); if (i >= 0) rows.splice(i, 1); return true },
  } as any
}

describe('normalizeRateOverride', () => {
  it('dateTo ausente ≡ un solo día (el caso "poné 333 el 22/11")', () => {
    const o = normalizeRateOverride({ roomType: 'Twin', ratePlan: 'bar', dateFrom: '2026-11-22', rate: 333 })
    expect(o).toMatchObject({ roomType: 'Twin', ratePlan: 'bar', dateFrom: '2026-11-22', dateTo: '2026-11-22', rate: 333 })
  })

  it('rechaza rango invertido, fechas mal formadas y filas sin tipo o plan', () => {
    expect(normalizeRateOverride({ roomType: 'Twin', ratePlan: 'bar', dateFrom: '2026-11-25', dateTo: '2026-11-20' })).toBeNull()
    expect(normalizeRateOverride({ roomType: 'Twin', ratePlan: 'bar', dateFrom: '25/11/2026' })).toBeNull()
    expect(normalizeRateOverride({ ratePlan: 'bar', dateFrom: '2026-11-22' })).toBeNull()
    expect(normalizeRateOverride({ roomType: 'Twin', dateFrom: '2026-11-22' })).toBeNull()
  })

  it('normaliza el plan a minúsculas y acepta booleanos en los flags (la grilla manda boolean)', () => {
    const o = normalizeRateOverride({ roomType: 'Twin', ratePlan: 'BAR', dateFrom: '2026-11-22', stopSell: true, closedToArrival: false })
    expect(o!.ratePlan).toBe('bar')
    expect(o!.stopSell).toBe(1)
    expect(o!.closedToArrival).toBe(0)
  })

  it('precio con 2 decimales (el test 3 de la certificación pide 456.23 exacto)', () => {
    expect(normalizeRateOverride({ roomType: 'Double', ratePlan: 'bb', dateFrom: '2026-11-29', rate: 456.234 })!.rate).toBe(456.23)
  })

  it('negativos y basura caen a 0 = "sin override de esa dimensión"', () => {
    const o = normalizeRateOverride({ roomType: 'Twin', ratePlan: 'bar', dateFrom: '2026-11-22', rate: -5, minStay: NaN as any, maxStay: 'x' as any })
    expect([o!.rate, o!.minStay, o!.maxStay]).toEqual([0, 0, 0])
    expect(isEmptyOverride(o!)).toBe(true)
  })
})

describe('upsertRateOverrides', () => {
  it('crea, y re-guardar la misma celda ACTUALIZA en vez de duplicar', async () => {
    const repo = fakeRepo()
    await upsertRateOverrides(repo, 'h1', [{ roomType: 'Twin', ratePlan: 'bar', dateFrom: '2026-11-22', rate: 333 }])
    const { saved } = await upsertRateOverrides(repo, 'h1', [{ roomType: 'Twin', ratePlan: 'bar', dateFrom: '2026-11-22', rate: 350 }])
    expect(repo.rows).toHaveLength(1)
    expect(saved[0]!.row.rate).toBe(350)
  })

  it('un override que queda todo en cero se BORRA y se reporta como revertido', async () => {
    const repo = fakeRepo()
    await upsertRateOverrides(repo, 'h1', [{ roomType: 'Twin', ratePlan: 'bar', dateFrom: '2026-11-22', rate: 333 }])
    const { saved, removed } = await upsertRateOverrides(repo, 'h1', [{ roomType: 'Twin', ratePlan: 'bar', dateFrom: '2026-11-22', rate: 0 }])
    expect(saved).toHaveLength(0)
    expect(removed).toHaveLength(1)
    expect(repo.rows).toHaveLength(0)
  })

  it('reporta las dimensiones APAGADAS: sin esto el stop_sell publicado queda vivo en la OTA', async () => {
    const repo = fakeRepo()
    await upsertRateOverrides(repo, 'h1', [{ roomType: 'Twin', ratePlan: 'bar', dateFrom: '2026-11-22', rate: 333, stopSell: true, minStay: 3 }])
    const { saved } = await upsertRateOverrides(repo, 'h1', [{ roomType: 'Twin', ratePlan: 'bar', dateFrom: '2026-11-22', rate: 333, stopSell: false, minStay: 0 }])
    expect(saved[0]!.cleared.sort()).toEqual(['minStay', 'stopSell'])
  })

  it('lo que NO cambió no se reporta como apagado', async () => {
    const repo = fakeRepo()
    await upsertRateOverrides(repo, 'h1', [{ roomType: 'Twin', ratePlan: 'bar', dateFrom: '2026-11-22', rate: 333 }])
    const { saved } = await upsertRateOverrides(repo, 'h1', [{ roomType: 'Twin', ratePlan: 'bar', dateFrom: '2026-11-22', rate: 333, minStay: 2 }])
    expect(saved[0]!.cleared).toEqual([])
  })

  it('un lote entero se guarda de una (test 3: tres celdas en un solo guardado)', async () => {
    const repo = fakeRepo()
    const { saved } = await upsertRateOverrides(repo, 'h1', [
      { roomType: 'Twin', ratePlan: 'bar', dateFrom: '2026-11-21', rate: 333 },
      { roomType: 'Double', ratePlan: 'bar', dateFrom: '2026-11-25', rate: 444 },
      { roomType: 'Double', ratePlan: 'bb', dateFrom: '2026-11-29', rate: 456.23 },
    ])
    expect(saved.map((s) => s.row.rate)).toEqual([333, 444, 456.23])
  })

  it('descarta las filas inválidas sin abortar el resto del lote', async () => {
    const repo = fakeRepo()
    const { saved } = await upsertRateOverrides(repo, 'h1', [
      { roomType: 'Twin', ratePlan: 'bar', dateFrom: 'no-es-fecha', rate: 333 },
      { roomType: 'Double', ratePlan: 'bar', dateFrom: '2026-11-25', rate: 444 },
    ])
    expect(saved).toHaveLength(1)
    expect(saved[0]!.row.roomType).toBe('Double')
  })
})

describe('listRateOverrides / deleteRateOverride', () => {
  const rows: RateOverrideRow[] = [
    { id: 'a', hotelId: 'h1', roomType: 'Twin', ratePlan: 'bar', dateFrom: '2026-11-20', dateTo: '2026-11-25', rate: 100, minStay: 0, maxStay: 0, stopSell: 0, closedToArrival: 0, closedToDeparture: 0, minStayThrough: 0 },
    { id: 'b', hotelId: 'h1', roomType: 'Twin', ratePlan: 'bar', dateFrom: '2027-01-01', dateTo: '2027-01-05', rate: 200, minStay: 0, maxStay: 0, stopSell: 0, closedToArrival: 0, closedToDeparture: 0, minStayThrough: 0 },
    { id: 'c', hotelId: 'h2', roomType: 'Twin', ratePlan: 'bar', dateFrom: '2026-11-20', dateTo: '2026-11-25', rate: 999, minStay: 0, maxStay: 0, stopSell: 0, closedToArrival: 0, closedToDeparture: 0, minStayThrough: 0 },
  ]

  it('filtra por hotel y devuelve los que SOLAPAN el rango pedido, no solo los contenidos', async () => {
    const repo = fakeRepo(rows)
    const out = await listRateOverrides(repo, 'h1', '2026-11-24', '2026-11-30')
    expect(out.map((r) => r.id)).toEqual(['a'])   // 'a' solapa por un día; 'b' no; 'c' es de otro hotel
  })

  it('sin rango devuelve todos los del hotel, ordenados por fecha', async () => {
    const repo = fakeRepo(rows)
    expect((await listRateOverrides(repo, 'h1')).map((r) => r.id)).toEqual(['a', 'b'])
  })

  it('no borra un override de OTRO hotel aunque el id exista', async () => {
    const repo = fakeRepo(rows)
    expect(await deleteRateOverride(repo, 'h1', 'c')).toBeNull()
    expect(repo.rows).toHaveLength(3)
  })
})

describe('pickOverrideForDate', () => {
  const mk = (id: string, dateFrom: string, dateTo: string, rate: number): RateOverrideRow => ({
    id, hotelId: 'h1', roomType: 'Twin', ratePlan: 'bar', dateFrom, dateTo, rate,
    minStay: 0, maxStay: 0, stopSell: 0, closedToArrival: 0, closedToDeparture: 0, minStayThrough: 0,
  })

  it('gana el MÁS ESPECÍFICO: el tramo corto pisa al rango largo que lo contiene', () => {
    const all = [mk('largo', '2026-12-01', '2027-05-31', 432), mk('corto', '2026-12-24', '2026-12-26', 900)]
    expect(pickOverrideForDate(all, 'Twin', 'bar', '2026-12-25')!.id).toBe('corto')
    expect(pickOverrideForDate(all, 'Twin', 'bar', '2027-01-15')!.id).toBe('largo')
  })

  it('es case-insensitive en tipo y plan, y no cruza a otro plan', () => {
    const all = [mk('x', '2026-11-22', '2026-11-22', 333)]
    expect(pickOverrideForDate(all, 'TWIN', 'BAR', '2026-11-22')!.id).toBe('x')
    expect(pickOverrideForDate(all, 'Twin', 'bb', '2026-11-22')).toBeNull()
  })

  it('fuera del rango no devuelve nada', () => {
    expect(pickOverrideForDate([mk('x', '2026-11-22', '2026-11-22', 333)], 'Twin', 'bar', '2026-11-23')).toBeNull()
  })
})
