// marketing/tests/controller-hotelid.test.ts — H1/H2 de la auditoría qa-ui/config-2026-08-22.
//
// El schema exige `hotelId` pero el cliente NO lo manda (auto-messages/index.vue y
// whatsapp-templates/index.vue arman el payload sin hotelId). El controller lo inyectaba
// DESPUÉS de `validateSchema` → 400 "hotelId is required" SIEMPRE: crear auto-mensajes y
// plantillas WhatsApp era funcionalidad muerta. Ahora se inyecta ANTES (withHotelId), igual
// que el fix de crm. Estos tests clavan esa convención: el hotelId que llega al service es
// el del TOKEN y el del body ajeno se pisa (multi-tenant no roto).
//
// Regresión del bug real: repro API sin hotelId → 400 {"fields":{"hotelId":["hotelId is required"]}}.

import { describe, it, expect } from 'bun:test'
import { MarketingController } from '../controller'

const silentLog = { info() {}, warn() {}, error() {}, debug() {} } as any

/** Service espía: graba el hotelId con el que cada create fue invocado. */
function makeController() {
  const calls: Array<[string, ...unknown[]]> = []
  const service = {
    createAutoMessage: async (dto: any) => { calls.push(['createAutoMessage', dto]); return dto },
    createTemplate: async (dto: any) => { calls.push(['createTemplate', dto]); return dto },
    createMessageLog: async (dto: any) => { calls.push(['createMessageLog', dto]); return dto },
  } as any
  return { controller: new MarketingController(service, silentLog), calls }
}

const req = (user: any, body: any = {}, query: any = {}) => ({ user, query, params: {}, body }) as any

const merchant = { id: 'u1', role: 'hotel_admin', hotelId: 'h1' }

describe('MarketingController — hotelId inyectado ANTES de validar (H1/H2)', () => {
  it('POST auto-mensaje SIN hotelId en body → 201 y se crea en el hotel del token', async () => {
    const { controller, calls } = makeController()
    const res = await controller.createAutoMessage(req(merchant, { title: 'Bienvenida', triggerEvent: 'checkin_day' }))
    expect(res.status).toBe(201)
    expect(calls[0][0]).toBe('createAutoMessage')
    expect((calls[0][1] as any).hotelId).toBe('h1') // hotel del TOKEN, no del body
  })

  it('POST plantilla WhatsApp SIN hotelId en body → 201 y se crea en el hotel del token', async () => {
    const { controller, calls } = makeController()
    const res = await controller.createTemplate(req(merchant, { name: 'Saludo', body: 'Hola {guest_name}' }))
    expect(res.status).toBe(201)
    expect((calls[0][1] as any).hotelId).toBe('h1')
  })

  it('POST message-log SIN hotelId en body → 201 y hotelId del token', async () => {
    const { controller, calls } = makeController()
    const res = await controller.createMessageLog(req(merchant, { channel: 'email', status: 'sent' }))
    expect(res.status).toBe(201)
    expect((calls[0][1] as any).hotelId).toBe('h1')
  })

  it('hotelId AJENO en el body se pisa con el del token (multi-tenant no roto)', async () => {
    const { controller, calls } = makeController()
    await controller.createAutoMessage(req(merchant, { hotelId: 'h2-victima', title: 'Bienvenida', triggerEvent: 'checkin_day' }))
    expect((calls[0][1] as any).hotelId).toBe('h1') // NO 'h2-victima'
  })

  it('super_admin SÍ puede apuntar a otro hotel vía ?hotelId (cross-hotel legítimo)', async () => {
    const { controller, calls } = makeController()
    await controller.createAutoMessage(req({ id: 'admin', role: 'super_admin', hotelId: 'platform' }, { title: 'Bienvenida', triggerEvent: 'checkin_day' }, { hotelId: 'h2' }))
    expect((calls[0][1] as any).hotelId).toBe('h2')
  })

  it('la validación del schema sigue viva: título faltante → ValidationError, no 201', async () => {
    const { controller } = makeController()
    expect(controller.createAutoMessage(req(merchant, { triggerEvent: 'checkin_day' }))).rejects.toThrow()
    expect(controller.createTemplate(req(merchant, {}))).rejects.toThrow()
  })
})
