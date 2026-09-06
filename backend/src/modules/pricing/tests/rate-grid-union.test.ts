// rate-grid-union.test.ts — La grilla de tarifas muestra TODO lo tarifable, no solo lo guardado.
//
// Regresión de un bug que se reportó como tres bugs distintos en /panel/channel/:id y en
// /panel/config/tarifas: aparecía un solo tipo de habitación, dos temporadas de cuatro, y una sola
// ocupación. Los tres salían de lo mismo — `listBaseRates`/`listChannelRates` devolvían la grilla
// derivada SOLO cuando no había ninguna fila guardada, así que la primera tarifa que el hotel
// guardaba tapaba todo el resto de la grilla y lo dejaba inalcanzable desde la UI.
import { describe, it, expect } from 'bun:test'
import { PricingQueries } from '../usecases/pricing-queries'

const SEASONS = ['baja', 'media', 'alta', 'especial']

/**
 * ORM del hotel de certificación reducido a lo que importa: 4 tipos de habitación, 4 temporadas y
 * tarifas guardadas SOLO para `double` en dos de las cuatro temporadas.
 */
function makeOrm(opts: { rates?: any[] } = {}) {
  const rates = opts.rates ?? [
    { id: 'r1', hotelId: 'h1', roomType: 'double', occupancy: 2, season: 'media', channel: '', basePrice: 110, percentage: 35, price: 148.5, closed: 0, minStay: 2, maxStay: 0 },
    { id: 'r2', hotelId: 'h1', roomType: 'double', occupancy: 2, season: 'especial', channel: '', basePrice: 110, percentage: 25, price: 137.5, closed: 0, minStay: 0, maxStay: 0 },
  ]
  return {
    findMany: async (table: string) => {
      if (table === 'Seasons') return SEASONS.map((name, i) => ({ id: `s${i}`, hotelId: 'h1', name, sortOrder: i }))
      if (table === 'RoomRates') return rates
      if (table === 'Rooms') return [
        { id: 'rm1', hotelId: 'h1', type: 'double', capacity: 2, basePrice: 110 },
        { id: 'rm2', hotelId: 'h1', type: 'single', capacity: 1, basePrice: 65 },
        { id: 'rm3', hotelId: 'h1', type: 'suite', capacity: 2, basePrice: 120 },
        { id: 'rm4', hotelId: 'h1', type: 'triple', capacity: 3, basePrice: 130 },
      ]
      return []
    },
    create: async (_t: string, d: any) => d,
    update: async () => {},
    delete: async () => {},
  }
}

const key = (r: any) => `${r.roomType}|${r.occupancy}|${r.season}`

describe('listBaseRates — la grilla completa, no solo lo guardado', () => {
  it('lista los CUATRO tipos de habitación aunque solo uno tenga tarifa guardada', async () => {
    const rows = await new PricingQueries(makeOrm() as any).listBaseRates('h1')
    expect([...new Set(rows.map((r: any) => r.roomType))].sort()).toEqual(['double', 'single', 'suite', 'triple'])
  })

  it('lista las CUATRO temporadas aunque solo dos tengan tarifa guardada', async () => {
    const rows = await new PricingQueries(makeOrm() as any).listBaseRates('h1')
    const deDouble = [...new Set(rows.filter((r: any) => r.roomType === 'double').map((r: any) => r.season))].sort()
    expect(deDouble).toEqual(['alta', 'baja', 'especial', 'media'])
  })

  it('devuelve la fila REAL donde existe (con su id y su %), no una derivada que la pise', async () => {
    const rows = await new PricingQueries(makeOrm() as any).listBaseRates('h1')
    const real = rows.find((r: any) => key(r) === 'double|2|media')
    expect(real).toMatchObject({ id: 'r1', percentage: 35, price: 148.5, minStay: 2 })
    expect(real._inherited).toBeUndefined()
  })

  it('una celda nueva hereda el precio base del grupo, no arranca en cero', async () => {
    const rows = await new PricingQueries(makeOrm() as any).listBaseRates('h1')
    const nueva = rows.find((r: any) => key(r) === 'double|2|baja')
    expect(nueva).toMatchObject({ basePrice: 110, percentage: 0, _inherited: true })
  })

  it('un tipo sin ninguna tarifa cae al basePrice de su habitación', async () => {
    const rows = await new PricingQueries(makeOrm() as any).listBaseRates('h1')
    expect(rows.find((r: any) => key(r) === 'single|1|alta')).toMatchObject({ basePrice: 65, _inherited: true })
  })

  it('no duplica: exactamente una fila por (tipo, ocupación, temporada)', async () => {
    const rows = await new PricingQueries(makeOrm() as any).listBaseRates('h1')
    expect(rows.length).toBe(new Set(rows.map(key)).size)
    // Ocupaciones 1..capacidad: double 2 + single 1 + suite 2 + triple 3 = 8 grupos × 4 temporadas.
    expect(rows.length).toBe(8 * 4)
  })

  it('una fila guardada que ya no entra en la grilla se devuelve igual — esconderla la borraría de la vista sin sacarla de la base', async () => {
    const orm = makeOrm({ rates: [
      { id: 'viejo', hotelId: 'h1', roomType: 'bungalow', occupancy: 2, season: 'media', channel: '', basePrice: 500, percentage: 0, price: 500 },
    ] })
    const rows = await new PricingQueries(orm as any).listBaseRates('h1')
    expect(rows.find((r: any) => r.id === 'viejo')).toBeTruthy()
  })
})

// El hotel tarifa SIEMPRE por persona: no hay modo "por habitación" ni switch que lo cambie.
describe('ocupaciones — siempre una fila por persona', () => {
  it('expande una fila por ocupación 1..capacidad, con las guardadas intactas', async () => {
    const rows = await new PricingQueries(makeOrm() as any).listBaseRates('h1')
    const dobleMedia = rows.filter((r: any) => r.roomType === 'double' && r.season === 'media')
    expect(dobleMedia.map((r: any) => r.occupancy).sort()).toEqual([1, 2])
    expect(dobleMedia.find((r: any) => r.occupancy === 2)!.id).toBe('r1')   // la guardada, no pisada
  })

  it('la ocupación nueva arranca con el MISMO precio y el mismo % que la ya cargada', async () => {
    const rows = await new PricingQueries(makeOrm() as any).listBaseRates('h1')
    const unaPersona = rows.find((r: any) => key(r) === 'double|1|media')
    // basePrice del grupo (110) y % de la temporada (35) → el mismo precio que 2 personas.
    expect(unaPersona).toMatchObject({ basePrice: 110, percentage: 35, price: 148.5, _inherited: true })
  })

  it('triple (capacidad 3) abre 1, 2 y 3', async () => {
    const rows = await new PricingQueries(makeOrm() as any).listBaseRates('h1')
    const triple = rows.filter((r: any) => r.roomType === 'triple' && r.season === 'baja')
    expect(triple.map((r: any) => r.occupancy).sort()).toEqual([1, 2, 3])
  })
})

describe('listChannelRates — misma grilla, con el override del canal donde exista', () => {
  const conOverride = () => makeOrm({ rates: [
    { id: 'r1', hotelId: 'h1', roomType: 'double', occupancy: 2, season: 'media', channel: '', basePrice: 110, percentage: 35, price: 148.5, closed: 0, minStay: 0, maxStay: 0 },
    { id: 'ov1', hotelId: 'h1', roomType: 'double', occupancy: 2, season: 'alta', channel: 'booking', basePrice: 110, percentage: 60, price: 176, closed: 0, minStay: 0, maxStay: 0 },
  ] })

  it('el canal también ve los cuatro tipos y las cuatro temporadas', async () => {
    const rows = await new PricingQueries(conOverride() as any).listChannelRates('h1', 'booking')
    expect([...new Set(rows.map((r: any) => r.roomType))].sort()).toEqual(['double', 'single', 'suite', 'triple'])
    expect([...new Set(rows.map((r: any) => r.season))].sort()).toEqual(['alta', 'baja', 'especial', 'media'])
  })

  it('donde hay override del canal, gana el override', async () => {
    const rows = await new PricingQueries(conOverride() as any).listChannelRates('h1', 'booking')
    expect(rows.find((r: any) => key(r) === 'double|2|alta')).toMatchObject({ id: 'ov1', percentage: 60 })
  })

  // El PRECIO heredado es el de la temporada (lo que el push publica para esa celda). El porcentaje
  // que se muestra es el del CANAL, y sin override es 0: mostrar el 35 de la temporada haría que el
  // editor ofreciera "+35%" sobre un precio que ya lo incluye, y al guardar lo aplicaría dos veces.
  it('sin override, la celda hereda el PRECIO de la temporada, con 0% de recargo del canal', async () => {
    const rows = await new PricingQueries(conOverride() as any).listChannelRates('h1', 'booking')
    const heredada = rows.find((r: any) => key(r) === 'double|2|media')
    expect(heredada).toMatchObject({ channel: 'booking', basePrice: 110, percentage: 0, price: 148.5, _inherited: true })
  })

  it('una celda heredada NO arrastra el id de la fila base (un guardado la pisaría)', async () => {
    const rows = await new PricingQueries(conOverride() as any).listChannelRates('h1', 'booking')
    expect(rows.find((r: any) => key(r) === 'double|2|media')!.id).toBeUndefined()
  })
})
