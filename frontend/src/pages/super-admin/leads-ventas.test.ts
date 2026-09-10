// leads-ventas.test.ts — Pipeline de ventas del super admin (#147, REQ-PIPE-06).
//
// Lo que se protege (criterios de aceptación del issue, no un checklist de markup):
//   1. "Perdido" sin motivo NO dispara petición: el error es inline y el service no se toca.
//   2. "Extender 7" manda days=7; la fila toma daysLeft del POST y la etapa del refresco.
//   3. Un prospecto con `nextStepAt` de ayer aparece en "Vencen hoy"; un perdido no.
//   4. Sin teléfono el botón de WhatsApp está deshabilitado con tooltip, no es un `<a>` roto.
//   5. Los leads del formulario se ven con etapa `contact` y su mensaje.
//   6. Los filtros (etapa / calor / buscador) recortan la lista.
//   7. Un lead del formulario sigue siendo una fila de `sales_leads`: "Contactado"/"Perdido" también
//      mueven su `status` (el badge del menú cuenta los `new`), y se puede borrar con confirmación.
//   8. La etapa NO se recalcula en el front: tras una acción se vuelve a pedir la lista al backend.
//   9. `assignedTo` es un `users.id` elegido de un select; el nombre se resuelve por id.
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import type { SalesPipelineRow, SalesProspect } from '@/types/sales-pipeline'

vi.mock('@/services/SalesPipeline.service', () => ({
  SalesPipelineService: {
    list: vi.fn(),
    assignees: vi.fn(),
    updateProspect: vi.fn(),
    extendTrial: vi.fn(),
  },
}))

vi.mock('@/services/SalesLeads.service', () => ({
  SalesLeadsService: {
    list: vi.fn(),
    update: vi.fn(),
    remove: vi.fn(),
  },
}))

vi.mock('@/composables/useToast', () => ({
  useToast: () => ({ success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn() }),
}))

// AppModal teleporta a <body>; para el test alcanza con que pinte sus slots en el lugar.
vi.mock('@/components/ui/AppModal.vue', () => ({
  default: { name: 'AppModal', template: '<div data-testid="modal"><slot /><slot name="footer" /></div>' },
}))
vi.mock('@/components/features/ConfirmModal.vue', () => ({
  default: {
    name: 'ConfirmModal',
    props: ['title', 'message', 'confirmLabel', 'danger', 'loading'],
    emits: ['confirm', 'close'],
    template: '<div data-testid="confirm"><p>{{ message }}</p><button data-testid="confirm-ok" @click="$emit(\'confirm\')">ok</button><button data-testid="confirm-cancel" @click="$emit(\'close\')">no</button></div>',
  },
}))

import LeadsVentas from './leads-ventas.vue'
import { SalesPipelineService } from '@/services/SalesPipeline.service'
import { SalesLeadsService } from '@/services/SalesLeads.service'

const ASSIGNEES = [
  { id: 'u1', name: 'Ana', email: 'ana@solmios.com' },
  { id: 'u2', name: 'Beto', email: 'beto@solmios.com' },
]

const DAY = 86_400_000
const iso = (offsetDays: number) => new Date(Date.now() + offsetDays * DAY).toISOString()

function row(over: Partial<SalesPipelineRow> & { key: string }): SalesPipelineRow {
  return {
    hotelId: over.key.startsWith('hotel:') ? over.key.slice(6) : null,
    leadId: over.key.startsWith('lead:') ? over.key.slice(5) : null,
    hotelName: 'Hotel X', ownerName: 'Dueño X', email: 'x@x.test', phone: '809-555-0000',
    whatsappUrl: 'https://wa.me/18095550000', stage: 'registered', leadStatus: null, subscriptionStatus: 'trialing',
    planId: 'plan-starter', trialEndsAt: iso(10), daysLeft: 10,
    signals: { rooms: 0, rates: 0, channels: 0, reservations: 0, lastActivityAt: null },
    heatScore: 0, heat: 'cold', message: null, registeredAt: iso(-3),
    nextStepAt: null, nextStepNote: null, assignedTo: null, contactedAt: null, lostAt: null, lostReason: null, notes: null,
    ...over,
  }
}

function prospect(over: Partial<SalesProspect> = {}): SalesProspect {
  return {
    id: 'p1', hotelId: null, leadId: null, nextStepAt: null, nextStepNote: null, assignedTo: null,
    contactedAt: null, lostAt: null, lostReason: null, notes: null, sequenceSent: {},
    createdAt: iso(0), updatedAt: iso(0), ...over,
  }
}

const ROWS: SalesPipelineRow[] = [
  row({ key: 'hotel:activated', hotelName: 'Villa Caracol', ownerName: 'Pedro', stage: 'activated', heat: 'warm', heatScore: 4, daysLeft: 6,
    signals: { rooms: 12, rates: 0, channels: 0, reservations: 0, lastActivityAt: iso(-3) },
    nextStepAt: iso(-1), nextStepNote: 'Llamar para cerrar', assignedTo: 'u1' }),
  row({ key: 'hotel:expired', hotelName: 'Cabañas del Río', ownerName: 'Luisa', email: 'luisa@rio.test', phone: null, whatsappUrl: null,
    stage: 'expired', daysLeft: -5, trialEndsAt: iso(-5), signals: { rooms: 7, rates: 0, channels: 0, reservations: 0, lastActivityAt: null } }),
  row({ key: 'hotel:registered', hotelName: 'Hostal El Faro', ownerName: 'Marta', stage: 'registered', daysLeft: 10 }),
  row({ key: 'hotel:lost', hotelName: 'Perdido SA', stage: 'lost', lostAt: iso(-2), lostReason: 'price', nextStepAt: iso(-4) }),
  row({ key: 'lead:1', hotelName: 'Posada Sol', ownerName: 'Carla Mota', stage: 'contact', subscriptionStatus: null, planId: 'professional',
    trialEndsAt: null, daysLeft: null, signals: null, message: 'Quiero una demo para 15 habitaciones' }),
]

async function mountView(rows: SalesPipelineRow[] = ROWS) {
  vi.mocked(SalesPipelineService.list).mockResolvedValue({ data: rows.map((r) => ({ ...r })), total: rows.length })
  vi.mocked(SalesPipelineService.assignees).mockResolvedValue({ data: ASSIGNEES })
  const wrapper = mount(LeadsVentas, { global: { stubs: { RouterLink: true } } })
  await flushPromises()
  return wrapper
}

beforeEach(() => {
  vi.mocked(SalesPipelineService.list).mockReset()
  vi.mocked(SalesPipelineService.updateProspect).mockReset()
  vi.mocked(SalesPipelineService.extendTrial).mockReset()
  vi.mocked(SalesPipelineService.assignees).mockReset()
  vi.mocked(SalesLeadsService.update).mockReset()
  vi.mocked(SalesLeadsService.remove).mockReset()
})

/** La lista que va a devolver el backend en el PRÓXIMO refresco (la etapa la decide él). */
function nextList(rows: SalesPipelineRow[]) {
  vi.mocked(SalesPipelineService.list).mockResolvedValueOnce({ data: rows.map((r) => ({ ...r })), total: rows.length })
}

describe('Pipeline de ventas — Perdido', () => {
  it('sin motivo NO llama al service y muestra el error inline', async () => {
    const wrapper = await mountView()
    await wrapper.find('[data-testid="lost-hotel:registered"]').trigger('click')
    expect(wrapper.find('[data-testid="modal"]').exists()).toBe(true)

    await wrapper.find('[data-testid="lost-confirm"]').trigger('submit')
    await wrapper.find('#lost-form').trigger('submit')
    await flushPromises()

    expect(SalesPipelineService.updateProspect).not.toHaveBeenCalled()
    expect(wrapper.find('[data-testid="lost-error"]').text()).toContain('motivo')
    // El modal sigue abierto: no se descarta la acción a medias.
    expect(wrapper.find('[data-testid="modal"]').exists()).toBe(true)
  })

  it('con motivo manda lostReason y la fila pasa a `lost` con la etapa que devuelve el backend', async () => {
    const wrapper = await mountView()
    vi.mocked(SalesPipelineService.updateProspect).mockResolvedValue(
      prospect({ hotelId: 'registered', lostAt: iso(0), lostReason: 'price' }),
    )
    nextList(ROWS.map((r) => (r.key === 'hotel:registered' ? { ...r, stage: 'lost' as const, lostAt: iso(0), lostReason: 'price' as const } : r)))
    await wrapper.find('[data-testid="lost-hotel:registered"]').trigger('click')
    await wrapper.find('[data-testid="lost-reason"]').setValue('price')
    await wrapper.find('#lost-form').trigger('submit')
    await flushPromises()

    expect(SalesPipelineService.updateProspect).toHaveBeenCalledWith('hotel:registered', { lostReason: 'price' })
    // La etapa no se calcula acá: se vuelve a pedir la lista.
    expect(SalesPipelineService.list).toHaveBeenCalledTimes(2)
    const tr = wrapper.find('[data-testid="row-hotel:registered"]')
    expect(tr.text()).toContain('Perdido')
    expect(tr.text()).toContain('Precio')
    expect(wrapper.find('[data-testid="modal"]').exists()).toBe(false)
    // Un hotel no es una fila de sales_leads: no se toca su status.
    expect(SalesLeadsService.update).not.toHaveBeenCalled()
  })

  it('Perdido sobre un lead del formulario también pasa sales_leads.status a `lost`', async () => {
    const wrapper = await mountView()
    vi.mocked(SalesPipelineService.updateProspect).mockResolvedValue(prospect({ leadId: '1', lostAt: iso(0), lostReason: 'no_response' }))
    vi.mocked(SalesLeadsService.update).mockResolvedValue({} as any)
    await wrapper.find('[data-testid="lost-lead:1"]').trigger('click')
    await wrapper.find('[data-testid="lost-reason"]').setValue('no_response')
    await wrapper.find('#lost-form').trigger('submit')
    await flushPromises()
    expect(SalesPipelineService.updateProspect).toHaveBeenCalledWith('lead:1', { lostReason: 'no_response' })
    expect(SalesLeadsService.update).toHaveBeenCalledWith('1', { status: 'lost' })
  })
})

describe('Pipeline de ventas — Extender trial', () => {
  it('Extender 7 manda days=7 y la fila toma daysLeft y la etapa que devuelve el backend', async () => {
    const wrapper = await mountView()
    vi.mocked(SalesPipelineService.extendTrial).mockResolvedValue({
      subscription: { id: 's', hotelId: 'expired', status: 'trialing', trialEndsAt: iso(7) },
      daysLeft: 7, previousTrialEndsAt: iso(-5), emailSent: true,
    })
    nextList(ROWS.map((r) => (r.key === 'hotel:expired' ? { ...r, stage: 'activated' as const, daysLeft: 7, trialEndsAt: iso(7) } : r)))

    const before = wrapper.find('[data-testid="row-hotel:expired"]')
    expect(before.find('[data-testid="trial-hotel:expired"]').text()).toContain('vencida')

    await wrapper.find('[data-testid="extend-7-hotel:expired"]').trigger('click')
    await flushPromises()

    expect(SalesPipelineService.extendTrial).toHaveBeenCalledWith('expired', 7)
    expect(SalesPipelineService.list).toHaveBeenCalledTimes(2)
    const after = wrapper.find('[data-testid="row-hotel:expired"]')
    expect(after.find('[data-testid="trial-hotel:expired"]').text()).toBe('7 días de prueba')
    expect(after.text()).toContain('Activado')
    expect(after.text()).not.toContain('Vencido')
  })

  it('solo se ofrece extender en registrado/activado/vencido (no en perdido, pagando ni contacto)', async () => {
    const wrapper = await mountView([
      ...ROWS,
      row({ key: 'hotel:paying', stage: 'paying', subscriptionStatus: 'active', daysLeft: null, trialEndsAt: null }),
    ])
    expect(wrapper.find('[data-testid="extend-7-hotel:registered"]').exists()).toBe(true)
    expect(wrapper.find('[data-testid="extend-7-hotel:activated"]').exists()).toBe(true)
    expect(wrapper.find('[data-testid="extend-7-hotel:expired"]').exists()).toBe(true)
    expect(wrapper.find('[data-testid="extend-7-hotel:lost"]').exists()).toBe(false)
    expect(wrapper.find('[data-testid="extend-7-hotel:paying"]').exists()).toBe(false)
    expect(wrapper.find('[data-testid="extend-7-lead:1"]').exists()).toBe(false)
  })

  // FE-13: un canceled/suspended cae en la etapa "vencido" pero el backend contesta 409 al extender:
  // solo se ofrece cuando la suscripción está de verdad en prueba (trialing/expired).
  it('no se ofrece extender a un canceled/suspended aunque la etapa sea "vencido"', async () => {
    const wrapper = await mountView([
      row({ key: 'hotel:canceled', stage: 'expired', subscriptionStatus: 'canceled', daysLeft: null, trialEndsAt: null }),
      row({ key: 'hotel:suspended', stage: 'expired', subscriptionStatus: 'suspended', daysLeft: null, trialEndsAt: null }),
      row({ key: 'hotel:trial-expired', stage: 'expired', subscriptionStatus: 'trialing', daysLeft: -2, trialEndsAt: iso(-2) }),
      row({ key: 'hotel:status-expired', stage: 'expired', subscriptionStatus: 'expired', daysLeft: -9, trialEndsAt: iso(-9) }),
    ])
    expect(wrapper.find('[data-testid="extend-7-hotel:canceled"]').exists()).toBe(false)
    expect(wrapper.find('[data-testid="extend-7-hotel:suspended"]').exists()).toBe(false)
    expect(wrapper.find('[data-testid="extend-7-hotel:trial-expired"]').exists()).toBe(true)
    expect(wrapper.find('[data-testid="extend-7-hotel:status-expired"]').exists()).toBe(true)
  })

  it('daysLeft=0 es "venció hace menos de un día", no "vence hoy" (backend: end < now)', async () => {
    const wrapper = await mountView([
      row({ key: 'hotel:d0', stage: 'expired', daysLeft: 0, trialEndsAt: iso(-0.5) }),
      row({ key: 'hotel:d-5', stage: 'expired', daysLeft: -5, trialEndsAt: iso(-5) }),
      row({ key: 'hotel:d1', stage: 'registered', daysLeft: 1, trialEndsAt: iso(0.5) }),
    ])
    const d0 = wrapper.find('[data-testid="trial-hotel:d0"]').text()
    expect(d0).not.toMatch(/vence hoy/i)
    expect(d0).toMatch(/vencida hoy/i)
    expect(wrapper.find('[data-testid="trial-hotel:d-5"]').text()).toBe('Prueba vencida hace 5 d')
    expect(wrapper.find('[data-testid="trial-hotel:d1"]').text()).toBe('1 día de prueba')
  })

  it('Extender 15 manda days=15', async () => {
    const wrapper = await mountView()
    vi.mocked(SalesPipelineService.extendTrial).mockResolvedValue({
      subscription: { id: 's', hotelId: 'registered', status: 'trialing', trialEndsAt: iso(25) },
      daysLeft: 25, previousTrialEndsAt: iso(10), emailSent: true,
    })
    await wrapper.find('[data-testid="extend-15-hotel:registered"]').trigger('click')
    await flushPromises()
    expect(SalesPipelineService.extendTrial).toHaveBeenCalledWith('registered', 15)
    expect(wrapper.find('[data-testid="trial-hotel:registered"]').text()).toBe('25 días de prueba')
  })

  it('un lead sin hotel no ofrece extender', async () => {
    const wrapper = await mountView()
    expect(wrapper.find('[data-testid="extend-7-lead:1"]').exists()).toBe(false)
  })
})

describe('Pipeline de ventas — Vencen hoy', () => {
  it('lista el prospecto con nextStepAt ayer y no al perdido', async () => {
    const wrapper = await mountView()
    const due = wrapper.find('[data-testid="due-today"]')
    expect(due.exists()).toBe(true)
    expect(due.text()).toContain('Villa Caracol')
    expect(due.text()).toContain('Llamar para cerrar')
    expect(due.text()).toContain('Ana')
    expect(due.text()).not.toContain('Perdido SA')
  })

  it('Contactado desde el bloque limpia el próximo paso y saca la fila del bloque', async () => {
    const wrapper = await mountView()
    vi.mocked(SalesPipelineService.updateProspect).mockResolvedValue(
      prospect({ hotelId: 'activated', contactedAt: iso(0), nextStepAt: null, nextStepNote: null, assignedTo: 'u1' }),
    )
    nextList(ROWS.map((r) => (r.key === 'hotel:activated' ? { ...r, contactedAt: iso(0), nextStepAt: null, nextStepNote: null } : r)))
    await wrapper.find('[data-testid="due-contacted-hotel:activated"]').trigger('click')
    await flushPromises()

    const [key, input] = vi.mocked(SalesPipelineService.updateProspect).mock.calls[0]!
    expect(key).toBe('hotel:activated')
    expect(typeof input.contactedAt).toBe('string')
    expect(input.nextStepAt).toBeNull()
    expect(input.nextStepNote).toBeNull()
    expect(wrapper.find('[data-testid="due-today"]').exists()).toBe(false)
  })

  it('Contactado sobre una fila con próximo paso FUTURO no lo borra', async () => {
    const wrapper = await mountView([row({ key: 'hotel:a', nextStepAt: iso(3), nextStepNote: 'Demo' })])
    vi.mocked(SalesPipelineService.updateProspect).mockResolvedValue(prospect({ hotelId: 'a', contactedAt: iso(0), nextStepAt: iso(3), nextStepNote: 'Demo' }))
    await wrapper.find('[data-testid="contacted-hotel:a"]').trigger('click')
    await flushPromises()
    const [, input] = vi.mocked(SalesPipelineService.updateProspect).mock.calls[0]!
    expect(input).not.toHaveProperty('nextStepAt')
    expect(input).not.toHaveProperty('nextStepNote')
  })

  it('no se pinta cuando nadie vence', async () => {
    const wrapper = await mountView([row({ key: 'hotel:a', nextStepAt: iso(3) })])
    expect(wrapper.find('[data-testid="due-today"]').exists()).toBe(false)
  })
})

describe('Pipeline de ventas — contacto y señales', () => {
  it('sin teléfono, WhatsApp y Llamar quedan deshabilitados con tooltip (no un enlace roto)', async () => {
    const wrapper = await mountView()
    const wa = wrapper.find('[data-testid="wa-hotel:expired"]')
    expect(wa.element.tagName).toBe('BUTTON')
    expect(wa.attributes('disabled')).toBeDefined()
    expect(wa.attributes('aria-label')).toBe('WhatsApp: sin teléfono')
    const tel = wrapper.find('[data-testid="tel-hotel:expired"]')
    expect(tel.element.tagName).toBe('BUTTON')
    expect(tel.attributes('disabled')).toBeDefined()
    expect(tel.attributes('aria-label')).toBe('Llamar: sin teléfono')
    // El email sí existe → mailto real.
    expect(wrapper.find('[data-testid="mail-hotel:expired"]').attributes('href')).toBe('mailto:luisa@rio.test')
  })

  it('con teléfono, WhatsApp abre wa.me en pestaña nueva y Llamar usa tel:', async () => {
    const wrapper = await mountView()
    const wa = wrapper.find('[data-testid="wa-hotel:activated"]')
    expect(wa.element.tagName).toBe('A')
    expect(wa.attributes('href')).toBe('https://wa.me/18095550000')
    expect(wa.attributes('target')).toBe('_blank')
    expect(wrapper.find('[data-testid="tel-hotel:activated"]').attributes('href')).toBe('tel:8095550000')
  })

  it('los testids son únicos por fila y acción: el bloque "Vencen hoy" usa el prefijo due-', async () => {
    const wrapper = await mountView()
    // Villa Caracol está en el bloque Y en la tabla: sin prefijo habría dos `wa-hotel:activated`.
    expect(wrapper.findAll('[data-testid="wa-hotel:activated"]').length).toBe(1)
    expect(wrapper.findAll('[data-testid="due-wa-hotel:activated"]').length).toBe(1)
    expect(wrapper.findAll('[data-testid="contacted-hotel:activated"]').length).toBe(1)
    expect(wrapper.findAll('[data-testid="due-contacted-hotel:activated"]').length).toBe(1)
  })

  it('el badge de calor es legible: >=12px y colores con contraste >= 4.5:1', async () => {
    const wrapper = await mountView()
    const warm = wrapper.find('[data-testid="heat-hotel:activated"]')
    expect(warm.classes()).toContain('text-xs')
    expect(warm.classes()).not.toContain('text-[10px]')
    // Tibio: amber-800 sobre amber-100 = 6.36:1 (medido con los valores de Tailwind 4).
    expect(warm.classes()).toEqual(expect.arrayContaining(['bg-amber-100', 'text-amber-800']))
  })

  it('pinta los chips de señales y el calor', async () => {
    const wrapper = await mountView()
    const chips = wrapper.find('[data-testid="signals-hotel:activated"]').text()
    expect(chips).toContain('12 hab')
    expect(chips).toContain('0 tarifas')
    expect(chips).toContain('0 canales')
    expect(chips).toContain('0 reservas')
    expect(chips).toContain('visto hace 3 d')
    expect(wrapper.find('[data-testid="heat-hotel:activated"]').text()).toContain('Tibio')
    expect(wrapper.find('[data-testid="signals-hotel:expired"]').text()).toContain('nunca entró')
  })

  it('el lead del formulario se ve con etapa Contacto y su mensaje', async () => {
    const wrapper = await mountView()
    const tr = wrapper.find('[data-testid="row-lead:1"]')
    expect(tr.text()).toContain('Contacto')
    expect(tr.text()).toContain('Quiero una demo para 15 habitaciones')
    expect(tr.text()).toContain('Carla Mota')
  })
})

describe('Pipeline de ventas — próximo paso inline y contactado', () => {
  it('Guardar aparece solo al editar y manda fecha ISO + nota + responsable', async () => {
    const wrapper = await mountView()
    expect(wrapper.find('[data-testid="save-step-hotel:registered"]').exists()).toBe(false)

    const tr = wrapper.find('[data-testid="row-hotel:registered"]')
    await tr.find('input[type="date"]').setValue('2026-09-15')
    await tr.findAll('input[type="text"]')[0]!.setValue('Mandar propuesta')
    await tr.find('[data-testid="assignee-hotel:registered"]').setValue('u2')

    vi.mocked(SalesPipelineService.updateProspect).mockResolvedValue(
      prospect({ hotelId: 'registered', nextStepAt: new Date(2026, 8, 15, 12).toISOString(), nextStepNote: 'Mandar propuesta', assignedTo: 'u2' }),
    )
    await wrapper.find('[data-testid="save-step-hotel:registered"]').trigger('click')
    await flushPromises()

    const [key, input] = vi.mocked(SalesPipelineService.updateProspect).mock.calls[0]!
    expect(key).toBe('hotel:registered')
    expect(input.nextStepNote).toBe('Mandar propuesta')
    // Se manda el users.id, no el nombre.
    expect(input.assignedTo).toBe('u2')
    expect(new Date(input.nextStepAt!).getDate()).toBe(15)
    // Guardado → ya no está sucio → el botón desaparece.
    expect(wrapper.find('[data-testid="save-step-hotel:registered"]').exists()).toBe(false)
  })

  it('el responsable sale de un select con los usuarios admin y se muestra por nombre', async () => {
    const wrapper = await mountView()
    const select = wrapper.find('[data-testid="assignee-hotel:activated"]')
    expect(select.element.tagName).toBe('SELECT')
    const labels = select.findAll('option').map((o) => o.text())
    expect(labels).toEqual(['Sin responsable', 'Ana', 'Beto'])
    expect((select.element as HTMLSelectElement).value).toBe('u1')
    // En "Vencen hoy" se ve el nombre, no el id.
    expect(wrapper.find('[data-testid="due-today"]').text()).toContain('Ana')
    expect(wrapper.find('[data-testid="due-today"]').text()).not.toContain('u1')
  })

  it('si el endpoint de responsables falla, la vista carga igual con "Sin responsable"', async () => {
    vi.mocked(SalesPipelineService.list).mockResolvedValue({ data: ROWS.map((r) => ({ ...r })), total: ROWS.length })
    vi.mocked(SalesPipelineService.assignees).mockRejectedValue(new Error('404'))
    const wrapper = mount(LeadsVentas, { global: { stubs: { RouterLink: true } } })
    await flushPromises()
    expect(wrapper.find('[data-testid="pipeline-error"]').exists()).toBe(false)
    expect(wrapper.findAll('tbody tr').length).toBe(5)
    const select = wrapper.find('[data-testid="assignee-hotel:registered"]')
    expect(select.findAll('option').map((o) => o.text())).toEqual(['Sin responsable'])
  })

  it('Contactado manda contactedAt y lo refleja en la fila', async () => {
    const wrapper = await mountView()
    vi.mocked(SalesPipelineService.updateProspect).mockResolvedValue(prospect({ hotelId: 'registered', contactedAt: iso(0) }))
    await wrapper.find('[data-testid="contacted-hotel:registered"]').trigger('click')
    await flushPromises()
    const [, input] = vi.mocked(SalesPipelineService.updateProspect).mock.calls[0]!
    expect(typeof input.contactedAt).toBe('string')
    expect(wrapper.find('[data-testid="row-hotel:registered"]').text()).toContain('Contactado hoy')
    // Un hotel NO es una fila de sales_leads.
    expect(SalesLeadsService.update).not.toHaveBeenCalled()
  })

  it('Contactado sobre lead:<id> además pasa sales_leads.status a `contacted` (el badge del menú cuenta los `new`)', async () => {
    const wrapper = await mountView()
    vi.mocked(SalesPipelineService.updateProspect).mockResolvedValue(prospect({ leadId: '1', contactedAt: iso(0) }))
    vi.mocked(SalesLeadsService.update).mockResolvedValue({} as any)
    await wrapper.find('[data-testid="contacted-lead:1"]').trigger('click')
    await flushPromises()
    expect(SalesPipelineService.updateProspect).toHaveBeenCalledTimes(1)
    expect(SalesLeadsService.update).toHaveBeenCalledWith('1', { status: 'contacted' })
    expect(wrapper.find('[data-testid="row-lead:1"]').text()).toContain('Contactado hoy')
  })

  it('si falla el cambio de status del lead, el error queda inline', async () => {
    const wrapper = await mountView()
    const { ApiError } = await import('@/services/http')
    vi.mocked(SalesPipelineService.updateProspect).mockResolvedValue(prospect({ leadId: '1', contactedAt: iso(0) }))
    vi.mocked(SalesLeadsService.update).mockRejectedValue(new ApiError(404, 'Lead no encontrado'))
    await wrapper.find('[data-testid="contacted-lead:1"]').trigger('click')
    await flushPromises()
    expect(wrapper.find('[data-testid="error-lead:1"]').text()).toBe('Lead no encontrado')
  })

  it('Recuperar un lead perdido lo devuelve a `new` en sales_leads', async () => {
    const wrapper = await mountView([row({ key: 'lead:9', stage: 'lost', lostAt: iso(-1), lostReason: 'price', signals: null, daysLeft: null })])
    vi.mocked(SalesPipelineService.updateProspect).mockResolvedValue(prospect({ leadId: '9' }))
    vi.mocked(SalesLeadsService.update).mockResolvedValue({} as any)
    await wrapper.find('[data-testid="recover-lead:9"]').trigger('click')
    await flushPromises()
    expect(SalesPipelineService.updateProspect).toHaveBeenCalledWith('lead:9', { lostReason: null, lostAt: null })
    expect(SalesLeadsService.update).toHaveBeenCalledWith('9', { status: 'new' })
  })

  it('las notas se editan desde la fila y se guardan en el prospecto', async () => {
    const wrapper = await mountView()
    await wrapper.find('[data-testid="notes-lead:1"]').trigger('click')
    expect(wrapper.find('[data-testid="modal"]').exists()).toBe(true)
    await wrapper.find('[data-testid="notes-text"]').setValue('Pidió precio para 15 hab')
    vi.mocked(SalesPipelineService.updateProspect).mockResolvedValue(prospect({ leadId: '1', notes: 'Pidió precio para 15 hab' }))
    await wrapper.find('#notes-form').trigger('submit')
    await flushPromises()
    expect(SalesPipelineService.updateProspect).toHaveBeenCalledWith('lead:1', { notes: 'Pidió precio para 15 hab' })
    expect(wrapper.find('[data-testid="modal"]').exists()).toBe(false)
    expect(wrapper.find('[data-testid="row-lead:1"]').text()).toContain('Pidió precio para 15 hab')
  })

  it('si el PUT falla, el error queda inline en la fila', async () => {
    const wrapper = await mountView()
    const { ApiError } = await import('@/services/http')
    vi.mocked(SalesPipelineService.updateProspect).mockRejectedValue(new ApiError(404, 'Hotel no encontrado'))
    await wrapper.find('[data-testid="contacted-hotel:registered"]').trigger('click')
    await flushPromises()
    expect(wrapper.find('[data-testid="error-hotel:registered"]').text()).toBe('Hotel no encontrado')
  })
})

describe('Pipeline de ventas — borrar lead', () => {
  it('Borrar pide confirmación; al confirmar llama a remove y saca la fila', async () => {
    const wrapper = await mountView()
    expect(wrapper.find('[data-testid="delete-hotel:registered"]').exists()).toBe(false)
    await wrapper.find('[data-testid="delete-lead:1"]').trigger('click')
    expect(wrapper.find('[data-testid="confirm"]').exists()).toBe(true)
    expect(SalesLeadsService.remove).not.toHaveBeenCalled()

    vi.mocked(SalesLeadsService.remove).mockResolvedValue(undefined)
    await wrapper.find('[data-testid="confirm-ok"]').trigger('click')
    await flushPromises()
    expect(SalesLeadsService.remove).toHaveBeenCalledWith('1')
    expect(wrapper.find('[data-testid="row-lead:1"]').exists()).toBe(false)
    expect(wrapper.find('[data-testid="confirm"]').exists()).toBe(false)
  })

  it('cancelar no borra nada', async () => {
    const wrapper = await mountView()
    await wrapper.find('[data-testid="delete-lead:1"]').trigger('click')
    await wrapper.find('[data-testid="confirm-cancel"]').trigger('click')
    expect(SalesLeadsService.remove).not.toHaveBeenCalled()
    expect(wrapper.find('[data-testid="row-lead:1"]').exists()).toBe(true)
  })
})

describe('Pipeline de ventas — filtros y estados', () => {
  it('filtra por etapa, calor y buscador', async () => {
    const wrapper = await mountView()
    expect(wrapper.findAll('tbody tr').length).toBe(5)

    const expiredChip = wrapper.findAll('button').find((b) => b.text().startsWith('Vencido ('))!
    await expiredChip.trigger('click')
    expect(wrapper.findAll('tbody tr').length).toBe(1)
    expect(wrapper.find('tbody').text()).toContain('Cabañas del Río')
    await expiredChip.trigger('click')

    await wrapper.find('select[aria-label="Filtrar por calor"]').setValue('warm')
    expect(wrapper.findAll('tbody tr').length).toBe(1)
    expect(wrapper.find('tbody').text()).toContain('Villa Caracol')
    await wrapper.find('select[aria-label="Filtrar por calor"]').setValue('')

    await wrapper.find('input[aria-label="Buscar por hotel, dueño o email"]').setValue('luisa@rio')
    expect(wrapper.findAll('tbody tr').length).toBe(1)

    await wrapper.find('input[aria-label="Buscar por hotel, dueño o email"]').setValue('nadie')
    expect(wrapper.findAll('tbody tr').length).toBe(0)
    expect(wrapper.text()).toContain('Sin resultados')
  })

  it('vacío y error', async () => {
    const empty = await mountView([])
    expect(empty.text()).toContain('Todavía no hay prospectos')

    // Caída de red: `fetch` rechaza con un TypeError pelado, no con ApiError.
    vi.mocked(SalesPipelineService.list).mockRejectedValue(new TypeError('Failed to fetch'))
    const failed = mount(LeadsVentas, { global: { stubs: { RouterLink: true } } })
    await flushPromises()
    expect(failed.find('[data-testid="pipeline-error"]').exists()).toBe(true)
    expect(failed.find('[data-testid="pipeline-error"]').text()).toContain('No se pudo conectar con el servidor')
    expect(failed.text()).not.toContain('Error desconocido')
  })
})
