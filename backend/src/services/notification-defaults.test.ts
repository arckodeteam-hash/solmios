// services/notification-defaults.test.ts — Tests de los defaults de plantillas (spec 11.1.6).

import { describe, it, expect } from 'bun:test'
import { getCodeDefault, NOTIFICATION_DEFAULTS } from './notification-defaults'

describe('notification-defaults (spec 11.1.6)', () => {
  it('cada evento tiene default en es con subject y body no vacíos', () => {
    for (const event of ['reservation_confirmed', 'reservation_presale', 'checkin_welcome', 'no_show', 'checkout', 'invoice', 'reminder', 'reservation_approved', 'reservation_rejected'] as const) {
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
    expect(Object.keys(NOTIFICATION_DEFAULTS).sort()).toEqual(['checkin_welcome', 'checkout', 'invoice', 'no_show', 'payment_link', 'reminder', 'reservation_approved', 'reservation_confirmed', 'reservation_new_ota_staff', 'reservation_new_staff', 'reservation_presale', 'reservation_received_unpaid', 'reservation_rejected', 'review_request'])
    for (const event of Object.keys(NOTIFICATION_DEFAULTS)) {
      const langs = Object.keys((NOTIFICATION_DEFAULTS as any)[event])
      expect(langs.sort()).toEqual(['en', 'es', 'pt'])
    }
  })

  it('#267: reservation_new_staff y reservation_received_unpaid en es/en/pt con {platform_name} (nunca hardcodeado)', () => {
    for (const lang of ['es', 'en', 'pt'] as const) {
      const staff = getCodeDefault('reservation_new_staff', lang)
      expect(staff.subject).toBe('[{platform_name}] {title}')
      expect(staff.body).toContain('{platform_name}')
      expect(staff.body).toContain('{payment_status}')
      expect(staff.body).toContain('{panel_link}')
      expect(staff.body).toContain('{details}')
      expect(staff.body).not.toMatch(/solmios/i)

      const unpaid = getCodeDefault('reservation_received_unpaid', lang)
      expect(unpaid.subject.length).toBeGreaterThan(0)
      expect(unpaid.subject).toContain('{hotel_name}')
      expect(unpaid.body).toContain('{platform_name}')
      expect(unpaid.body).toContain('{locator}')
      expect(unpaid.body).toContain('{guest_name}')
      expect(unpaid.body).not.toMatch(/solmios/i)
    }
    expect(getCodeDefault('reservation_new_staff', 'es').body).not.toBe(getCodeDefault('reservation_new_staff', 'pt').body)
    expect(getCodeDefault('reservation_new_staff', 'es').body).toContain('desde el motor web')
    expect(getCodeDefault('reservation_received_unpaid', 'es').body).toContain('el hotel te contactará para coordinar el pago')
    expect(getCodeDefault('reservation_received_unpaid', 'en').body).toContain('the hotel will contact you')
    expect(getCodeDefault('reservation_received_unpaid', 'pt').body).toContain('o hotel entrará em contato')
  })

  // La ingestión de Channex no recibe dato de cobro: la plantilla OTA nombra al canal y NO
  // afirma un estado del pago (ni "motor web", ni "Pendiente de pago").
  it('reservation_new_ota_staff en es/en/pt: {channel_name}, sin {payment_status} ni "motor web"', () => {
    for (const lang of ['es', 'en', 'pt'] as const) {
      const ota = getCodeDefault('reservation_new_ota_staff', lang)
      expect(ota.subject).toBe('[{platform_name}] {title}')
      expect(ota.body).toContain('{channel_name}')
      expect(ota.body).toContain('{platform_name}')
      expect(ota.body).toContain('{panel_link}')
      expect(ota.body).toContain('{total_amount}')
      expect(ota.body).not.toContain('{payment_status}')
      expect(ota.body).not.toMatch(/motor web|booking engine|motor de reservas/i)
      expect(ota.body).not.toMatch(/solmios/i)
    }
    expect(getCodeDefault('reservation_new_ota_staff', 'es').body).toContain('Entró una reserva desde {channel_name}')
    expect(getCodeDefault('reservation_new_ota_staff', 'en').body).toContain('A booking came in from {channel_name}')
    expect(getCodeDefault('reservation_new_ota_staff', 'pt').body).toContain('Entrou uma reserva por {channel_name}')
  })
})
