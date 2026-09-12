// marketing/tests/validators.test.ts — El enum `event` de auto_messages acepta lo que el panel ofrece.
//
// #267: las plantillas `reservation_new_staff`, `reservation_new_ota_staff` y
// `reservation_received_unpaid` tienen default en `services/notification-defaults.ts` y la doc
// decía que el hotel podía pisarlas desde auto_messages, pero el enum del validator no las
// incluía: guardar una daba 400 y el override nunca existía.
import { describe, it, expect } from 'bun:test'
import { validateSchema } from 'arckode-framework'
import { NOTIFICATION_DEFAULTS } from '../../../services/notification-defaults'
import { CreateAutoMessageSchema, NOTIFICATION_EVENTS, UpdateAutoMessageSchema } from '../validators/schema'

const base = { hotelId: 'h1', title: 'Aviso', triggerEvent: 'on_reservation' }

describe('auto_messages.event (#267)', () => {
  for (const event of ['reservation_new_staff', 'reservation_new_ota_staff', 'reservation_received_unpaid'] as const) {
    it(`${event} es válido al crear y al editar`, () => {
      expect(validateSchema(CreateAutoMessageSchema, { ...base, event }).event).toBe(event)
      expect(validateSchema(UpdateAutoMessageSchema, { event }).event).toBe(event)
    })
  }

  it('todo evento del enum tiene default en código (si no, el override no tendría fallback)', () => {
    for (const event of NOTIFICATION_EVENTS) {
      expect(NOTIFICATION_DEFAULTS[event]).toBeDefined()
    }
  })

  it('un evento fuera del catálogo se rechaza', () => {
    expect(() => validateSchema(CreateAutoMessageSchema, { ...base, event: 'reservation_new_fax' })).toThrow()
    expect(() => validateSchema(UpdateAutoMessageSchema, { event: 'reservation_new_fax' })).toThrow()
  })
})
