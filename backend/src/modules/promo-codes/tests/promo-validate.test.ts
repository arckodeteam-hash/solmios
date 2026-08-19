// promo-codes/tests/promo-validate.test.ts — Cubre los 5 reasons + happy path (F2 2.2).
//
// Aceptancia (tasks.md 2.2):
//  - código vencido → {valid:false, reason:'expired'}
//  - código válido con subtotal suficiente → {valid:true, discount: calculatedValue}
//
// Sin dependencia de DB: mock del promoCodes repo. Casos:
//  (1) not_found        — code no existe para el hotel
//  (2) inactive         — active=false
//  (3a) expired          — validTo pasado
//  (3b) expired          — validFrom futuro
//  (4) max_uses_reached — uses >= maxUses
//  (5) min_amount_not_met — subtotal < minAmount
//  (6) happy percent    — descuento = subtotal * value / 100
//  (7) happy fixed      — descuento = min(value, subtotal)
//  (8) case-insensitive — "welcome10" ≡ "WELCOME10"
//  (9) fixed > subtotal — descuento capado a subtotal (no negativos)
import { describe, it, expect, spyOn } from 'bun:test'
import { validate } from '../usecases/promo-validate'
import type { PromoCodeDTO } from '../types'

function makeRepo(findOneResult: PromoCodeDTO | null) {
  return {
    findOne: async () => findOneResult,
    findMany: async () => (findOneResult ? [findOneResult] : []),
  } as any
}

const basePromo = (overrides: Partial<PromoCodeDTO> = {}): PromoCodeDTO => ({
  id: 'p1',
  hotelId: 'h1',
  code: 'WELCOME10',
  kind: 'percent',
  value: 10,
  minAmount: null,
  maxUses: null,
  uses: 0,
  validFrom: null,
  validTo: null,
  active: true,
  createdAt: '2026-01-01T00:00:00Z',
  updatedAt: '2026-01-01T00:00:00Z',
  ...overrides,
})

describe('promo-validate (F2 2.2)', () => {
  it('code inexistente → not_found', async () => {
    const deps = { promoCodes: makeRepo(null) }
    const r = await validate(deps, 'h1', 'NOPE', 100)
    expect(r.valid).toBe(false)
    expect(r.reason).toBe('not_found')
    expect(r.discount).toBe(0)
  })

  it('inactive → inactive', async () => {
    const deps = { promoCodes: makeRepo(basePromo({ active: false })) }
    const r = await validate(deps, 'h1', 'WELCOME10', 100)
    expect(r.valid).toBe(false)
    expect(r.reason).toBe('inactive')
  })

  it('validTo pasado → expired', async () => {
    const deps = { promoCodes: makeRepo(basePromo({ validTo: '2020-01-01T00:00:00Z' })) }
    const r = await validate(deps, 'h1', 'WELCOME10', 100)
    expect(r.valid).toBe(false)
    expect(r.reason).toBe('expired')
  })

  it('validFrom futuro → expired', async () => {
    const future = new Date(Date.now() + 86_400_000).toISOString() // +1d
    const deps = { promoCodes: makeRepo(basePromo({ validFrom: future })) }
    const r = await validate(deps, 'h1', 'WELCOME10', 100)
    expect(r.valid).toBe(false)
    expect(r.reason).toBe('expired')
  })

  it('uses >= maxUses → max_uses_reached', async () => {
    const deps = { promoCodes: makeRepo(basePromo({ maxUses: 100, uses: 100 })) }
    const r = await validate(deps, 'h1', 'WELCOME10', 100)
    expect(r.valid).toBe(false)
    expect(r.reason).toBe('max_uses_reached')
  })

  it('subtotal < minAmount → min_amount_not_met', async () => {
    const deps = { promoCodes: makeRepo(basePromo({ minAmount: 200 })) }
    const r = await validate(deps, 'h1', 'WELCOME10', 100)
    expect(r.valid).toBe(false)
    expect(r.reason).toBe('min_amount_not_met')
  })

  it('happy percent — descuento = subtotal * value / 100', async () => {
    const deps = { promoCodes: makeRepo(basePromo({ kind: 'percent', value: 10 })) }
    const r = await validate(deps, 'h1', 'WELCOME10', 300)
    expect(r.valid).toBe(true)
    expect(r.discount).toBe(30) // 300 * 10 / 100
    expect(r.code).toBe('WELCOME10')
  })

  it('happy fixed — descuento = value (no capado)', async () => {
    const deps = { promoCodes: makeRepo(basePromo({ kind: 'fixed', value: 50 })) }
    const r = await validate(deps, 'h1', 'WELCOME50', 300)
    expect(r.valid).toBe(true)
    expect(r.discount).toBe(50)
  })

  it('case-insensitive — "welcome10" ≡ "WELCOME10"', async () => {
    const deps = { promoCodes: makeRepo(basePromo({ kind: 'percent', value: 10 })) }
    const r = await validate(deps, 'h1', 'welcome10', 100)
    expect(r.valid).toBe(true)
    expect(r.discount).toBe(10)
    expect(r.code).toBe('WELCOME10')
  })

  it('fixed > subtotal — descuento capado a subtotal (no negativos)', async () => {
    const deps = { promoCodes: makeRepo(basePromo({ kind: 'fixed', value: 500 })) }
    const r = await validate(deps, 'h1', 'BIG', 100)
    expect(r.valid).toBe(true)
    expect(r.discount).toBe(100) // min(500, 100)
  })

  it('uses NO se incrementa al validar', async () => {
    const promo = basePromo({ uses: 5, maxUses: 10 })
    const deps = { promoCodes: makeRepo(promo) }
    await validate(deps, 'h1', 'WELCOME10', 100)
    // El validador es read-only: el `uses` de la fila debe quedar igual.
    expect(promo.uses).toBe(5)
  })

  it('subtotal negativo → not_found (fail-cerrado)', async () => {
    const deps = { promoCodes: makeRepo(basePromo()) }
    const r = await validate(deps, 'h1', 'WELCOME10', -50)
    expect(r.valid).toBe(false)
    expect(r.reason).toBe('not_found')
  })
})

// ─── PC-3/PC-4 (auditoría 2026-08-19): ventana de validez ──────────────────────────────
// El admin carga validTo con `<input type="date">` → "YYYY-MM-DD". Antes Date.parse daba
// 00:00 UTC y el día "Hasta" ENTERO ya rechazaba (off-by-one); y una fecha corrupta se leía
// como "sin ventana" → código eterno. Fechas relativas a hoy para no vencer el test.
describe('promo-validate — ventana date-only y fechas corruptas (PC-3/PC-4)', () => {
  const today = new Date().toISOString().slice(0, 10)
  const yesterday = new Date(Date.now() - 86_400_000).toISOString().slice(0, 10)

  it('validTo date-only de HOY cuenta el día completo → válido (antes: off-by-one)', async () => {
    const deps = { promoCodes: makeRepo(basePromo({ validTo: today })) }
    const r = await validate(deps, 'h1', 'WELCOME10', 100)
    expect(r.valid).toBe(true)
  })

  it('validTo date-only de AYER (fin de ayer < ahora) → expired', async () => {
    const deps = { promoCodes: makeRepo(basePromo({ validTo: yesterday })) }
    const r = await validate(deps, 'h1', 'WELCOME10', 100)
    expect(r.valid).toBe(false)
    expect(r.reason).toBe('expired')
  })

  it('validFrom date-only de HOY (inicio del día) → válido ya', async () => {
    const deps = { promoCodes: makeRepo(basePromo({ validFrom: today })) }
    const r = await validate(deps, 'h1', 'WELCOME10', 100)
    expect(r.valid).toBe(true)
  })

  it('validFrom date-only de MAÑANA → expired (todavía no arranca)', async () => {
    const tomorrow = new Date(Date.now() + 86_400_000).toISOString().slice(0, 10)
    const deps = { promoCodes: makeRepo(basePromo({ validFrom: tomorrow })) }
    const r = await validate(deps, 'h1', 'WELCOME10', 100)
    expect(r.valid).toBe(false)
    expect(r.reason).toBe('expired')
  })

  it('fecha corrupta ("31/12/2026") → expired (fail-closed; antes: vigente PARA SIEMPRE)', async () => {
    const deps = { promoCodes: makeRepo(basePromo({ validTo: '31/12/2026' as any })) }
    const r = await validate(deps, 'h1', 'WELCOME10', 100)
    expect(r.valid).toBe(false)
    expect(r.reason).toBe('expired')
  })

  it('validTo ISO completa exactamente ahora → válido (borde now === to, reloj congelado)', async () => {
    const to = '2026-08-19T12:00:00Z'
    const deps = { promoCodes: makeRepo(basePromo({ validTo: to })) }
    const spy = spyOn(Date, 'now').mockReturnValue(Date.parse(to))
    const r = await validate(deps, 'h1', 'WELCOME10', 100)
    spy.mockRestore()
    expect(r.valid).toBe(true)
  })
})
