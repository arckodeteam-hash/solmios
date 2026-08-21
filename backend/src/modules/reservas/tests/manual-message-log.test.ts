// reservas/tests/manual-message-log.test.ts — Traza de los envíos manuales al huésped.
//
// Regresión (bug 2026-08-19): las plantillas de WhatsApp del modal abrían `wa.me` y no escribían
// nada; "Historial de Envíos" (`message_logs`) nunca reflejaba lo que el mostrador le mandó al
// huésped. Este usecase es el que deja la constancia — con el Auth REAL para que el multi-tenant
// no se caiga por un doble complaciente (mismo criterio que ownership.test.ts).

import { describe, it, expect } from 'bun:test'
import { Auth } from 'arckode-framework'
import { logManualMessage, toMessageLogView } from '../usecases/message-log'
import { ReservasController } from '../controller'

const noopLogger = { info() {}, warn() {}, error() {}, debug() {} } as any
const realAuth = new Auth({ sign: () => '', verify: () => ({}) } as any, 'test-secret', noopLogger)

const HOTEL = 'hotel-a'
const OTRO_HOTEL = 'hotel-b'
const RESERVA = { id: 'r1', hotelId: HOTEL, guestId: 'g1' }

function harness() {
  const created: any[] = []
  return {
    created,
    deps: {
      messageLogRepo: { create: async (d: any) => { created.push(d); return { id: 'ml1', ...d } } } as any,
      reservationRepo: { findById: async () => RESERVA } as any,
      // El ownership se resuelve contra el hotel PERSISTIDO del usuario, no contra el del token.
      userRepo: { findById: async (id: string) => ({ id, hotelId: id === 'u9' ? OTRO_HOTEL : HOTEL }) } as any,
      auth: realAuth,
    },
  }
}

describe('logManualMessage', () => {
  it('asienta el envío en message_logs con la reserva, el huésped y el canal', async () => {
    const h = harness()
    const out = await logManualMessage(
      h.deps, 'r1',
      { messageType: 'whatsapp', recipient: '+18095550000', reference: 'Bienvenida' },
      { id: 'u1', role: 'hotel_admin', hotelId: HOTEL },
    )
    expect(out.manual).toBe(true)
    expect(out.reference).toBe('Bienvenida')
    expect(out.sentByUserId).toBe('u1')
    expect(h.created).toHaveLength(1)
    expect(h.created[0]).toMatchObject({
      hotelId: HOTEL, reservationId: 'r1', guestId: 'g1',
      messageType: 'whatsapp', recipient: '+18095550000',
    })
    expect(JSON.parse(h.created[0].response)).toEqual({ kind: 'manual', reference: 'Bienvenida', byUserId: 'u1' })
    expect(h.created[0].sentAt).toBeTruthy()
  })

  it('NO se marca como "sent": el envío es manual y el sistema no puede confirmar la entrega', async () => {
    const h = harness()
    const call = logManualMessage(
      h.deps, 'r1',
      { messageType: 'whatsapp', status: 'sent' as any },
      { id: 'u1', role: 'hotel_admin', hotelId: HOTEL },
    )
    // `sent` no es un estado que el panel pueda declarar: se rechaza, no se reescribe en silencio.
    await expect(call).rejects.toThrow('status inválido')
    expect(h.created).toHaveLength(0)
  })

  it('sin status explícito queda "queued" (abierto/preparado)', async () => {
    const h = harness()
    await logManualMessage(h.deps, 'r1', { messageType: 'whatsapp' }, { id: 'u1', role: 'hotel_admin', hotelId: HOTEL })
    expect(h.created[0].status).toBe('queued')
  })

  it('bloquea a un usuario de otro hotel (multi-tenant)', async () => {
    const h = harness()
    const call = logManualMessage(
      h.deps, 'r1',
      { messageType: 'whatsapp' },
      { id: 'u9', role: 'hotel_admin', hotelId: OTRO_HOTEL },
    )
    await expect(call).rejects.toThrow()
    expect(h.created).toHaveLength(0)
  })

  it('canal desconocido se rechaza (no escribe basura ni lo reescribe a whatsapp)', async () => {
    const h = harness()
    const call = logManualMessage(
      h.deps, 'r1',
      { messageType: 'telepatia' },
      { id: 'u1', role: 'hotel_admin', hotelId: HOTEL },
    )
    await expect(call).rejects.toThrow('messageType inválido')
    expect(h.created).toHaveLength(0)
  })

  // SEC-3: el autor del envío no puede falsificarse desde `reference`.
  it('un `reference` que imita el separador NO reescribe quién mandó el mensaje', async () => {
    const h = harness()
    const out = await logManualMessage(
      h.deps, 'r1',
      { messageType: 'whatsapp', reference: 'x:by:usuario-inventado' },
      { id: 'u1', role: 'hotel_admin', hotelId: HOTEL },
    )
    expect(out.sentByUserId).toBe('u1')
    expect(toMessageLogView(h.created[0]).sentByUserId).toBe('u1')
  })
})

// SEC-2: el detalle de la reserva se sirve con `reservations:view`; `response` guarda el error crudo
// del transporte de email de los auto-messages, que antes exigía `settings:view` en marketing.
describe('toMessageLogView — proyección segura de message_logs', () => {
  it('no expone `response` ni ningún campo fuera de la lista', () => {
    const view = toMessageLogView({
      id: 'ml1', hotelId: HOTEL, reservationId: 'r1', messageType: 'email', status: 'failed',
      recipient: 'a@b.com', response: 'SMTP 535 auth failed: user smtp-user@hotel pass ****',
      sentAt: '2026-08-19T10:00:00.000Z', messageId: 'x',
    })
    expect(Object.keys(view).sort()).toEqual(
      ['id', 'manual', 'messageType', 'recipient', 'reference', 'sentAt', 'sentByUserId', 'status'],
    )
    expect(JSON.stringify(view)).not.toContain('SMTP')
    expect(view.manual).toBe(false)
    expect(view.reference).toBeNull()
  })

  it('cae a createdAt cuando la fila no tiene sentAt', () => {
    expect(toMessageLogView({ id: 'ml2', createdAt: '2026-01-01T00:00:00.000Z' }).sentAt).toBe('2026-01-01T00:00:00.000Z')
  })
})

// ── QA7-2: el adaptador HTTP del endpoint (POST /api/reservations/:id/message-log) ────────────
//
// El usecase tenía red; el controller no tenía NINGUNA: ni la rama 503 (repo sin cablear, que
// antes devolvía 201 con `{logged:false}` y le mentía al operador), ni el mapeo de errores.
describe('ReservasController.logManualMessage', () => {
  const USER = { id: 'u1', role: 'hotel_admin', hotelId: HOTEL }
  const req = (body: any = { messageType: 'whatsapp', reference: 'Bienvenida' }, id = 'r1') =>
    ({ params: { id }, body, user: USER } as any)

  /** Controller con las MISMAS piezas que arma `reservas/index.ts`, salvo el repo bajo prueba. */
  function controller(over: { messageLogRepo?: any; reservationRepo?: any; userRepo?: any } = {}) {
    const h = harness()
    return new ReservasController(
      {} as any, noopLogger, {} as any, {} as any,
      over.reservationRepo ?? h.deps.reservationRepo,
      over.userRepo ?? h.deps.userRepo,
      realAuth,
      undefined, undefined,
      'messageLogRepo' in over ? over.messageLogRepo : h.deps.messageLogRepo,
    )
  }

  it('sin repo de message_logs devuelve 503 — nunca un 201 que finge haber registrado', async () => {
    const res = await controller({ messageLogRepo: undefined }).logManualMessage(req())
    expect(res.status).toBe(503)
    expect((res.body as any).error).toContain('no está disponible')
  })

  it('201 con la vista segura del registro creado', async () => {
    const res = await controller().logManualMessage(req())
    expect(res.status).toBe(201)
    expect(res.body).toMatchObject({ manual: true, reference: 'Bienvenida', sentByUserId: 'u1' })
    expect(Object.keys(res.body as any)).not.toContain('response')
  })

  it('404 si la reserva no existe', async () => {
    const res = await controller({ reservationRepo: { findById: async () => null } }).logManualMessage(req())
    expect(res.status).toBe(404)
  })

  it('403 si la reserva es de otro hotel (AuthError/ForbiddenError del assertOwnership)', async () => {
    const res = await controller({ userRepo: { findById: async (id: string) => ({ id, hotelId: OTRO_HOTEL }) } })
      .logManualMessage(req())
    expect(res.status).toBe(403)
  })

  it('400 si el canal no es uno de los soportados (ValidationError del usecase)', async () => {
    const res = await controller().logManualMessage(req({ messageType: 'paloma-mensajera' }))
    expect(res.status).toBe(400)
  })

  it('500 si la escritura del log falla por un error inesperado', async () => {
    const res = await controller({ messageLogRepo: { create: async () => { throw new Error('DB caída') } } })
      .logManualMessage(req())
    expect(res.status).toBe(500)
    expect((res.body as any).error).toBe('DB caída')
  })
})
