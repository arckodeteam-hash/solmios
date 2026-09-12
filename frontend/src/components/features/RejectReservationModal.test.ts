// RejectReservationModal.test.ts — El motivo para rechazar una reserva pendiente de aprobación (#271 MR-06).
//
// Qué se protege acá:
//   1. Rechazar mueve plata (reembolso 100% por Stripe) y le llega un email al huésped con el motivo:
//      no se puede confirmar sin un motivo de al menos 10 caracteres (mismo mínimo que el backend).
//   2. El monto que se va a devolver se VE antes de confirmar; si no hay cobro por Stripe, se avisa
//      que la devolución (si la hay) es a mano.
//   3. Volver no rechaza nada: el que llama actúa solo en `confirm`.
import { describe, it, expect, afterEach } from 'vitest'
import { mount, flushPromises, type VueWrapper } from '@vue/test-utils'

import RejectReservationModal from './RejectReservationModal.vue'

/** El panel vive teletransportado en <body> (AppModal), no dentro del wrapper. */
const byTestId = (id: string): HTMLElement | null => document.body.querySelector<HTMLElement>(`[data-testid="${id}"]`)
const plain = (s: string | null | undefined): string => String(s ?? '').replace(/[  ]/g, ' ')

function buttonByText(text: string): HTMLButtonElement {
  const btn = Array.from(document.body.querySelectorAll<HTMLButtonElement>('button')).find(b => b.textContent?.trim() === text)
  if (!btn) throw new Error(`No se encontró el botón "${text}"`)
  return btn
}

let wrapper: VueWrapper | null = null

async function open(props: Partial<{ guestName: string; refundAmount: number; currency: string; loading: boolean; isGroup: boolean }> = {}) {
  wrapper = mount(RejectReservationModal, { props: { guestName: 'Ana Pérez', refundAmount: 150, ...props } })
  await flushPromises()
}

async function typeReason(text: string) {
  const ta = byTestId('reject-reason') as HTMLTextAreaElement
  ta.value = text
  ta.dispatchEvent(new Event('input'))
  await flushPromises()
}

const confirmBtn = () => byTestId('reject-confirm') as HTMLButtonElement

describe('RejectReservationModal — rechazar con motivo y reembolso a la vista', () => {
  afterEach(() => {
    wrapper?.unmount()
    wrapper = null
    document.body.innerHTML = ''
  })

  it('abre con el botón bloqueado y sigue bloqueado con menos de 10 caracteres', async () => {
    await open()
    expect(confirmBtn().hasAttribute('disabled')).toBe(true)
    expect(confirmBtn().textContent?.trim()).toBe('Rechazar y reembolsar')

    await typeReason('corto')
    expect(confirmBtn().hasAttribute('disabled')).toBe(true)
    expect(byTestId('reject-reason-count')?.textContent).toContain('5/10 mín.')
    expect(wrapper!.emitted('confirm')).toBeUndefined()
  })

  it('con 10 caracteres habilita y emite confirm con el motivo sin espacios de sobra', async () => {
    await open()
    await typeReason('  Sin lugar. ')
    expect(confirmBtn().hasAttribute('disabled')).toBe(false)
    expect(byTestId('reject-reason-count')?.textContent).toContain('10/10 mín.')

    confirmBtn().click()
    await flushPromises()
    expect(wrapper!.emitted('confirm')).toEqual([['Sin lugar.']])
  })

  // Los espacios no cuentan para el mínimo: el backend recibe el texto trimmeado.
  it('no cuenta los espacios para llegar al mínimo ni emite confirm llamándolo directo', async () => {
    await open()
    await typeReason('abc       ')
    expect(confirmBtn().hasAttribute('disabled')).toBe(true)

    ;(wrapper!.vm as unknown as { confirm: () => void }).confirm()
    await flushPromises()
    expect(wrapper!.emitted('confirm')).toBeUndefined()
  })

  it('muestra el monto que se va a reembolsar al huésped', async () => {
    await open({ refundAmount: 150, currency: 'USD' })
    const notice = plain(byTestId('reject-refund-notice')?.textContent)
    expect(notice).toContain('Se reembolsarán')
    expect(notice).toContain('150,00')
    expect(notice).toContain('US$')
    expect(notice).toContain('al huésped')
    expect(byTestId('reject-group-notice')).toBeNull()
  })

  it('sin cobro por Stripe avisa que la devolución es a mano', async () => {
    await open({ refundAmount: 0 })
    const notice = byTestId('reject-refund-notice')?.textContent ?? ''
    expect(notice).toContain('No hay cobros por Stripe para reembolsar')
    expect(notice).toContain('devolvelo a mano')
    expect(notice).not.toContain('Se reembolsarán')
  })

  it('en una reserva de varias habitaciones avisa que cae el grupo entero', async () => {
    await open({ isGroup: true })
    expect(byTestId('reject-group-notice')?.textContent).toContain('Se rechaza y reembolsa el grupo entero')
  })

  it('Volver emite close y no confirma', async () => {
    await open()
    await typeReason('Overbooking en esa fecha')
    buttonByText('Volver').click()
    await flushPromises()
    expect(wrapper!.emitted('close')).toHaveLength(1)
    expect(wrapper!.emitted('confirm')).toBeUndefined()
  })

  it('mientras carga bloquea el botón y cambia la etiqueta', async () => {
    await open({ loading: true })
    await typeReason('Overbooking en esa fecha')
    expect(confirmBtn().hasAttribute('disabled')).toBe(true)
    expect(confirmBtn().textContent?.trim()).toBe('Rechazando…')
  })
})
