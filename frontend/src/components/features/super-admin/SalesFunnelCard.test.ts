// SalesFunnelCard.test.ts — #151: los números de la tarjeta son los del endpoint (misma petición),
// estados vacío/error, y el selector de semanas vuelve a pedir.
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import type { SalesFunnelResult } from '@/types/sales-pipeline'

vi.mock('@/services/SalesPipeline.service', () => ({
  SalesPipelineService: { funnel: vi.fn() },
}))

import { SalesPipelineService } from '@/services/SalesPipeline.service'
import SalesFunnelCard from './SalesFunnelCard.vue'

const funnelMock = vi.mocked(SalesPipelineService.funnel)

const lost = (over: Partial<SalesFunnelResult['totals']['lost']> = {}) => ({
  no_response: 0, price: 0, missing_feature: 0, chose_competitor: 0, not_a_fit: 0, other: 0, ...over,
})

function fixture(): SalesFunnelResult {
  const week = (w: string, registered: number, activated: number, paying: number) => ({
    week: w, start: '2026-09-07T00:00:00.000Z', end: '2026-09-13T23:59:59.999Z',
    registered, activated, paying, lost: lost(), lostTotal: 0,
    activationRate: registered ? Math.round((activated / registered) * 1000) / 10 : 0,
    payingRate: registered ? Math.round((paying / registered) * 1000) / 10 : 0,
  })
  return {
    weeks: [week('2026-W36', 0, 0, 0), week('2026-W37', 10, 4, 1)],
    totals: { registered: 10, activated: 4, paying: 1, lost: lost({ price: 1, other: 1 }), lostTotal: 2, activationRate: 40, payingRate: 10 },
    weeksCount: 2,
    generatedAt: '2026-09-09T15:00:00.000Z',
  }
}

const mountCard = () => mount(SalesFunnelCard, { global: { stubs: { RouterLink: true } } })

beforeEach(() => {
  funnelMock.mockReset()
})

describe('SalesFunnelCard', () => {
  it('muestra los totales y tasas que devolvió el endpoint (40% / 10%) y los motivos de pérdida', async () => {
    funnelMock.mockResolvedValue(fixture())
    const w = mountCard()
    await flushPromises()

    expect(funnelMock).toHaveBeenCalledTimes(1)
    expect(funnelMock).toHaveBeenCalledWith(8)
    expect(w.get('[data-testid=funnel-total-registered]').text()).toBe('10')
    expect(w.get('[data-testid=funnel-total-activated]').text()).toBe('4')
    expect(w.get('[data-testid=funnel-rate-activated]').text()).toBe('40%')
    expect(w.get('[data-testid=funnel-total-paying]').text()).toBe('1')
    expect(w.get('[data-testid=funnel-rate-paying]').text()).toBe('10%')
    expect(w.get('[data-testid=funnel-total-lostTotal]').text()).toBe('2')
    const lostText = w.get('[data-testid=funnel-lost]').text()
    expect(lostText).toContain('Precio · 1')
    expect(lostText).toContain('Otro · 1')
    expect(lostText).not.toContain('Sin respuesta')
  })

  it('sin registrados → estado vacío, sin cuerpo', async () => {
    const f = fixture()
    f.totals.registered = 0
    funnelMock.mockResolvedValue(f)
    const w = mountCard()
    await flushPromises()
    expect(w.find('[data-testid=funnel-body]').exists()).toBe(false)
    expect(w.text()).toContain('Sin altas en el período')
  })

  it('error del service → mensaje con reintentar; reintentar vuelve a pedir', async () => {
    funnelMock.mockRejectedValueOnce(new Error('No se pudo conectar con el servidor'))
    funnelMock.mockResolvedValueOnce(fixture())
    const w = mountCard()
    await flushPromises()
    expect(w.get('[data-testid=funnel-error]').text()).toContain('No se pudo conectar')
    await w.get('[data-testid=funnel-error] button').trigger('click')
    await flushPromises()
    expect(funnelMock).toHaveBeenCalledTimes(2)
    expect(w.find('[data-testid=funnel-body]').exists()).toBe(true)
  })

  it('cambiar las semanas vuelve a pedir con ese valor', async () => {
    funnelMock.mockResolvedValue(fixture())
    const w = mountCard()
    await flushPromises()
    await w.get('[data-testid=funnel-weeks]').setValue('12')
    await flushPromises()
    expect(funnelMock).toHaveBeenLastCalledWith(12)
  })
})
