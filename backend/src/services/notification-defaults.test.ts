// services/notification-defaults.test.ts — Tests de los defaults de plantillas (spec 11.1.6).

import { describe, it, expect } from 'bun:test'
import { getCodeDefault, NOTIFICATION_DEFAULTS } from './notification-defaults'

describe('notification-defaults (spec 11.1.6)', () => {
  it('cada evento tiene default en es con subject y body no vacíos', () => {
    for (const event of ['reservation_confirmed', 'reservation_presale', 'reservation_cancelled_guest', 'reservation_cancelled_staff', 'checkin_welcome', 'no_show', 'checkout', 'invoice', 'reminder', 'reservation_approved', 'reservation_rejected'] as const) {
      const d = getCodeDefault(event, 'es')
      expect(d.subject.length).toBeGreaterThan(0)
      expect(d.body.length).toBeGreaterThan(0)
      expect(d.body).toContain('{hotel_name}')
    }
  })

  it('devuelve traducción para en y pt', () => {
    const es = getCodeDefault('checkin_welcome', 'es')
    const en = getCodeDefault('checkin_welcome', 'en')
    const pt = getCodeDefault('checkin_welcome', 'pt')
    expect(es.subject).not.toBe(en.subject)
    expect(es.subject).not.toBe(pt.subject)
    expect(en.body).toContain('Welcome')
    expect(pt.body).toContain('Bem-vindo')
  })

  it('idioma sin default (fr) → fallback es', () => {
    const d = getCodeDefault('reservation_confirmed', 'fr' as any)
    const es = getCodeDefault('reservation_confirmed', 'es')
    expect(d).toBe(es)
  })

  it('evento desconocido → throw', () => {
    expect(() => getCodeDefault('unknown' as any, 'es')).toThrow(/evento desconocido/)
  })

  it('NOTIFICATION_DEFAULTS registra todos los eventos × 3 idiomas', () => {
    expect(Object.keys(NOTIFICATION_DEFAULTS).sort()).toEqual(['checkin_welcome', 'checkout', 'invoice', 'no_show', 'payment_link', 'reminder', 'reservation_approved', 'reservation_cancelled_guest', 'reservation_cancelled_staff', 'reservation_confirmed', 'reservation_presale', 'reservation_rejected', 'review_request'])
    for (const event of Object.keys(NOTIFICATION_DEFAULTS)) {
      const langs = Object.keys((NOTIFICATION_DEFAULTS as any)[event])
      expect(langs.sort()).toEqual(['en', 'es', 'pt'])
    }
  })

  // #272 — las plantillas de cancelación piden la frase del reembolso y (staff) el link al panel.
  it('reservation_cancelled_guest/staff: 3 idiomas con {refund_line}; staff con {reservation_link}', () => {
    for (const lang of ['es', 'en', 'pt'] as const) {
      const guest = getCodeDefault('reservation_cancelled_guest', lang)
      expect(guest.body).toContain('{refund_line}')
      expect(guest.body).toContain('{rooms_count}')
      expect(guest.body).not.toContain('{reservation_link}')
      const staff = getCodeDefault('reservation_cancelled_staff', lang)
      expect(staff.body).toContain('{refund_line}')
      expect(staff.body).toContain('{reservation_link}')
      expect(staff.subject).toContain('{guest_name}')
    }
  })
})
