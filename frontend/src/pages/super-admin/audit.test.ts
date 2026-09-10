// audit.test.ts — Regresión #139 de la auditoría global (super-admin):
// el select de acciones se deriva de las entidades presentes (agrupadas y normalizadas), el filtro
// compara contra el grupo y el buscador también mira la acción cruda.
// #140: columna/desplegable/filtro/buscador/CSV de Hotel leen `hotelName` (resuelto por el backend)
// y la carga recorre TODAS las páginas del log, no sólo la primera.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import { nextTick } from 'vue'

/** Distribución real del issue: 226 'Reservations' + 24 'reservation' + facturación + cash_shift. */
const ENTITIES: string[] = [
  ...Array(226).fill('Reservations'),
  ...Array(24).fill('reservation'),
  ...Array(4).fill('invoice'),
  ...Array(2).fill('payment'),
  'expense',
  ...Array(3).fill('cash_shift'),
]
const ACTIONS = ['create', 'update', 'delete', 'rate.change']

const LOGS = ENTITIES.map((entity, i) => {
  const action = ACTIONS[i % ACTIONS.length]
  return {
    id: `l${i}`,
    userName: i % 2 === 0 ? 'Recepción' : 'Admin',
    action,
    entity,
    // Los 'delete' NO repiten la palabra en el detalle: el buscador tiene que encontrarlos por la acción.
    detail: action === 'delete' ? `Registro ${i} eliminado` : `Detalle ${i}`,
    ip: '10.0.0.1',
    createdAt: `2026-08-${String((i % 28) + 1).padStart(2, '0')}T10:00:00.000Z`,
  }
})
const DELETE_COUNT = LOGS.filter((l) => l.action === 'delete').length

const listMock = vi.fn()
vi.mock('@/services/AuditLog.service', () => ({
  AuditLogService: { list: (...a: unknown[]) => listMock(...a) },
}))
// Singleton: el componente y el test tienen que ver LOS MISMOS vi.fn() (patrón auditoria.test.ts).
vi.mock('@/composables/useToast', () => {
  const fns = { success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn(), toasts: [] }
  return { useToast: () => fns }
})

import Audit from './audit.vue'

let wrapper: ReturnType<typeof mount> | null = null
afterEach(() => {
  wrapper?.unmount()
  wrapper = null
  document.body.innerHTML = ''
  vi.restoreAllMocks()
})

async function render() {
  wrapper = mount(Audit)
  await flushPromises()
  await flushPromises()
  return wrapper
}

/** Primer <select> de la barra de filtros = "Todas las acciones". */
const actionSelect = (w: ReturnType<typeof mount>) => w.findAll('select')[0]
const optionValues = (w: ReturnType<typeof mount>) =>
  actionSelect(w).findAll('option').map((o) => o.attributes('value'))
/** Cantidad filtrada: la tabla está paginada (25 por página), así que se lee el computed. */
const filtered = (w: ReturnType<typeof mount>) => (w.vm as any).filteredLogs as unknown[]

describe('super-admin/audit — filtro de acciones y búsqueda (#139)', () => {
  beforeEach(() => {
    listMock.mockResolvedValue({ data: LOGS, total: LOGS.length })
  })

  it('el select trae "all" + sólo los grupos presentes, sin las opciones fijas viejas', async () => {
    const w = await render()
    const values = optionValues(w)
    expect(values[0]).toBe('all')
    expect(values.slice(1).sort()).toEqual(['billing', 'cash_shift', 'reservation'])
    for (const old of ['login', 'settings', 'system']) expect(values).not.toContain(old)
    // Más frecuentes primero, con conteo visible.
    expect(values[1]).toBe('reservation')
    expect(actionSelect(w).findAll('option')[1].text()).toBe('Reservas (250)')
  })

  it("filtrar 'reservation' junta 'Reservations' + 'reservation' = 250 filas", async () => {
    const w = await render()
    expect(filtered(w).length).toBe(LOGS.length)
    await actionSelect(w).setValue('reservation')
    await nextTick()
    expect(filtered(w).length).toBe(250)
    expect(w.text()).toContain('250 resultados')
  })

  it("filtrar 'billing' = invoice + payment + expense = 7 filas", async () => {
    const w = await render()
    await actionSelect(w).setValue('billing')
    await nextTick()
    expect(filtered(w).length).toBe(7)
    expect(w.text()).toContain('7 resultados')
  })

  it('cada option del select (distinta de all) devuelve al menos una fila', async () => {
    const w = await render()
    const values = optionValues(w).filter((v) => v !== 'all')
    expect(values.length).toBeGreaterThan(0)
    for (const v of values) {
      await actionSelect(w).setValue(v)
      await nextTick()
      expect(filtered(w).length, `option ${v}`).toBeGreaterThanOrEqual(1)
    }
  })

  it("buscar 'delete' devuelve exactamente las filas con action delete aunque el detalle no lo diga", async () => {
    const w = await render()
    expect(DELETE_COUNT).toBeGreaterThan(0)
    await w.find('input[type="text"]').setValue('delete')
    await nextTick()
    const rows = filtered(w) as any[]
    expect(rows.length).toBe(DELETE_COUNT)
    expect(rows.every((r) => r.actionKey === 'delete')).toBe(true)
    expect(rows.some((r) => String(r.detail).toLowerCase().includes('delete'))).toBe(false)
  })
})

// ── #140: hotel en columna, desplegable, filtro y CSV ─────────────────────────────────────────

/** Segundo <select> de la barra de filtros = "Todos los hoteles". */
const hotelSelect = (w: ReturnType<typeof mount>) => w.findAll('select')[1]

/** 5 entradas cortas (la tabla pagina de a 25, así que todas quedan visibles sin pasar de página). */
const LOGS_HOTEL = [
  { id: 'a1', userName: 'Recepción', action: 'create', entity: 'reservation', detail: 'Detalle a1', ip: '10.0.0.1', createdAt: '2026-08-02T10:00:00.000Z', hotelName: 'Hotel Alpha' },
  { id: 'a2', userName: 'Recepción', action: 'create', entity: 'reservation', detail: 'Detalle a2', ip: '10.0.0.1', createdAt: '2026-08-02T11:00:00.000Z', hotelName: 'Hotel Alpha' },
  { id: 'b1', userName: 'Admin', action: 'update', entity: 'invoice', detail: 'Detalle b1', ip: '10.0.0.2', createdAt: '2026-08-03T10:00:00.000Z', hotelName: 'Hotel Beta' },
  // #140: hotelName '' cuando el log no tiene hotelId (o el hotel es huérfano)...
  { id: 'p1', userName: 'Sistema', action: 'update', entity: 'cash_shift', detail: 'Detalle p1', ip: '10.0.0.3', createdAt: '2026-08-04T10:00:00.000Z', hotelName: '' },
  // ...y puede venir ausente en filas viejas: ambos casos caen al fallback 'Plataforma'.
  { id: 'p2', userName: 'Sistema', action: 'delete', entity: 'expense', detail: 'Detalle p2', ip: '10.0.0.3', createdAt: '2026-08-05T10:00:00.000Z' },
]

describe('super-admin/audit — columna y filtro de hotel (#140)', () => {
  beforeEach(() => {
    listMock.mockResolvedValue({ data: LOGS_HOTEL, total: LOGS_HOTEL.length })
  })

  it('la columna Hotel renderiza el nombre real (hotelName del backend)', async () => {
    const w = await render()
    expect(w.find('tbody').text()).toContain('Hotel Alpha')
    expect(w.find('tbody').text()).toContain('Hotel Beta')
  })

  it("'Plataforma' para los logs sin hotelName (vacío o ausente)", async () => {
    const w = await render()
    const rows = filtered(w) as any[]
    expect(rows.filter((r) => r.hotel === 'Plataforma').length).toBe(2)
    expect(w.find('tbody').text()).toContain('Plataforma')
  })

  it('el desplegable lista los hoteles presentes, sin repetidos', async () => {
    const w = await render()
    const values = hotelSelect(w).findAll('option').map((o) => o.attributes('value'))
    expect(values[0]).toBe('all')
    expect(values).toContain('Hotel Alpha')
    expect(values).toContain('Hotel Beta')
    expect(values).toContain('Plataforma')
    expect(new Set(values).size).toBe(values.length)
  })

  it("elegir 'Hotel Alpha' en el desplegable deja sólo sus entradas", async () => {
    const w = await render()
    await hotelSelect(w).setValue('Hotel Alpha')
    await nextTick()
    const rows = filtered(w) as any[]
    expect(rows.length).toBe(2)
    expect(rows.every((r) => r.hotel === 'Hotel Alpha')).toBe(true)
    expect(w.find('tbody').text()).toContain('Detalle a1')
    expect(w.find('tbody').text()).not.toContain('Detalle b1')
  })
})

describe('super-admin/audit — export CSV con hotel (#140)', () => {
  let blobs: Blob[] = []

  beforeEach(() => {
    listMock.mockResolvedValue({ data: LOGS_HOTEL, total: LOGS_HOTEL.length })
    blobs = []
    // Patrón auditoria.test.ts: capturar el Blob que el export crea con URL.createObjectURL.
    vi.spyOn(URL, 'createObjectURL').mockImplementation((b: Blob | MediaSource) => {
      blobs.push(b as Blob)
      return 'blob:mock'
    })
  })

  it('la columna Hotel del CSV trae el nombre real y "Plataforma" para las entradas sin hotel', async () => {
    const w = await render()
    const btn = w.findAll('button').find((b) => b.text() === 'Exportar CSV')!
    await btn.trigger('click')
    await flushPromises()

    expect(blobs.length).toBe(1)
    const csv = (await blobs[0].text()).replace(/^\uFEFF/, '') // BOM para Excel
    const lines = csv.split('\r\n')
    expect(lines[0]).toBe('Fecha,Hora,Usuario,Hotel,Acción,Categoría,Detalle,IP')
    // Cada campo va entrecomillado (comillas internas duplicadas): se pelan los extremos y se parte.
    const filas = lines.slice(1).map((l) => l.slice(1, -1).split('","'))
    expect(filas.length).toBe(LOGS_HOTEL.length)
    expect(filas.filter((f) => f[3] === 'Hotel Alpha').length).toBe(2)
    expect(filas.filter((f) => f[3] === 'Hotel Beta').length).toBe(1)
    expect(filas.filter((f) => f[3] === 'Plataforma').length).toBe(2)
  })
})

describe('super-admin/audit — carga completa del log (#140)', () => {
  it('recorre las páginas de 100 hasta total: los logs de la página 2 también quedan cargados', async () => {
    // Página 1 llena (100 filas de 'Hotel Alpha'); el hotel de la página 2 SOLO existe ahí.
    const pagina1 = Array.from({ length: 100 }, (_, i) => ({
      id: `p1-${i}`, userName: 'Recepción', action: 'create', entity: 'reservation',
      detail: `Detalle ${i}`, ip: '10.0.0.1', createdAt: '2026-08-02T10:00:00.000Z', hotelName: 'Hotel Alpha',
    }))
    const pagina2 = Array.from({ length: 5 }, (_, i) => ({
      id: `p2-${i}`, userName: 'Admin', action: 'update', entity: 'invoice',
      detail: `Detalle pagina dos ${i}`, ip: '10.0.0.2', createdAt: '2026-08-03T10:00:00.000Z', hotelName: 'Hotel Solo Pagina Dos',
    }))
    listMock.mockImplementation(async (params?: { page?: number }) =>
      (params?.page ?? 1) === 1 ? { data: pagina1, total: 105 } : { data: pagina2, total: 105 })
    // El historial de listMock acumula las llamadas de los tests anteriores: se limpia para contar
    // sólo las de ESTA carga.
    listMock.mockClear()

    const w = await render()
    expect(filtered(w).length).toBe(105)
    expect(w.text()).toContain('de 105')
    expect((w.vm as any).hotelList).toContain('Hotel Solo Pagina Dos')
    expect(listMock).toHaveBeenCalledTimes(2) // 100 < 105 → pidió la 2; 105 ya no es < 105 → paró.
    expect(listMock).toHaveBeenLastCalledWith({ page: 2, limit: 100 })
  })
})
