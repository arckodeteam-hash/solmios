// connectors/tests/reservas-ttlock-assign.test.ts — #258 (REQ-HAC-03): el PIN TTLock se genera al
// ASIGNAR la habitación, no al pagar. Se prueba el cableado de los dos connectors juntos:
//   - payment-requests-ttlock: pago de una reserva SIN habitación → 0 códigos (no hay cerradura).
//   - reservas-ttlock.onRoomAssigned: primera asignación de una reserva confirmada/pagada →
//     generateCodeIfAbsent; reasignación → generateCode (keepSingleCode revoca el anterior);
//     pending sin pago → nada; desasignar → expireCodesByReservation; ttlock ausente → no rompe.

import { describe, it, expect } from 'bun:test'
import type { ConnectorContext } from 'arckode-framework'
import { silentLogger } from 'arckode-framework/testing'
import { reservasTtlockConnector, isReservationEntitledToCode } from '../reservas-ttlock'
import { paymentRequestsTtlockConnector } from '../payment-requests-ttlock'

const log = silentLogger()
const SYSTEM_USER = { id: 'system-connector', role: 'super_admin', hotelId: 'h1' }

/** ttlock fake: cuenta llamadas por método. */
function makeTtlock() {
  const calls = { generateCodeIfAbsent: [] as Array<[string, string]>, generateCode: [] as Array<[string, string]>, expire: [] as string[] }
  const ttlock = {
    generateCodeIfAbsent: async (h: string, r: string) => { calls.generateCodeIfAbsent.push([h, r]); return { id: 'c-new' } },
    generateCode: async (h: string, r: string) => { calls.generateCode.push([h, r]); return { id: 'c-new' } },
    expireCodesByReservation: async (r: string) => { calls.expire.push(r) },
  }
  return { ttlock, calls }
}

/**
 * ctx fake: `reservas` y `payment-requests` capturan los sockets que registran los connectors;
 * `reservas.getById` devuelve la reserva que el test controla (y registra con qué user se leyó).
 */
function makeCtx(reservation: any, modules: Record<string, any> = {}) {
  const captured = { reservas: {} as any, paymentRequests: {} as any }
  const getByIdCalls: Array<[string, any]> = []
  const reservas = {
    setSockets: (s: any) => Object.assign(captured.reservas, s),
    getById: async (id: string, user: any) => {
      getByIdCalls.push([id, user])
      if (!reservation) throw new Error('Reserva no encontrada')
      return reservation
    },
  }
  const paymentRequests = { setSockets: (s: any) => Object.assign(captured.paymentRequests, s) }
  const ctx = {
    resolveModule: (name: string) => {
      if (name === 'reservas') return reservas
      if (name === 'payment-requests') return paymentRequests
      if (name in modules) return modules[name]
      throw new Error(`módulo desconocido: ${name}`)
    },
  } as unknown as ConnectorContext
  return { ctx, captured, getByIdCalls }
}

const CONFIRMED_NO_ROOM = { id: 'res1', hotelId: 'h1', roomId: null, status: 'confirmed', depositStatus: 'paid', totalAmount: 100, pendingAmount: 70 }

describe('reservas-ttlock — código al asignar habitación (#258)', () => {
  it('flujo completo: pago sin habitación → 0 códigos; asignar después → 1 (generateCodeIfAbsent)', async () => {
    const reservation: any = { ...CONFIRMED_NO_ROOM }
    const { ttlock, calls } = makeTtlock()
    const { ctx, captured, getByIdCalls } = makeCtx(reservation, { ttlock })
    paymentRequestsTtlockConnector(log)(ctx)
    reservasTtlockConnector(ctx, log)

    // (a) Se paga la seña de una reserva SIN habitación: no hay cerradura → 0 códigos.
    await captured.paymentRequests.onPaymentRequestPaid({ hotelId: 'h1', reservationId: 'res1' })
    expect(calls.generateCodeIfAbsent).toHaveLength(0)
    expect(calls.generateCode).toHaveLength(0)
    expect(getByIdCalls[0]).toEqual(['res1', SYSTEM_USER])

    // (b) Recepción asigna la habitación: la reserva ya está confirmada/pagada → 1 código.
    reservation.roomId = 'r1'
    await captured.reservas.onRoomAssigned({ reservationId: 'res1', hotelId: 'h1', roomId: 'r1', previousRoomId: null })
    expect(calls.generateCodeIfAbsent).toEqual([['h1', 'res1']])
    expect(calls.generateCode).toHaveLength(0)
    expect(calls.expire).toHaveLength(0)
  })

  it('pago de una reserva CON habitación sigue generando (compat con el flujo de la seña)', async () => {
    const { ttlock, calls } = makeTtlock()
    const { ctx, captured } = makeCtx({ ...CONFIRMED_NO_ROOM, roomId: 'r1' }, { ttlock })
    paymentRequestsTtlockConnector(log)(ctx)
    await captured.paymentRequests.onPaymentRequestPaid({ hotelId: 'h1', reservationId: 'res1' })
    expect(calls.generateCodeIfAbsent).toEqual([['h1', 'res1']])
  })

  it('reasignar (r1 → r2) llama a generateCode: crea el PIN de la cerradura nueva y reemplaza el anterior', async () => {
    const { ttlock, calls } = makeTtlock()
    const { ctx, captured } = makeCtx({ ...CONFIRMED_NO_ROOM, roomId: 'r2' }, { ttlock })
    reservasTtlockConnector(ctx, log)
    await captured.reservas.onRoomAssigned({ reservationId: 'res1', hotelId: 'h1', roomId: 'r2', previousRoomId: 'r1' })
    expect(calls.generateCode).toEqual([['h1', 'res1']])
    expect(calls.generateCodeIfAbsent).toHaveLength(0)
    expect(calls.expire).toHaveLength(0)
  })

  it('re-asignar la MISMA habitación no regenera: es idempotente (generateCodeIfAbsent)', async () => {
    const { ttlock, calls } = makeTtlock()
    const { ctx, captured } = makeCtx({ ...CONFIRMED_NO_ROOM, roomId: 'r1' }, { ttlock })
    reservasTtlockConnector(ctx, log)
    await captured.reservas.onRoomAssigned({ reservationId: 'res1', hotelId: 'h1', roomId: 'r1', previousRoomId: 'r1' })
    expect(calls.generateCode).toHaveLength(0)
    expect(calls.generateCodeIfAbsent).toEqual([['h1', 'res1']])
  })

  it('reserva pending sin pago: asignar habitación NO genera código', async () => {
    const { ttlock, calls } = makeTtlock()
    const pending = { id: 'res1', hotelId: 'h1', roomId: 'r1', status: 'pending', depositStatus: 'pending', totalAmount: 100, pendingAmount: 100 }
    const { ctx, captured } = makeCtx(pending, { ttlock })
    reservasTtlockConnector(ctx, log)
    await captured.reservas.onRoomAssigned({ reservationId: 'res1', hotelId: 'h1', roomId: 'r1', previousRoomId: null })
    await captured.reservas.onRoomAssigned({ reservationId: 'res1', hotelId: 'h1', roomId: 'r2', previousRoomId: 'r1' })
    expect(calls.generateCodeIfAbsent).toHaveLength(0)
    expect(calls.generateCode).toHaveLength(0)
    expect(calls.expire).toHaveLength(0)
  })

  it('reserva pending pero saldada (pendingAmount 0) sí genera', async () => {
    const { ttlock, calls } = makeTtlock()
    const paidInFull = { id: 'res1', hotelId: 'h1', roomId: 'r1', status: 'pending', depositStatus: 'pending', totalAmount: 100, pendingAmount: 0 }
    const { ctx, captured } = makeCtx(paidInFull, { ttlock })
    reservasTtlockConnector(ctx, log)
    await captured.reservas.onRoomAssigned({ reservationId: 'res1', hotelId: 'h1', roomId: 'r1', previousRoomId: null })
    expect(calls.generateCodeIfAbsent).toEqual([['h1', 'res1']])
  })

  it('desasignar (roomId null) expira los códigos vigentes: sin habitación no hay cerradura', async () => {
    const { ttlock, calls } = makeTtlock()
    const { ctx, captured, getByIdCalls } = makeCtx({ ...CONFIRMED_NO_ROOM }, { ttlock })
    reservasTtlockConnector(ctx, log)
    await captured.reservas.onRoomAssigned({ reservationId: 'res1', hotelId: 'h1', roomId: null, previousRoomId: 'r1' })
    expect(calls.expire).toEqual(['res1'])
    expect(calls.generateCodeIfAbsent).toHaveLength(0)
    expect(calls.generateCode).toHaveLength(0)
    expect(getByIdCalls).toHaveLength(0) // no hace falta leer la reserva para expirar
  })

  it('ttlock no registrado en el despliegue: asignar/reasignar/desasignar no rompen', async () => {
    const { ctx, captured } = makeCtx({ ...CONFIRMED_NO_ROOM, roomId: 'r1' }) // sin ttlock
    reservasTtlockConnector(ctx, log)
    await expect(captured.reservas.onRoomAssigned({ reservationId: 'res1', hotelId: 'h1', roomId: 'r1', previousRoomId: null })).resolves.toBeUndefined()
    await expect(captured.reservas.onRoomAssigned({ reservationId: 'res1', hotelId: 'h1', roomId: 'r2', previousRoomId: 'r1' })).resolves.toBeUndefined()
    await expect(captured.reservas.onRoomAssigned({ reservationId: 'res1', hotelId: 'h1', roomId: null, previousRoomId: 'r2' })).resolves.toBeUndefined()
  })

  it('si ttlock falla (habitación sin cerradura, hotel sin conectar) la asignación NO se rompe', async () => {
    const ttlock = {
      generateCodeIfAbsent: async () => { throw new Error('La habitación no tiene cerradura TTLock') },
      generateCode: async () => { throw new Error('TTLock no conectado') },
      expireCodesByReservation: async () => { throw new Error('boom') },
    }
    const { ctx, captured } = makeCtx({ ...CONFIRMED_NO_ROOM, roomId: 'r1' }, { ttlock })
    reservasTtlockConnector(ctx, log)
    await expect(captured.reservas.onRoomAssigned({ reservationId: 'res1', hotelId: 'h1', roomId: 'r1', previousRoomId: null })).resolves.toBeUndefined()
    await expect(captured.reservas.onRoomAssigned({ reservationId: 'res1', hotelId: 'h1', roomId: 'r2', previousRoomId: 'r1' })).resolves.toBeUndefined()
    await expect(captured.reservas.onRoomAssigned({ reservationId: 'res1', hotelId: 'h1', roomId: null, previousRoomId: 'r2' })).resolves.toBeUndefined()
  })

  // Revisión PR #315: al reasignar, `generateCode` sólo revoca el anterior DESPUÉS de crear el
  // nuevo (contrato de ttlock). Si la cerradura nueva rechaza el PIN, el viejo seguía abriendo la
  // habitación ANTERIOR, que ya no es de este huésped. Ahora se expira igual, con error en el log.
  it('reasignar con la cerradura nueva fallando: el código anterior se expira igual y se loguea error (reserva sin código)', async () => {
    const errors: string[] = []
    const expired: string[] = []
    const ttlock = {
      generateCodeIfAbsent: async () => ({ id: 'c-new' }),
      generateCode: async () => { throw new Error('lock unreachable') },
      expireCodesByReservation: async (r: string) => { expired.push(r) },
    }
    const { ctx, captured } = makeCtx({ ...CONFIRMED_NO_ROOM, roomId: 'r2' }, { ttlock })
    reservasTtlockConnector(ctx, { info: () => {}, error: (m: string) => { errors.push(m) } } as any)
    await expect(captured.reservas.onRoomAssigned({ reservationId: 'res1', hotelId: 'h1', roomId: 'r2', previousRoomId: 'r1' })).resolves.toBeUndefined()
    expect(expired).toEqual(['res1'])
    expect(errors).toHaveLength(1)
    expect(errors[0]).toContain('res1')
    expect(errors[0]).toContain('SIN código')
  })

  it('reasignar OK: NO expira (keepSingleCode ya dejó uno solo) ni loguea error', async () => {
    const errors: string[] = []
    const { ttlock, calls } = makeTtlock()
    const { ctx, captured } = makeCtx({ ...CONFIRMED_NO_ROOM, roomId: 'r2' }, { ttlock })
    reservasTtlockConnector(ctx, { info: () => {}, error: (m: string) => { errors.push(m) } } as any)
    await captured.reservas.onRoomAssigned({ reservationId: 'res1', hotelId: 'h1', roomId: 'r2', previousRoomId: 'r1' })
    expect(calls.expire).toEqual([])
    expect(errors).toEqual([])
  })

  it('reasignar con la nueva Y el revoke fallando: no rompe y deja DOS errores (el PIN viejo sigue abriendo)', async () => {
    const errors: string[] = []
    const ttlock = {
      generateCodeIfAbsent: async () => ({}),
      generateCode: async () => { throw new Error('lock unreachable') },
      expireCodesByReservation: async () => { throw new Error('gateway offline') },
    }
    const { ctx, captured } = makeCtx({ ...CONFIRMED_NO_ROOM, roomId: 'r2' }, { ttlock })
    reservasTtlockConnector(ctx, { info: () => {}, error: (m: string) => { errors.push(m) } } as any)
    await expect(captured.reservas.onRoomAssigned({ reservationId: 'res1', hotelId: 'h1', roomId: 'r2', previousRoomId: 'r1' })).resolves.toBeUndefined()
    expect(errors).toHaveLength(2)
    expect(errors[1]).toContain('SIGUE ABRIENDO')
  })

  it('si la reserva no existe, no genera ni rompe', async () => {
    const { ttlock, calls } = makeTtlock()
    const { ctx, captured } = makeCtx(null, { ttlock })
    reservasTtlockConnector(ctx, log)
    await expect(captured.reservas.onRoomAssigned({ reservationId: 'nope', hotelId: 'h1', roomId: 'r1', previousRoomId: null })).resolves.toBeUndefined()
    expect(calls.generateCodeIfAbsent).toHaveLength(0)
  })

  it('sigue expirando al checkout y a la cancelación (C-1)', async () => {
    const { ttlock, calls } = makeTtlock()
    const { ctx, captured } = makeCtx({ ...CONFIRMED_NO_ROOM, roomId: 'r1' }, { ttlock })
    reservasTtlockConnector(ctx, log)
    await captured.reservas.onReservationCheckedOut({ reservationId: 'res1' })
    await captured.reservas.onReservationCancelled({ reservationId: 'res2' })
    expect(calls.expire).toEqual(['res1', 'res2'])
  })
})

describe('isReservationEntitledToCode', () => {
  it('confirmada o alojada → sí; checked_out/cancelled sin pago → no', () => {
    expect(isReservationEntitledToCode({ status: 'confirmed' })).toBe(true)
    expect(isReservationEntitledToCode({ status: 'checked_in' })).toBe(true)
    expect(isReservationEntitledToCode({ status: 'cancelled', totalAmount: 100, pendingAmount: 100 })).toBe(false)
    expect(isReservationEntitledToCode({ status: 'pending' })).toBe(false)
    expect(isReservationEntitledToCode(null)).toBe(false)
  })
  it('seña pagada o saldo cero (con total > 0) → sí; total 0 sin pago → no', () => {
    expect(isReservationEntitledToCode({ status: 'pending', depositStatus: 'paid' })).toBe(true)
    expect(isReservationEntitledToCode({ status: 'pending', totalAmount: '150', pendingAmount: '0' })).toBe(true)
    expect(isReservationEntitledToCode({ status: 'pending', totalAmount: 0, pendingAmount: 0 })).toBe(false)
    expect(isReservationEntitledToCode({ status: 'pending', totalAmount: 100 })).toBe(false) // pendingAmount ausente
  })
})
