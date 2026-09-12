// REQ-RWP-02 — Bloque "Pasarela de pago" del modal de reserva. Se MONTA el componente de verdad
// (no se lee el fuente con `?raw`, como hace payment-history.test.ts): un test que sólo busca
// strings en el .vue pasa en verde aunque la lógica esté invertida. Acá cada caso arma un
// `ReservationDetail` con `paymentAttempts` y mira lo que el DOM muestra.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { mount, flushPromises, type VueWrapper } from '@vue/test-utils'

vi.mock('@/services/Reservation.service', () => ({
  ReservationService: {
    getById: vi.fn(), getAudit: vi.fn(), update: vi.fn(), unlockGuaranteeCard: vi.fn(),
    logManualMessage: vi.fn(), sendLockCodeEmail: vi.fn(), list: vi.fn(),
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
vi.mock('@/services/Room.service', () => ({ RoomService: { list: vi.fn() } }))
vi.mock('@/services/TTLock.service', () => ({ TTLockService: { listDevices: vi.fn() } }))
vi.mock('vue-router', () => ({ useRouter: () => ({ push: vi.fn() }) }))

const toastSuccess = vi.fn()
const toastError = vi.fn()
vi.mock('@/composables/useToast', () => ({
  useToast: () => ({ success: toastSuccess, error: toastError, info: vi.fn(), warning: vi.fn() }),
}))
vi.mock('@/composables/usePermissions', () => ({
  usePermissions: () => ({ can: () => true, canRoute: () => true, permissions: { value: ['*:*'] } }),
}))

import ReservationModal from './ReservationModal.vue'
import { ReservationService } from '@/services/Reservation.service'
import { AutoMessagesService } from '@/services/AutoMessages.service'
import { ConfigService } from '@/services/Platform.service'
import { HotelService } from '@/services/Hotel.service'
import { RoomService } from '@/services/Room.service'
import type { ReservationDetail, PaymentAttemptView } from '@/types'

function detailFixture(over: Partial<ReservationDetail> = {}): ReservationDetail {
  return {
    id: 'res-1', hotelId: 'h1', status: 'confirmed',
    checkIn: '2026-09-01', checkOut: '2026-09-04',
    totalAmount: 500, deposit: 0, otherCharges: 0,
    chargeableTotal: 500, addonsTotal: 0, paidAmount: 0, pendingAmount: 500, paymentState: 'pending',
    currency: 'USD',
    guest: { id: 'g1', name: 'Ana Pérez', phone: '+18095550000', email: 'ana@x.com' },
    addons: [], messageLogs: [], paymentHistory: [],
    ...over,
  } as unknown as ReservationDetail
}

/** Intento de la pasarela con la forma exacta de `PaymentAttemptView` (backend). */
function attempt(over: Partial<PaymentAttemptView> = {}): PaymentAttemptView {
  return {
    id: 'a1', kind: 'paid', source: 'booking_engine', provider: 'stripe', mode: 'test',
    providerRef: 'pi_test_1', amount: 500, currency: 'USD', failureCode: '', failureMessage: '',
    cardBrand: 'visa', cardLast4: '4242', receiptUrl: '',
    dashboardUrl: `https://dashboard.stripe.com/test/payments/${over.providerRef ?? 'pi_test_1'}`,
    occurredAt: '2026-09-01T10:00:00Z', ...over,
  }
}

// Rechazo real de Stripe test (tarjeta 4000 0000 0000 0002) tal como lo asienta stripe-gateway.
const DECLINED = attempt({
  id: 'a-declined', kind: 'failed', failureCode: 'card_declined', failureMessage: 'Your card was declined.',
  cardLast4: '0002', providerRef: 'pi_test_declined_1', occurredAt: '2026-09-02T10:00:00Z',
})

let wrapper: VueWrapper | null = null
const q = <T extends Element = HTMLElement>(sel: string) => document.body.querySelector<T>(sel)
const rows = () => Array.from(document.body.querySelectorAll('[data-testid="payment-attempt-row"]'))
const warningText = () => q('[data-testid="failed-payment-warning"]')?.textContent?.replace(/\s+/g, ' ').trim() ?? null

async function open(detail: ReservationDetail) {
  vi.mocked(ReservationService.getById).mockResolvedValue(detail)
  wrapper = mount(ReservationModal, { props: { reservationId: 'res-1' } })
  await flushPromises()
  await flushPromises()
}

describe('ReservationModal — bloque "Pasarela de pago" (REQ-RWP-02)', () => {
  beforeEach(() => {
    document.body.innerHTML = ''
    vi.clearAllMocks()
    vi.mocked(ReservationService.getAudit).mockResolvedValue({ data: [] } as never)
    vi.mocked(AutoMessagesService.list).mockResolvedValue({ data: [] } as never)
    vi.mocked(ConfigService.get).mockResolvedValue({} as never)
    vi.mocked(HotelService.settings).mockResolvedValue({ hotel: { name: 'Hotel Demo' } } as never)
    vi.mocked(ReservationService.list).mockResolvedValue({ reservations: [], total: 0 })
    vi.mocked(RoomService.list).mockResolvedValue({ rooms: [], total: 0 })
    vi.stubGlobal('open', vi.fn())
  })
  afterEach(() => {
    wrapper?.unmount()
    wrapper = null
    vi.unstubAllGlobals()
  })

  it('sin intentos: el bloque existe, vacío, debajo de "Historial de cobros" y sin aviso', async () => {
    await open(detailFixture({ paymentAttempts: [] }))
    const block = q('[data-testid="payment-attempts"]')
    expect(block?.textContent).toContain('Pasarela de pago')
    expect(block?.textContent).toContain('Esta reserva no pasó por la pasarela.')
    expect(rows()).toHaveLength(0)
    expect(warningText()).toBeNull()
    const history = q('[data-testid="payment-history"]')
    expect(history && block && (history.compareDocumentPosition(block) & Node.DOCUMENT_POSITION_FOLLOWING)).toBeTruthy()
  })

  it('backend viejo sin `paymentAttempts`: no revienta y muestra el vacío', async () => {
    await open(detailFixture({ paymentAttempts: undefined }))
    expect(q('[data-testid="payment-attempts"]')?.textContent).toContain('Esta reserva no pasó por la pasarela.')
  })

  it('un rechazo: fila con badge Rechazado, motivo en rojo, tarjeta, referencia copiable y link a Stripe en pestaña nueva', async () => {
    await open(detailFixture({ paymentAttempts: [DECLINED] }))
    const [row] = rows()
    expect(rows()).toHaveLength(1)
    expect(row.textContent).toContain('Rechazado')
    expect(row.textContent).toContain('Stripe')
    expect(row.textContent).toContain('visa ····0002')
    expect(row.textContent).toContain('US$500,00')
    expect(row.querySelector('[data-testid="payment-attempt-failure"]')?.textContent?.trim()).toBe('Your card was declined.')
    expect(row.querySelector('code')?.textContent?.trim()).toBe('pi_test_declined_1')
    const link = row.querySelector<HTMLAnchorElement>('a[href="https://dashboard.stripe.com/test/payments/pi_test_declined_1"]')
    expect(link?.textContent?.trim()).toBe('Ver en Stripe')
    expect(link?.getAttribute('target')).toBe('_blank')
    expect(link?.getAttribute('rel')).toContain('noopener')
    expect(row.textContent).not.toContain('Recibo') // sin receiptUrl no hay botón
  })

  it('botón Copiar: manda providerRef al portapapeles y avisa', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined)
    vi.stubGlobal('navigator', { ...navigator, clipboard: { writeText } })
    await open(detailFixture({ paymentAttempts: [DECLINED] }))
    ;(q('[data-testid="payment-attempt-copy"]') as HTMLButtonElement).click()
    await flushPromises()
    expect(writeText).toHaveBeenCalledWith('pi_test_declined_1')
    expect(toastSuccess).toHaveBeenCalledWith('Referencia copiada')
  })

  it('último intento rechazado y reserva sin pagar: aviso ámbar con el motivo', async () => {
    await open(detailFixture({ paymentAttempts: [DECLINED] }))
    expect(warningText()).toBe('El último intento de cobro no se completó (Your card was declined.). El huésped puede reintentar desde el correo de recuperación o usted puede generar un link de pago.')
    expect(q('[data-testid="failed-payment-warning"]')?.className).toContain('amber')
  })

  it('último intento expirado (sin motivo): el aviso usa la etiqueta del estado', async () => {
    await open(detailFixture({ paymentAttempts: [attempt({ id: 'a-exp', kind: 'expired', providerRef: 'cs_test_1', occurredAt: '2026-09-02T10:00:00Z' })] }))
    expect(warningText()).toBe('El último intento de cobro no se completó (Expirado). El huésped puede reintentar desde el correo de recuperación o usted puede generar un link de pago.')
    expect(rows()[0].textContent).toContain('Expirado')
  })

  it('último intento rechazado pero la reserva ya está pagada por otra vía: sin aviso', async () => {
    await open(detailFixture({ paymentState: 'paid', paidAmount: 500, pendingAmount: 0, paymentAttempts: [DECLINED] }))
    expect(warningText()).toBeNull()
    expect(rows()).toHaveLength(1) // el rechazo sigue en la bitácora
  })

  it('rechazo y luego cobro: sin aviso, filas del más reciente al más viejo, con Recibo en el pagado', async () => {
    const paid = attempt({ id: 'a-paid', kind: 'paid', providerRef: 'pi_test_paid_1', receiptUrl: 'https://pay.stripe.com/receipts/test_x', occurredAt: '2026-09-03T10:00:00Z' })
    // El backend ya ordena (más reciente primero); el modal respeta ese orden.
    await open(detailFixture({ paymentState: 'paid', paidAmount: 500, pendingAmount: 0, paymentAttempts: [paid, DECLINED] }))
    expect(warningText()).toBeNull()
    const [first, second] = rows()
    expect(rows()).toHaveLength(2)
    expect(first.textContent).toContain('Pagado')
    expect(first.querySelector<HTMLAnchorElement>('a[href="https://pay.stripe.com/receipts/test_x"]')?.textContent?.trim()).toBe('Recibo')
    expect(second.textContent).toContain('Rechazado')
  })

  it('un `payments` fallido sin intento en la pasarela ya no dispara el aviso (eso era hasFailedPayment)', async () => {
    await open(detailFixture({
      paymentAttempts: [],
      paymentHistory: [{ id: 'p1', type: 'charge', method: 'card', status: 'failed', amount: 500, currency: 'USD', description: '', reference: '', registeredBy: '', createdAt: '2026-09-01T10:00:00Z' }] as never,
    }))
    expect(warningText()).toBeNull()
    expect(q('[data-testid="payment-history"]')?.textContent).toContain('Fallido') // sigue en el historial
  })

  it('Azul sin dashboardUrl y pagado: badge Pagado, proveedor Azul y ningún link "Ver en Stripe"', async () => {
    await open(detailFixture({ paymentAttempts: [attempt({ provider: 'azul', mode: 'live', dashboardUrl: '', providerRef: 'azul-123', cardBrand: '', cardLast4: '' })] }))
    const [row] = rows()
    expect(row.textContent).toContain('Azul')
    expect(row.textContent).not.toContain('Ver en Stripe')
    expect(row.textContent).not.toContain('····')
  })
})
