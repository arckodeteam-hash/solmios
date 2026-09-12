// #271 MR-06 — approvalDeadlineHours: horas que el hotel se da para aprobar/rechazar una reserva
// web pendiente (1–168, default 24). Valida el schema del admin (entero acotado, sin coerción),
// el default 24 del ConfigUseCase (filas viejas sin la columna y hoteles sin config) y que el
// GET público de la reserva exponga el plazo del hotel + motivo/reembolso SOLO en rechazo.
import { describe, it, expect, beforeEach, afterEach } from 'bun:test'
import { ValidationError } from 'arckode-framework'
import type { RepositoryAdapter, CacheAdapter } from 'arckode-framework'
import { validateSchema } from '../../../shared/validators/validate-body'
import { UpdateBookingConfigSchema } from '../validators/schema'
import { ConfigUseCase, DEFAULT_APPROVAL_DEADLINE_HOURS } from '../usecases/config'
import { getPublicReservation } from '../usecases/public-reservation'

const noCache = { get: async () => null, set: async () => {}, delete: async () => {} } as unknown as CacheAdapter

function setup(rows: any[]) {
  const created: any[] = []
  const repo = {
    findMany: async () => rows,
    create: async (data: any) => {
      const row = { id: 'cfg1', ...data }
      created.push(row)
      return row
    },
  } as unknown as RepositoryAdapter<any>
  return { usecase: new ConfigUseCase(repo, noCache), created }
}

describe('UpdateBookingConfigSchema.approvalDeadlineHours', () => {
  it('acepta 24 (default) y los bordes 1 y 168', () => {
    expect(validateSchema(UpdateBookingConfigSchema, { approvalDeadlineHours: 24 }).approvalDeadlineHours).toBe(24)
    expect(validateSchema(UpdateBookingConfigSchema, { approvalDeadlineHours: 1 }).approvalDeadlineHours).toBe(1)
    expect(validateSchema(UpdateBookingConfigSchema, { approvalDeadlineHours: 168 }).approvalDeadlineHours).toBe(168)
  })

  it('rechaza 0 (por debajo del mínimo 1)', () => {
    expect(() => validateSchema(UpdateBookingConfigSchema, { approvalDeadlineHours: 0 })).toThrow(ValidationError)
  })

  it('rechaza 169 (por encima del máximo 168)', () => {
    expect(() => validateSchema(UpdateBookingConfigSchema, { approvalDeadlineHours: 169 })).toThrow(ValidationError)
  })

  it('rechaza un decimal', () => {
    expect(() => validateSchema(UpdateBookingConfigSchema, { approvalDeadlineHours: 7.5 })).toThrow(ValidationError)
  })

  it('rechaza un string (sin coerción)', () => {
    expect(() => validateSchema(UpdateBookingConfigSchema, { approvalDeadlineHours: 'x' })).toThrow(ValidationError)
  })
})

describe('ConfigUseCase.get — default de approvalDeadlineHours', () => {
  it('el default exportado es 24', () => {
    expect(DEFAULT_APPROVAL_DEADLINE_HOURS).toBe(24)
  })

  it('una fila anterior a la columna (sin valor) devuelve 24 sin persistir', async () => {
    const { usecase, created } = setup([{ id: 'cfg1', hotelId: 'h1', enabled: true, minNights: 1, pendingTtlMinutes: 60 }])
    const cfg = await usecase.get('h1')
    expect(cfg.approvalDeadlineHours).toBe(24)
    expect(cfg.pendingTtlMinutes).toBe(60) // el resto de la fila se conserva
    expect(cfg.minNights).toBe(1)
    expect(created).toHaveLength(0)
  })

  it('una fila con NULL devuelve 24', async () => {
    const { usecase } = setup([{ id: 'cfg1', hotelId: 'h1', approvalDeadlineHours: null }])
    expect((await usecase.get('h1')).approvalDeadlineHours).toBe(24)
  })

  it('una fila con un valor configurado (48) NO se pisa con el default', async () => {
    const { usecase } = setup([{ id: 'cfg1', hotelId: 'h1', approvalDeadlineHours: 48 }])
    expect((await usecase.get('h1')).approvalDeadlineHours).toBe(48)
  })

  it('sin filas crea la config con 24', async () => {
    const { usecase, created } = setup([])
    const cfg = await usecase.get('h1')
    expect(cfg.approvalDeadlineHours).toBe(24)
    expect(created).toHaveLength(1)
    expect(created[0].approvalDeadlineHours).toBe(24)
  })
})

// ─── GET público: plazo del hotel + motivo/reembolso solo en rechazo ─────────────────────

const VALID_TOKEN = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'

function makeOrm(reservation: Record<string, any>, config: Record<string, any> | null) {
  const row = {
    id: 'res-1', hotelId: 'h1', guestId: 'g1', roomId: 'r1',
    accessToken: VALID_TOKEN,
    status: 'confirmed',
    checkIn: '2026-10-10', checkOut: '2026-10-12', totalAmount: 200, deposit: 0,
    ...reservation,
  }
  const guest = { id: 'g1', hotelId: 'h1', name: 'Ana', email: 'ana@example.com' }
  const orm: any = {
    findMany: async (model: string, query: any) => {
      if (model === 'Reservations') return row.id === query?.id ? [row] : []
      if (model === 'Guests') return guest.id === query?.id ? [guest] : []
      if (model === 'BookingConfig') return config && config.hotelId === query?.hotelId ? [config] : []
      return []
    },
  }
  return orm
}

describe('getPublicReservation — approvalDeadlineHours / rejectionReason / refundAmount (#271)', () => {
  const prevSecret = process.env.BOOKING_TOKEN_SECRET
  beforeEach(() => { process.env.BOOKING_TOKEN_SECRET = 'test-secret-fixed' })
  afterEach(() => {
    if (prevSecret === undefined) delete process.env.BOOKING_TOKEN_SECRET
    else process.env.BOOKING_TOKEN_SECRET = prevSecret
  })

  it('expone el approvalDeadlineHours configurado por el hotel (48)', async () => {
    const orm = makeOrm({ approvalStatus: 'pending' }, { id: 'cfg1', hotelId: 'h1', approvalDeadlineHours: 48 })
    const res = await getPublicReservation(orm, 'res-1', VALID_TOKEN)
    expect(res.status).toBe(200)
    expect(res.body.reservation.approvalDeadlineHours).toBe(48)
  })

  it('sin config del hotel (o columna vieja en null) cae al default 24, siempre número', async () => {
    const sinFila = await getPublicReservation(makeOrm({ approvalStatus: 'pending' }, null), 'res-1', VALID_TOKEN)
    expect(sinFila.body.reservation.approvalDeadlineHours).toBe(24)
    const conNull = await getPublicReservation(
      makeOrm({ approvalStatus: 'pending' }, { id: 'cfg1', hotelId: 'h1', approvalDeadlineHours: null }),
      'res-1', VALID_TOKEN,
    )
    expect(conNull.body.reservation.approvalDeadlineHours).toBe(24)
  })

  it('reserva rechazada: expone rejectionReason (texto para el huésped) y refundAmount', async () => {
    const orm = makeOrm(
      {
        status: 'cancelled',
        approvalStatus: 'rejected',
        cancellationReason: 'No hay disponibilidad real esa noche',
        refundAmount: 150,
      },
      { id: 'cfg1', hotelId: 'h1', approvalDeadlineHours: 24 },
    )
    const res = await getPublicReservation(orm, 'res-1', VALID_TOKEN)
    expect(res.status).toBe(200)
    expect(res.body.reservation.rejectionReason).toBe('No hay disponibilidad real esa noche')
    expect(res.body.reservation.refundAmount).toBe(150)
    // La regla vieja de `cancellationReason` (solo el código 'payment_timeout') no cambia.
    expect(res.body.reservation.cancellationReason).toBeNull()
  })

  it('reserva rechazada sin refundAmount guardado → refundAmount 0 (no null)', async () => {
    const orm = makeOrm({ status: 'cancelled', approvalStatus: 'rejected', cancellationReason: 'Overbooking' }, null)
    const res = await getPublicReservation(orm, 'res-1', VALID_TOKEN)
    expect(res.body.reservation.refundAmount).toBe(0)
  })

  it('reserva pending: rejectionReason y refundAmount son null', async () => {
    const orm = makeOrm({ approvalStatus: 'pending', refundAmount: 0 }, null)
    const res = await getPublicReservation(orm, 'res-1', VALID_TOKEN)
    expect(res.body.reservation.rejectionReason).toBeNull()
    expect(res.body.reservation.refundAmount).toBeNull()
  })

  it('cancelada por el panel (no rechazo) con motivo libre: NO filtra el motivo ni el reembolso', async () => {
    const orm = makeOrm(
      { status: 'cancelled', approvalStatus: null, cancellationReason: 'Nota interna del empleado', refundAmount: 80 },
      null,
    )
    const res = await getPublicReservation(orm, 'res-1', VALID_TOKEN)
    expect(res.body.reservation.rejectionReason).toBeNull()
    expect(res.body.reservation.refundAmount).toBeNull()
    expect(res.body.reservation.cancellationReason).toBeNull()
  })
})
