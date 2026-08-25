// auditoria.test.ts — Regresión M3 de la auditoría qa-ui/config-2026-08-22:
// filtros (rango de fechas, usuario, acción) + export CSV del resultado filtrado.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'

// 60 eventos: fuerza 3 páginas de 20 (LIMIT) y 1 tanda de 100 (EXPORT_PAGE) para el export.
const EVENTS = Array.from({ length: 60 }, (_, i) => ({
  id: `e${i}`,
  hotelId: 'h1',
  userId: i % 2 === 0 ? 'u1' : 'u2',
  userName: i % 2 === 0 ? 'Recepción' : 'Admin',
  action: i % 3 === 0 ? 'room.delete' : 'payment_request.paid',
  entity: 'room',
  detail: `Detalle ${i}`,
  createdAt: `2026-08-${String((i % 20) + 1).padStart(2, '0')}T10:00:00.000Z`,
}))

const listMock = vi.fn()
vi.mock('@/services/AuditLog.service', () => ({
  AuditLogService: { list: (...a: unknown[]) => listMock(...a) },
}))
vi.mock('@/services/Team.service', () => ({
  TeamService: { list: vi.fn(async () => ({ data: [{ id: 'u1', name: 'Recepción' }, { id: 'u2', name: 'Admin' }], total: 2 })) },
}))
// Singleton: el componente y el test tienen que ver LOS MISMOS vi.fn() (patrón rooms.test.ts).
vi.mock('@/composables/useToast', () => {
  const fns = { success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn(), toasts: [] }
  return { useToast: () => fns }
})

import Auditoria from './index.vue'
import { useToast } from '@/composables/useToast'

const toast = useToast()

let wrapper: ReturnType<typeof mount> | null = null
afterEach(() => {
  wrapper?.unmount()
  wrapper = null
  document.body.innerHTML = ''
  vi.restoreAllMocks()
})

/** Mock del list: pagina EVENTS aplicando userId/action/from/to como el backend. */
function mockList() {
  listMock.mockImplementation(async (params: any) => {
    let rows = EVENTS
    if (params?.userId) rows = rows.filter((r) => r.userId === params.userId)
    if (params?.action) rows = rows.filter((r) => r.action === params.action)
    if (params?.from) rows = rows.filter((r) => r.createdAt >= `${params.from}T00:00:00.000Z`)
    if (params?.to) rows = rows.filter((r) => r.createdAt <= `${params.to}T23:59:59.999Z`)
    const start = ((params?.page || 1) - 1) * (params?.limit || 20)
    return { data: rows.slice(start, start + (params?.limit || 20)), total: rows.length }
  })
}

async function render() {
  wrapper = mount(Auditoria)
  await flushPromises()
  await flushPromises()
  return wrapper
}

const btnByText = (w: ReturnType<typeof mount>, text: string) =>
  w.findAll('button').find((b) => b.text().includes(text))

describe('auditoria — filtros (M3)', () => {
  beforeEach(() => { mockList() })

  it('muestra la barra de filtros y el botón de export', async () => {
    const w = await render()
    expect(w.find('#auditoria-from').exists()).toBe(true)
    expect(w.find('#auditoria-to').exists()).toBe(true)
    expect(w.find('#auditoria-user').exists()).toBe(true)
    expect(w.find('#auditoria-action').exists()).toBe(true)
    expect(btnByText(w, 'Exportar CSV')).toBeTruthy()
    expect(w.text()).toContain('60 evento(s)')
  })

  it('el filtro de usuario viaja al backend como userId y reinicia a página 1', async () => {
    const w = await render()
    // Ir a página 2 primero: si el filtro no reseteara, seguiría en la 2.
    await btnByText(w, 'Siguiente')!.trigger('click')
    await flushPromises()
    expect(listMock).toHaveBeenLastCalledWith(expect.objectContaining({ page: 2 }))

    await w.find('#auditoria-user').setValue('u1')
    await flushPromises()

    const last = listMock.mock.calls[listMock.mock.calls.length - 1][0] as any
    expect(last.page).toBe(1)
    expect(last.userId).toBe('u1')
  })

  it('rango de fechas viaja como from/to y acota el total', async () => {
    const w = await render()
    await w.find('#auditoria-from').setValue('2026-08-02')
    await flushPromises()

    const last = listMock.mock.calls[listMock.mock.calls.length - 1][0] as any
    expect(last.from).toBe('2026-08-02')
    expect(w.text()).toContain('57 evento(s)') // 60 menos los 3 del día 1
  })

  it('con filtros sin resultados muestra el empty state de filtros', async () => {
    const w = await render()
    await w.find('#auditoria-from').setValue('2020-01-01')
    await w.find('#auditoria-to').setValue('2020-01-31')
    await flushPromises()

    expect(w.text()).toContain('Sin eventos para estos filtros')
  })

  it('Limpiar filtros vuelve al listado completo', async () => {
    const w = await render()
    await w.find('#auditoria-action').setValue('room.delete')
    await flushPromises()
    expect(w.text()).toContain('20 evento(s)')

    await btnByText(w, 'Limpiar filtros')!.trigger('click')
    await flushPromises()
    const last = listMock.mock.calls[listMock.mock.calls.length - 1][0] as any
    expect(last.action).toBeUndefined()
    expect(w.text()).toContain('60 evento(s)')
  })
})

describe('auditoria — export CSV (M3)', () => {
  let blobs: Blob[] = []

  beforeEach(() => {
    mockList()
    blobs = []
    vi.spyOn(URL, 'createObjectURL').mockImplementation((b: Blob | MediaSource) => { blobs.push(b as Blob); return 'blob:mock' })
  })

  it('exporta TODOS los eventos filtrados (recorre páginas de 100), no solo la visible', async () => {
    const w = await render()
    await btnByText(w, 'Exportar CSV')!.trigger('click')
    await flushPromises()

    expect(blobs.length).toBe(1)
    const csv = (await blobs[0].text()).replace(/^﻿/, '') // BOM para Excel
    const lines = csv.split('\n')
    expect(lines[0]).toBe('Fecha,Usuario,Acción,Entidad,Detalle')
    expect(lines.length).toBe(61) // header + los 60 (la página muestra solo 20)
    expect(csv).toContain('room.delete')
    expect(toast.success).toHaveBeenCalledWith('CSV exportado (60 eventos)')
  })

  it('el export respeta el filtro de acción activo', async () => {
    const w = await render()
    await w.find('#auditoria-action').setValue('room.delete')
    await flushPromises()

    await btnByText(w, 'Exportar CSV')!.trigger('click')
    await flushPromises()

    const csv = await blobs[0].text()
    expect(csv).toContain('room.delete')
    expect(csv).not.toContain('payment_request.paid')
    expect(toast.success).toHaveBeenCalledWith('CSV exportado (20 eventos)')
  })
})
