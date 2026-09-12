// #270 — El correo de confirmación creado desde el PANEL usa la misma plantilla que el pago
// del motor público. El renderer deja literal cualquier `{var}` que el flujo no provea, así
// que este test renderiza las tres plantillas con las variables reales del flujo y exige que
// no quede ningún placeholder crudo (un "{manage_url}" visible en el correo es un bug).
import { describe, it, expect } from 'bun:test'
import { silentLogger } from 'arckode-framework/testing'
import { enqueueReservationEmail } from '../usecases/reservation-email'
import { NOTIFICATION_DEFAULTS } from '../../../services/notification-defaults'
import { renderTemplate } from '../../../services/notification-renderer'
import { confirmationVariableDefaults } from '../../../shared/usecases/confirmation-email-variables'

const LANGS = ['es', 'en', 'pt'] as const
const templateOf = (lang: string) => (NOTIFICATION_DEFAULTS as any).reservation_confirmed[lang] as { subject: string; body: string }

async function variablesFor(language: string): Promise<Record<string, string | number>> {
  const sent: any[] = []
  await enqueueReservationEmail({
    emailSender: { enqueueNotification: async (i: any) => { sent.push(i); return 'q1' } },
    guestRepo: { findById: async () => ({ id: 'g1', hotelId: 'h1', name: 'Ana', email: 'ana@example.com', language }) } as any,
    roomRepo: { findById: async () => ({ id: 'r1', hotelId: 'h1', number: '101', type: 'double', basePrice: 100 }) } as any,
    hotelRepo: { findById: async () => ({ id: 'h1', name: 'Hotel Test', phone: '555' }) } as any,
    logger: silentLogger(),
  }, { hotelId: 'h1', guestId: 'g1', roomId: 'r1', checkIn: '2026-10-10', checkOut: '2026-10-12', communicateClient: 'email_confirmation', totalAmount: 200, deposit: 50, paymentMethod: 'card' } as any,
  { id: 'res-1', locator: 'ABC123' })
  expect(sent).toHaveLength(1)
  expect(sent[0].event).toBe('reservation_confirmed')
  return sent[0].variables
}

describe('reservation_confirmed desde el panel (#270)', () => {
  it.each([...LANGS])('%s: ningún placeholder queda literal en subject ni body', async (lang) => {
    const variables = await variablesFor(lang)
    const tpl = templateOf(lang)
    const subject = renderTemplate(tpl.subject, variables, false)
    const body = renderTemplate(tpl.body, variables, true)
    expect(subject).not.toMatch(/\{\w+\}/)
    expect(body).not.toMatch(/\{\w+\}/)
    // Lo que el panel sí conoce pisa la base neutra.
    expect(variables.hotel_name).toBe('Hotel Test')
    expect(variables.locator).toBe('ABC123')
    expect(variables.room_number).toBe('101')
    expect(String(variables.platform_name)).not.toBe('')
  })

  it.each([...LANGS])('%s: la base neutra cubre TODOS los placeholders de la plantilla', (lang) => {
    const defaults = confirmationVariableDefaults(lang)
    const tpl = templateOf(lang)
    const used = new Set([...`${tpl.subject}\n${tpl.body}`.matchAll(/\{(\w+)\}/g)].map((m) => m[1]))
    for (const key of used) expect(key in defaults).toBe(true)
  })
})
