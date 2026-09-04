// RescheduleModal.test.ts — La decisión de precio al mover/extender una reserva en el planning.
//
// Qué se protege acá (el reclamo real del dueño, no un checklist):
//   1. La elección "mantener vs. recalcular" aparece SIEMPRE, incluso cuando las dos opciones dan
//      el mismo número. Antes el modal asumía un único camino (cobrar solo las noches agregadas),
//      así que mover una reserva a otra habitación sin cambiar noches daba diferencia 0 y el
//      precio "se quedaba igual" sin que nadie lo decidiera.
//   2. NO hay opción marcada por defecto: hay que ELEGIR. Con un default premarcado el
//      recepcionista confirma en automático y el precio nunca se actualiza — el bug original.
//   3. Elegir "recalcular" tiene que VIAJAR al backend como `pricingMode: 'reprice'`.
//   4. Un total MENOR al anterior se muestra como saldo a favor del huésped (antes decía
//      "Sin diferencia a cobrar", que es mentira) y NO abre el bloque de cobro.
//   5. Si el hotel no tiene tarifas cargadas (`repricedFromRates: false`) se avisa: si no, los dos
//      totales salen iguales y nadie entiende por qué recalcular no hace nada.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { mount, flushPromises, type VueWrapper } from '@vue/test-utils'

vi.mock('@/services/Reservation.service', () => ({
  ReservationService: {
    rescheduleQuote: vi.fn(),
    reschedule: vi.fn(),
  },
}))

import RescheduleModal from './RescheduleModal.vue'
import { ReservationService } from '@/services/Reservation.service'
import type { RescheduleQuote, RescheduleResult, RescheduleCommitInput } from '@/types'

const RESERVATION = { id: 'res-1', name: 'Ana Pérez', roomId: 'room-1', checkIn: '2026-09-01', checkOut: '2026-09-04' }
const TARGET = { roomId: 'room-2', checkIn: '2026-09-01', checkOut: '2026-09-04' }
const ROOMS = [{ id: 'room-1', number: '101' }, { id: 'room-2', number: '205' }]

/** Quote por defecto: MISMAS noches, otra habitación. Es el caso del reclamo (keepDifference = 0). */
function quoteFixture(over: Partial<RescheduleQuote> = {}): RescheduleQuote {
  return {
    reservationId: 'res-1',
    roomId: 'room-2',
    checkIn: '2026-09-01',
    checkOut: '2026-09-04',
    basePrice: 100,
    oldNights: 3,
    newNights: 3,
    previousTotal: 300,
    quotedNewPrice: 300,
    difference: 0,
    pricingMode: 'keep',
    keepTotal: 300,
    keepDifference: 0,
    repricedTotal: 380,
    repricedDifference: 80,
    repricedFromRates: true,
    roomChanged: true,
    datesChanged: false,
    currency: 'USD',
    paidAmount: 0,          // por defecto: la reserva no tiene un peso cobrado
    available: true,
    reason: '',
    ...over,
  }
}

function resultFixture(quote: RescheduleQuote): RescheduleResult {
  return {
    reservation: {
      id: 'res-1', hotelId: 'h1', guestId: 'g1', roomId: 'room-2',
      checkIn: quote.checkIn, checkOut: quote.checkOut, channel: 'direct',
      totalAmount: quote.quotedNewPrice, status: 'confirmed',
    },
    quote: {
      ...quote,
      chargeAmount: Math.max(0, quote.difference),
      newTotal: quote.quotedNewPrice,
      creditAmount: Math.max(0, -quote.difference),
      overpaidAmount: Math.max(0, quote.paidAmount - quote.quotedNewPrice),
    },
    charge: null,
    credit: null,
  }
}

/** El panel vive teletransportado en <body> (AppModal), no dentro del wrapper. */
const modalText = (): string => document.body.textContent ?? ''
const byTestId = (id: string): HTMLElement | null => document.body.querySelector<HTMLElement>(`[data-testid="${id}"]`)

function buttonByText(text: string): HTMLButtonElement {
  const btn = Array.from(document.body.querySelectorAll<HTMLButtonElement>('button')).find(b => b.textContent?.trim() === text)
  if (!btn) throw new Error(`No se encontró el botón "${text}"`)
  return btn
}

let wrapper: VueWrapper | null = null

async function open(quote: RescheduleQuote) {
  vi.mocked(ReservationService.rescheduleQuote).mockResolvedValue(quote)
  wrapper = mount(RescheduleModal, {
    props: { open: true, reservation: RESERVATION, target: TARGET, rooms: ROOMS },
  })
  await flushPromises()
}

/** Body con el que se llamó al commit. */
function commitBody(): RescheduleCommitInput {
  return vi.mocked(ReservationService.reschedule).mock.calls[0][1]
}

describe('RescheduleModal — elección de precio', () => {
  beforeEach(() => {
    document.body.innerHTML = ''
    vi.mocked(ReservationService.rescheduleQuote).mockReset()
    vi.mocked(ReservationService.reschedule).mockReset()
  })
  afterEach(() => {
    wrapper?.unmount()
    wrapper = null
    document.body.innerHTML = ''
  })

  it('muestra SIEMPRE las dos opciones con su total, incluso cuando ya viene preseleccionada', async () => {
    // Mover de habitación sin cambiar noches y con la misma tarifa: los dos caminos dan 300.
    await open(quoteFixture({ repricedTotal: 300, repricedDifference: 0 }))

    expect(byTestId('pricing-keep')).not.toBeNull()
    expect(byTestId('pricing-reprice')).not.toBeNull()
    expect(modalText()).toContain('Mantener el precio pactado')
    expect(modalText()).toContain('Recalcular al precio actual')
    // El total de CADA opción está a la vista para poder compararlas.
    expect(byTestId('pricing-keep')?.textContent).toContain('USD 300.00')
    expect(byTestId('pricing-reprice')?.textContent).toContain('USD 300.00')
  })

  // El reclamo del dueño (feedback directo sobre el planning): mover una reserva y que las dos
  // rutas de precio den el mismo número no es una decisión — es el mismo resultado dos veces.
  // Obligar a elegir ahí era fricción sin propósito; "Confirmar" solo debe confirmar el movimiento.
  it('con las dos opciones iguales, preselecciona "keep" y Confirmar queda habilitado sin clickear nada', async () => {
    await open(quoteFixture({ repricedTotal: 300, repricedDifference: 0 })) // keep: 300 · reprice: 300

    expect(byTestId('pricing-keep')?.getAttribute('aria-pressed')).toBe('true')
    expect(byTestId('pricing-required')).toBeNull()
    expect(byTestId('total-pending')).toBeNull()
    expect(byTestId('no-difference')).not.toBeNull()
    expect(byTestId('charge-block')).toBeNull()
    expect(buttonByText('Confirmar').hasAttribute('disabled')).toBe(false)

    const quote = quoteFixture({ repricedTotal: 300, repricedDifference: 0 })
    vi.mocked(ReservationService.reschedule).mockResolvedValue(resultFixture(quote))
    buttonByText('Confirmar').click()
    await flushPromises()

    expect(commitBody().pricingMode).toBe('keep')
    expect(commitBody().charge).toBeUndefined()
  })

  // Hay que ELEGIR, no confirmar algo ya elegido: con una opción premarcada el recepcionista
  // aprieta "Confirmar" en automático y el precio nunca se actualiza — el problema original.
  it('abre SIN opción marcada y con "Confirmar" bloqueado', async () => {
    await open(quoteFixture())

    expect(byTestId('pricing-keep')?.getAttribute('aria-pressed')).toBe('false')
    expect(byTestId('pricing-reprice')?.getAttribute('aria-pressed')).toBe('false')
    expect(byTestId('pricing-required')).not.toBeNull()
    expect(buttonByText('Confirmar').hasAttribute('disabled')).toBe(true)
  })

  it('al elegir una opción se habilita Confirmar y el commit manda ese modo', async () => {
    const quote = quoteFixture()
    await open(quote)

    byTestId('pricing-keep')!.click()
    await flushPromises()

    expect(byTestId('pricing-keep')?.getAttribute('aria-pressed')).toBe('true')
    expect(byTestId('pricing-required')).toBeNull()
    expect(buttonByText('Confirmar').hasAttribute('disabled')).toBe(false)

    vi.mocked(ReservationService.reschedule).mockResolvedValue(resultFixture(quote))
    buttonByText('Confirmar').click()
    await flushPromises()

    expect(commitBody().pricingMode).toBe('keep')
    // keepDifference = 0 → no se cobra nada.
    expect(commitBody().charge).toBeUndefined()
  })

  // Dos candados distintos, y este test prueba LOS DOS por separado. Clickear un botón
  // `disabled` no dispara el handler, así que el click solo probaría el `:disabled` del
  // template; el guard de `confirm()` se ejerce llamándolo directo, que es lo que pasaría si
  // el botón se saltea (doble evento, atajo de teclado, un refactor que se olvide el disabled).
  it('no commitea nunca sin haber elegido, ni por el botón ni llamando a confirm()', async () => {
    await open(quoteFixture())

    expect(buttonByText('Confirmar').hasAttribute('disabled')).toBe(true)
    buttonByText('Confirmar').click()
    await flushPromises()
    expect(vi.mocked(ReservationService.reschedule)).not.toHaveBeenCalled()

    await (wrapper!.vm as unknown as { confirm: () => Promise<void> }).confirm()
    await flushPromises()
    expect(vi.mocked(ReservationService.reschedule)).not.toHaveBeenCalled()
  })

  it('elegir "recalcular" manda pricingMode:"reprice" y cobra la diferencia repreciada', async () => {
    const quote = quoteFixture()   // keep: 300 (+0) · reprice: 380 (+80)
    await open(quote)

    // Con "mantener" no hay nada que cobrar; el bloque de cobro aparece recién al recalcular.
    expect(byTestId('charge-block')).toBeNull()

    byTestId('pricing-reprice')!.click()
    await flushPromises()

    expect(byTestId('pricing-reprice')?.getAttribute('aria-pressed')).toBe('true')
    expect(modalText()).toContain('USD 380.00')
    expect(byTestId('charge-block')).not.toBeNull()
    // El monto propuesto es el de la opción elegida (80), no el de la opción por defecto (0).
    expect(byTestId('charge-block')?.querySelector<HTMLInputElement>('input[type="number"]')?.value).toBe('80')

    vi.mocked(ReservationService.reschedule).mockResolvedValue(resultFixture({ ...quote, pricingMode: 'reprice', quotedNewPrice: 380, difference: 80 }))
    buttonByText('Confirmar').click()
    await flushPromises()

    const body = commitBody()
    expect(vi.mocked(ReservationService.reschedule).mock.calls[0][0]).toBe('res-1')
    expect(body.pricingMode).toBe('reprice')
    expect(body.charge?.method).toBe('folio')
    expect(body.charge?.amount).toBeUndefined()   // igual a la diferencia → no se manda override
  })

  it('el total baja pero el huésped NO había pagado: no hay nada que devolver, y no se pregunta', async () => {
    // Menos días (o habitación más barata): repreciar da 220 sobre un total previo de 300, pero
    // la reserva está impaga. Ese "a favor" no existe: simplemente ahora debe menos. Preguntarle
    // al recepcionista qué hacer con plata que nunca entró es cómo se devolvía de más.
    const quote = quoteFixture({ newNights: 2, checkOut: '2026-09-03', repricedTotal: 220, repricedDifference: -80, paidAmount: 0 })
    await open(quote)

    byTestId('pricing-reprice')!.click()
    await flushPromises()

    const credit = byTestId('credit-block')
    expect(credit).not.toBeNull()
    expect(credit?.textContent).toContain('El total baja')
    expect(credit?.textContent).toContain('USD 80.00')
    expect(byTestId('credit-none')).not.toBeNull()
    expect(credit?.textContent).toContain('No hay nada que devolver')
    expect(byTestId('credit-refund')).toBeNull()        // ni siquiera se ofrece devolver
    expect(byTestId('charge-block')).toBeNull()
    expect(byTestId('no-difference')).toBeNull()

    vi.mocked(ReservationService.reschedule).mockResolvedValue(resultFixture({ ...quote, pricingMode: 'reprice', quotedNewPrice: 220, difference: -80 }))
    buttonByText('Confirmar').click()
    await flushPromises()

    expect(commitBody().pricingMode).toBe('reprice')
    expect(commitBody().charge).toBeUndefined()   // no se cobra nada
    expect(commitBody().credit).toBeUndefined()   // ni se decide sobre plata inexistente
  })

  it('el huésped SÍ pagó de más: se resuelve en el mismo modal, sin ir a Finanzas', async () => {
    // Pagó los 300 y la estadía bajó a 220: hay 80 suyos de verdad.
    const quote = quoteFixture({ newNights: 2, checkOut: '2026-09-03', repricedTotal: 220, repricedDifference: -80, paidAmount: 300 })
    await open(quote)
    byTestId('pricing-reprice')!.click()
    await flushPromises()

    const credit = byTestId('credit-block')
    expect(credit?.textContent).toContain('Pagó de más')
    expect(credit?.textContent).toContain('USD 80.00')
    expect(byTestId('credit-keep')).not.toBeNull()
    expect(byTestId('credit-refund')).not.toBeNull()

    vi.mocked(ReservationService.reschedule).mockResolvedValue(resultFixture({ ...quote, pricingMode: 'reprice', quotedNewPrice: 220, difference: -80 }))
    buttonByText('Confirmar').click()
    await flushPromises()

    // Sin tocar nada va 'keep': lo único que no mueve plata.
    expect(commitBody().credit).toEqual({ action: 'keep' })
  })

  it('elegir "Devolver" viaja al backend — y el monto NO lo decide el navegador', async () => {
    const quote = quoteFixture({ newNights: 2, checkOut: '2026-09-03', repricedTotal: 220, repricedDifference: -80, paidAmount: 300 })
    await open(quote)
    byTestId('pricing-reprice')!.click()
    await flushPromises()

    byTestId('credit-refund')!.click()
    await flushPromises()

    vi.mocked(ReservationService.reschedule).mockResolvedValue(resultFixture({ ...quote, pricingMode: 'reprice', quotedNewPrice: 220, difference: -80 }))
    buttonByText('Confirmar').click()
    await flushPromises()

    expect(commitBody().credit).toEqual({ action: 'refund' })
    // Cuánta plata sale lo calcula el servidor contra lo cobrado: si el monto viajara desde acá,
    // el cliente elegiría cuánto se saca de la caja.
    expect((commitBody().credit as any).amount).toBeUndefined()
  })

  it('pagó de más pero el total SUBE: se cobra, no se pregunta por devoluciones', async () => {
    const quote = quoteFixture({ repricedTotal: 380, repricedDifference: 80, paidAmount: 300 })
    await open(quote)
    byTestId('pricing-reprice')!.click()
    await flushPromises()

    expect(byTestId('charge-block')).not.toBeNull()
    expect(byTestId('credit-block')).toBeNull()
  })

  it('avisa cuando el recálculo degradó al precio base por falta de tarifas cargadas', async () => {
    await open(quoteFixture({ repricedFromRates: false, repricedTotal: 300, repricedDifference: 0 }))

    const warning = byTestId('no-rates-warning')
    expect(warning).not.toBeNull()
    expect(warning?.textContent).toContain('no tiene tarifas cargadas')
    expect(warning?.textContent).toContain('precio base')
  })

  it('no muestra el aviso de tarifas cuando el recálculo sí salió de las tarifas del hotel', async () => {
    await open(quoteFixture({ repricedFromRates: true }))
    expect(byTestId('no-rates-warning')).toBeNull()
  })
})
