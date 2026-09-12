// wallet-pass/tests/partial-pass.test.ts — Pase PARCIAL para reservas sin habitación (#262, REQ-HAC-07).
//
//   - reserva sin roomId con roomType → email con 'Por asignar · doble', SIN bloque de código;
//     fila con lockCode '' + emailSentAt; devuelve true.
//   - segunda llamada → false, sigue una sola fila (no reenvía).
//   - generatePass sobre la fila parcial → la completa in-place (lockCode, emailSentAt null),
//     sin crear otra fila.
//   - sin guestEmail → false y sin fila.
//   - render con lockCode '' y sin roomNumber → sin bloque de código, con 'Por asignar'.
//
// Harness in-memory copiado de generate-pass.test.ts (sin DB, sin Apple/Google reales).
import { describe, it, expect, mock } from 'bun:test'
import type { RepositoryAdapter, Logger } from 'arckode-framework'
import { silentLogger } from 'arckode-framework/testing'
import { generatePass, type GeneratePassDeps, type TtlockPort } from '../usecases/generate-pass'
import { sendPartialPassNow } from '../usecases/partial-pass'
import { renderWalletPassEmail } from '../usecases/pass-email'
import type { WalletPassDTO } from '../types'

const log: Logger = silentLogger()

function makeRepo<T extends object>(overrides: Partial<RepositoryAdapter<T>> = {}): RepositoryAdapter<T> {
  return {
    findMany: async () => [],
    findById: async () => null,
    findOne: async () => null,
    create: async (data: any) => ({ ...data, id: 'wp-1', createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z' }) as T,
    update: async (id: any, data: any) => ({ ...data, id }) as T,
    delete: async () => true,
    count: async () => 0,
    paginate: async () => ({ data: [], total: 0, limit: 20, offset: 0, pages: 0 }),
    ...overrides,
  } as RepositoryAdapter<T>
}

/** Repo WalletPasses in-memory: una lista de filas, findOne por reservationId, update in-place. */
function makeWalletRepo(rows: WalletPassDTO[]): RepositoryAdapter<WalletPassDTO> {
  let seq = 1
  return makeRepo<WalletPassDTO>({
    findOne: async (f: any) => rows.find((r) => r.reservationId === f.reservationId) ?? null,
    create: async (data: any) => {
      const row = { ...data, id: `wp-${seq++}`, createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z' } as WalletPassDTO
      rows.push(row)
      return row
    },
    update: async (id: any, data: any) => {
      const row = rows.find((r) => r.id === id)
      if (!row) return null as any
      Object.assign(row, data)
      return row
    },
    delete: async (id: any) => {
      const i = rows.findIndex((r) => r.id === id)
      if (i >= 0) rows.splice(i, 1)
      return i >= 0
    },
  })
}

function makeDeps(overrides: Partial<GeneratePassDeps> = {}): GeneratePassDeps {
  return {
    walletPassRepo: makeWalletRepo([]),
    configRepo: makeRepo<Record<string, unknown>>({ findMany: async () => [] }),
    lockCodeRepo: makeRepo({ findMany: async () => [] }),
    reservationRepo: makeRepo<any>({
      // HAC-01: reserva pagada SIN habitación, con el tipo vendido.
      findOne: async () => ({ id: 'r1', hotelId: 'h1', guestId: 'g1', roomId: null, roomType: 'doble', checkIn: '2026-08-01', checkOut: '2026-08-05' }),
    }),
    hotelRepo: makeRepo<any>({ findOne: async () => ({ id: 'h1', name: 'Hotel Test' }) }),
    guestRepo: makeRepo<any>({ findOne: async () => ({ id: 'g1', name: 'Ana', email: 'ana@test.com' }) }),
    roomRepo: makeRepo<any>({ findOne: async () => null }),
    ttlock: null,
    emailService: { enqueue: mock(async () => 'q-1') } as any,
    logger: log,
    ...overrides,
  }
}

describe('wallet-pass/usecases/partial-pass — #262 pase parcial', () => {
  it('reserva sin roomId con roomType → email "Por asignar · doble" sin bloque de código, fila lockCode "" + emailSentAt', async () => {
    const rows: WalletPassDTO[] = []
    const enqueue = mock(async () => 'q-1')
    const deps = makeDeps({ walletPassRepo: makeWalletRepo(rows), emailService: { enqueue } as any })

    const ok = await sendPartialPassNow(deps, 'r1')

    expect(ok).toBe(true)
    expect(enqueue).toHaveBeenCalledTimes(1)
    const sent = (enqueue.mock.calls[0] as any[])[0] as { to: string; html: string; subject: string }
    expect(sent.to).toBe('ana@test.com')
    expect(sent.html).toContain('Por asignar')
    expect(sent.html).toContain('doble')
    expect(sent.html).not.toContain('Tu código de acceso')
    expect(sent.html).not.toContain('abre la puerta desde')
    expect(sent.html).toContain('en cuanto el hotel te asigne la unidad')

    expect(rows).toHaveLength(1)
    expect(rows[0]!.reservationId).toBe('r1')
    expect(rows[0]!.hotelId).toBe('h1')
    expect(rows[0]!.lockCode).toBe('')
    expect(rows[0]!.appleUrl).toBeNull()
    expect(rows[0]!.googleUrl).toBeNull()
    expect(rows[0]!.emailSentAt).toBeTruthy()
    expect(rows[0]!.generatedAt).toBeTruthy()
  })

  it('segunda llamada → false y sigue una sola fila (no reenvía)', async () => {
    const rows: WalletPassDTO[] = []
    const enqueue = mock(async () => 'q-1')
    const deps = makeDeps({ walletPassRepo: makeWalletRepo(rows), emailService: { enqueue } as any })

    expect(await sendPartialPassNow(deps, 'r1')).toBe(true)
    expect(await sendPartialPassNow(deps, 'r1')).toBe(false)

    expect(rows).toHaveLength(1)
    expect(enqueue).toHaveBeenCalledTimes(1)
  })

  it('generatePass sobre la fila parcial → la completa in-place (lockCode, emailSentAt null) sin crear otra', async () => {
    const rows: WalletPassDTO[] = []
    const walletPassRepo = makeWalletRepo(rows)
    const deps = makeDeps({ walletPassRepo })
    expect(await sendPartialPassNow(deps, 'r1')).toBe(true)
    const partialId = rows[0]!.id

    // Recepción asigna la habitación: la reserva ya tiene roomId y TTLock puede generar código.
    const ttlockGen = mock(async () => ({ code: '1234' }))
    const assignedDeps = makeDeps({
      walletPassRepo,
      reservationRepo: makeRepo<any>({
        findOne: async () => ({ id: 'r1', hotelId: 'h1', guestId: 'g1', roomId: 'rm1', roomType: 'doble', checkIn: '2026-08-01', checkOut: '2026-08-05' }),
      }),
      roomRepo: makeRepo<any>({ findOne: async () => ({ id: 'rm1', number: '101', type: 'doble' }) }),
      ttlock: { generateCode: ttlockGen } as TtlockPort,
    })

    const result = await generatePass(assignedDeps, 'r1', false)

    expect(result).not.toBeNull()
    expect(result!.alreadyExisted).toBe(false)
    expect(result!.emailQueued).toBe(false)
    expect(result!.pass.lockCode).toBe('1234')
    expect(result!.pass.emailSentAt).toBeNull()
    expect(ttlockGen).toHaveBeenCalledTimes(1)

    expect(rows).toHaveLength(1)
    expect(rows[0]!.id).toBe(partialId)
    expect(rows[0]!.lockCode).toBe('1234')
    expect(rows[0]!.emailSentAt).toBeNull()
  })

  it('generatePass sobre fila parcial sin lockCode disponible → null y la fila parcial queda intacta', async () => {
    const rows: WalletPassDTO[] = []
    const walletPassRepo = makeWalletRepo(rows)
    const deps = makeDeps({ walletPassRepo })
    expect(await sendPartialPassNow(deps, 'r1')).toBe(true)

    const result = await generatePass(deps, 'r1', false)

    expect(result).toBeNull()
    expect(rows).toHaveLength(1)
    expect(rows[0]!.lockCode).toBe('')
    expect(rows[0]!.emailSentAt).toBeTruthy()
  })

  it('sin guestEmail → false y sin fila', async () => {
    const rows: WalletPassDTO[] = []
    const enqueue = mock(async () => 'q-1')
    const deps = makeDeps({
      walletPassRepo: makeWalletRepo(rows),
      guestRepo: makeRepo<any>({ findOne: async () => ({ id: 'g1', name: 'Ana', email: '' }) }),
      emailService: { enqueue } as any,
    })

    expect(await sendPartialPassNow(deps, 'r1')).toBe(false)
    expect(rows).toHaveLength(0)
    expect(enqueue).not.toHaveBeenCalled()
  })

  it('si el enqueue falla → false y sin fila (nunca lanza)', async () => {
    const rows: WalletPassDTO[] = []
    const deps = makeDeps({
      walletPassRepo: makeWalletRepo(rows),
      emailService: { enqueue: mock(async () => { throw new Error('smtp caído') }) } as any,
    })

    expect(await sendPartialPassNow(deps, 'r1')).toBe(false)
    expect(rows).toHaveLength(0)
  })

  it('el asunto del parcial no promete código de acceso', async () => {
    const enqueue = mock(async () => 'q-1')
    const deps = makeDeps({ emailService: { enqueue } as any })
    expect(await sendPartialPassNow(deps, 'r1')).toBe(true)
    const sent = (enqueue.mock.calls[0] as any[])[0] as { subject: string }
    expect(sent.subject).toBe('Tu pase de reserva — Hotel Test')
    expect(sent.subject).not.toContain('código')
  })

  it('dos corridas solapadas → un solo correo: la fila se reserva ANTES de mandar (UNIQUE reservationId)', async () => {
    const rows: WalletPassDTO[] = []
    const base = makeWalletRepo(rows)
    // Simula el UNIQUE de la base: el segundo create de la misma reserva revienta como SQLite.
    const repo = {
      ...base,
      create: async (data: any) => {
        if (rows.some((r) => r.reservationId === data.reservationId)) {
          throw new Error('UNIQUE constraint failed: wallet_passes.reservationId')
        }
        return base.create(data)
      },
    } as RepositoryAdapter<WalletPassDTO>
    const enqueue = mock(async () => 'q-1')
    const deps = makeDeps({ walletPassRepo: repo, emailService: { enqueue } as any })
    // Las dos pasan el findOne inicial (todavía sin fila) al mismo tiempo.
    const [a, b] = await Promise.all([sendPartialPassNow(deps, 'r1'), sendPartialPassNow(deps, 'r1')])
    expect([a, b].filter(Boolean)).toHaveLength(1)
    expect(enqueue).toHaveBeenCalledTimes(1)
    expect(rows).toHaveLength(1)
    expect(rows[0].emailSentAt).toBeTruthy()
  })

  it('fila parcial sin emailSentAt (corrida en vuelo o caída) → no reenvía: sin claim atómico sería doble correo', async () => {
    const rows: WalletPassDTO[] = [{ id: 'wp-0', hotelId: 'h1', reservationId: 'r1', appleUrl: null, googleUrl: null, lockCode: '', generatedAt: '2026-01-01T00:00:00.000Z', emailSentAt: null } as any]
    const enqueue = mock(async () => 'q-1')
    const deps = makeDeps({ walletPassRepo: makeWalletRepo(rows), emailService: { enqueue } as any })
    expect(await sendPartialPassNow(deps, 'r1')).toBe(false)
    expect(enqueue).not.toHaveBeenCalled()
    expect(rows).toHaveLength(1)
    expect(rows[0].emailSentAt).toBeNull()
  })

  it('dos corridas solapadas sobre una fila parcial en vuelo → un solo correo', async () => {
    const rows: WalletPassDTO[] = []
    const base = makeWalletRepo(rows)
    const repo = {
      ...base,
      create: async (data: any) => {
        if (rows.some((r) => r.reservationId === data.reservationId)) throw new Error('UNIQUE constraint failed: wallet_passes.reservationId')
        return base.create(data)
      },
    } as RepositoryAdapter<WalletPassDTO>
    // El enqueue de la primera tarda: la segunda corrida arranca con la fila ya creada y sin emailSentAt.
    let release: () => void = () => {}
    const gate = new Promise<void>((r) => { release = r })
    const enqueue = mock(async () => { await gate; return 'q-1' })
    const deps = makeDeps({ walletPassRepo: repo, emailService: { enqueue } as any })
    const first = sendPartialPassNow(deps, 'r1')
    await new Promise((r) => setTimeout(r, 5))
    const second = await sendPartialPassNow(deps, 'r1')
    release()
    expect(await first).toBe(true)
    expect(second).toBe(false)
    expect(enqueue).toHaveBeenCalledTimes(1)
    expect(rows).toHaveLength(1)
    expect(rows[0].emailSentAt).toBeTruthy()
  })
})

describe('wallet-pass/usecases/pass-email — render parcial (#262)', () => {
  const base = {
    to: 'ana@test.com', hotelId: 'h1', reservationId: 'r1', hotelName: 'Hotel Test', guestName: 'Ana',
    checkIn: '2026-08-01', checkOut: '2026-08-05', checkInTime: '15:00', checkOutTime: '12:00',
  }

  it('lockCode "" y sin roomNumber → sin bloque de código, con "Por asignar" y subtítulo sin "+ código"', () => {
    const html = renderWalletPassEmail({ ...base, lockCode: '', roomNumber: undefined })
    expect(html).not.toContain('Tu código de acceso')
    expect(html).not.toContain('abre la puerta desde')
    expect(html).not.toContain('Tu pase de reserva + código de acceso')
    expect(html).toContain('Tu pase de reserva')
    expect(html).toContain('Por asignar')
    expect(html).toContain('en cuanto el hotel te asigne la unidad')
    // Fechas + horario se mantienen.
    expect(html).toContain('2026-08-01 · 15:00')
    expect(html).toContain('2026-08-05 · 12:00')
  })

  it('roomType sin roomNumber → "Por asignar · <tipo>" escapado', () => {
    const html = renderWalletPassEmail({ ...base, lockCode: '', roomType: 'doble <vip>' })
    expect(html).toContain('Por asignar · doble &lt;vip&gt;')
    expect(html).not.toContain('<vip>')
  })

  it('roomNumber + roomType con lockCode → "<numero> · <tipo>" y el bloque de código intacto', () => {
    const html = renderWalletPassEmail({ ...base, lockCode: 'TT-1234', roomNumber: '101', roomType: 'doble' })
    expect(html).toContain('101 · doble')
    expect(html).not.toContain('Por asignar')
    expect(html).toContain('Tu código de acceso')
    expect(html).toContain('TT-1234')
    expect(html).toContain('abre la puerta desde')
    expect(html).toContain('Tu pase de reserva + código de acceso')
  })
})
