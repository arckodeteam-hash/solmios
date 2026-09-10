// audit.test.ts — Regresión #139 de la auditoría global (super-admin):
// el select de acciones se deriva de las entidades presentes (agrupadas y normalizadas), el filtro
// compara contra el grupo y el buscador también mira la acción cruda.
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
