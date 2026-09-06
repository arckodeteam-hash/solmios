// pricing/tests/base-price.test.ts — El precio base es UNO SOLO por tipo de habitación.
//
// Lo que estos tests fijan es la regla que el sistema NO tenía: la temporada y el canal solo aplican
// un porcentaje, y el número absoluto sale siempre de la habitación. Antes cada fila de `room_rates`
// llevaba su propia copia del base y podían divergir sin que nada avisara — en producción llegaron a
// convivir tres valores para la misma suite (120 / 250 / 220).

import { describe, it, expect } from 'bun:test'
import {
  indexBasePrices, basePriceFor, effectiveRate, percentagePreserving,
} from '../../../shared/utils/base-price'
import { applyBasePrices } from '../usecases/base-price-port'

describe('indexBasePrices', () => {
  it('toma un solo base por tipo aunque venga una fila por ocupación', () => {
    const index = indexBasePrices([
      { type: 'suite', basePrice: 220 },
      { type: 'suite', basePrice: 220 },
      { type: 'single', basePrice: 80 },
    ])
    expect(index.get('suite')).toBe(220)
    expect(index.get('single')).toBe(80)
    expect(index.size).toBe(2)
  })

  it('ignora tipos vacíos y no explota con la lista vacía', () => {
    expect(indexBasePrices([{ type: '', basePrice: 99 }]).size).toBe(0)
    expect(indexBasePrices([]).size).toBe(0)
  })

  // `push-rates.ts` le pasa las filas CRUDAS de `Rooms`, una por habitación física: ahí un tipo con
  // dos unidades a precios distintos tiene que resolver al mismo número que muestra el panel
  // (`roomTypesFor`) y que publica `sync-property.ts` — el mínimo positivo.
  it('con varias unidades del tipo se queda con el MÍNIMO, no con la primera', () => {
    expect(indexBasePrices([{ type: 'suite', basePrice: 200 }, { type: 'suite', basePrice: 120 }]).get('suite')).toBe(120)
    expect(indexBasePrices([{ type: 'suite', basePrice: 120 }, { type: 'suite', basePrice: 200 }]).get('suite')).toBe(120)
  })

  it('una unidad sin precio no tapa a la que sí lo tiene', () => {
    expect(indexBasePrices([{ type: 'suite', basePrice: 0 }, { type: 'suite', basePrice: 120 }]).get('suite')).toBe(120)
  })

  // Un tipo entero sin precio queda FUERA del índice: `basePriceFor` cae al fallback grabado, que
  // es lo que la OTA está vendiendo. Un 0 en el índice lo publicaría gratis.
  it('un tipo con todas las unidades en 0 no entra al índice', () => {
    expect(indexBasePrices([{ type: 'suite', basePrice: 0 }]).size).toBe(0)
  })
})

describe('basePriceFor', () => {
  it('el base sale del tipo, NO del que traiga la fila guardada', () => {
    const index = indexBasePrices([{ type: 'suite', basePrice: 120 }])
    // 220 es lo que la fila del canal tenía grabado en producción: se descarta.
    expect(basePriceFor(index, 'suite', 220)).toBe(120)
  })

  it('respeta lo grabado cuando el tipo ya no existe (fila huérfana)', () => {
    // Un tipo borrado deja filas que el editor sigue mostrando y la OTA sigue vendiendo.
    // Ponerlas en 0 las publicaría gratis.
    expect(basePriceFor(indexBasePrices([]), 'fantasma', 175)).toBe(175)
  })

  it('un tipo con base 0 tampoco pisa lo grabado', () => {
    const index = indexBasePrices([{ type: 'suite', basePrice: 0 }])
    expect(basePriceFor(index, 'suite', 175)).toBe(175)
  })
})

describe('effectiveRate', () => {
  it('un porcentaje negativo BAJA el precio', () => {
    expect(effectiveRate(200, -25)).toBe(150)
  })

  it('-100% deja la tarifa en cero, no en negativo', () => {
    expect(effectiveRate(200, -100)).toBe(0)
  })

  it('redondea a centavos', () => {
    expect(effectiveRate(120, 211.67)).toBe(374)
  })
})

describe('percentagePreserving', () => {
  it('convierte un base viejo en el porcentaje que deja el precio igual', () => {
    // El caso real de Palma: la suite publicaba 374 con base 220 y +70%.
    // Con el base único del hotel (120) el porcentaje sube, pero el precio no se mueve.
    const pct = percentagePreserving(374, 120)
    expect(effectiveRate(120, pct)).toBe(374)
  })

  it('devuelve 0 en vez de dividir por cero', () => {
    expect(percentagePreserving(374, 0)).toBe(0)
  })

  it('un precio menor que el base da porcentaje negativo', () => {
    expect(percentagePreserving(90, 120)).toBe(-25)
  })
})

describe('applyBasePrices', () => {
  const portSpy = () => {
    const calls: Array<{ roomType: string; basePrice: unknown }> = []
    return {
      calls,
      port: {
        setTypeBasePrice: async (_h: string, roomType: string, basePrice: unknown) => {
          calls.push({ roomType, basePrice }); return 1
        },
      },
    }
  }

  it('aplica un precio por tipo', async () => {
    const { calls, port } = portSpy()
    const touched = await applyBasePrices(port, 'h1', [
      { roomType: 'suite', basePrice: 150 },
      { roomType: 'single', basePrice: 80 },
    ])
    expect(touched).toBe(2)
    expect(calls).toEqual([
      { roomType: 'suite', basePrice: 150 },
      { roomType: 'single', basePrice: 80 },
    ])
  })

  it('un tipo repetido se aplica una sola vez (gana el último)', async () => {
    const { calls, port } = portSpy()
    await applyBasePrices(port, 'h1', [
      { roomType: 'suite', basePrice: 150 },
      { roomType: 'suite', basePrice: 200 },
    ])
    expect(calls).toEqual([{ roomType: 'suite', basePrice: 200 }])
  })

  it('sin puerto inyectado no rompe el guardado de tarifas', async () => {
    expect(await applyBasePrices(null, 'h1', [{ roomType: 'suite', basePrice: 150 }])).toBe(0)
  })

  it('sin precios que aplicar no llama al puerto', async () => {
    const { calls, port } = portSpy()
    expect(await applyBasePrices(port, 'h1', undefined)).toBe(0)
    expect(await applyBasePrices(port, 'h1', [])).toBe(0)
    expect(calls).toHaveLength(0)
  })

  it('ignora entradas sin tipo', async () => {
    const { calls, port } = portSpy()
    await applyBasePrices(port, 'h1', [{ roomType: '  ', basePrice: 150 }])
    expect(calls).toHaveLength(0)
  })
})
