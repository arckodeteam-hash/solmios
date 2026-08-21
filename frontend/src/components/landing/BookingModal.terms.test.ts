// BookingModal.terms.test.ts — Las condiciones que el huésped acepta ANTES de que le cobren.
//
// Qué se protege acá (todo salió de un recorrido E2E real del paso 5 en producción):
//   1. Se paga solo con aceptación explícita. El botón se bloquea Y `onPrimary()` se planta,
//      porque un doble evento o un atajo de teclado se saltean el atributo `disabled`.
//      Mismo criterio que `CancelReservationModal.confirm()`.
//   2. La política que se anuncia es la REAL (`cancellationSummary`, derivada de los tiers que
//      el backend aplica al cancelar), NUNCA el texto libre `cancellationPolicy` — que en
//      producción dice "flexible" mientras la política real es estricta. Anunciar el texto libre
//      es prometer un reembolso que no existe.
//   3. Sin política publicada no se rellena con genéricos: se dice que no está.
//   4. Pluralización: "1 día" / "7 días". Nunca "día(s)".
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { mount, flushPromises, type VueWrapper } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'

vi.mock('@/services/Booking.service', () => ({
  BookingService: {
    getRates: vi.fn(),
    getCalendar: vi.fn(),
    getUpsells: vi.fn(),
    validatePromo: vi.fn(),
    createBooking: vi.fn(),
  },
}))
// El paso de habitaciones también pide el catálogo (`GET /room-types`) para los tipos
// deshabilitados — mockeado vacío acá, no es lo que testea este archivo (condiciones/pago).
vi.mock('@/services/PublicHotel.service', () => ({
  PublicHotelService: { getRoomTypes: vi.fn().mockResolvedValue({ roomTypes: [] }) },
}))

import BookingModal from './BookingModal.vue'
import { BookingService } from '@/services/Booking.service'
import { useBookingStore } from '@/composables/useBooking'
import type {
  CancellationSummary,
  OpenBookingOptions,
  PublicHotelInfo,
  PublicRatesResponse,
} from '@/types'

const HOTEL = {
  id: 'h1',
  slug: 'hotel-demo',
  name: 'Hotel Demo',
  title: 'Hotel Demo',
  description: '',
  accommodationType: 'hotel',
  starRating: 4,
  amenities: [],
  latitude: 0,
  longitude: 0,
  currency: 'USD',
} as unknown as PublicHotelInfo

/** El texto libre SIEMPRE miente en estos fixtures a propósito: si aparece en pantalla, el
 *  componente cayó al campo equivocado y el test tiene que romper. */
const FREE_TEXT_LIE = 'Cancelación flexible: te devolvemos todo cuando quieras.'

function ratesResponse(summary: CancellationSummary | null): PublicRatesResponse {
  return {
    currency: 'USD',
    chargeCurrency: 'USD',
    nights: 3,
    checkIn: '2026-08-18',
    checkOut: '2026-08-21',
    taxes: [{ name: 'ITBIS', rate: 18 }],
    cancellationPolicy: FREE_TEXT_LIE,
    cancellationSummary: summary,
    roomTypes: [
      {
        id: 'double', name: 'double', fromPrice: 300, availableCount: 5, capacity: 2,
        surfaceArea: 24, taxBreakdown: [{ name: 'ITBIS', rate: 18, amount: 54 }], photoUrl: null,
      },
    ],
  }
}

const FROM_HERO: OpenBookingOptions = {
  checkIn: '2026-08-18',
  checkOut: '2026-08-21',
  adults: 2,
  children: 0,
  rooms: 1,
  skipToRooms: true,
}

/** El panel vive teletransportado en <body> (AppModal), no dentro del wrapper. */
function modalText(): string {
  return document.body.textContent ?? ''
}

function termsBlockText(): string {
  return document.querySelector('[data-testid="booking-terms"]')?.textContent ?? ''
}

function acceptCheckbox(): HTMLInputElement | null {
  return document.querySelector<HTMLInputElement>('[data-testid="accept-terms"]')
}

function payButton(): HTMLButtonElement | undefined {
  return Array.from(document.querySelectorAll<HTMLButtonElement>('button'))
    .find((b) => b.textContent?.includes('Reservar y pagar'))
}

let wrapper: VueWrapper | null = null

/** Abre el modal desde el hero y elige la habitación (queda en el paso de extras/datos según se
 *  siga avanzando). `goToStep` NO sirve para adelantar: el store solo deja saltar hacia atrás. */
async function openAtRoomsStep(summary: CancellationSummary | null) {
  vi.mocked(BookingService.getRates).mockResolvedValue(ratesResponse(summary))
  wrapper = mount(BookingModal, {
    props: { hotel: HOTEL, options: FROM_HERO },
    global: { stubs: { RouterLink: true } },
  })
  await flushPromises()

  const store = useBookingStore()
  await store.addToCart(store.ratesResponse!.roomTypes[0]!)
  await flushPromises()
  return store
}

/** Avanza paso a paso hasta el de pago (habitación → extras → datos → pago). */
async function advanceToPay(store: ReturnType<typeof useBookingStore>) {
  store.setGuest({ name: 'Ana Pérez', email: 'ana@example.com', phone: '8095550000' })
  store.next() // rooms → extras
  await flushPromises()
  store.next() // extras → datos
  await flushPromises()
  store.next() // datos → pago
  await flushPromises()
  expect(store.status).toBe('paying')
}

/** Deja el modal en el paso 5 (pago) con habitación elegida y datos del huésped cargados. */
async function openAtPayStep(summary: CancellationSummary | null) {
  const store = await openAtRoomsStep(summary)
  await advanceToPay(store)
  return store
}

describe('BookingModal — condiciones y aceptación previas al pago', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    document.body.innerHTML = ''
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date(2026, 7, 15, 10, 0, 0))
    vi.mocked(BookingService.getRates).mockReset()
    vi.mocked(BookingService.getCalendar).mockReset().mockResolvedValue({
      currency: 'USD', chargeCurrency: 'USD', from: '2026-08-15', to: '2026-08-31', guests: 2, days: [],
    })
    vi.mocked(BookingService.getUpsells).mockReset().mockResolvedValue([])
    vi.mocked(BookingService.createBooking).mockReset().mockResolvedValue({
      reservationId: 'r1', accessToken: 't1', checkoutUrl: null,
      totalBreakdown: { subtotal: 300, promoDiscount: 0, upsellsTotal: 0, taxes: 54, total: 354 },
    })
  })
  afterEach(() => {
    wrapper?.unmount()
    wrapper = null
    vi.useRealTimers()
  })

  const FLEXIBLE: CancellationSummary = {
    tiers: [
      { deadlineHours: 168, penaltyPercent: 0, refundable: true },
      { deadlineHours: 0, penaltyPercent: 50, refundable: true },
    ],
    freeUntilHours: 168,
    penaltyDescription: 'Después: hasta 50% de penalización',
    source: 'preset',
  }

  const ESTRICTA: CancellationSummary = {
    tiers: [
      { deadlineHours: 24, penaltyPercent: 0, refundable: true },
      { deadlineHours: 0, penaltyPercent: 100, refundable: false },
    ],
    freeUntilHours: 24,
    penaltyDescription: 'No reembolsable',
    source: 'custom',
  }

  const NO_REEMBOLSABLE: CancellationSummary = {
    tiers: [{ deadlineHours: 0, penaltyPercent: 100, refundable: false }],
    freeUntilHours: null,
    penaltyDescription: 'No reembolsable',
    source: 'preset',
  }

  // ─── Aceptación obligatoria ────────────────────────────────────────────────
  it('no deja pagar sin aceptar: el botón está bloqueado y onPrimary() tampoco cobra', async () => {
    await openAtPayStep(FLEXIBLE)

    const btn = payButton()
    expect(btn).toBeTruthy()
    expect(btn!.disabled).toBe(true)
    expect(modalText()).toContain('Aceptá las condiciones para poder pagar.')

    // Clickear el botón bloqueado no hace nada…
    btn!.click()
    await flushPromises()
    expect(BookingService.createBooking).not.toHaveBeenCalled()

    // …y llamar a la acción directo (doble evento / atajo de teclado / refactor que pierda el
    // `disabled`) TAMPOCO: el guard vive dentro de la función, no solo en el atributo.
    await (wrapper!.vm as unknown as { onPrimary: () => Promise<void> }).onPrimary()
    await flushPromises()
    expect(BookingService.createBooking).not.toHaveBeenCalled()
    expect(useBookingStore().reservation).toBeNull()
  })

  it('con la casilla tildada habilita el pago y cobra', async () => {
    await openAtPayStep(FLEXIBLE)

    const box = acceptCheckbox()
    expect(box).toBeTruthy()
    box!.checked = true
    box!.dispatchEvent(new Event('change'))
    await flushPromises()

    expect(payButton()!.disabled).toBe(false)
    expect(modalText()).not.toContain('Aceptá las condiciones para poder pagar.')

    await (wrapper!.vm as unknown as { onPrimary: () => Promise<void> }).onPrimary()
    await flushPromises()
    expect(BookingService.createBooking).toHaveBeenCalledTimes(1)
  })

  it('volver atrás vuelve a pedir la aceptación (otra tarifa puede traer otra política)', async () => {
    const store = await openAtPayStep(FLEXIBLE)

    const box = acceptCheckbox()!
    box.checked = true
    box.dispatchEvent(new Event('change'))
    await flushPromises()
    expect(payButton()!.disabled).toBe(false)

    store.goToStep(1) // vuelve a elegir habitación
    await flushPromises()
    await advanceToPay(store) // y regresa al pago

    expect(acceptCheckbox()!.checked).toBe(false)
    expect(payButton()!.disabled).toBe(true)
  })

  // ─── Qué dice el bloque ────────────────────────────────────────────────────
  it('muestra la política REAL y nunca el texto libre del admin', async () => {
    await openAtPayStep(ESTRICTA)

    const terms = termsBlockText()
    // Estricta se dice con esa palabra, sin suavizar.
    expect(terms).toContain('Política estricta')
    expect(terms).toContain('Pasado ese plazo la reserva no es reembolsable.')
    // El texto libre miente ("flexible") — no puede aparecer en ningún lado del modal.
    expect(modalText()).not.toContain(FREE_TEXT_LIE)
    expect(modalText()).not.toContain('flexible')
  })

  it('una tarifa sin ventana gratuita se anuncia NO reembolsable, con la plata que se pierde', async () => {
    await openAtPayStep(NO_REEMBOLSABLE)

    const terms = termsBlockText()
    expect(terms).toContain('Tarifa NO reembolsable.')
    expect(terms).toContain('Ese cobro no se devuelve si cancelás.')
    expect(modalText()).not.toContain(FREE_TEXT_LIE)
  })

  // Bug real encontrado recorriendo el paso 5 en el navegador contra el backend local: la
  // política `default` que devuelve /rates trae `deadlineHours: 99999` como centinela de "sin
  // límite", y traducirlo literal escupía "cancelación sin cargo hasta 4167 días antes del
  // check-in" — un número absurdo que además suena a restricción donde no la hay.
  it('una política sin penalidades se anuncia gratuita, no "hasta 4167 días antes"', async () => {
    await openAtPayStep({
      tiers: [{ deadlineHours: 99999, penaltyPercent: 0, refundable: true, label: 'Cancelación gratis' }],
      freeUntilHours: 99999,
      penaltyDescription: 'Cancelación gratuita en cualquier momento',
      source: 'preset',   // el hotel ELIGIÓ flexible — ver el test de abajo para el caso 'default'
    })

    const terms = termsBlockText()
    expect(terms).toContain('Cancelación gratuita en cualquier momento.')
    expect(terms).not.toContain('4167')
    expect(terms).not.toContain('99999')
  })

  // `source: 'default'` NO es una política del hotel: es el fallback del backend cuando no hay
  // ninguna configurada. Los tiers que trae son flexibles, así que la lectura ingenua anunciaba
  // "cancelación gratuita" — prometiendo en nombre de un hotel que nunca eligió eso, y encima
  // haciéndoselo aceptar al huésped con la casilla. `PoliciesBlock` ya se callaba en este caso;
  // el checkout no.
  it('sin política configurada NO promete cancelación gratuita: avisa que no está publicada', async () => {
    await openAtPayStep({
      tiers: [{ deadlineHours: 99999, penaltyPercent: 0, refundable: true, label: 'Cancelación gratis' }],
      freeUntilHours: 99999,
      penaltyDescription: 'Cancelación gratuita en cualquier momento',
      source: 'default',
    })

    const terms = termsBlockText()
    expect(terms).toContain('no publicó su política de cancelación')
    expect(terms).not.toContain('Cancelación gratuita en cualquier momento.')
    expect(terms).not.toMatch(/se te devuelve|se devuelve completo/i)
  })

  // El reintegro automático NO existe (TODO #627): cancelar calcula el monto y lo guarda, pero
  // la plata solo vuelve si alguien del hotel la devuelve a mano. Este es el único texto del
  // producto que el huésped ACEPTA con una casilla, así que prometer la devolución acá convertía
  // una deuda técnica en un compromiso firmado.
  it('no promete que el dinero se devuelva solo: dice que la devolución la gestiona el hotel', async () => {
    await openAtPayStep(ESTRICTA)

    const terms = termsBlockText()
    expect(terms).toContain('la devolución la gestiona el hotel')
    expect(terms).not.toMatch(/se te devuelve el total|se devuelve completo si cancelás/i)
  })

  // El preset `strict` del backend es `{penaltyPercent: 100, refundable: true}`: exigir
  // `!refundable` para considerarla estricta dejaba fuera al caso más común y el hotel estricto
  // veía el aviso en gris, leyendo primero la buena noticia. Es el patrón que esta tarea vino a
  // corregir, reproducido dentro del propio arreglo.
  it('el preset strict real del backend dispara el aviso fuerte, no el neutral', async () => {
    await openAtPayStep({
      tiers: [
        { deadlineHours: 168, penaltyPercent: 0, refundable: true },
        { deadlineHours: 0, penaltyPercent: 100, refundable: true },   // refundable TRUE, como en prod
      ],
      freeUntilHours: 168,
      penaltyDescription: 'Después: hasta 100% de penalización',
      source: 'preset',
    })

    const terms = termsBlockText()
    expect(terms).toContain('Política estricta')
    expect(terms).toContain('no es reembolsable')
  })

  it('dice qué se cobra ahora: el total, no una seña', async () => {
    await openAtPayStep(FLEXIBLE)

    const terms = termsBlockText()
    expect(terms).toContain('Qué se cobra ahora')
    expect(terms).toContain('el total de la reserva, no una seña')
    // El monto anunciado es el mismo que el del botón de pago (300 + 18% ITBIS = 354).
    expect(terms).toContain('354')
    expect(payButton()!.textContent).toContain('354')
  })

  it('sin cancellationSummary no inventa nada: dice que la política no está publicada', async () => {
    await openAtPayStep(null)

    const terms = termsBlockText()
    expect(terms).toContain('Este hotel no publicó su política de cancelación.')
    expect(terms).toContain('tampoco podemos anticiparte si el cobro se devuelve')
    // Ni el texto libre mentiroso, ni un "consultá los términos" que manda a una página inexistente.
    expect(modalText()).not.toContain(FREE_TEXT_LIE)
    expect(modalText()).not.toMatch(/términos y condiciones/i)
    // Y sigue sin poder pagarse a ciegas: la aceptación es obligatoria igual.
    expect(payButton()!.disabled).toBe(true)
  })

  // ─── Pluralización ─────────────────────────────────────────────────────────
  it('pluraliza la ventana de cancelación: "7 días", "1 día", "1 hora" — nunca "día(s)"', async () => {
    await openAtPayStep(FLEXIBLE) // 168 h = 7 días
    expect(termsBlockText()).toContain('hasta 7 días antes del check-in')
    expect(modalText()).not.toContain('(s)')
    wrapper!.unmount()
    wrapper = null

    setActivePinia(createPinia())
    document.body.innerHTML = ''
    await openAtPayStep({ ...FLEXIBLE, freeUntilHours: 24 }) // 24 h = 1 día
    expect(termsBlockText()).toContain('hasta 1 día antes del check-in')
    expect(termsBlockText()).not.toContain('1 días')
    expect(modalText()).not.toContain('(s)')
    wrapper!.unmount()
    wrapper = null

    setActivePinia(createPinia())
    document.body.innerHTML = ''
    await openAtPayStep({ ...FLEXIBLE, freeUntilHours: 1 }) // menos de un día → horas
    expect(termsBlockText()).toContain('hasta 1 hora antes del check-in')
    expect(modalText()).not.toContain('(s)')
  })

  // ─── Aviso de privacidad (paso 4) ──────────────────────────────────────────
  it('avisa para qué se usan los datos personales en el paso que los pide', async () => {
    const store = await openAtRoomsStep(FLEXIBLE)
    store.next() // rooms → extras
    await flushPromises()
    store.next() // extras → datos
    await flushPromises()
    expect(store.status).toBe('checkingout')

    const note = document.querySelector('[data-testid="privacy-note"]')?.textContent ?? ''
    expect(note).toContain('para gestionar esta reserva')
    expect(note).toContain(HOTEL.name)
    // Sin "solo": el sistema además segmenta al huésped (crm), le manda campañas (marketing) y
    // correos de recuperación si abandona el checkout (abandon-recovery). Una limitación de
    // finalidad es una promesa exigible — prometer de más lo paga el hotel.
    expect(note).not.toContain('solo para gestionar')
    // Y el hotel no es el único que toca los datos: la base es multi-tenant y el cobro pasa por
    // la pasarela. Nombrar solo al hotel dejaba fuera a la plataforma.
    expect(note).toMatch(/plataforma/i)
  })
})
