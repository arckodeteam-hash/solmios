// RoomsStep.occupancies.test.ts — El composer de huéspedes del widget embebible (feature
// adultos+niños+edades, 2026-09-02, reemplaza la matriz "Para 1/Para 2").
//
// Qué se protege acá:
//   1. Cada tarjeta arma UNA composición (adultos + niños + edad de cada niño) y muestra el
//      precio/disponibilidad de la ocupación que esa composición resuelve (`resolveChildComposition`
//      contra `store.childPolicy`, espejo del backend) — buscándola en `rt.occupancies`.
//   2. La composición que el hotel NO puede vender se muestra DESHABILITADA Y CON EL MOTIVO,
//      nunca oculta (misma regla del dueño que tenía la matriz vieja).
//   3. "Agregar esta habitación" agrega ESA composición exacta al carrito — cada click es una
//      habitación aparte, con sus propios niños (confirmado con el dueño: "si elegís 2 niños, la
//      edad del primero y del segundo aparte"; dos clicks con niños de edades distintas NO se
//      mezclan en una sola línea).
//   4. Sin `occupancies` (backend viejo o caché) el composer sigue funcionando con el precio
//      único de antes — el campo es opcional a propósito.
//   5. Un niño que no consume plaza (política del hotel) no sube el precio ni bloquea la
//      capacidad; uno que sí consume plaza cotiza como un ocupante normal.
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { mount, flushPromises, type VueWrapper } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'

vi.mock('@/services/Booking.service', () => ({
  BookingService: { getRates: vi.fn(), getCalendar: vi.fn(), getUpsells: vi.fn().mockResolvedValue([]), getMealPlans: vi.fn().mockResolvedValue([]) },
}))

import RoomsStep from './RoomsStep.vue'
import { useBookingStore } from '@/composables/useBooking'
import { useBookingI18nStore, type BookingLocale } from '@/composables/useBookingI18n'
import type { PublicRatesResponse, RoomOccupancyRate } from '@/types/booking'
import type { ChildPolicy } from '@/utils/child-composition'

/** Las 6 filas cubren las 2 vendibles y LOS CUATRO motivos de no-disponibilidad. */
function occupancies(): RoomOccupancyRate[] {
  const tax = (total: number) => [{ name: 'ITBIS', rate: 18, amount: Math.round(total * 0.18 * 100) / 100 }]
  return [
    { occupancy: 1, price: 210, pricePerNight: 70, available: true, unavailableReason: null, taxBreakdown: tax(210) },
    { occupancy: 2, price: 300, pricePerNight: 100, available: true, unavailableReason: null, taxBreakdown: tax(300) },
    { occupancy: 3, price: 0, pricePerNight: 0, available: false, unavailableReason: 'no_rate', taxBreakdown: [] },
    { occupancy: 4, price: 480, pricePerNight: 160, available: false, unavailableReason: 'no_availability', taxBreakdown: tax(480) },
    { occupancy: 5, price: 550, pricePerNight: 183.33, available: false, unavailableReason: 'stop_sell', taxBreakdown: tax(550) },
    { occupancy: 6, price: 0, pricePerNight: 0, available: false, unavailableReason: 'over_capacity', taxBreakdown: [] },
  ]
}

function ratesResponse(withMatrix: boolean): PublicRatesResponse {
  return {
    currency: 'USD',
    chargeCurrency: 'USD',
    nights: 3,
    checkIn: '2026-08-18',
    checkOut: '2026-08-21',
    taxes: [{ name: 'ITBIS', rate: 18 }],
    cancellationPolicy: null,
    cancellationSummary: null,
    roomTypes: [
      {
        id: 'familiar',
        name: 'familiar',
        fromPrice: 210,
        availableCount: 5,
        capacity: 6,
        surfaceArea: 32,
        taxBreakdown: [{ name: 'ITBIS', rate: 18, amount: 37.8 }],
        photoUrl: null,
        ...(withMatrix ? { occupancies: occupancies() } : {}),
      },
    ],
  }
}

function render(withMatrix = true, locale: BookingLocale = 'es', childPolicy?: ChildPolicy): VueWrapper {
  const store = useBookingStore()
  store.init('hotel-demo')
  store.ratesResponse = ratesResponse(withMatrix)
  if (childPolicy) store.childPolicy = childPolicy
  useBookingI18nStore().setLocale(locale)
  return mount(RoomsStep)
}

/** Todos los "+" de la tarjeta, en orden de aparición: el composer siempre renderiza
 *  Adultos primero y Niños (si `acceptChildren`) segundo — filtrar por el aria-label
 *  traducido rompería en `en`/`pt`, así que se usa el glifo del botón, que no se traduce. */
function plusButtons(w: VueWrapper) {
  return w.findAll('button').filter((b) => b.text() === '+')
}

async function bumpAdults(w: VueWrapper, times = 1): Promise<void> {
  for (let i = 0; i < times; i++) {
    await plusButtons(w)[0]!.trigger('click')
  }
}

/** Sube el stepper de "Niños" N veces (segundo "+" de la tarjeta). */
async function bumpChildren(w: VueWrapper, times = 1): Promise<void> {
  for (let i = 0; i < times; i++) {
    await plusButtons(w)[1]!.trigger('click')
  }
}

function addRoomButton(w: VueWrapper) {
  return w.findAll('button').find((b) => b.text().includes('Agregar esta habitación'))!
}

/** `addComposedRoom` es async (`await store.addToCart(...)`) y recién después resetea el
 *  composer: `trigger('click')` solo espera un nextTick, no el resto de la cadena de promesas,
 *  así que hace falta `flushPromises()` para que el reset (y el alta al carrito) ya esté aplicado
 *  antes de la siguiente aserción o del próximo bump del composer. */
async function clickAddRoom(w: VueWrapper): Promise<void> {
  await addRoomButton(w).trigger('click')
  await flushPromises()
}

describe('RoomsStep — composer de huéspedes (adultos+niños+edades)', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
  })

  it('arranca en 1 adulto y muestra el precio de "para 1"', () => {
    const w = render()
    expect(w.text()).toContain('210')
    expect(w.text()).toContain('70')
    expect(w.get('[data-occupancy]').attributes('data-occupancy')).toBe('1')
    w.unmount()
  })

  it('subir adultos a 2 recalcula la ocupación y el precio en vivo', async () => {
    const w = render()
    await bumpAdults(w, 1) // 1 → 2

    expect(w.get('[data-occupancy]').attributes('data-occupancy')).toBe('2')
    expect(w.text()).toContain('300')
    w.unmount()
  })

  // Un caso por motivo: el backend tiene CUATRO y traducir tres deja al huésped mirando un texto
  // mudo (o un código en inglés) en el caso que falte.
  const reasons: Array<{ adults: number; texto: string }> = [
    { adults: 3, texto: 'Sin tarifa para esta ocupación' },
    { adults: 4, texto: 'Sin disponibilidad en estas fechas' },
    { adults: 5, texto: 'Cerrada a la venta' },
    { adults: 6, texto: 'Supera la capacidad de la habitación' },
  ]

  for (const r of reasons) {
    it(`ocupación no vendible (${r.texto}) se muestra DESHABILITADA y con el motivo, "Agregar" deshabilitado`, async () => {
      const w = render()
      await bumpAdults(w, r.adults - 1)

      expect(w.text()).toContain(r.texto)
      expect(w.text()).not.toMatch(/no_rate|no_availability|stop_sell|over_capacity/)
      expect((addRoomButton(w).element as HTMLButtonElement).disabled).toBe(true)
      w.unmount()
    })
  }

  it('agregar una composición propaga ESA ocupación y ESE precio al carrito', async () => {
    const w = render()
    const store = useBookingStore()
    await bumpAdults(w, 1) // 2 adultos → "para 2" → $300

    await clickAddRoom(w)

    expect(store.cart).toHaveLength(1)
    expect(store.cart[0]!.roomType).toBe('familiar')
    expect(store.cart[0]!.occupancy).toBe(2)
    expect(store.cart[0]!.adults).toBe(2)
    expect(store.cart[0]!.childrenAges).toEqual([])
    expect(store.roomsSubtotal).toBe(300)
    expect(store.roomsValid).toBe(true)
    w.unmount()
  })

  it('agregar dos veces con distinta composición crea DOS líneas separadas (no se mezclan)', async () => {
    const w = render()
    const store = useBookingStore()

    await clickAddRoom(w) // 1 adulto → "para 1" → $210
    await bumpAdults(w, 1) // el composer sigue vivo tras el reset → 1→2
    await clickAddRoom(w) // 2 adultos → "para 2" → $300

    expect(store.cart).toHaveLength(2)
    expect(store.cart.map((l) => l.occupancy).sort()).toEqual([1, 2])
    expect(store.roomsSubtotal).toBe(510)
    w.unmount()
  })

  it('el composer se resetea a 1 adulto / 0 niños después de agregar', async () => {
    const w = render()
    await bumpAdults(w, 1) // 2 adultos
    await clickAddRoom(w)

    // Volvió a "para 1" ($210), no se quedó en 2.
    expect(w.get('[data-occupancy]').attributes('data-occupancy')).toBe('1')
    expect(w.text()).toContain('210')
    w.unmount()
  })

  // ── Requerimiento 9 (Cantidad de habitaciones, 2026-09-03) ─────────────────────────────────
  // Huéspedes y habitaciones son conceptos DISTINTOS: el composer es estado local por tarjeta,
  // separado del carrito. Nada de lo que pasa en el composer (subir adultos/niños) toca
  // `store.cart` hasta el click explícito en "Agregar esta habitación".
  describe('huéspedes ≠ habitaciones', () => {
    it('subir adultos y niños NO agrega nada al carrito por sí solo', async () => {
      const w = render()
      const store = useBookingStore()

      await bumpAdults(w, 2) // 1 → 3 adultos, sin tocar "Agregar"
      await bumpChildren(w, 1)

      expect(store.cart).toHaveLength(0)
      w.unmount()
    })

    it('agregar la MISMA composición dos veces suma cantidad a UNA sola línea (no la reemplaza ni la duplica)', async () => {
      const w = render()
      const store = useBookingStore()

      await clickAddRoom(w) // 1 adulto → línea nueva, quantity=1
      await clickAddRoom(w) // MISMA composición otra vez → misma línea, quantity=2

      expect(store.cart).toHaveLength(1)
      expect(store.cart[0]!.quantity).toBe(2)
      expect(store.cart[0]!.adults).toBe(1)
      expect(store.roomsSubtotal).toBe(420) // 210 × 2 — ni se pisó ni se cobró como si fuera 1
      w.unmount()
    })

    it('eliminar una línea NO afecta a las demás — quita solo esa unidad', async () => {
      const w = render()
      const store = useBookingStore()

      await clickAddRoom(w) // línea A: 1 adulto → "para 1"
      await bumpAdults(w, 1)
      await clickAddRoom(w) // línea B: 2 adultos → "para 2"
      expect(store.cart).toHaveLength(2)
      const [lineA, lineB] = store.cart

      store.removeCartLine(lineA!.key)

      expect(store.cart).toHaveLength(1)
      expect(store.cart[0]!.key).toBe(lineB!.key)
      expect(store.cart[0]!.adults).toBe(2)
      w.unmount()
    })

    it('el resumen de cantidad de habitaciones refleja las líneas REALES del carrito, sumando cantidad por línea', async () => {
      const w = render()
      const store = useBookingStore()

      await clickAddRoom(w) // línea A: quantity 1
      await clickAddRoom(w) // MISMA composición → línea A pasa a quantity 2
      await bumpAdults(w, 1)
      await clickAddRoom(w) // línea B: quantity 1, composición distinta

      // 2 líneas, pero 3 UNIDADES reales (2 de la línea A + 1 de la B).
      expect(store.cart).toHaveLength(2)
      expect(store.cartTotalRooms).toBe(3)
      w.unmount()
    })
  })

  // ── Requerimiento 10 (Varias habitaciones, 2026-09-03) ──────────────────────────────────────
  // Cada habitación del carrito conserva SU composición — el ejemplo del pedido: Habitación 1 (2
  // adultos + niño de 2), Habitación 2 (1 adulto + niños de 6 y 10).
  describe('varias habitaciones — composición independiente por línea', () => {
    it('seguir tocando el composer DESPUÉS de agregar no muta la línea ya agregada (snapshot exacto)', async () => {
      const w = render(true, 'es', { acceptChildren: true, maxChildAge: 12, maxFreeAge: 3 })
      const store = useBookingStore()

      await bumpAdults(w, 1) // 2 adultos
      await bumpChildren(w, 1)
      await w.get('select').setValue('2') // niño de 2 (libre)
      await clickAddRoom(w) // Habitación 1: {adults:2, childrenAges:[2]}
      const snapshotA = { ...store.cart[0]! }

      // El composer sigue vivo (se reseteó a 1/0, pero el huésped lo vuelve a tocar para la 2ª
      // habitación): esto NO puede reescribir la Habitación 1 ya agregada.
      await bumpChildren(w, 2)
      const selects = w.findAll('select')
      await selects[0]!.setValue('6')
      await selects[1]!.setValue('10')

      expect(store.cart).toHaveLength(1) // todavía no se agregó la 2ª — solo se tocó el composer
      expect(store.cart[0]).toEqual(snapshotA) // la línea 1 sigue IDÉNTICA, byte a byte
      w.unmount()
    })

    it('ejemplo del pedido: Habitación 1 (2 adultos + niño de 2) y Habitación 2 (1 adulto + niños de 6 y 10) mantienen edades separadas', async () => {
      const w = render(true, 'es', { acceptChildren: true, maxChildAge: 12, maxFreeAge: 3 })
      const store = useBookingStore()
      // Habitación 2 cotiza "para 3" (1 adulto + 2 niños con plaza) — el fixture de este archivo
      // solo trae 1 y 2 vendibles por defecto; se habilita 3 acá para poder agregarla.
      store.ratesResponse!.roomTypes[0]!.occupancies![2] = {
        occupancy: 3, price: 400, pricePerNight: 133.33, available: true, unavailableReason: null, taxBreakdown: [],
      }

      // Habitación 1: 2 adultos + niño de 2 (libre).
      await bumpAdults(w, 1)
      await bumpChildren(w, 1)
      await w.get('select').setValue('2')
      await clickAddRoom(w)

      // Habitación 2: 1 adulto (default tras el reset) + niños de 6 y 10 (ambos con plaza).
      await bumpChildren(w, 2)
      const selects = w.findAll('select')
      await selects[0]!.setValue('6')
      await selects[1]!.setValue('10')
      await clickAddRoom(w)

      expect(store.cart).toHaveLength(2)
      const [room1, room2] = store.cart
      expect(room1!.adults).toBe(2)
      expect(room1!.childrenAges).toEqual([2])
      expect(room2!.adults).toBe(1)
      expect(room2!.childrenAges).toEqual([6, 10])
      // Ninguna edad de una habitación aparece en la otra.
      expect(room1!.childrenAges!.some((a) => room2!.childrenAges!.includes(a))).toBe(false)
    })

    it('mismos adultos, EDADES distintas: no se agrupan en una sola línea con quantity — son habitaciones distintas', async () => {
      const w = render(true, 'es', { acceptChildren: true, maxChildAge: 12, maxFreeAge: 0 })
      const store = useBookingStore()

      await bumpChildren(w, 1) // 1 adulto (default) + 1 niño
      await w.get('select').setValue('5')
      await clickAddRoom(w)

      await bumpChildren(w, 1) // otra vez 1 adulto + 1 niño, pero edad DISTINTA
      await w.get('select').setValue('9')
      await clickAddRoom(w)

      expect(store.cart).toHaveLength(2) // NO quantity:2 en una sola línea
      expect(store.cart[0]!.quantity).toBe(1)
      expect(store.cart[1]!.quantity).toBe(1)
      expect(store.cart.map((l) => l.childrenAges).sort()).toEqual([[5], [9]])
    })

    it('cada habitación se valida de forma independiente: una inválida no bloquea agregar otra válida', async () => {
      const w = render() // fixture: solo occupancy 1 y 2 vendibles
      const store = useBookingStore()

      await bumpAdults(w, 5) // 6 adultos → over_capacity, "Agregar" apagado
      expect((addRoomButton(w).element as HTMLButtonElement).disabled).toBe(true)

      // Bajar directo con el stepper "−" hasta una composición válida.
      const minusAdults = w.findAll('button').filter((b) => b.text() === '−')[0]!
      for (let i = 0; i < 5; i++) await minusAdults.trigger('click')
      expect((addRoomButton(w).element as HTMLButtonElement).disabled).toBe(false)

      await clickAddRoom(w)
      expect(store.cart).toHaveLength(1)
    })
  })

  it('sin `occupancies` degrada al precio único de siempre (backend viejo / caché)', async () => {
    const w = render(false)
    const store = useBookingStore()

    // Sin matriz, sin filas data-occupancy — pero el composer y el precio único siguen andando.
    expect(w.findAll('[data-occupancy]')).toHaveLength(1) // el span que envuelve precio/botón sigue existiendo, sin fila de matriz
    expect(w.text()).toContain('Familiar')
    expect(w.text()).toContain('210')

    await clickAddRoom(w)

    expect(store.cart).toHaveLength(1)
    expect(store.cart[0]!.roomType).toBe('familiar')
    expect(store.cart[0]!.occupancy).toBe(1)
    expect(store.roomsSubtotal).toBe(210) // fromPrice, exactamente como antes
    expect(store.roomsValid).toBe(true)
    w.unmount()
  })

  it('[en] traduce los motivos de no-disponibilidad', async () => {
    const w = render(true, 'en')
    await bumpAdults(w, 2) // → 3 adultos, no_rate
    expect(w.text()).toContain('No rate for this occupancy')
    w.unmount()
  })

  it('[pt] traduce los motivos de no-disponibilidad', async () => {
    const w = render(true, 'pt')
    await bumpAdults(w, 2)
    expect(w.text()).toContain('Sem tarifa para esta ocupação')
    w.unmount()
  })

  // ─── Niños: libres vs. con plaza (política del hotel) ────────────────────────────────────
  describe('niños según la política del hotel', () => {
    const POLICY: ChildPolicy = { acceptChildren: true, maxChildAge: 12, maxFreeAge: 3 }

    it('un niño que NO consume plaza no sube el precio (sigue en "para 2")', async () => {
      const w = render(true, 'es', POLICY)
      await bumpAdults(w, 1) // 2 adultos
      await bumpChildren(w, 1) // 1 niño, edad default 0 → libre (≤3)

      expect(w.get('[data-occupancy]').attributes('data-occupancy')).toBe('2')
      expect(w.text()).toContain('300')
      w.unmount()
    })

    it('un niño que SÍ consume plaza cotiza como un ocupante más ("para 3")', async () => {
      const w = render(true, 'es', POLICY)
      const store = useBookingStore()
      await bumpAdults(w, 1) // 2 adultos
      await bumpChildren(w, 1) // 1 niño
      // Subir su edad a 8 (con plaza): el <select> es el único de la tarjeta.
      await w.get('select').setValue('8')

      expect(w.get('[data-occupancy]').attributes('data-occupancy')).toBe('3')
      expect(w.text()).toContain('Sin tarifa para esta ocupación') // ocupancy=3 no está cargada en el fixture
      expect((addRoomButton(w).element as HTMLButtonElement).disabled).toBe(true)
      expect(store.cart).toHaveLength(0)
      w.unmount()
    })

    it('agregar la habitación con niño incluye sus edades en la línea del carrito', async () => {
      const w = render(true, 'es', POLICY)
      const store = useBookingStore()
      await bumpChildren(w, 1) // 1 adulto + 1 niño de 0 años (libre) → sigue en "para 1"
      await clickAddRoom(w)

      expect(store.cart).toHaveLength(1)
      expect(store.cart[0]!.adults).toBe(1)
      expect(store.cart[0]!.childrenAges).toEqual([0])
      expect(store.cart[0]!.occupancy).toBe(1) // niño libre: no sube la ocupación chargeable
      w.unmount()
    })

    it('sin política de niños activada (acceptChildren: false) no ofrece agregar niños', () => {
      const w = render(true, 'es', { acceptChildren: false, maxChildAge: 12, maxFreeAge: 3 })
      expect(w.text()).not.toContain('Niños')
      w.unmount()
    })

    // ── Requerimiento 4 (Edad de los niños, 2026-09-03) ──────────────────────────────────────
    it('el desplegable de edad respeta maxChildAge del hotel: NO ofrece 0-17 fijo', async () => {
      const w = render(true, 'es', POLICY) // maxChildAge: 12
      await bumpChildren(w, 1)

      const options = w.get('select').findAll('option').map((o) => o.attributes('value'))
      expect(options).toEqual(Array.from({ length: 13 }, (_, i) => String(i))) // 0..12
      expect(options).not.toContain('17')
      w.unmount()
    })

    it('maxChildAge=0 (caso borde): el desplegable ofrece una sola opción, "0"', async () => {
      const w = render(true, 'es', { acceptChildren: true, maxChildAge: 0, maxFreeAge: 0 })
      await bumpChildren(w, 1)

      const options = w.get('select').findAll('option').map((o) => o.attributes('value'))
      expect(options).toEqual(['0'])
      w.unmount()
    })

    it('dos habitaciones con niños de EDADES DISTINTAS: cada línea del carrito conserva las suyas', async () => {
      const w = render(true, 'es', POLICY) // maxChildAge:12, maxFreeAge:3 — solo occ. 1 y 2 son vendibles en este fixture
      const store = useBookingStore()

      // Habitación 1: 1 adulto + 1 niño de 8 (con plaza) → chargeable 1+1=2 (available, $300).
      await bumpChildren(w, 1)
      await w.get('select').setValue('8')
      await clickAddRoom(w)

      // El composer se resetea tras agregar — arma la segunda composición desde cero.
      // Habitación 2: 1 adulto + niños de 1 (libre, ≤3) y 9 (con plaza) → chargeable 1+1=2.
      await bumpChildren(w, 2)
      const selects = w.findAll('select')
      await selects[0]!.setValue('1')
      await selects[1]!.setValue('9')
      await clickAddRoom(w)

      expect(store.cart).toHaveLength(2)
      expect(store.cart[0]!.adults).toBe(1)
      expect(store.cart[0]!.childrenAges).toEqual([8])
      expect(store.cart[1]!.adults).toBe(1)
      expect(store.cart[1]!.childrenAges).toEqual([1, 9])
      // Ninguna línea heredó las edades de la otra (dato huérfano entre habitaciones) — dos
      // líneas separadas, no una sola "×2" con la composición mezclada.
      expect(store.cart[0]!.childrenAges).not.toEqual(store.cart[1]!.childrenAges)
      w.unmount()
    })
  })

  it('sin regímenes configurados: "Sólo alojamiento" activo y los 3 códigos deshabilitados', () => {
    const w = render()
    const text = w.text()

    expect(text).toContain('Sólo alojamiento')
    expect(text).toContain('Desayuno incluido')
    expect(text).toContain('Desayuno y cena')
    expect(text).toContain('Todo incluido')
    const boardButtons = w.findAll('button').filter((b) => /Desayuno incluido|Desayuno y cena|Todo incluido/.test(b.text()))
    expect(boardButtons).toHaveLength(0)
    w.unmount()
  })

  it('régimen incluido en la tarifa: se muestra activo (mismo estilo que "Sólo alojamiento")', () => {
    const store = useBookingStore()
    store.init('hotel-demo')
    store.ratesResponse = ratesResponse(true)
    store.mealPlans = [{ code: 'breakfast', priceMode: 'included', price: 0 }]
    const w = mount(RoomsStep)

    const pill = w.findAll('span').find((s) => s.text().includes('Desayuno incluido'))
    expect(pill).toBeTruthy()
    expect(pill!.classes().join(' ')).toContain('bg-navy')
    w.unmount()
  })

  // ─── Requerimiento 6 (Validación de capacidad, 2026-09-03) ────────────────────────────────
  // occupancy-matrix.ts (backend) solo conoce el NÚMERO de ocupación, no maxAdults/maxChildren:
  // una fila puede decir "disponible, $300" aunque la composición exceda el máximo del tipo. Sin
  // `capacityBlockReason`, el botón quedaba apagado con un precio arriba y sin explicar por qué
  // — la regla del dueño (nunca callar un rechazo) se rompía justo en este caso.
  describe('maxAdults/maxChildren no vienen codificados en la matriz — capacityBlockReason', () => {
    it('excede maxAdults en una ocupación que la matriz SÍ marca disponible: motivo, no precio', async () => {
      const w = render() // fixture: occupancy=2 disponible, $300
      const store = useBookingStore()
      store.ratesResponse!.roomTypes[0]!.maxAdults = 1
      await bumpAdults(w, 1) // 1 → 2 adultos, dentro de la matriz pero excede maxAdults=1

      expect(w.get('[data-occupancy]').attributes('data-occupancy')).toBe('2')
      expect(w.text()).toContain('Supera el máximo de adultos de esta habitación')
      expect(w.text()).not.toContain('300') // NO se muestra el precio de una fila que no se puede agregar
      expect((addRoomButton(w).element as HTMLButtonElement).disabled).toBe(true)
      w.unmount()
    })

    it('excede maxChildren en una ocupación que la matriz SÍ marca disponible: motivo, no precio', async () => {
      const w = render(true, 'es', { acceptChildren: true, maxChildAge: 12, maxFreeAge: 0 })
      const store = useBookingStore()
      store.ratesResponse!.roomTypes[0]!.maxChildren = 0
      await bumpChildren(w, 1)
      await w.get('select').setValue('5') // > maxFreeAge=0 → con plaza → occupancy 2, disponible en la matriz

      expect(w.get('[data-occupancy]').attributes('data-occupancy')).toBe('2')
      expect(w.text()).toContain('Supera el máximo de niños de esta habitación')
      expect((addRoomButton(w).element as HTMLButtonElement).disabled).toBe(true)
      w.unmount()
    })

    it('dentro de maxAdults/maxChildren: sigue mostrando el precio normalmente (sin falsos positivos)', async () => {
      const w = render()
      const store = useBookingStore()
      store.ratesResponse!.roomTypes[0]!.maxAdults = 2
      await bumpAdults(w, 1) // 2 adultos, dentro del máximo

      expect(w.text()).toContain('300')
      expect(w.text()).not.toContain('máximo de adultos')
      expect((addRoomButton(w).element as HTMLButtonElement).disabled).toBe(false)
      w.unmount()
    })
  })

  it('el precio del régimen con costo usa chargeCurrency, NUNCA displayCurrency (D10)', () => {
    const store = useBookingStore()
    store.init('hotel-demo')
    const res = ratesResponse(true)
    res.currency = 'EUR'
    res.chargeCurrency = 'USD'
    store.ratesResponse = res
    store.mealPlans = [{ code: 'all_inclusive', priceMode: 'per_person_per_night', price: 45 }]
    const w = mount(RoomsStep)

    const pill = w.findAll('span').find((s) => s.text().includes('Todo incluido'))
    expect(pill!.attributes('title')).toContain('US$')
    expect(pill!.attributes('title')).not.toContain('€')
    w.unmount()
  })
})
