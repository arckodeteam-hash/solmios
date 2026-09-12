// PayStep.test.ts — Política de cancelación del resumen pre-pago (Tarea 6 / tasks.md 1.5).
//
// "Cargar la política de cancelación/reembolso del widget desde la configuración del hotel
// en el PMS, eliminando cualquier texto fijo compartido entre hoteles." Acceptance: dos
// hoteles con plazos de cancelación gratuita distintos (3 días vs 7 días) muestran cada uno
// su propio texto en el resumen pre-pago — no una leyenda genérica compartida.
//
// El backend (`public-rates.ts` → `buildCancellationSummary`) ya resuelve esto por hotel
// (ver `public-rates.test.ts`, describe "cancellationSummary"). Este archivo cubre el otro
// extremo — que PayStep.vue (el resumen del WIDGET embebible) efectivamente renderiza lo que
// el store recibió, CON el mismo tono de riesgo (`cancellationTerms`) que ya tenía
// BookingModal.vue (landing, `bookingTerms`) — ver el FIX 2026-08-21 ahí: nunca cae al texto
// libre `cancellationPolicy` que el admin escribe a mano, porque en producción llegó a decir
// "flexible" mientras la política real (la que el backend aplica al cancelar) era estricta.
// PayStep.vue tenía exactamente ese patrón peligroso hasta este fix.
import { describe, it, expect, beforeEach } from 'vitest'
import { nextTick } from 'vue'
import { mount, type VueWrapper } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { vi } from 'vitest'

vi.mock('@/services/Booking.service', () => ({
  BookingService: { getRates: vi.fn(), getCalendar: vi.fn(), getUpsells: vi.fn(), createBooking: vi.fn() },
}))

import PayStep from './PayStep.vue'
import { useBookingStore } from '@/composables/useBooking'
import { BookingService } from '@/services/Booking.service'
import { useBookingI18nStore, type BookingLocale } from '@/composables/useBookingI18n'
import type { CancellationSummary, PublicRatesResponse } from '@/types/booking'

function baseRates(overrides: Partial<PublicRatesResponse> = {}): PublicRatesResponse {
  return {
    currency: 'USD',
    chargeCurrency: 'USD',
    nights: 2,
    checkIn: '2026-08-18',
    checkOut: '2026-08-20',
    taxes: [{ name: 'ITBIS', rate: 18 }],
    cancellationPolicy: null,
    cancellationSummary: null,
    roomTypes: [
      {
        id: 'double', name: 'double', fromPrice: 200, availableCount: 5, capacity: 2,
        surfaceArea: 24, taxBreakdown: [{ name: 'ITBIS', rate: 18, amount: 36 }], photoUrl: null,
      },
    ],
    ...overrides,
  } as unknown as PublicRatesResponse
}

/** Arma el store con 1 línea en el carrito (necesaria para que PayStep renderice el resumen
 *  sin depender de recorrer los steps previos) + una política de cancelación dada. */
function render(
  cancellationSummary: CancellationSummary | null,
  cancellationPolicy: string | null = null,
  locale: BookingLocale = 'es',
): VueWrapper {
  const store = useBookingStore()
  store.init('hotel-demo')
  store.ratesResponse = baseRates({ cancellationSummary, cancellationPolicy })
  store.cart = [{
    key: 'double|2', roomType: 'double', roomName: 'double', occupancy: 2, quantity: 1,
    unitPrice: 200, unitTaxBreakdown: [{ name: 'ITBIS', rate: 18, amount: 36 }], maxAvailable: 5, photoUrl: null,
  }]
  useBookingI18nStore().setLocale(locale)
  return mount(PayStep)
}

describe('PayStep — política de cancelación por hotel (Tarea 6 / tasks.md 1.5)', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
  })

  it('Hotel A (moderate, gratis 3 días) es NEUTRAL; Hotel B (estricta, gratis 7 días) es DANGER — cada uno con SU plazo', () => {
    const wA = render({
      tiers: [{ deadlineHours: 72, penaltyPercent: 0, refundable: true }, { deadlineHours: 0, penaltyPercent: 50, refundable: true }],
      freeUntilHours: 72,
      penaltyDescription: 'Después: hasta 50% de penalización',
      source: 'preset',
    })
    expect(wA.text()).toContain('3 días')
    expect(wA.text()).toContain('Después: hasta 50% de penalización')
    expect(wA.text()).not.toContain('Política estricta')
    wA.unmount()

    const wB = render({
      tiers: [{ deadlineHours: 168, penaltyPercent: 0, refundable: true }, { deadlineHours: 0, penaltyPercent: 100, refundable: true }],
      freeUntilHours: 168,
      penaltyDescription: 'Después: hasta 100% de penalización',
      source: 'preset',
    })
    expect(wB.text()).toContain('7 días')
    expect(wB.text()).toContain('Política estricta')
    // El texto de A ya no está — no es una leyenda que se acumula ni queda pegada de un hotel a otro.
    expect(wB.text()).not.toContain('3 días')
    expect(wB.text()).not.toContain('50% de penalización')
    wB.unmount()
  })

  // Bug real ya encontrado y cerrado en la OTRA superficie del mismo motor (BookingModal.vue,
  // landing): el preset `default`/`flexible` del backend usa `deadlineHours: 99_999` como
  // centinela de "sin límite" (`cancellation-math.ts` PRESET_TIERS.flexible), y traducirlo
  // literal escupía "cancelación sin cargo hasta 4167 días antes del check-in" — un número
  // absurdo. `PayStep.vue` tiene el MISMO umbral (`FLEXIBLE_ANYTIME_THRESHOLD`) pero no tenía
  // ningún test que lo protegiera acá (arreglar el bug en un solo componente lo deja vivo en
  // el otro — mismo patrón de bugs recurrentes de este proyecto).
  it('política flexible (99999h, sin tiers de penalidad) dice "cualquier momento", NUNCA "4167 días"', () => {
    const w = render({
      tiers: [{ deadlineHours: 99_999, penaltyPercent: 0, refundable: true, label: 'Cancelación gratis' }],
      freeUntilHours: 99_999,
      penaltyDescription: 'Cancelación gratuita en cualquier momento',
      source: 'preset',
    })
    expect(w.text()).toContain('Cancelación gratuita en cualquier momento')
    expect(w.text()).not.toContain('4167')
    expect(w.text()).not.toContain('99999')
    expect(w.text()).not.toContain('99.999')
    w.unmount()
  })

  it('ventana gratuita menor a 24h se muestra en HORAS, no en "0 días"', () => {
    const w = render({
      tiers: [{ deadlineHours: 6, penaltyPercent: 100, refundable: true }],
      freeUntilHours: 6,
      penaltyDescription: 'No reembolsable',
      source: 'preset',
    })
    expect(w.text()).toContain('6 horas')
    expect(w.text()).not.toContain('0 días')
    w.unmount()
  })

  it('sin ventana gratuita (no reembolsable) NO dice ningún plazo — dice "Tarifa NO reembolsable"', () => {
    const w = render({
      tiers: [{ deadlineHours: 0, penaltyPercent: 100, refundable: false }],
      freeUntilHours: null,
      penaltyDescription: 'No reembolsable',
      source: 'preset',
    })
    expect(w.text()).toContain('Tarifa NO reembolsable')
    expect(w.text()).toContain('No reembolsable')
    expect(w.text()).not.toMatch(/\d+ días? antes/)
    w.unmount()
  })

  // FIX 2026-08-21 — este es el caso que realmente importa: el mismo incidente que ya se
  // documentó y cerró en BookingModal.vue (landing), reproducido acá antes del fix. Un admin
  // puede escribir CUALQUIER cosa en el campo de texto libre de /panel/booking-engine —
  // incluida una promesa que la política real (los tiers que el backend aplica al cancelar)
  // no cumple. Mostrarla es prometer un reembolso que no existe.
  it('sin cancellationSummary IGNORA el texto libre del admin — nunca lo muestra, avisa que no hay política', () => {
    const w = render(null, 'Cancelación 100% flexible, te devolvemos todo cuando quieras.')
    expect(w.text()).toContain('Este hotel no publicó su política de cancelación.')
    expect(w.text()).not.toContain('Cancelación 100% flexible, te devolvemos todo cuando quieras.')
    w.unmount()
  })

  it('sin cancellationSummary NI texto libre → mismo aviso, no queda en blanco', () => {
    const w = render(null, null)
    expect(w.text()).toContain('Este hotel no publicó su política de cancelación.')
    w.unmount()
  })

  // `source: 'default'` es el fallback defensivo del backend cuando el hotel NO configuró
  // nada — sus tiers son flexibles (0% siempre) pero NO representan una elección real del
  // hotel. Mostrarlo como "cancelación gratuita" prometería en su nombre algo que nunca
  // configuró (mismo criterio que BookingModal.vue, ver el comentario en `bookingTerms`).
  it('cancellationSummary con source "default" avisa que no hay política, aunque los tiers digan "gratis"', () => {
    const w = render({
      tiers: [{ deadlineHours: 99_999, penaltyPercent: 0, refundable: true }],
      freeUntilHours: 99_999,
      penaltyDescription: 'Cancelación gratuita en cualquier momento',
      source: 'default',
    })
    expect(w.text()).toContain('Este hotel no publicó su política de cancelación.')
    expect(w.text()).not.toContain('Cancelación gratuita en cualquier momento')
    w.unmount()
  })

  // El widget (a diferencia de la landing) tiene switcher de idioma — arreglar el bug de los
  // "4167 días" o el plazo por hotel solo en español deja vivo el mismo problema para la mitad
  // de los huéspedes que navegan en inglés/portugués (mismo criterio que RoomsStep.test.ts).
  const localeCases: Array<{ locale: BookingLocale; deadline: string; policyLabel: string }> = [
    { locale: 'en', deadline: '7 days', policyLabel: 'Cancellation policy' },
    { locale: 'pt', deadline: '7 dias', policyLabel: 'Política de cancelamento' },
  ]
  for (const c of localeCases) {
    it(`[${c.locale}] el plazo específico del hotel (168h → 7) se traduce, no queda hardcodeado en español`, () => {
      const w = render({
        tiers: [{ deadlineHours: 168, penaltyPercent: 0, refundable: true }, { deadlineHours: 0, penaltyPercent: 50, refundable: true }],
        freeUntilHours: 168,
        penaltyDescription: '',
        source: 'preset',
      }, null, c.locale)
      expect(w.text()).toContain(c.deadline)
      expect(w.text()).toContain(c.policyLabel)
      // El número (7) es el mismo en cualquier idioma — lo que cambia es la palabra alrededor.
      expect(w.text()).not.toContain('7 días')
      w.unmount()
    })
  }
})

// ─── Aceptación explícita de condiciones (FIX 2026-08-22 — paridad con BookingModal.vue) ────
// El widget dejaba pagar sin ningún tilde de aceptación explícita, a diferencia de la landing
// (`termsAccepted`, testeado extensivamente en `BookingModal.terms.test.ts`). Mismo criterio acá.
describe('PayStep — aceptación de condiciones antes de pagar', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.mocked(BookingService.createBooking).mockReset()
  })

  function renderReadyToPay(): VueWrapper {
    const store = useBookingStore()
    store.init('hotel-demo')
    store.ratesResponse = baseRates({ cancellationSummary: null, cancellationPolicy: null })
    store.cart = [{
      key: 'double|2', roomType: 'double', roomName: 'double', occupancy: 2, quantity: 1,
      unitPrice: 200, unitTaxBreakdown: [], maxAvailable: 5, photoUrl: null,
    }]
    store.setGuest({ name: 'Ana Pérez', email: 'ana@example.com', phone: '8095550000' })
    useBookingI18nStore().setLocale('es')
    return mount(PayStep)
  }

  it('no deja pagar sin aceptar: el botón está bloqueado y el click no dispara el cobro', async () => {
    const w = renderReadyToPay()
    const buttons = w.findAll('button')
    const btn = buttons[buttons.length - 1]!

    expect(w.text()).toContain('Aceptá las condiciones para poder pagar.')

    await btn.trigger('click')
    expect(BookingService.createBooking).not.toHaveBeenCalled()

    // Guard adicional dentro del handler (`onPay()`), no solo el atributo `disabled`: un doble
    // evento o un atajo de teclado que se salte el `:disabled` tampoco puede cobrarle a alguien
    // que nunca tildó la casilla.
    await (w.vm as unknown as { onPay: () => Promise<void> }).onPay()
    expect(BookingService.createBooking).not.toHaveBeenCalled()
    w.unmount()
  })

  it('con la casilla tildada, el botón se habilita y el click SÍ dispara el cobro', async () => {
    vi.mocked(BookingService.createBooking).mockResolvedValue({
      reservationId: 'r1', accessToken: 't1', checkoutUrl: null,
      totalBreakdown: { subtotal: 200, promoDiscount: 0, upsellsTotal: 0, taxes: 0, taxBreakdown: [], total: 200 },
    })
    const w = renderReadyToPay()

    const checkbox = w.get('input[data-testid="accept-terms"]')
    await checkbox.setValue(true)
    expect(w.text()).not.toContain('Aceptá las condiciones para poder pagar.')

    const buttons = w.findAll('button')
    await buttons[buttons.length - 1]!.trigger('click')
    expect(BookingService.createBooking).toHaveBeenCalledTimes(1)
    w.unmount()
  })
})

// ─── Tarea 24 (#88): transparentar impuestos y total final ───────────────────────────────
describe('PayStep — desglose impuesto por impuesto y extras por separado (#88)', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.mocked(BookingService.createBooking).mockReset()
  })

  function renderWith(taxes: Array<{ name: string; rate: number }>): { w: VueWrapper; store: ReturnType<typeof useBookingStore> } {
    const store = useBookingStore()
    store.init('hotel-demo')
    store.ratesResponse = baseRates({ taxes } as any)
    store.cart = [{
      key: 'double|2', roomType: 'double', roomName: 'double', occupancy: 2, quantity: 1,
      unitPrice: 200, unitTaxBreakdown: [], maxAvailable: 5, photoUrl: null,
    }]
    store.upsells = [
      { id: 'u-brk', name: 'Desayuno', description: null, price: 15, kind: 'per_person', sortOrder: 1 },
      { id: 'u-spa', name: 'Spa', description: null, price: 40, kind: 'per_stay', sortOrder: 2 },
    ] as any
    store.selectedUpsells = [{ id: 'u-brk', quantity: 2 }, { id: 'u-spa', quantity: 1 }]
    useBookingI18nStore().setLocale('es')
    return { w: mount(PayStep), store }
  }

  it('muestra cada impuesto con nombre, % e importe, y el total es subtotal + extras + Σ impuestos', () => {
    const { w } = renderWith([{ name: 'ITBIS', rate: 18 }, { name: 'Propina legal', rate: 10 }])
    const lines = w.findAll('[data-testid="tax-line"]').map((l) => l.text().replace(/\s+/g, ' '))
    // Base: 200 (habitación) + 30 (2 desayunos) + 40 (spa) = 270 → ITBIS 48.60 · Propina 27.00
    expect(lines).toHaveLength(2)
    expect(lines[0]).toContain('ITBIS (18%)')
    expect(lines[0]).toContain('48,60')
    expect(lines[1]).toContain('Propina legal (10%)')
    expect(lines[1]).toContain('27,00')
    expect(w.find('[data-testid="final-total"]').text()).toContain('345,60')
    // Ya no hay una línea agregada "Impuestos": el huésped ve cada uno.
    expect(w.find('[data-testid="price-breakdown"]').text()).not.toMatch(/Impuestos\s+\$?\d/)
  })

  it('los extras van uno por línea (nombre × cantidad = importe), no una suma opaca', () => {
    const { w } = renderWith([{ name: 'ITBIS', rate: 18 }])
    const lines = w.findAll('[data-testid="upsell-line"]').map((l) => l.text().replace(/\s+/g, ' '))
    expect(lines).toHaveLength(2)
    expect(lines[0]).toContain('Desayuno × 2')
    expect(lines[0]).toContain('30,00')
    expect(lines[1]).toContain('Spa')
    expect(lines[1]).not.toContain('×')
    expect(lines[1]).toContain('40,00')
  })

  it('el subtotal se anuncia "sin impuestos" y el total aclara que es lo que cobra la pasarela', () => {
    const { w } = renderWith([{ name: 'ITBIS', rate: 18 }])
    const text = w.find('[data-testid="price-breakdown"]').text()
    expect(text).toContain('sin impuestos')
    expect(text).toContain('Es exactamente el importe que se cobra en la pasarela.')
  })

  it('sin impuestos configurados lo dice explícitamente en vez de esconder la línea', () => {
    const { w } = renderWith([])
    expect(w.findAll('[data-testid="tax-line"]')).toHaveLength(0)
    expect(w.text()).toContain('Este hotel no aplica impuestos sobre la reserva.')
    expect(w.find('[data-testid="final-total"]').text()).toContain('270,00')
  })

  it('tras crear la reserva manda el desglose DEFINITIVO del backend, no la estimación', async () => {
    const { w, store } = renderWith([{ name: 'ITBIS', rate: 18 }])
    store.reservation = {
      reservation: { id: 'r1', checkIn: '2026-08-18', checkOut: '2026-08-20', status: 'pending', totalAmount: 318.6 },
      guest: null, checkoutUrl: null,
      totalBreakdown: { subtotal: 270, promoDiscount: 0, upsellsTotal: 70, taxes: 48.6, taxBreakdown: [{ name: 'ITBIS', rate: 18, amount: 48.6 }], total: 318.6 },
    } as any
    await w.vm.$nextTick()
    expect(w.find('[data-testid="final-total"]').text()).toContain('318,60')
    expect(w.findAll('[data-testid="tax-line"]')[0]!.text()).toContain('48,60')
  })
})

// ─── #267: reserva creada SIN pasarela → aviso "recibimos tu pedido", no error rojo ─────────

describe('PayStep — sin pasarela (#267)', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.mocked(BookingService.createBooking).mockReset()
  })

  it('con localizador seteado muestra el aviso con el localizador, sin texto rojo y sin botón de pagar', async () => {
    const w = render(null)
    const store = useBookingStore()
    store.status = 'failed'
    store.receivedUnpaidLocator = 'abc12345'
    await nextTick()

    const notice = w.find('[data-testid="received-unpaid"]')
    expect(notice.exists()).toBe(true)
    expect(notice.text()).toContain('Recibimos tu pedido de reserva')
    expect(notice.text()).toContain('el hotel te contactará para coordinar el pago')
    expect(notice.text()).toContain('Tu localizador')
    expect(notice.find('span.font-mono').text()).toBe('abc12345')
    expect(w.find('[data-testid="pay-error"]').exists()).toBe(false)
    expect(w.text()).not.toContain('Tu reserva quedó creada pero')
    // El botón de "Reservar y pagar" desaparece: reintentar no tiene sentido.
    expect(w.text()).not.toContain('Reservar y pagar')
    w.unmount()
  })

  it('[en] el aviso sale en inglés', async () => {
    const w = render(null, null, 'en')
    const store = useBookingStore()
    store.status = 'failed'
    store.receivedUnpaidLocator = 'abc12345'
    await nextTick()

    const notice = w.find('[data-testid="received-unpaid"]')
    expect(notice.text()).toContain('We received your booking request')
    expect(notice.text()).toContain('the hotel will contact you to arrange the payment')
    expect(notice.text()).toContain('Your booking reference')
    expect(notice.text()).toContain('abc12345')
    w.unmount()
  })

  it('flujo real: POST sin checkoutUrl deja el localizador (8 chars del id) y NO setea error', async () => {
    vi.mocked(BookingService.createBooking).mockResolvedValue({
      reservationId: 'abcdef12-3456-7890-abcd-ef1234567890', accessToken: 't1', checkoutUrl: null,
      totalBreakdown: { subtotal: 200, promoDiscount: 0, upsellsTotal: 0, taxes: 0, taxBreakdown: [], total: 200 },
    })
    const w = render(null)
    const store = useBookingStore()
    store.setGuest({ name: 'Ana Pérez', email: 'ana@example.com', phone: '8095550000' })
    await w.get('input[data-testid="accept-terms"]').setValue(true)
    await (w.vm as unknown as { onPay: () => Promise<void> }).onPay()
    await nextTick()

    expect(store.status).toBe('failed')
    expect(store.error).toBeNull()
    expect(store.receivedUnpaidLocator).toBe('abcdef12')
    expect(w.find('[data-testid="received-unpaid"]').text()).toContain('abcdef12')
    expect(w.find('[data-testid="pay-error"]').exists()).toBe(false)
    w.unmount()
  })
})
