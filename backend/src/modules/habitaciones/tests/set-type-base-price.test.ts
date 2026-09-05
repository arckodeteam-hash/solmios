// habitaciones/tests/set-type-base-price.test.ts — El precio base del TIPO se escribe en todas sus
// unidades. Si se escribiera en una sola, el precio del tipo (mínimo positivo entre las unidades)
// podría no moverse y el campo no haría nada visible: "guardé y no cambió" en otra forma.

import { describe, it, expect } from 'bun:test'
import { setTypeBasePrice, normalizeBasePrice } from '../usecases/set-type-base-price'

interface Row { id: string; hotelId: string; type: string; basePrice: number }

function repoWith(rows: Row[]) {
  const updates: Array<{ id: string; patch: any }> = []
  return {
    updates,
    rows,
    repo: {
      findMany: async (q: any) => rows.filter((r) => r.hotelId === q.hotelId && r.type === q.type),
      update: async (id: string, patch: any) => {
        updates.push({ id, patch })
        const row = rows.find((r) => r.id === id)
        if (row) Object.assign(row, patch)
        return row
      },
    } as any,
  }
}

describe('normalizeBasePrice', () => {
  it('acepta un precio con centavos', () => {
    expect(normalizeBasePrice('150.456')).toBe(150.46)
  })

  it('rechaza 0, negativos y basura — dejarían al tipo publicando gratis', () => {
    expect(normalizeBasePrice(0)).toBeNull()
    expect(normalizeBasePrice(-1)).toBeNull()
    expect(normalizeBasePrice('abc')).toBeNull()
    expect(normalizeBasePrice(undefined)).toBeNull()
  })

  it('rechaza lo que supera el tope del validador de tarifas', () => {
    expect(normalizeBasePrice(1_000_001)).toBeNull()
  })
})

describe('setTypeBasePrice', () => {
  it('escribe el precio en TODAS las unidades del tipo', async () => {
    const { repo, rows } = repoWith([
      { id: 'a', hotelId: 'h1', type: 'suite', basePrice: 220 },
      { id: 'b', hotelId: 'h1', type: 'suite', basePrice: 300 },
      { id: 'c', hotelId: 'h1', type: 'single', basePrice: 80 },
    ])
    expect(await setTypeBasePrice(repo, 'h1', 'suite', 150)).toBe(2)
    expect(rows.map((r) => r.basePrice)).toEqual([150, 150, 80])
  })

  it('no toca otro hotel con el mismo tipo de habitación', async () => {
    const { repo, rows } = repoWith([
      { id: 'a', hotelId: 'h1', type: 'suite', basePrice: 220 },
      { id: 'b', hotelId: 'h2', type: 'suite', basePrice: 220 },
    ])
    await setTypeBasePrice(repo, 'h1', 'suite', 150)
    expect(rows.find((r) => r.id === 'b')!.basePrice).toBe(220)
  })

  it('no escribe si el precio ya era ese (idempotente)', async () => {
    const { repo, updates } = repoWith([{ id: 'a', hotelId: 'h1', type: 'suite', basePrice: 150 }])
    expect(await setTypeBasePrice(repo, 'h1', 'suite', 150)).toBe(0)
    expect(updates).toHaveLength(0)
  })

  it('un precio inválido no escribe nada', async () => {
    const { repo, updates } = repoWith([{ id: 'a', hotelId: 'h1', type: 'suite', basePrice: 220 }])
    expect(await setTypeBasePrice(repo, 'h1', 'suite', 0)).toBe(0)
    expect(await setTypeBasePrice(repo, 'h1', 'suite', 'x')).toBe(0)
    expect(updates).toHaveLength(0)
  })

  it('un tipo que no existe no escribe nada', async () => {
    const { repo, updates } = repoWith([{ id: 'a', hotelId: 'h1', type: 'suite', basePrice: 220 }])
    expect(await setTypeBasePrice(repo, 'h1', 'fantasma', 150)).toBe(0)
    expect(updates).toHaveLength(0)
  })

  it('avisa una sola vez cuando algo cambió, para invalidar la caché', async () => {
    const { repo } = repoWith([
      { id: 'a', hotelId: 'h1', type: 'suite', basePrice: 220 },
      { id: 'b', hotelId: 'h1', type: 'suite', basePrice: 300 },
    ])
    const seen: string[] = []
    await setTypeBasePrice(repo, 'h1', 'suite', 150, async (h) => { seen.push(h) })
    expect(seen).toEqual(['h1'])
  })

  it('no avisa si no cambió nada', async () => {
    const { repo } = repoWith([{ id: 'a', hotelId: 'h1', type: 'suite', basePrice: 150 }])
    const seen: string[] = []
    await setTypeBasePrice(repo, 'h1', 'suite', 150, async (h) => { seen.push(h) })
    expect(seen).toHaveLength(0)
  })
})
