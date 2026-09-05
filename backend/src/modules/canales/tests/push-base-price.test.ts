// canales/tests/push-base-price.test.ts — Lo que se PUBLICA usa el precio base de la habitación.
//
// El hueco que fija este archivo apareció al derivar el base solo en el panel: `push-rates.ts` lee
// `RoomRates` crudo desde el ORM, sin pasar por `PricingQueries`, así que el panel mostraba el
// precio nuevo y la OTA seguía vendiendo el viejo. Es la misma discrepancia que el fix vino a
// cerrar, corrida un paso más adelante — y la que aparece igual cuando el precio se cambia desde
// `/panel/habitaciones`, que no reescribe `room_rates`.

import { describe, it, expect } from 'bun:test'
import { pushSeasonalRatesToChannex } from '../usecases/push-rates'

interface Captured { roomType: string; season: string; occupancy: number; basePrice: number; percentage: number }

/** Deps mínimas: una suite a $120 en `Rooms` y una fila de tarifas con el base viejo grabado. */
function makeDeps(roomBasePrice: number, savedBasePrice: number) {
  const captured: { rates: Captured[] } = { rates: [] }
  const deps = {
    getConfig: async () => ({ apiKey: 'k', propertyId: 'p', baseUrl: 'https://x' }),
    findMany: async (model: string) => {
      if (model === 'RoomRates') {
        return [{ roomType: 'suite', season: 'alta', occupancy: 2, channel: '', basePrice: savedBasePrice, percentage: 70, closed: 0, minStay: 0, maxStay: 0 }]
      }
      if (model === 'Rooms') return [{ id: 'rm1', type: 'suite', capacity: 2, basePrice: roomBasePrice }]
      if (model === 'Seasons') return [{ id: 's1', name: 'alta', label: 'Alta', startDate: '2026-01-01', endDate: '2026-03-31' }]
      return []
    },
    pushSeasonalRates: async (_cfg: any, rates: Captured[]) => {
      captured.rates = rates
      return { pushed: rates.length, skipped: 0 }
    },
  } as any
  return { deps, captured }
}

describe('push a Channex — el base publicado es el de la habitación', () => {
  it('descarta el basePrice grabado en la fila y usa el del tipo', async () => {
    // 220 es lo que la fila del canal tenía en producción; la habitación vale 120.
    const { deps, captured } = makeDeps(120, 220)
    await pushSeasonalRatesToChannex(deps, 'h1')
    expect(captured.rates[0]!.basePrice).toBe(120)
  })

  it('cambiar el precio de la habitación cambia lo que se publica', async () => {
    const { deps, captured } = makeDeps(150, 220)
    await pushSeasonalRatesToChannex(deps, 'h1')
    expect(captured.rates[0]!.basePrice).toBe(150)
  })

  it('el porcentaje de la temporada viaja intacto: solo el base se deriva', async () => {
    const { deps, captured } = makeDeps(120, 220)
    await pushSeasonalRatesToChannex(deps, 'h1')
    expect(captured.rates[0]!.percentage).toBe(70)
  })

  it('un tipo sin habitación conserva el base grabado (la OTA lo sigue vendiendo)', async () => {
    const { deps, captured } = makeDeps(0, 175)
    await pushSeasonalRatesToChannex(deps, 'h1')
    expect(captured.rates[0]!.basePrice).toBe(175)
  })
})
