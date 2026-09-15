// CancelReservationModal.test.ts — La confirmación de cancelar una reserva.
//
// Qué se protege acá (el reclamo real del dueño, no un checklist):
//   1. Cancelar NO puede pasar en el acto. Antes el popover del planning llamaba a
//      `update({status:'cancelled'})` apenas se clickeaba: sin preguntar, sin motivo, y encima
//      por el endpoint equivocado (salteaba la política, la penalidad, el reembolso y el
//      release del depósito).
//   2. La plata en juego se VE antes de confirmar: penalidad y reembolso salen del preview del
//      servidor, no de una cuenta hecha en el frontend.
//   3. El motivo es obligatorio y SIN default: hay que elegirlo (mismo criterio que
//      RescheduleModal — con un default premarcado todas las cancelaciones dirían lo mismo).
//   4. Una reserva que el servidor marca como no cancelable no ofrece el botón de confirmar:
//      se muestra el porqué.
//   5. Si el preview falla no se cancela a ciegas NI se deja la pantalla en blanco.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { mount, flushPromises, type VueWrapper } from '@vue/test-utils'

vi.mock('@/services/Reservation.service', () => ({
  ReservationService: {
    cancelPreview: vi.fn(),
    cancel: vi.fn(),
  },
}))

const toastSuccess = vi.fn()
vi.mock('@/composables/useToast', () => ({
  useToast: () => ({ success: toastSuccess, error: vi.fn(), info: vi.fn(), warning: vi.fn() }),
}))

import CancelReservationModal from './CancelReservationModal.vue'
import { ReservationService } from '@/services/Reservation.service'
import type { CancelPreview, Reservation } from '@/types'

const RESERVATION = {
  id: 'res-1', guestName: 'Ana Pérez', roomNumber: '205',
  checkIn: '2026-09-01', checkOut: '2026-09-04', amount: 300,
}

/** Preview por defecto: política del hotel, 20% de penalidad sobre un depósito de 150. */
function previewFixture(over: Partial<CancelPreview> = {}): CancelPreview {
  return {
    reservationId: 'res-1',
    status: 'confirmed',
    canCancel: true,
    blockedReason: '',
    guestName: 'Ana Pérez',
    checkIn: '2026-09-01',
    checkOut: '2026-09-04',
    hoursUntilCheckIn: 48,
    totalAmount: 300,
    deposit: 150,
    currency: 'USD',
    refundable: true,
    penaltyPercent: 20,
    cancellationFee: 30,
    refundAmount: 120,
    policySource: 'custom',
    policyLabel: 'Política flexible',
    tierLabel: 'Más de 24 h antes',
    ...over,
  }
}

/** La reserva que devuelve `POST /reservas/:id/cancel` (ya mapeada por el service). */
function cancelledFixture(): Reservation {
  return { id: 'res-1', status: 'cancelled' } as unknown as Reservation
}

/** El panel vive teletransportado en <body> (AppModal), no dentro del wrapper. */
const modalText = (): string => document.body.textContent ?? ''
const byTestId = (id: string): HTMLElement | null => document.body.querySelector<HTMLElement>(`[data-testid="${id}"]`)

function buttonByText(text: string): HTMLButtonElement {
  const btn = Array.from(document.body.querySelectorAll<HTMLButtonElement>('button')).find(b => b.textContent?.trim() === text)
  if (!btn) throw new Error(`No se encontró el botón "${text}"`)
  return btn
}
function findButton(text: string): HTMLButtonElement | undefined {
  return Array.from(document.body.querySelectorAll<HTMLButtonElement>('button')).find(b => b.textContent?.trim() === text)
}

let wrapper: VueWrapper | null = null

async function open(preview: CancelPreview) {
  vi.mocked(ReservationService.cancelPreview).mockResolvedValue(preview)
  wrapper = mount(CancelReservationModal, { props: { open: true, reservation: RESERVATION } })
  await flushPromises()
}

/** Elige un motivo del select (dispara el v-model igual que el usuario). */
async function pickReason(key: string) {
  const select = byTestId('cancel-reason-select') as HTMLSelectElement
  select.value = key
  select.dispatchEvent(new Event('change'))
  await flushPromises()
}

/** Body con el que se llamó al commit. */
function cancelBody(): { reason?: string; notifyGuest?: boolean } {
  return vi.mocked(ReservationService.cancel).mock.calls[0][1] as { reason?: string; notifyGuest?: boolean }
}

describe('CancelReservationModal — cancelar con política a la vista', () => {
  beforeEach(() => {
    document.body.innerHTML = ''
    vi.mocked(ReservationService.cancelPreview).mockReset()
    vi.mocked(ReservationService.cancel).mockReset()
  })
  afterEach(() => {
    wrapper?.unmount()
    wrapper = null
    document.body.innerHTML = ''
  })

  // El punto entero del cambio: abrir el modal NO cancela nada.
  it('al abrir solo cotiza: no toca la reserva', async () => {
    await open(previewFixture())

    expect(vi.mocked(ReservationService.cancelPreview)).toHaveBeenCalledWith('res-1')
    expect(vi.mocked(ReservationService.cancel)).not.toHaveBeenCalled()
  })

  it('muestra la penalidad y el reembolso que devolvió el preview', async () => {
    await open(previewFixture())

    expect(byTestId('cancel-money')).not.toBeNull()
    expect(byTestId('cancel-fee')?.textContent).toContain('USD 30.00')
    expect(byTestId('cancel-refund')?.textContent).toContain('USD 120.00')
    // El porcentaje y la política aplicada quedan a la vista para justificar el número.
    expect(modalText()).toContain('20%')
    expect(modalText()).toContain('Política flexible')
    expect(modalText()).toContain('Más de 24 h antes')
    // Depósito y total, que es sobre lo que se calculó.
    expect(byTestId('cancel-money')?.textContent).toContain('USD 150.00')
    expect(byTestId('cancel-money')?.textContent).toContain('USD 300.00')
    // La reserva que se está por cancelar está identificada.
    expect(modalText()).toContain('Ana Pérez')
    expect(modalText()).toContain('205')
  })

  it('avisa cuando el hotel no tiene política cargada y por eso se reembolsa todo', async () => {
    await open(previewFixture({ policySource: 'default', penaltyPercent: 0, cancellationFee: 0, refundAmount: 150, policyLabel: '', tierLabel: '' }))

    const warning = byTestId('cancel-no-policy')
    expect(warning).not.toBeNull()
    expect(warning?.textContent).toContain('no tiene política de cancelación configurada')
    expect(byTestId('cancel-refund')?.textContent).toContain('USD 150.00')
  })

  it('no muestra el aviso cuando la política sí está configurada', async () => {
    await open(previewFixture({ policySource: 'preset' }))
    expect(byTestId('cancel-no-policy')).toBeNull()
  })

  // Hay que ELEGIR el motivo: queda en el historial y es lo que después explica la plata perdida.
  it('abre sin motivo elegido y con el botón destructivo bloqueado', async () => {
    await open(previewFixture())

    expect((byTestId('cancel-reason-select') as HTMLSelectElement).value).toBe('')
    expect(byTestId('cancel-reason-required')).not.toBeNull()
    expect(buttonByText('Cancelar reserva').hasAttribute('disabled')).toBe(true)
  })

  // Dos candados distintos, y este test prueba LOS DOS por separado. Clickear un botón
  // `disabled` no dispara el handler, así que el click solo probaría el `:disabled` del
  // template; el guard de `confirm()` se ejerce llamándolo directo, que es lo que pasaría si
  // el botón se saltea (doble evento, atajo de teclado, un refactor que se olvide el disabled).
  it('no cancela nunca sin motivo, ni por el botón ni llamando a confirm()', async () => {
    await open(previewFixture())

    buttonByText('Cancelar reserva').click()
    await flushPromises()
    expect(vi.mocked(ReservationService.cancel)).not.toHaveBeenCalled()

    await (wrapper!.vm as unknown as { confirm: () => Promise<void> }).confirm()
    await flushPromises()
    expect(vi.mocked(ReservationService.cancel)).not.toHaveBeenCalled()
  })

  // "Otro" sin texto sigue siendo no-motivo: elegir la opción no alcanza.
  it('el motivo "Otro" exige el texto libre', async () => {
    await open(previewFixture())

    await pickReason('other')
    expect(byTestId('cancel-reason-other')).not.toBeNull()
    expect(buttonByText('Cancelar reserva').hasAttribute('disabled')).toBe(true)

    const input = byTestId('cancel-reason-other') as HTMLInputElement
    input.value = 'La habitación se inundó'
    input.dispatchEvent(new Event('input'))
    await flushPromises()

    expect(buttonByText('Cancelar reserva').hasAttribute('disabled')).toBe(false)

    vi.mocked(ReservationService.cancel).mockResolvedValue(cancelledFixture())
    buttonByText('Cancelar reserva').click()
    await flushPromises()

    expect(cancelBody().reason).toBe('La habitación se inundó')
  })

  it('al elegir un motivo se habilita el botón y el commit manda ESE motivo', async () => {
    await open(previewFixture())

    await pickReason('no_show')

    expect(byTestId('cancel-reason-required')).toBeNull()
    expect(buttonByText('Cancelar reserva').hasAttribute('disabled')).toBe(false)

    vi.mocked(ReservationService.cancel).mockResolvedValue(cancelledFixture())
    buttonByText('Cancelar reserva').click()
    await flushPromises()

    // Va por el endpoint de cancelación (el único que aplica la política), con el motivo elegido.
    expect(vi.mocked(ReservationService.cancel).mock.calls[0][0]).toBe('res-1')
    expect(cancelBody().reason).toBe('El huésped no se presentó')
    expect(wrapper!.emitted('cancelled')?.[0]?.[0]).toMatchObject({ id: 'res-1' })
    expect(wrapper!.emitted('close')).toBeTruthy()
  })

  it('una reserva no cancelable muestra el porqué y NO ofrece confirmar', async () => {
    await open(previewFixture({
      canCancel: false,
      status: 'checked_in',
      blockedReason: 'La reserva ya tiene check-in: hacé el check-out en vez de cancelar.',
    }))

    const blocked = byTestId('cancel-blocked')
    expect(blocked).not.toBeNull()
    expect(blocked?.textContent).toContain('ya tiene check-in')
    // Ni botón destructivo, ni select de motivo: no hay nada que confirmar.
    expect(findButton('Cancelar reserva')).toBeUndefined()
    expect(byTestId('cancel-reason-select')).toBeNull()
    expect(findButton('Cerrar')).toBeDefined()

    // Y el guard aguanta aunque alguien llame a confirm() por fuera del template.
    await (wrapper!.vm as unknown as { confirm: () => Promise<void> }).confirm()
    await flushPromises()
    expect(vi.mocked(ReservationService.cancel)).not.toHaveBeenCalled()
  })

  it('si el preview falla no deja la pantalla vacía ni ofrece cancelar a ciegas', async () => {
    vi.mocked(ReservationService.cancelPreview).mockRejectedValue(new Error('Servidor caído'))
    wrapper = mount(CancelReservationModal, { props: { open: true, reservation: RESERVATION } })
    await flushPromises()

    const errorBlock = byTestId('cancel-error')
    expect(errorBlock).not.toBeNull()
    expect(errorBlock?.textContent).toContain('Servidor caído')
    // Sin cálculo no se cancela: no hay botón destructivo, solo salir.
    expect(findButton('Cancelar reserva')).toBeUndefined()
    expect(findButton('Cerrar')).toBeDefined()
    expect(byTestId('cancel-preview')).toBeNull()

    await (wrapper!.vm as unknown as { confirm: () => Promise<void> }).confirm()
    await flushPromises()
    expect(vi.mocked(ReservationService.cancel)).not.toHaveBeenCalled()
  })

  // El preview es una COTIZACIÓN: entre abrirlo y confirmar puede cruzarse un borde de tier
  // (p. ej. las 72h de `moderate`) y el servidor aplicar otro número. El aviso tiene que decir
  // lo que se aplicó, no lo que se había cotizado — si no, alguien devuelve de más en el mostrador.
  it('anuncia el monto que el servidor APLICÓ, no el que se cotizó al abrir', async () => {
    await open(previewFixture({ refundAmount: 120 }))   // cotizado: 120
    await pickReason('guest_request')

    // El servidor terminó devolviendo 60 (se cruzó el borde mientras el modal estaba abierto).
    vi.mocked(ReservationService.cancel).mockResolvedValue(
      { id: 'res-1', status: 'cancelled', refundAmount: 60, cancellationFee: 90 } as unknown as Reservation,
    )
    buttonByText('Cancelar reserva').click()
    await flushPromises()

    const message = String(toastSuccess.mock.calls.at(-1)?.[0] ?? '')
    expect(message).toContain('60')
    expect(message).not.toContain('120')
  })

  it('sin monto aplicado en la respuesta cae al del preview (no rompe ni miente por omisión)', async () => {
    await open(previewFixture({ refundAmount: 120 }))
    await pickReason('guest_request')

    vi.mocked(ReservationService.cancel).mockResolvedValue(cancelledFixture())   // sin refundAmount
    buttonByText('Cancelar reserva').click()
    await flushPromises()

    expect(String(toastSuccess.mock.calls.at(-1)?.[0] ?? '')).toContain('120')
  })

  // ── Aviso al huésped por correo ─────────────────────────────────────────────────────────────
  describe('aviso al huésped', () => {
    async function cancelWith(preview: CancelPreview, reasonKey: string) {
      vi.mocked(ReservationService.cancel).mockResolvedValue(cancelledFixture())
      await open(preview)
      await pickReason(reasonKey)
      buttonByText('Cancelar reserva').click()
      await flushPromises()
    }

    it('con correo: casilla visible y marcada, manda notifyGuest:true', async () => {
      await cancelWith(previewFixture({ guestEmail: 'ana@example.com' }), 'guest_request')
      expect(byTestId('cancel-notify-guest')?.textContent).toContain('ana@example.com')
      expect(cancelBody().notifyGuest).toBe(true)
    })

    it('"Error de carga" la desmarca: no se le avisa al huésped', async () => {
      await cancelWith(previewFixture({ guestEmail: 'ana@example.com' }), 'data_entry_error')
      expect(cancelBody().notifyGuest).toBe(false)
    })

    it('el operador puede desmarcarla', async () => {
      vi.mocked(ReservationService.cancel).mockResolvedValue(cancelledFixture())
      await open(previewFixture({ guestEmail: 'ana@example.com' }))
      await pickReason('overbooking')
      const box = byTestId('cancel-notify-guest')!.querySelector('input') as HTMLInputElement
      box.checked = false
      box.dispatchEvent(new Event('change'))
      await flushPromises()
      buttonByText('Cancelar reserva').click()
      await flushPromises()
      expect(cancelBody().notifyGuest).toBe(false)
    })

    it('sin correo: no hay casilla, lo dice y manda notifyGuest:false', async () => {
      await cancelWith(previewFixture({ guestEmail: '' }), 'guest_request')
      expect(byTestId('cancel-notify-guest')).toBeNull()
      expect(byTestId('cancel-no-guest-email')).not.toBeNull()
      expect(cancelBody().notifyGuest).toBe(false)
    })
  })
})
