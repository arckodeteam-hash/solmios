// restaurante/DiscountModal.test.ts — #215 (REST-13): modal de descuento/cortesía.
//   - sin motivo no se puede aplicar (el botón queda deshabilitado); con motivo y valor válido emite
//     `confirm` con { type, value, reason } — el motivo "Otro" viaja como el texto libre.
//   - la vista previa muestra cuánto se resta y cuánto queda (orientativa; el server recalcula).
//   - tope del rol: un valor por encima muestra "Supera tu tope (20 %)" y bloquea; "Cortesía 100 %" queda
//     deshabilitada si el tope no llega a 100. Un MONTO también se mide contra el tope.
//   - con un descuento vigente se ofrece "Quitar descuento" (emite `remove`) y se precargan tipo/valor/motivo.
import { describe, it, expect, afterEach } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import DiscountModal from './DiscountModal.vue'
import type { DiscountPolicy } from '@/services/Restaurant.service'

const policy = (maxDiscountPercent: number): DiscountPolicy => ({ maxDiscountPercent, reasons: ['Cortesía de la casa', 'Huésped del hotel', 'Otro'], isDefault: true })

// AppModal teletransporta al body: se consulta el DOM, no el wrapper (mismo criterio que cocina.test.ts).
function mountModal(props: Partial<InstanceType<typeof DiscountModal>['$props']> = {}) {
  return mount(DiscountModal, {
    props: { title: 'Descuento de la comanda', base: 100, currency: '$', policy: policy(100), ...props },
    attachTo: document.body,
  })
}
type W = ReturnType<typeof mountModal>
const q = <T extends Element = HTMLElement>(sel: string) => document.body.querySelector<T>(sel)
const text = (sel: string) => q(sel)?.textContent ?? ''
const disabled = (sel: string) => q<HTMLButtonElement>(sel)?.disabled
async function click(w: W, sel: string) { q<HTMLButtonElement>(sel)!.click(); await w.vm.$nextTick() }
async function type(w: W, sel: string, value: string) {
  const el = q<HTMLInputElement | HTMLTextAreaElement>(sel)!
  el.value = value
  el.dispatchEvent(new Event('input'))
  await w.vm.$nextTick()
}
const reasonBtn = (n: number) => `[data-testid="discount-reasons"] button:nth-child(${n})`
const CONFIRM = '[data-testid="discount-confirm"]'
const VALUE = '[data-testid="discount-value"]'

describe('DiscountModal — #215', () => {
  afterEach(() => { document.body.innerHTML = '' })

  it('sin motivo no aplica; con 10 % + motivo emite confirm {percent, 10, motivo} y la vista previa dice −$10 / queda $90', async () => {
    const w = mountModal()
    await type(w, VALUE, '10')
    expect(disabled(CONFIRM)).toBe(true)   // falta el motivo
    expect(text('[data-testid="discount-preview"]')).toContain('−$10.00')
    expect(text('[data-testid="discount-preview"]')).toContain('Queda $90.00')

    await click(w, reasonBtn(2))   // Huésped del hotel
    expect(disabled(CONFIRM)).toBe(false)
    await click(w, CONFIRM)
    expect(w.emitted('confirm')).toEqual([[{ type: 'percent', value: 10, reason: 'Huésped del hotel' }]])
    w.unmount()
  })

  it('"Otro" pide texto y ese texto es el motivo; por monto emite {amount, 25}', async () => {
    const w = mountModal()
    await click(w, '[data-testid="discount-type-amount"]')
    await type(w, VALUE, '25')
    await click(w, reasonBtn(3))   // Otro
    expect(disabled(CONFIRM)).toBe(true)   // texto vacío
    await type(w, '[data-testid="discount-other"]', '  Cumpleaños  ')
    expect(disabled(CONFIRM)).toBe(false)
    await click(w, CONFIRM)
    expect(w.emitted('confirm')).toEqual([[{ type: 'amount', value: 25, reason: 'Cumpleaños' }]])
    w.unmount()
  })

  it('tope 20 %: 25 % muestra "Supera tu tope (20 %)" y bloquea; un monto de 30 sobre 100 también; la cortesía está deshabilitada', async () => {
    const w = mountModal({ policy: policy(20) })
    expect(disabled('[data-testid="discount-courtesy"]')).toBe(true)
    await click(w, reasonBtn(2))
    await type(w, VALUE, '25')
    expect(text('[data-testid="discount-value-error"]')).toContain('Supera tu tope (20 %)')
    expect(disabled(CONFIRM)).toBe(true)

    await click(w, '[data-testid="discount-type-amount"]')
    await type(w, VALUE, '30')
    expect(text('[data-testid="discount-value-error"]')).toContain('Supera tu tope (20 %)')
    await type(w, VALUE, '20')
    expect(q('[data-testid="discount-value-error"]')).toBeNull()
    expect(disabled(CONFIRM)).toBe(false)
    expect(w.emitted('confirm')).toBeUndefined()
    w.unmount()
  })

  it('tope 100: "Cortesía 100 %" fija percent 100, la vista previa queda en $0.00 y el botón dice "Aplicar cortesía"', async () => {
    const w = mountModal()
    await click(w, '[data-testid="discount-courtesy"]')
    expect(q<HTMLInputElement>(VALUE)!.value).toBe('100')
    expect(text('[data-testid="discount-preview"]')).toContain('Queda $0.00')
    await click(w, reasonBtn(1))
    expect(text(CONFIRM).trim()).toBe('Aplicar cortesía')
    await click(w, CONFIRM)
    expect(w.emitted('confirm')).toEqual([[{ type: 'percent', value: 100, reason: 'Cortesía de la casa' }]])
    w.unmount()
  })

  it('con descuento vigente: precarga tipo/valor/motivo ("Otro" con texto si no es de la lista) y "Quitar descuento" emite remove', async () => {
    const w = mountModal({ current: { type: 'amount', value: 15, reason: 'Plato frío' } })
    await flushPromises()
    expect(q<HTMLInputElement>(VALUE)!.value).toBe('15')
    expect(q('[data-testid="discount-type-amount"]')!.getAttribute('aria-pressed')).toBe('true')
    expect(q<HTMLTextAreaElement>('[data-testid="discount-other"]')!.value).toBe('Plato frío')
    expect(disabled(CONFIRM)).toBe(false)
    await click(w, '[data-testid="discount-remove"]')
    expect(w.emitted('remove')).toHaveLength(1)
    w.unmount()
  })

  it('sin descuento vigente no hay "Quitar descuento"; sin política los motivos son solo "Otro" y el tope no bloquea', async () => {
    const w = mountModal({ policy: null })
    expect(q('[data-testid="discount-remove"]')).toBeNull()
    expect(Array.from(document.body.querySelectorAll('[data-testid="discount-reasons"] button')).map((b) => b.textContent?.trim())).toEqual(['Otro'])
    expect(disabled('[data-testid="discount-courtesy"]')).toBe(false)
    w.unmount()
  })
})
