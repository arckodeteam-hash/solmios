// shared/usecases/tests/booking-engine-gate.test.ts — #276 (MR-11): tabla de casos del único
// interruptor del motor público (`isEngineOpen`).
import { describe, it, expect } from 'bun:test'
import { ENGINE_CLOSED_BODY, engineClosed, isEngineOpen } from '../booking-engine-gate'

describe('isEngineOpen — hotels.onlineBookingStatus (plataforma) × booking_config.enabled (hotel)', () => {
  const cases: Array<[string, any, any, boolean]> = [
    ['hotel null (no existe) → cerrado', null, { enabled: true }, false],
    ['hotel undefined → cerrado', undefined, null, false],
    ['hotel paused + enabled:true → cerrado (manda la plataforma)', { onlineBookingStatus: 'paused' }, { enabled: true }, false],
    ['hotel inactive + sin config → cerrado', { onlineBookingStatus: 'inactive' }, null, false],
    ['hotel sin onlineBookingStatus → cerrado', {}, null, false],
    ['active + sin fila de config (null) → abierto (default enabled=true)', { onlineBookingStatus: 'active' }, null, true],
    ['active + config undefined → abierto', { onlineBookingStatus: 'active' }, undefined, true],
    ['active + enabled:false → cerrado (toggle del hotel)', { onlineBookingStatus: 'active' }, { enabled: false }, false],
    ['active + enabled:true → abierto', { onlineBookingStatus: 'active' }, { enabled: true }, true],
    ['active + config sin campo enabled → abierto (sólo pesa enabled === false)', { onlineBookingStatus: 'active' }, { minNights: 2 }, true],
    ['active + enabled:null → abierto (no es false estricto)', { onlineBookingStatus: 'active' }, { enabled: null }, true],
  ]
  for (const [name, hotel, cfg, expected] of cases) {
    it(name, () => {
      expect(isEngineOpen(hotel, cfg)).toBe(expected)
    })
  }
})

describe('engineClosed — mismo 404 anti-enumeración para todos los endpoints', () => {
  it('devuelve status 404 y una COPIA de ENGINE_CLOSED_BODY', () => {
    const res = engineClosed()
    expect(res.status).toBe(404)
    expect(res.body).toEqual({ error: 'Hotel not found' })
    expect(res.body).toEqual(ENGINE_CLOSED_BODY)
    expect(res.body).not.toBe(ENGINE_CLOSED_BODY)
  })

  it('cada llamada devuelve un objeto nuevo (mutar uno no contamina al siguiente)', () => {
    const a = engineClosed()
    ;(a.body as any).error = 'mutado'
    expect(engineClosed().body.error).toBe('Hotel not found')
    expect(ENGINE_CLOSED_BODY.error).toBe('Hotel not found')
  })
})
