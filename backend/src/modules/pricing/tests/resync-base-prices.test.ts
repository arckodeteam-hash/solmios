// pricing/tests/resync-base-prices.test.ts — El espejo `room_rates` sigue al precio de la habitación.
//
// El agujero que cierra: cambiar el precio desde /panel/habitaciones escribe `rooms` y no toca
// `room_rates`. El panel y el push a Channex derivan al vuelo, pero el motor de reservas cotiza la
// fila guardada (`shared/utils/rate-resolution.ts:ratePrice`) — con base 220 → 120 y +70%, la OTA
// pasaba a publicar 204 mientras la web propia seguía cobrando 374.

import { describe, it, expect } from 'bun:test'
import { resyncBasePrices, type ResyncBasePricesDeps } from '../usecases/resync-base-prices'
import { ratePrice } from '../../../shared/utils/rate-resolution'

function makeDeps(rooms: Array<{ type: string; basePrice: number }>, rates: any[]) {
  const updates: Array<{ id: string; patch: { basePrice: number; price: number } }> = []
  const deps: ResyncBasePricesDeps = {
    roomTypes: async () => rooms,
    listRates: async () => rates,
    updateRate: async (id, patch) => { updates.push({ id, patch }); Object.assign(rates.find((r) => r.id === id), patch) },
  }
  return { deps, updates, rates }
}

const SUITE_VIEJA = { id: 'r1', roomType: 'suite', season: 'alta', occupancy: 2, channel: '', basePrice: 220, percentage: 70, price: 374 }

describe('resyncBasePrices', () => {
  it('reescribe basePrice y price con el precio nuevo de la habitación', async () => {
    const { deps, updates } = makeDeps([{ type: 'suite', basePrice: 120 }], [{ ...SUITE_VIEJA }])
    expect(await resyncBasePrices(deps, 'h1')).toBe(1)
    expect(updates[0]!.patch).toEqual({ basePrice: 120, price: 204 })
  })

  it('el motor de reservas cotiza lo mismo que publica la OTA', async () => {
    const { deps, rates } = makeDeps([{ type: 'suite', basePrice: 120 }], [{ ...SUITE_VIEJA }])
    await resyncBasePrices(deps, 'h1')
    // `ratePrice` es la función que usan bookingengine, quote y reprice.
    expect(ratePrice(rates[0])).toBe(204)
  })

  it('el porcentaje de la temporada no se toca', async () => {
    const { deps, rates } = makeDeps([{ type: 'suite', basePrice: 120 }], [{ ...SUITE_VIEJA }])
    await resyncBasePrices(deps, 'h1')
    expect(rates[0].percentage).toBe(70)
  })

  it('alcanza también a las filas de CANAL, no solo a la base', async () => {
    const { deps, updates } = makeDeps([{ type: 'suite', basePrice: 120 }], [
      { ...SUITE_VIEJA },
      { ...SUITE_VIEJA, id: 'r2', channel: 'booking', percentage: 100, price: 440 },
    ])
    expect(await resyncBasePrices(deps, 'h1')).toBe(2)
    expect(updates[1]!.patch).toEqual({ basePrice: 120, price: 240 })
  })

  it('no escribe nada si ya estaban alineadas', async () => {
    const { deps, updates } = makeDeps([{ type: 'suite', basePrice: 120 }],
      [{ ...SUITE_VIEJA, basePrice: 120, price: 204 }])
    expect(await resyncBasePrices(deps, 'h1')).toBe(0)
    expect(updates).toHaveLength(0)
  })

  // Un tipo borrado deja filas que el editor sigue mostrando y la OTA sigue vendiendo: pisarlas con
  // un 0 las publicaría gratis (misma regla que `basePriceFor`).
  it('deja intactas las filas de un tipo que ya no existe', async () => {
    const { deps, updates } = makeDeps([{ type: 'double', basePrice: 80 }], [{ ...SUITE_VIEJA }])
    expect(await resyncBasePrices(deps, 'h1')).toBe(0)
    expect(updates).toHaveLength(0)
  })

  it('un hotel sin habitaciones con precio no mueve ninguna tarifa', async () => {
    const { deps, updates } = makeDeps([{ type: 'suite', basePrice: 0 }], [{ ...SUITE_VIEJA }])
    expect(await resyncBasePrices(deps, 'h1')).toBe(0)
    expect(updates).toHaveLength(0)
  })

  // `roomTypesFor` devuelve una fila por ocupación con el mismo base; varias unidades del tipo a
  // precios distintos resuelven al mínimo positivo, igual que el panel y que el push.
  it('con varias unidades del tipo toma el mínimo positivo', async () => {
    const { deps, updates } = makeDeps(
      [{ type: 'suite', basePrice: 200 }, { type: 'suite', basePrice: 120 }], [{ ...SUITE_VIEJA }])
    await resyncBasePrices(deps, 'h1')
    expect(updates[0]!.patch.basePrice).toBe(120)
  })
})
