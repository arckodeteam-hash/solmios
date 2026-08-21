// shared/tests/auto-payment-request.test.ts — Alta automática del link de cobro al crear la reserva.
//
// El monto del payment request automático es el saldo pendiente calculado con la fórmula única
// (`shared/utils/reservation-balance`), que incluye `otherCharges`. Antes se hacía a mano
// (`totalAmount − deposit`) y una reserva con otros cobros nacía con el link corto.
//
// SEC3-4/COR-E: la fila la crea el SERVICE del módulo dueño (techo + lock + re-verificación
// post-commit), no un `orm.create` directo — estos tests ejercen el puerto que el connector
// `reservas-payment-requests` inyecta.

import { describe, it, expect } from 'bun:test'
import { handleReservationCreated } from '../usecases/auto-payment-request'

const AUTO_ON = { id: 'cfg1', hotelId: 'h1', key: 'automation_config', value: JSON.stringify({ autoPaymentRequest: true }) }

function ormWith(opts: { config?: any[] } = {}) {
  const created: Record<string, any[]> = {}
  const queries: { entity: string; filter: any }[] = []
  const orm = {
    create: async (entity: string, data: any) => {
      (created[entity] ??= []).push(data)
      return data
    },
    findMany: async (entity: string, filter: any) => {
      queries.push({ entity, filter })
      if (entity === 'Configuration') return opts.config ?? [AUTO_ON]
      return []
    },
  }
  return { orm, created, queries }
}

/** Doble del service de payment-requests: registra lo que el hook le pide crear. */
function creatorWith(opts: { fail?: Error } = {}) {
  const calls: any[] = []
  return {
    calls,
    create: async (dto: any, user: any) => {
      calls.push({ dto, user })
      if (opts.fail) throw opts.fail
      return { id: 'pr-auto', status: 'pending', ...dto }
    },
  }
}

const RESERVA = { id: 'r1', hotelId: 'h1', totalAmount: 500, deposit: 100, otherCharges: 40, currency: 'USD', status: 'pending' }

describe('handleReservationCreated', () => {
  it('crea el payment request por el saldo REAL (incluye otherCharges) vía el service dueño', async () => {
    const { orm, created } = ormWith()
    const creator = creatorWith()
    await handleReservationCreated(orm, RESERVA, creator)
    // 500 + 40 − 100 = 440 (antes: 400, el link nacía corto por los otros cobros)
    expect(creator.calls).toHaveLength(1)
    expect(creator.calls[0].dto).toMatchObject({ hotelId: 'h1', reservationId: 'r1', amount: 440, currency: 'USD' })
    // Actor de sistema, no un usuario del panel.
    expect(creator.calls[0].user).toMatchObject({ id: 'system', hotelId: 'h1' })
    // SEC3-4: el hook NO escribe `payment_requests` por su cuenta — el único escritor es el service.
    expect(created.PaymentRequests).toBeUndefined()
  })

  it('siempre deja el audit log del alta, aunque la automatización esté apagada', async () => {
    const { orm, created } = ormWith({ config: [] })
    const creator = creatorWith()
    await handleReservationCreated(orm, RESERVA, creator)
    expect(created.Auditlog).toHaveLength(1)
    expect(creator.calls).toHaveLength(0)
  })

  it('sin saldo pendiente no crea nada', async () => {
    const { orm } = ormWith()
    const creator = creatorWith()
    await handleReservationCreated(orm, { ...RESERVA, deposit: 540 }, creator)
    expect(creator.calls).toHaveLength(0)
  })

  it('fail-closed: sin el service del módulo dueño no crea el link por fuera del techo', async () => {
    const { orm, created } = ormWith()
    await handleReservationCreated(orm, RESERVA)
    expect(created.PaymentRequests).toBeUndefined()
  })

  it('el dedup no es del hook: si el techo del service rechaza (ya hay un link vivo), se traga', async () => {
    const { orm } = ormWith()
    const creator = creatorWith({ fail: new Error('La reserva ya tiene links de pago pendientes') })
    await expect(handleReservationCreated(orm, RESERVA, creator)).resolves.toBeUndefined()
    expect(creator.calls).toHaveLength(1)
  })

  // COR-10: en el alta no hay extras todavía — ir a buscarlos es un roundtrip por reserva creada.
  it('no consulta `ReservationAddons` en el alta', async () => {
    const { orm, queries } = ormWith()
    await handleReservationCreated(orm, RESERVA, creatorWith())
    expect(queries.some((q) => q.entity === 'ReservationAddons')).toBe(false)
  })

  it('SEC3-4: ya no lee `PaymentRequests` directo — el dedup vive en el techo del service', async () => {
    const { orm, queries } = ormWith()
    await handleReservationCreated(orm, RESERVA, creatorWith())
    expect(queries.some((q) => q.entity === 'PaymentRequests')).toBe(false)
  })
})
