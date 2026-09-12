// services/notification-defaults.test.ts — Tests de los defaults de plantillas (spec 11.1.6).

import { describe, it, expect } from 'bun:test'
import { getCodeDefault, NOTIFICATION_DEFAULTS, type NotificationLanguage } from './notification-defaults'

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

  // #270: reservation_confirmed es el recibo completo — desglose, gestión, enlaces y tono formal.
  describe('reservation_confirmed (#270)', () => {
    const langs: NotificationLanguage[] = ['es', 'en', 'pt']
    const confirmed = (lang: unknown) => getCodeDefault('reservation_confirmed', lang as NotificationLanguage)
    // Niños, promo, botones y la mención al recibo llegan como fragmentos condicionales
    // (`{occupancy}`, `{promo_lines}`, `{actions_lines}`, `{receipt_intro}` de
    // shared/usecases/confirmation-email-variables.ts): el renderer no tiene condicionales.
    const REQUIRED = [
      '{extras_lines}', '{tax_lines}', '{rooms_lines}', '{rooms_count}', '{child_amenities_lines}', '{room_amenities_lines}',
      '{actions_lines}', '{receipt_intro}', '{platform_name}', '{crib}', '{meal_plan}', '{estimated_arrival}', '{special_requests}',
      '{occupancy}', '{subtotal}', '{promo_lines}', '{total_amount}',
      '{deposit_amount}', '{pending_amount}', '{payment_method}', '{locator}', '{cancellation_policy}', '{hotel_address}',
    ]

    it.each(langs)('%s: el cuerpo pide todas las variables del recibo', (lang) => {
      const { body } = confirmed(lang)
      for (const v of REQUIRED) expect(body).toContain(v)
    })

    it.each(langs)('%s: sin botones con href vacío ni "0 niños ()" ni "Código promocional  −—" fijos en la plantilla', (lang) => {
      const { body } = confirmed(lang)
      // Los enlaces NO van fijos: sin URL pública (reserva del panel) no hay botón.
      expect(body).not.toContain('href="{manage_url}"')
      expect(body).not.toContain('href="{receipt_url}"')
      expect(body).not.toMatch(/PDF/)
      // Niños y promo tampoco: sin dato el fragmento es ''.
      expect(body).not.toContain('{children}')
      expect(body).not.toContain('{children_ages}')
      expect(body).not.toContain('{promo_code}')
      expect(body).not.toContain('{promo_discount}')
      // La mención al recibo es condicional, no texto fijo.
      expect(body).not.toMatch(/recibo de su pago|payment receipt|recibo do seu pagamento/)
    })

    it.each(langs)('%s: subject con hotel y localizador', (lang) => {
      const { subject } = confirmed(lang)
      expect(subject).toContain('{hotel_name}')
      expect(subject).toContain('{locator}')
    })

    it.each(langs)('%s: sin marca hardcodeada (usa {platform_name})', (lang) => {
      const { subject, body } = confirmed(lang)
      expect(subject + body).not.toContain('SolmiOS')
      expect(body).toContain('{platform_name}')
    })

    it('es: tono de usted (nada de tuteo)', () => {
      const { subject, body } = getCodeDefault('reservation_confirmed', 'es')
      for (const tuteo of ['Tu reserva', 'Te mandamos', 'Te esperamos', 'Hola <strong>', 'tu habitación']) {
        expect(body).not.toContain(tuteo)
        expect(subject).not.toContain(tuteo)
      }
      expect(body).toContain('Su reserva ha sido confirmada')
      expect(body).toContain('Le esperamos')
    })

    it('en/pt: fórmulas formales', () => {
      expect(getCodeDefault('reservation_confirmed', 'en').body).not.toContain('Your booking has')
      expect(getCodeDefault('reservation_confirmed', 'pt').body).not.toContain('Sua reserva foi')
      expect(getCodeDefault('reservation_confirmed', 'pt').body).not.toContain('você')
    })

    it('las 3 plantillas comparten el mismo esqueleto visual', () => {
      for (const lang of langs) {
        const { body } = confirmed(lang)
        expect(body).toContain('background:#1a2b4c')
        expect(body).toContain('background:#f8f9fa')
        expect(body).toContain('🏨 {hotel_name}')   // el renderer lo cambia por logo_url
      }
    })
  })

  it('NOTIFICATION_DEFAULTS registra todos los eventos × 3 idiomas', () => {
    expect(Object.keys(NOTIFICATION_DEFAULTS).sort()).toEqual(['checkin_welcome', 'checkout', 'invoice', 'no_show', 'payment_link', 'reminder', 'reservation_approved', 'reservation_confirmed', 'reservation_presale', 'reservation_rejected', 'review_request'])
    for (const event of Object.keys(NOTIFICATION_DEFAULTS)) {
      const langs = Object.keys((NOTIFICATION_DEFAULTS as any)[event])
      expect(langs.sort()).toEqual(['en', 'es', 'pt'])
    }
  })
})
