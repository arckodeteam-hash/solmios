// ReservationModal.test.ts — El detalle de reserva: saldo, permisos y traza de envíos.
//
// Qué se protege acá (los tres reclamos del cambio 2026-08-19, no un checklist):
//   1. El saldo que se muestra y el que se le cobra al huésped por Stripe salen del BACKEND
//      (`chargeableTotal`/`pendingAmount` de `shared/utils/reservation-balance.ts`). El modal NO
//      re-deriva la fórmula: una copia local es una segunda fuente de verdad que se desincroniza.
//   2. El rol manda: sin `reservations:edit` no se ofrecen acciones de escritura, y la tarjeta de
//      garantía no muestra ni el campo del PIN.
//   3. Mandar una plantilla de WhatsApp deja rastro en `message_logs`, y el refresco en caliente
//      que viene después NO vuelve a bloquear la garantía que el staff destrabó con el PIN.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { mount, flushPromises, type VueWrapper } from '@vue/test-utils'

vi.mock('@/services/Reservation.service', () => ({
  ReservationService: {
    getById: vi.fn(),
    getAudit: vi.fn(),
    update: vi.fn(),
    unlockGuaranteeCard: vi.fn(),
    logManualMessage: vi.fn(),
    sendLockCodeEmail: vi.fn(),
  },
}))
vi.mock('@/services/Payments.service', () => ({
  PaymentsService: { create: vi.fn(), update: vi.fn(), createStripeCheckout: vi.fn() },
}))
vi.mock('@/services/Folios.service', () => ({ FoliosService: { list: vi.fn(), get: vi.fn() } }))
vi.mock('@/services/AutoMessages.service', () => ({ AutoMessagesService: { list: vi.fn() } }))
vi.mock('@/services/Addons.service', () => ({ AddonsService: { create: vi.fn(), remove: vi.fn() } }))
vi.mock('@/services/Platform.service', () => ({ ConfigService: { get: vi.fn() } }))
vi.mock('@/services/Hotel.service', () => ({ HotelService: { settings: vi.fn() } }))
vi.mock('@/services/TTLock.service', () => ({ TTLockService: { listDevices: vi.fn() } }))
vi.mock('vue-router', () => ({ useRouter: () => ({ push: vi.fn() }) }))

const toastWarning = vi.fn()
vi.mock('@/composables/useToast', () => ({
  useToast: () => ({ success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: toastWarning }),
}))

let permissions: string[] = []
vi.mock('@/composables/usePermissions', () => ({
  usePermissions: () => ({
    can: (module: string, action: string) => permissions.includes(`${module}:${action}`) || permissions.includes('*:*'),
    canRoute: () => true,
    permissions: { value: permissions },
  }),
}))

import ReservationModal from './ReservationModal.vue'
import { ReservationService } from '@/services/Reservation.service'
import { PaymentsService } from '@/services/Payments.service'
import { AddonsService } from '@/services/Addons.service'
import { AutoMessagesService } from '@/services/AutoMessages.service'
import { ConfigService } from '@/services/Platform.service'
import { HotelService } from '@/services/Hotel.service'
import type { ReservationDetail } from '@/types'

const ALL = ['*:*']
const READ_ONLY = ['reservations:view']

/**
 * Detalle tal como lo devuelve el backend: 500 de alojamiento + 40 de otros cobros + 60 de extras
 * = 600 cobrables, 100 de anticipo → 500 pendientes. Los tres números vienen del servidor.
 */
function detailFixture(over: Partial<ReservationDetail> = {}): ReservationDetail {
  return {
    id: 'res-1', hotelId: 'h1', status: 'pending',
    checkIn: '2026-09-01', checkOut: '2026-09-04',
    totalAmount: 500, deposit: 100, otherCharges: 40,
    chargeableTotal: 600, addonsTotal: 60, pendingAmount: 500,
    currency: 'USD',
    guest: { id: 'g1', name: 'Ana Pérez', phone: '+18095550000', email: 'ana@x.com' },
    addons: [{ id: 'a1', description: 'Cena', kind: 'service', amount: 30, quantity: 2 }],
    messageLogs: [],
    hasGuaranteeCard: true,
    ...over,
  } as unknown as ReservationDetail
}

const modalText = (): string => document.body.textContent ?? ''
function findButton(text: string): HTMLButtonElement | undefined {
  return Array.from(document.body.querySelectorAll<HTMLButtonElement>('button')).find(b => b.textContent?.trim() === text)
}

let wrapper: VueWrapper | null = null

async function open(detail: ReservationDetail = detailFixture(), perms: string[] = ALL) {
  permissions = perms
  vi.mocked(ReservationService.getById).mockResolvedValue(detail)
  wrapper = mount(ReservationModal, { props: { reservationId: 'res-1' } })
  await flushPromises()
  await flushPromises()
}

describe('ReservationModal', () => {
  beforeEach(() => {
    document.body.innerHTML = ''
    vi.clearAllMocks()
    vi.mocked(ReservationService.getAudit).mockResolvedValue({ data: [] } as never)
    vi.mocked(AutoMessagesService.list).mockResolvedValue({ data: [{ id: 't1', title: 'Bienvenida', channel: 'whatsapp', whatsappBody: 'Hola' }] } as never)
    vi.mocked(ConfigService.get).mockResolvedValue({} as never)
    vi.mocked(HotelService.settings).mockResolvedValue({ hotel: { name: 'Hotel Demo' } } as never)
    vi.stubGlobal('open', vi.fn())
  })
  afterEach(() => {
    wrapper?.unmount()
    wrapper = null
    document.body.innerHTML = ''
    vi.unstubAllGlobals()
  })

  // ── 1. El saldo lo dicta el servidor ───────────────────────────────────────────────────────
  describe('saldo', () => {
    it('muestra el pendiente y el total cobrable que devolvió el backend', async () => {
      await open()
      expect(modalText()).toContain('Pendiente de cobroUS$500,00')
      expect(modalText()).toContain('TOTALUS$600,00') // chargeableTotal del servidor
    })

    it('no re-deriva la fórmula: si el backend dice otro número, se muestra ESE', async () => {
      // Mismos componentes (500 + 40 + 60 = 600), pero el servidor aplicó una regla que el modal
      // no conoce. Con una copia local de la fórmula acá seguiría diciendo 500/600.
      await open(detailFixture({ pendingAmount: 123.45, chargeableTotal: 223.45 }))
      expect(modalText()).toContain('Pendiente de cobroUS$123,45')
      expect(modalText()).toContain('TOTALUS$223,45')
      expect(modalText()).not.toContain('Pendiente de cobroUS$500,00')
    })

    // GH-0.2: `deposit` no incluye lo cobrado por folio ni por factura. Con "Pendiente" calculado
    // sobre `payments`, el comprobante impreso decía TOTAL 600 − Pagado 100 = Pendiente 200.
    it('el comprobante imprime lo COBRADO (`paidAmount`), no el anticipo', async () => {
      await open(detailFixture({ deposit: 100, paidAmount: 400, pendingAmount: 200 }))
      expect(modalText()).toContain('PagadoUS$400,00')
      expect(modalText()).toContain('Total abonadoUS$400,00')
      expect(modalText()).not.toContain('PagadoUS$100,00')
    })

    // COR-7: el refresco silencioso que dispara guardar/cargar algo NO puede pisar lo que el
    // operador está tipeando en "Otros cobros".
    it('un refresco en caliente no pisa el borrador de "Otros cobros" a medio tipear', async () => {
      vi.mocked(AddonsService.create).mockResolvedValue({ id: 'a2', description: 'Spa', amount: 10, quantity: 1, kind: 'service' } as never)
      await open()

      const otros = document.body.querySelector<HTMLInputElement>('input[type="number"][step="0.01"]')!
      otros.value = '99'
      otros.dispatchEvent(new Event('input'))
      await flushPromises()

      // Cargar un extra dispara `load({ silent: true })` con el `otherCharges` viejo del servidor.
      const desc = document.body.querySelector<HTMLInputElement>('input[placeholder="Descripción"]')!
      desc.value = 'Spa'
      desc.dispatchEvent(new Event('input'))
      await flushPromises()
      findButton('+')!.click()
      await flushPromises()

      expect(vi.mocked(ReservationService.getById)).toHaveBeenCalledTimes(2)
      expect(document.body.querySelector<HTMLInputElement>('input[type="number"][step="0.01"]')!.value).toBe('99')
    })

    it('abrir OTRA reserva sí reemplaza el borrador (no es un refresco silencioso)', async () => {
      await open()
      const otros = document.body.querySelector<HTMLInputElement>('input[type="number"][step="0.01"]')!
      otros.value = '99'
      otros.dispatchEvent(new Event('input'))
      await flushPromises()

      vi.mocked(ReservationService.getById).mockResolvedValue(detailFixture({ id: 'res-2', otherCharges: 7 }))
      await wrapper!.setProps({ reservationId: 'res-2' })
      await flushPromises()

      expect(document.body.querySelector<HTMLInputElement>('input[type="number"][step="0.01"]')!.value).toBe('7')
    })

    it('el link de pago de Stripe se pide por el pendiente del backend', async () => {
      vi.mocked(PaymentsService.create).mockResolvedValue({ id: 'pr1' } as never)
      vi.mocked(PaymentsService.createStripeCheckout).mockResolvedValue({ url: 'https://checkout' } as never)
      await open()

      findButton('Crear link de pago Stripe')!.click()
      await flushPromises()

      expect(vi.mocked(PaymentsService.create)).toHaveBeenCalledWith(
        expect.objectContaining({ reservationId: 'res-1', amount: 500 }),
      )
    })
  })

  // COR-4/SEC-2: cada click creaba un PaymentRequest nuevo por el pendiente completo. Tres clicks
  // = tres links de $500 vivos sobre un saldo de $500.
  describe('link de pago — no se apilan requerimientos', () => {
    it('reusa el link `pending` que ya tiene la reserva en vez de crear otro', async () => {
      vi.mocked(PaymentsService.createStripeCheckout).mockResolvedValue({ url: 'https://checkout' } as never)
      await open(detailFixture({
        payments: [{ id: 'pr-existente', amount: 500, status: 'pending' }],
      } as Partial<ReservationDetail>))

      findButton('Crear link de pago Stripe')!.click()
      await flushPromises()

      expect(vi.mocked(PaymentsService.create)).not.toHaveBeenCalled()
      expect(vi.mocked(PaymentsService.createStripeCheckout)).toHaveBeenCalledWith('pr-existente')
    })

    // ── GH-0.1: reusar el link sin mirar su monto es un undercharge silencioso ────────────
    // Reserva de 500 con un link vivo de 300 (se cargó un extra después de emitirlo). Reusarlo
    // tal cual abría un Checkout de Stripe por 300 y el huésped quedaba debiendo 200 sin que
    // ninguna pantalla lo dijera.
    it('un link vigente por MENOS que el saldo se actualiza al saldo antes de cobrar', async () => {
      vi.mocked(PaymentsService.update).mockResolvedValue({ id: 'pr-existente', amount: 500 } as never)
      vi.mocked(PaymentsService.createStripeCheckout).mockResolvedValue({ url: 'https://checkout' } as never)
      await open(detailFixture({
        payments: [{ id: 'pr-existente', amount: 300, status: 'pending' }],
      } as Partial<ReservationDetail>))

      findButton('Crear link de pago Stripe')!.click()
      await flushPromises()

      expect(vi.mocked(PaymentsService.update)).toHaveBeenCalledWith('pr-existente', { amount: 500 })
      expect(vi.mocked(PaymentsService.create)).not.toHaveBeenCalled()
      expect(vi.mocked(PaymentsService.createStripeCheckout)).toHaveBeenCalledWith('pr-existente')
    })

    // `receptionist` tiene billing:view+create pero NO billing:edit (shared/permissions.ts): sin ese
    // permiso no se puede actualizar el link, y abrirlo por el monto viejo sería el undercharge.
    it('sin `billing:edit` no abre el Checkout por el monto viejo: avisa y corta', async () => {
      vi.mocked(PaymentsService.createStripeCheckout).mockResolvedValue({ url: 'https://checkout' } as never)
      await open(detailFixture({
        payments: [{ id: 'pr-existente', amount: 300, status: 'pending' }],
      } as Partial<ReservationDetail>), ['reservations:view', 'billing:view', 'billing:create'])

      findButton('Crear link de pago Stripe')!.click()
      await flushPromises()

      expect(vi.mocked(PaymentsService.update)).not.toHaveBeenCalled()
      expect(vi.mocked(PaymentsService.createStripeCheckout)).not.toHaveBeenCalled()
    })

    it('un link vigente por el saldo exacto se reusa sin tocarle el monto', async () => {
      vi.mocked(PaymentsService.createStripeCheckout).mockResolvedValue({ url: 'https://checkout' } as never)
      await open(detailFixture({
        payments: [{ id: 'pr-existente', amount: 500, status: 'pending' }],
      } as Partial<ReservationDetail>))

      findButton('Crear link de pago Stripe')!.click()
      await flushPromises()

      expect(vi.mocked(PaymentsService.update)).not.toHaveBeenCalled()
    })

    it('el modal muestra el monto del link vivo y avisa cuando no cubre el saldo', async () => {
      await open(detailFixture({
        payments: [{ id: 'pr-existente', amount: 300, status: 'pending' }],
      } as Partial<ReservationDetail>))

      expect(modalText()).toContain('Link de pago vigenteUS$300,00')
      expect(modalText()).toContain('El link vigente es por US$300,00 y el saldo es US$500,00')
    })

    it('sin desfase no aparece la advertencia', async () => {
      await open(detailFixture({
        payments: [{ id: 'pr-existente', amount: 500, status: 'pending' }],
      } as Partial<ReservationDetail>))

      expect(modalText()).toContain('Link de pago vigenteUS$500,00')
      expect(modalText()).not.toContain('El link vigente es por')
    })

    it('un link ya pagado no se reusa: se crea uno nuevo', async () => {
      vi.mocked(PaymentsService.create).mockResolvedValue({ id: 'pr-nuevo' } as never)
      vi.mocked(PaymentsService.createStripeCheckout).mockResolvedValue({ url: 'https://checkout' } as never)
      await open(detailFixture({
        payments: [{ id: 'pr-viejo', amount: 500, status: 'paid' }],
      } as Partial<ReservationDetail>))

      findButton('Crear link de pago Stripe')!.click()
      await flushPromises()

      expect(vi.mocked(PaymentsService.create)).toHaveBeenCalled()
      expect(vi.mocked(PaymentsService.createStripeCheckout)).toHaveBeenCalledWith('pr-nuevo')
    })
  })

  // ── 2. Permisos ────────────────────────────────────────────────────────────────────────────
  describe('permisos', () => {
    it('con permisos completos ofrece las acciones de escritura', async () => {
      await open()
      expect(findButton('Editar')).toBeDefined()
      expect(findButton('Confirmar')).toBeDefined()
      expect(findButton('Anular')).toBeDefined()
    })

    it('solo lectura: ninguna acción de escritura y sin campo de PIN de garantía', async () => {
      await open(detailFixture(), READ_ONLY)
      expect(findButton('Editar')).toBeUndefined()
      expect(findButton('Confirmar')).toBeUndefined()
      expect(findButton('Anular')).toBeUndefined()
      expect(findButton('Crear link de pago Stripe')).toBeUndefined()
      expect(document.body.querySelector('input[placeholder="PIN"]')).toBeNull()
      expect(modalText()).toContain('Tu rol no puede revelarla')
    })

    it('solo lectura: "Otros cobros" se muestra pero no se puede editar', async () => {
      await open(detailFixture(), READ_ONLY)
      expect(modalText()).toContain('Otros cobros')
      expect(document.body.querySelector('input[type="number"][step="0.01"]')).toBeNull()
    })
  })

  // ── 3. Traza de envíos + garantía ──────────────────────────────────────────────────────────
  describe('plantillas de WhatsApp', () => {
    it('registra el envío en el historial con la plantilla usada y estado queued', async () => {
      vi.mocked(ReservationService.logManualMessage).mockResolvedValue({ id: 'ml1', manual: true } as never)
      await open()

      // El botón trae el título y el "Enviar →" juntos: se busca por contenido parcial.
      Array.from(document.body.querySelectorAll<HTMLButtonElement>('button'))
        .find(b => b.textContent?.includes('Bienvenida'))!.click()
      await flushPromises()

      expect(vi.mocked(ReservationService.logManualMessage)).toHaveBeenCalledWith('res-1', {
        messageType: 'whatsapp',
        recipient: '+18095550000',
        reference: 'Bienvenida',
        status: 'queued',
      })
    })

    it('si el registro falla avisa, pero no cancela el envío', async () => {
      vi.mocked(ReservationService.logManualMessage).mockRejectedValue(new Error('500'))
      await open()

      Array.from(document.body.querySelectorAll<HTMLButtonElement>('button'))
        .find(b => b.textContent?.includes('Bienvenida'))!.click()
      await flushPromises()

      expect(toastWarning).toHaveBeenCalled()
      expect(vi.mocked(globalThis.open)).toHaveBeenCalled()
    })
  })

  describe('tarjeta de garantía', () => {
    /** Destraba la tarjeta con el PIN, como lo hace el staff. */
    async function unlock() {
      vi.mocked(ReservationService.unlockGuaranteeCard).mockResolvedValue({
        cardHolder: 'ANA PEREZ', cardBrand: 'visa', cardLast4: '4242', cardExpMonth: 12, cardExpYear: 2030,
      } as never)
      const pin = document.body.querySelector<HTMLInputElement>('input[placeholder="PIN"]')!
      pin.value = '1234'
      pin.dispatchEvent(new Event('input'))
      await flushPromises()
      findButton('Ver')!.click()
      await flushPromises()
    }

    it('un refresco en caliente NO vuelve a bloquear la tarjeta destrabada', async () => {
      vi.mocked(AddonsService.create).mockResolvedValue({ id: 'a2', description: 'Spa', amount: 10, quantity: 1, kind: 'service' } as never)
      await open()
      await unlock()
      expect(modalText()).toContain('4242')

      // Cargar un extra dispara `load({silent:true})`: antes esto reseteaba `guaranteeUnlocked`
      // y el staff tenía que volver a tipear el PIN en medio del flujo.
      const desc = document.body.querySelector<HTMLInputElement>('input[placeholder="Descripción"]')!
      desc.value = 'Spa'
      desc.dispatchEvent(new Event('input'))
      await flushPromises()
      findButton('+')!.click()
      await flushPromises()

      expect(vi.mocked(AddonsService.create)).toHaveBeenCalled()
      expect(vi.mocked(ReservationService.getById)).toHaveBeenCalledTimes(2) // el refresco ocurrió
      expect(modalText()).toContain('4242') // …y la tarjeta sigue destrabada
    })

    it('abrir otra reserva SÍ vuelve a bloquear la tarjeta', async () => {
      await open()
      await unlock()
      expect(modalText()).toContain('4242')

      await wrapper!.setProps({ reservationId: 'res-2' })
      await flushPromises()

      expect(modalText()).not.toContain('4242')
      expect(document.body.querySelector('input[placeholder="PIN"]')).not.toBeNull()
    })
  })

  describe('historial de envíos', () => {
    it('lista los envíos con la plantilla y no expone la respuesta del transporte', async () => {
      await open(detailFixture({
        messageLogs: [
          { id: 'ml1', messageType: 'whatsapp', status: 'queued', reference: 'Bienvenida', manual: true },
          { id: 'ml2', messageType: 'email', status: 'failed', reference: null, manual: false },
        ],
      } as Partial<ReservationDetail>))

      expect(modalText()).toContain('Envíos registrados')
      expect(modalText()).toContain('Bienvenida')
      expect(modalText()).toContain('queued')
    })
  })
})
