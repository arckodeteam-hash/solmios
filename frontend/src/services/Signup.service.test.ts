// Signup.service.test.ts — #94: la prueba gratis es de 15 días también en el estado inicial y en
// el fallback del frontend. Antes `signupPolicy()` caía a un 7 escrito a mano y /registro decía
// "7 días gratis" hasta que respondía la política (o siempre, si el endpoint fallaba).
import { describe, it, expect, beforeEach, vi } from 'vitest'

vi.mock('./http', () => ({
  http: { post: vi.fn(), get: vi.fn() },
}))

import { SignupService, DEFAULT_TRIAL_DAYS, trialEligiblePlans, type PublicPlan } from './Signup.service'
import { http } from './http'

describe('Signup.service — signupPolicy (#94)', () => {
  beforeEach(() => vi.clearAllMocks())

  it('DEFAULT_TRIAL_DAYS espeja TRIAL_DAYS del backend: 15', () => {
    expect(DEFAULT_TRIAL_DAYS).toBe(15)
  })

  it('si /public/signup-policy falla, cae al camino conservador: 15 días y sin tarjeta', async () => {
    vi.mocked(http.get).mockRejectedValueOnce(new Error('network'))
    const p = await SignupService.signupPolicy()
    expect(p).toEqual({ requireCardOnTrial: false, trialDays: 15 })
  })

  it.each([0, -1, NaN, 'abc', null, undefined])(
    'si el backend manda trialDays inválido (%s), usa 15',
    async (bad) => {
      vi.mocked(http.get).mockResolvedValueOnce({ data: { requireCardOnTrial: false, trialDays: bad } })
      const p = await SignupService.signupPolicy()
      expect(p.trialDays).toBe(15)
    },
  )

  it.each([15, 14, 30])('respeta el valor del backend (%s)', async (days) => {
    vi.mocked(http.get).mockResolvedValueOnce({ data: { requireCardOnTrial: true, trialDays: days } })
    const p = await SignupService.signupPolicy()
    expect(p).toEqual({ requireCardOnTrial: true, trialDays: days })
    expect(http.get).toHaveBeenCalledWith('/public/signup-policy')
  })
})

// ── #71: el registro sólo ofrece planes con `plans.trialEligible` ─────────────────────────────
describe('Signup.service — trialEligiblePlans (#71)', () => {
  const plan = (over: Partial<PublicPlan>): PublicPlan => ({
    id: 'plan-x', name: 'X', slug: 'x', price: 10, currency: 'USD', description: '', features: [], ...over,
  })

  it('deja afuera los planes con trialEligible=false', () => {
    const out = trialEligiblePlans([
      plan({ id: 'a', trialEligible: true }),
      plan({ id: 'b', trialEligible: false }),
      plan({ id: 'c', trialEligible: true }),
    ])
    expect(out.map(p => p.id)).toEqual(['a', 'c'])
  })

  it('sin el campo (backend viejo / NULL en la fila) el plan sigue siendo elegible', () => {
    const out = trialEligiblePlans([plan({ id: 'a' }), plan({ id: 'b', trialEligible: undefined })])
    expect(out.map(p => p.id)).toEqual(['a', 'b'])
  })

  it('lista vacía → lista vacía, y no muta la entrada', () => {
    expect(trialEligiblePlans([])).toEqual([])
    const input = [plan({ id: 'a', trialEligible: false })]
    trialEligiblePlans(input)
    expect(input).toHaveLength(1)
  })
})
