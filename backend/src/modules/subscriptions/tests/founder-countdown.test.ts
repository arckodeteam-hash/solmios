// subscriptions/tests/founder-countdown.test.ts — contador cíclico de /hotel-fundador.
//
// Antes la fecha límite quedaba HARDCODEADA en el frontend (`FOUNDER_DEADLINE`) y, al pasar esa
// fecha, el contador se quedaba clavado en 00:00:00:00 para siempre — nadie la reiniciaba porque
// no había desde dónde. `readFounderCountdown` no devuelve una fecha límite: devuelve la config
// (enabled/durationDays/anchorAt) para que el frontend calcule el ciclo vigente con `%`, que
// arranca solo apenas se cumple el anterior.

import { describe, it, expect } from 'bun:test'
import { readFounderCountdown, FOUNDER_COUNTDOWN_ANCHOR_ISO } from '../usecases/founder-countdown'

describe('readFounderCountdown', () => {
  it('sin lector inyectado, el contador queda apagado (no rompe la página pública)', async () => {
    const cfg = await readFounderCountdown(undefined)
    expect(cfg.enabled).toBe(false)
    expect(cfg.durationDays).toBe(90)
    expect(cfg.anchorAt).toBe(FOUNDER_COUNTDOWN_ANCHOR_ISO)
  })

  it('si el lector falla, el contador queda apagado en vez de tirar el endpoint público', async () => {
    const cfg = await readFounderCountdown(async () => { throw new Error('DB caída') })
    expect(cfg.enabled).toBe(false)
  })

  it('propaga enabled=true y la duración configurada', async () => {
    const cfg = await readFounderCountdown(async () => ({ enabled: true, durationDays: 30 }))
    expect(cfg.enabled).toBe(true)
    expect(cfg.durationDays).toBe(30)
    expect(cfg.anchorAt).toBe(FOUNDER_COUNTDOWN_ANCHOR_ISO)
  })

  it('una duración inválida (0, negativa o no numérica) cae al default de 90 días', async () => {
    for (const bad of [0, -5, NaN, undefined as any]) {
      const cfg = await readFounderCountdown(async () => ({ enabled: true, durationDays: bad }))
      expect(cfg.durationDays).toBe(90)
    }
  })

  it('enabled no-boolean (undefined, string) se normaliza a false, nunca truthy por accidente', async () => {
    const cfg = await readFounderCountdown(async () => ({ enabled: undefined as any, durationDays: 90 }))
    expect(cfg.enabled).toBe(false)
  })

  it('el ancla es SIEMPRE la constante fija, sin importar lo que devuelva el lector', async () => {
    const cfg = await readFounderCountdown(async () => ({ enabled: true, durationDays: 90 }))
    expect(cfg.anchorAt).toBe(FOUNDER_COUNTDOWN_ANCHOR_ISO)
  })
})
