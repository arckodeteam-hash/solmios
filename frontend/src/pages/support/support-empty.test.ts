// support-empty.test.ts — El vacío de /panel/support (issue #19).
//
// La auditoría E2E vio "0 abiertos / 0 en progreso / 0 resueltos" y, abajo, un bloque propio con
// "No hay tickets" + "Crea un ticket si necesitas ayuda": no explicaba qué es el módulo, no usaba
// el `EmptyState` compartido y no ofrecía la acción (había que subir al header a buscar el botón).
//
// Lo que se protege acá:
//   1. Sin tickets → EmptyState compartido que explica para qué sirve Soporte.
//   2. El primer paso es una acción que YA existe: abre el mismo modal de alta que el header.
//   3. Filtro sin resultados es otro estado (limpiar filtros), no el texto del módulo.
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'

let ticketsData: Record<string, unknown>[] = []

vi.mock('@/services/Operations.service', () => ({
  OperationsService: {
    tickets: {
      list: async () => ({ data: ticketsData }),
      create: async () => ({}),
      update: async () => ({}),
    },
  },
}))

vi.mock('@/composables/useToast', () => ({
  useToast: () => ({ success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn() }),
}))
vi.mock('@/stores/auth.store', () => ({
  useAuthStore: () => ({ user: { hotelId: 'h1', id: 'u1' } }),
}))

import Support from './index.vue'

function ticket(over: Record<string, unknown> = {}) {
  return {
    id: 't1', subject: 'No me abre la cerradura', description: 'La 101 no responde',
    priority: 'medium', status: 'open', category: 'Técnico',
    createdAt: '2026-08-19T10:00:00.000Z', messages: [],
    ...over,
  }
}

async function render() {
  const w = mount(Support)
  await flushPromises()
  return w
}

describe('support — estado vacío', () => {
  beforeEach(() => { ticketsData = [] })

  it('sin tickets usa el EmptyState compartido, no un cuadro propio', async () => {
    const w = await render()
    expect(w.findComponent({ name: 'EmptyState' }).exists()).toBe(true)
  })

  it('explica qué es el módulo en vez de mostrar sólo los ceros', async () => {
    const w = await render()
    const txt = w.text()
    expect(txt).toContain('Todavía no abriste ningún ticket')
    expect(txt).toMatch(/soporte/i)
    expect(txt).toMatch(/categor[íi]a/i)
    expect(txt).toMatch(/prioridad/i)
  })

  it('el primer paso abre el alta que ya existe en la vista', async () => {
    const w = await render()
    const cta = w.findAll('button').find((b) => /primer ticket/i.test(b.text()))
    expect(cta).toBeTruthy()
    await cta!.trigger('click')
    await flushPromises()
    // Es el mismo formulario que dispara el botón del header (va por <Teleport to="body">).
    expect(document.body.textContent).toContain('Nuevo Ticket de Soporte')
    expect(document.getElementById('support-categoria')).not.toBeNull()
  })

  it('filtro sin resultados es otro estado: limpiar filtros, no el texto del módulo', async () => {
    ticketsData = [ticket()]
    const w = await render()
    await w.find('#support-search-query').setValue('zzzz-no-matchea')
    await flushPromises()
    expect(w.text()).toContain('Ningún ticket con esos filtros')
    expect(w.text()).not.toContain('Todavía no abriste ningún ticket')
  })

  it('«Limpiar filtros» devuelve la lista completa', async () => {
    ticketsData = [ticket()]
    const w = await render()
    await w.find('#support-search-query').setValue('zzzz-no-matchea')
    await flushPromises()
    const btn = w.findAll('button').find((b) => b.text() === 'Limpiar filtros')
    expect(btn).toBeTruthy()
    await btn!.trigger('click')
    await flushPromises()
    expect(w.text()).toContain('No me abre la cerradura')
  })
})
