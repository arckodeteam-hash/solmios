// marketing/tests/guest-triggers.test.ts — Spec guest-triggers (crm-campanas-v1):
// birthday mes/día (sin año), win-back exacto, exclusión con reserva futura, dedupe por día.
import { describe, it, expect } from 'bun:test'
import { isBirthdayToday, isInactiveSince, lastStayCheckout, hasFutureStay } from '../usecases/guest-triggers'
import { alreadySentToday } from '../usecases/auto-message-dedupe'

const TODAY = new Date('2026-08-18T10:00:00Z')

describe('birthday (spec)', () => {
  it('coincide mes y día, ignorando el año', () => {
    expect(isBirthdayToday('1990-08-18', TODAY)).toBe(true)
    expect(isBirthdayToday('2000-08-18', TODAY)).toBe(true)
    expect(isBirthdayToday('1990-08-19', TODAY)).toBe(false)
    expect(isBirthdayToday('1990-07-18', TODAY)).toBe(false)
  })
  it('sin birthDate o formato roto → nunca', () => {
    expect(isBirthdayToday(null, TODAY)).toBe(false)
    expect(isBirthdayToday('', TODAY)).toBe(false)
    expect(isBirthdayToday('no-fecha', TODAY)).toBe(false)
  })
})

describe('inactive_guests / win-back (spec)', () => {
  const res = [
    { guestId: 'g1', checkIn: '2026-01-01', checkOut: '2026-01-05', status: 'checked_out' },
    { guestId: 'g2', checkIn: '2026-01-01', checkOut: '2026-01-20', status: 'checked_out' }, // 210 días → NO (offset 180)
    { guestId: 'g3', checkIn: '2026-01-01', checkOut: '2026-01-20', status: 'checked_out' },
    { guestId: 'g3', checkIn: '2026-09-01', status: 'confirmed' },                            // g3 volvió → excluir
    { guestId: 'g4', checkIn: '2025-12-01', checkOut: '2026-02-19', status: 'checked_out' },  // 180 días exactos
  ]

  it('última estadía terminada exactamente hace offset días (g4: 19/2 → 180 días)', () => {
    expect(isInactiveSince(res, 'g4', 180, TODAY)).toBe(true)
    expect(isInactiveSince(res, 'g1', 180, TODAY)).toBe(false) // terminó 05/01 → 225 días
  })
  it('más días que el offset → NO (solo el día exacto, sin spam)', () => {
    expect(isInactiveSince(res, 'g2', 180, TODAY)).toBe(false)
  })
  it('con reserva futura → NO (ya volvió)', () => {
    expect(isInactiveSince(res, 'g3', 180, TODAY)).toBe(false)
    expect(hasFutureStay(res, 'g3', TODAY)).toBe(true)
  })
  it('nunca alojó → NO (desconocido ≠ inactivo) y helpers de última visita', () => {
    expect(isInactiveSince(res, 'g-inexistente', 180, TODAY)).toBe(false)
    expect(lastStayCheckout(res, 'g4')).toBe('2026-02-19')
    expect(lastStayCheckout(res, 'g-none')).toBe('')
  })
})

describe('dedupe mismo-día (spec)', () => {
  const logs = [
    { response: 'auto:birthday:m1', status: 'sent', sentAt: '2026-08-18T09:00:00Z' },
    { response: 'auto:birthday:m1', status: 'failed', sentAt: '2026-08-18T08:00:00Z' }, // failed no cuenta
    { response: 'auto:birthday:m1', status: 'sent', sentAt: '2026-08-17T09:00:00Z' },   // ayer no cuenta
  ]
  it('hoy y sent → bloquea; failed o de otro día → no', () => {
    expect(alreadySentToday(logs, 'birthday', 'm1', TODAY)).toBe(true)
    expect(alreadySentToday(logs, 'birthday', 'm2', TODAY)).toBe(false)
    expect(alreadySentToday([logs[1]!], 'birthday', 'm1', TODAY)).toBe(false)
    expect(alreadySentToday([logs[2]!], 'birthday', 'm1', TODAY)).toBe(false)
  })
})
