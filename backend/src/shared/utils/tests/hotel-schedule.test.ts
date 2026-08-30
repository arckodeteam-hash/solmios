import { describe, it, expect } from 'bun:test'
import { readFileSync } from 'node:fs'
import {
  normalizeTime, hotelCheckInTime, hotelCheckOutTime, hotelTimezone,
  effectiveCheckInTime, effectiveCheckOutTime, zonedTimeToUtc, reservationAccessWindow,
  DEFAULT_CHECK_IN_TIME, DEFAULT_CHECK_OUT_TIME,
} from '../hotel-schedule'

describe('normalizeTime', () => {
  it('acepta HH:MM', () => expect(normalizeTime('15:00')).toBe('15:00'))
  it('rellena H:MM', () => expect(normalizeTime('9:30')).toBe('09:30'))
  it('recorta segundos', () => expect(normalizeTime('08:45:00')).toBe('08:45'))
  it('rechaza hora inexistente', () => expect(normalizeTime('25:00')).toBeNull())
  it('rechaza minuto inexistente', () => expect(normalizeTime('12:70')).toBeNull())
  it('rechaza vacío, basura y no-string', () => {
    expect(normalizeTime('')).toBeNull()
    expect(normalizeTime('   ')).toBeNull()
    expect(normalizeTime('tarde')).toBeNull()
    expect(normalizeTime(null)).toBeNull()
    expect(normalizeTime(1500)).toBeNull()
  })
})

describe('horario del hotel', () => {
  it('usa el configurado por el hotel, NO un literal', () => {
    expect(hotelCheckInTime({ checkIn: '15:00' })).toBe('15:00')
    expect(hotelCheckOutTime({ checkOut: '11:00' })).toBe('11:00')
  })
  it('cae al default del modelo cuando el registro está vacío', () => {
    expect(hotelCheckInTime(null)).toBe(DEFAULT_CHECK_IN_TIME)
    expect(hotelCheckOutTime({})).toBe(DEFAULT_CHECK_OUT_TIME)
  })
  it('el default NO es 14:00 (regresión del bug checkInTime)', () => {
    expect(hotelCheckInTime(null)).not.toBe('14:00')
  })
  it('ignora un horario corrupto y no propaga basura', () => {
    expect(hotelCheckInTime({ checkIn: 'ayer' })).toBe(DEFAULT_CHECK_IN_TIME)
  })
  it('timezone del hotel con fallback', () => {
    expect(hotelTimezone({ timezone: 'Europe/Madrid' })).toBe('Europe/Madrid')
    expect(hotelTimezone({ timezone: '  ' })).toBe('America/Santo_Domingo')
  })
})

describe('override por reserva (early check-in / late checkout)', () => {
  const hotel = { checkIn: '15:00', checkOut: '12:00' }
  it('sin override manda el hotel', () => {
    expect(effectiveCheckInTime({}, hotel)).toBe('15:00')
    expect(effectiveCheckOutTime({}, hotel)).toBe('12:00')
  })
  it('el override de la reserva pisa al hotel', () => {
    expect(effectiveCheckInTime({ checkInTime: '10:00' }, hotel)).toBe('10:00')
    expect(effectiveCheckOutTime({ checkOutTime: '18:00' }, hotel)).toBe('18:00')
  })
  it('un override inválido NO rompe: cae al hotel', () => {
    expect(effectiveCheckInTime({ checkInTime: '99:99' }, hotel)).toBe('15:00')
    expect(effectiveCheckInTime({ checkInTime: '' }, hotel)).toBe('15:00')
  })
})

describe('zonedTimeToUtc', () => {
  it('interpreta la hora en la zona del hotel, no en UTC', () => {
    // Santo Domingo es UTC-4 todo el año: 15:00 local = 19:00 UTC.
    expect(zonedTimeToUtc('2026-09-12', '15:00', 'America/Santo_Domingo').toISOString())
      .toBe('2026-09-12T19:00:00.000Z')
  })
  it('contempla DST donde existe (Madrid en verano = UTC+2)', () => {
    expect(zonedTimeToUtc('2026-07-15', '15:00', 'Europe/Madrid').toISOString())
      .toBe('2026-07-15T13:00:00.000Z')
  })
  it('contempla el invierno de la misma zona (Madrid = UTC+1)', () => {
    expect(zonedTimeToUtc('2026-01-15', '15:00', 'Europe/Madrid').toISOString())
      .toBe('2026-01-15T14:00:00.000Z')
  })
  it('fecha inválida devuelve Invalid Date en vez de un instante inventado', () => {
    expect(Number.isNaN(zonedTimeToUtc('', '15:00', 'America/Santo_Domingo').getTime())).toBe(true)
  })
})

describe('reservationAccessWindow — el caso que reportó el cliente', () => {
  const hotel = { checkIn: '15:00', checkOut: '12:00', timezone: 'America/Santo_Domingo' }
  const reserva = { checkIn: '2026-09-12', checkOut: '2026-09-13' }

  it('el código empieza a valer a la hora de entrada del hotel, no a medianoche UTC', () => {
    const w = reservationAccessWindow(reserva, hotel)
    expect(new Date(w.startMs).toISOString()).toBe('2026-09-12T19:00:00.000Z') // 15:00 local
  })

  it('el código expira a la hora de SALIDA, no antes de la última noche', () => {
    const w = reservationAccessWindow(reserva, hotel)
    expect(new Date(w.endMs).toISOString()).toBe('2026-09-13T16:00:00.000Z') // 12:00 local del 13
  })

  it('REGRESIÓN: el comportamiento viejo dejaba al huésped afuera su última noche', () => {
    const viejo = { startMs: new Date(reserva.checkIn).getTime(), endMs: new Date(reserva.checkOut).getTime() }
    const nuevo = reservationAccessWindow(reserva, hotel)
    // El viejo expiraba el 13 a las 00:00 UTC = 12 sept 20:00 local: antes de la última noche.
    expect(viejo.endMs).toBeLessThan(nuevo.endMs)
    // Y arrancaba el día ANTERIOR a la llegada en hora local.
    expect(viejo.startMs).toBeLessThan(nuevo.startMs)
    // Diferencia real de cierre: 16 horas de acceso que el huésped no tenía.
    expect((nuevo.endMs - viejo.endMs) / 3_600_000).toBe(16)
  })

  it('la ventana siempre abre antes de cerrar', () => {
    const w = reservationAccessWindow(reserva, hotel)
    expect(w.startMs).toBeLessThan(w.endMs)
  })

  it('el early check-in de la reserva adelanta la apertura del código', () => {
    const w = reservationAccessWindow({ ...reserva, checkInTime: '09:00' }, hotel)
    expect(new Date(w.startMs).toISOString()).toBe('2026-09-12T13:00:00.000Z') // 09:00 local
    expect(w.checkInTime).toBe('09:00')
  })

  it('el late checkout de la reserva extiende el cierre del código', () => {
    const w = reservationAccessWindow({ ...reserva, checkOutTime: '18:00' }, hotel)
    expect(new Date(w.endMs).toISOString()).toBe('2026-09-13T22:00:00.000Z') // 18:00 local
    expect(w.checkOutTime).toBe('18:00')
  })
})

// Guardia estructural: el bug fue leer `hotel.checkInTime`, campo que NO existe en el modelo
// (`hoteles/model.ts` declara `checkIn`). Falla si alguien lo reintroduce en las rutas que le
// anuncian el horario al huésped.
/** Código sin comentarios: los comentarios de estos archivos CITAN el bug viejo a propósito. */
function codeOnly(rel: string): string {
  return readFileSync(rel, 'utf8')
    .split('\n')
    .filter(l => !/^\s*(\/\/|\*|\/\*)/.test(l))
    .join('\n')
}

describe('guardia — nadie lee hotel.checkInTime en backend', () => {
  const files = [
    'src/modules/reservas/usecases/checkin-email.ts',
    'src/modules/ai-recepcionista/usecases/llm-pipeline.ts',
    'src/modules/ttlock/usecases/ttlock-config.ts',
  ]
  it.each(files)('%s no lee el campo inexistente del hotel', (rel) => {
    const src = codeOnly(rel)
    expect(src).not.toMatch(/hotel\??\.\s*checkInTime/)
    expect(src).not.toMatch(/hotel\??\.\s*checkOutTime/)
  })
  it.each(files)('%s toma el horario del helper compartido', (rel) => {
    const src = readFileSync(rel, 'utf8')
    expect(src).toContain('hotel-schedule')
  })
  it('la cerradura NO vuelve a calcular la ventana con medianoche UTC', () => {
    const src = codeOnly('src/modules/ttlock/usecases/ttlock-config.ts')
    expect(src).not.toMatch(/new Date\(res\.checkIn\)\.getTime\(\)/)
    expect(src).toContain('reservationAccessWindow')
  })
})
