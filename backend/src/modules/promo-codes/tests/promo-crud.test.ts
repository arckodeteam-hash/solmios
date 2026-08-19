// promo-codes/tests/promo-crud.test.ts — Admin CRUD + duplicate code error (F2 2.1, 2.2).
//
// Aceptancia (tasks.md 2.1): "insertar 2 codes iguales para el mismo hotel → error de
// constraint". El service captura el duplicate error del UNIQUE index físico y lo
// traduce a ValidationError. En tests mockeamos el repo para emitir el mismo mensaje
// que SQLite/PG en violación de UNIQUE (mismo truco que folios/tests/pos-idempotency).
//
// Sin dependencia de DB. Casos:
//  (1) create + duplicate code → ValidationError (no crudo del motor)
//  (2) create normaliza code a UPPERCASE
//  (3) create valida kind + value (percent fuera de rango → error)
//  (4) update con code duplicado → ValidationError
//  (5) update ownership: promo de hotel ajeno → error de ownership (assertOwnership lanza)
//  (6) delete exists + ownership OK → {deleted: true}
//  (7) list ordena por createdAt DESC y filtra por hotelId del user
import { describe, it, expect } from 'bun:test'
import { silentLogger } from 'arckode-framework/testing'
import { ValidationError, NotFoundError } from 'arckode-framework'
import {
  list, create, update, remove,
} from '../usecases/promo-crud'
import type { PromoCodeDTO, CreatePromoCodeDTO, UpdatePromoCodeDTO, CurrentUser } from '../types'

void silentLogger // importado para/documentar disponibilidad; el usecase no lo requiere.
const adminUser: CurrentUser = { id: 'u1', hotelId: 'h1', role: 'hotel_admin', userType: 'merchant' }

/** Repo mock. `duplicateOn` activa la barrera UNIQUE en create/update de cierto code. */
function makeRepo(opts: {
  rows?: PromoCodeDTO[]
  duplicateCode?: string
} = {}) {
  const rows: PromoCodeDTO[] = opts.rows ? [...opts.rows] : []
  const dup = opts.duplicateCode
  const isDupMsg = () =>
    'duplicate key value violates unique constraint "promo_codes_hotel_code"'
  return {
    rows,
    findMany: async (filter: any = {}) =>
      rows.filter((r) => Object.entries(filter).every(([k, v]) => (r as any)[k] === v)),
    findOne: async (filter: any) =>
      rows.find((r) => Object.entries(filter).every(([k, v]) => (r as any)[k] === v)) ?? null,
    create: async (data: any) => {
      if (dup && data.code === dup) throw new Error(isDupMsg())
      const row = { id: `p_${rows.length + 1}`, ...data } as PromoCodeDTO
      rows.push(row)
      return row
    },
    update: async (id: string, patch: any) => {
      const idx = rows.findIndex((r) => r.id === id)
      if (idx === -1) return null
      if (dup && patch.code === dup && rows[idx].code !== dup) throw new Error(isDupMsg())
      rows[idx] = { ...rows[idx], ...patch }
      return rows[idx]
    },
    delete: async (id: string) => {
      const idx = rows.findIndex((r) => r.id === id)
      if (idx === -1) return false
      rows.splice(idx, 1)
      return true
    },
  }
}

function makeDeps(opts: Parameters<typeof makeRepo>[0] = {}, ownershipOk = true) {
  const promoCodes = makeRepo(opts) as any
  return {
    deps: {
      promoCodes,
      userRepo: { findOne: async () => ({ hotelId: adminUser.hotelId }) } as any,
      auth: {
        assertOwnership: (_rh: string, _uh: string, _r?: string, _s?: string) => {
          if (!ownershipOk) throw new Error('forbidden: not owner')
        },
      } as any,
    },
    promoCodes,
  }
}

/** Fila base con defaults; solo sobreescribí lo que importa por test. */
function row(overrides: Partial<PromoCodeDTO>): PromoCodeDTO {
  return {
    id: 'p_x', hotelId: 'h1', code: 'X', kind: 'percent', value: 5,
    active: true, uses: 0, minAmount: null, maxUses: null,
    validFrom: null, validTo: null,
    createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z',
    ...overrides,
  }
}

// ─── create ──────────────────────────────────────────────────────────────────
describe('create (F2 2.2)', () => {
  it('normaliza code a UPPERCASE al persistir', async () => {
    const { deps, promoCodes } = makeDeps()
    const dto: CreatePromoCodeDTO = { code: 'welcome10', kind: 'percent', value: 10 }
    const promo = await create(deps, dto, adminUser)
    expect(promo.code).toBe('WELCOME10')
    expect((promoCodes.rows as PromoCodeDTO[]).length).toBe(1)
  })

  it('code duplicado → ValidationError (no expone el crudo del motor)', async () => {
    const { deps } = makeDeps({ duplicateCode: 'WELCOME10' })
    const dto: CreatePromoCodeDTO = { code: 'WELCOME10', kind: 'percent', value: 10 }
    await expect(create(deps, dto, adminUser)).rejects.toBeInstanceOf(ValidationError)
    try {
      await create(deps, dto, adminUser)
      throw new Error('should have thrown')
    } catch (e) {
      expect((e as Error).message).toContain('WELCOME10')
      expect((e as Error).message).not.toContain('duplicate key') // no leak del motor
    }
  })

  it('kind inválido → ValidationError', async () => {
    const { deps } = makeDeps()
    const dto = { code: 'X', kind: 'invalid', value: 10 } as any
    await expect(create(deps, dto, adminUser)).rejects.toBeInstanceOf(ValidationError)
  })

  it('percent value > 100 → ValidationError', async () => {
    const { deps } = makeDeps()
    const dto: CreatePromoCodeDTO = { code: 'X', kind: 'percent', value: 150 }
    await expect(create(deps, dto, adminUser)).rejects.toBeInstanceOf(ValidationError)
  })

  it('fixed value guarda bien y normaliza active=true default', async () => {
    const { deps } = makeDeps()
    const dto: CreatePromoCodeDTO = { code: 'FLAT', kind: 'fixed', value: 25 }
    const promo = await create(deps, dto, adminUser)
    expect(promo.kind).toBe('fixed')
    expect(promo.value).toBe(25)
    expect(promo.active).toBe(true)
    expect(promo.uses).toBe(0)
  })

  it('create sin hotel en JWT → ValidationError', async () => {
    const { deps } = makeDeps()
    const dto: CreatePromoCodeDTO = { code: 'X', kind: 'percent', value: 10 }
    await expect(create(deps, dto, { id: 'u1', hotelId: null } as any)).rejects.toBeInstanceOf(ValidationError)
  })
})

// ─── update ──────────────────────────────────────────────────────────────────
describe('update (F2 2.2)', () => {
  it('update code duplicado → ValidationError', async () => {
    const existing = row({ id: 'p_existing', code: 'OLD' })
    const { deps } = makeDeps({ rows: [existing], duplicateCode: 'TAKEN' })
    const dto: UpdatePromoCodeDTO = { code: 'TAKEN' }
    await expect(update(deps, 'p_existing', dto, adminUser)).rejects.toBeInstanceOf(ValidationError)
  })

  it('update de code de hotel ajeno → error de ownership', async () => {
    const existing = row({ id: 'p_foreign', hotelId: 'h-OTRO' })
    const { deps } = makeDeps({ rows: [existing] }, false)
    const dto: UpdatePromoCodeDTO = { value: 15 }
    await expect(update(deps, 'p_foreign', dto, adminUser)).rejects.toThrow(/forbidden: not owner/)
  })

  it('update inexistente → NotFoundError', async () => {
    const { deps } = makeDeps()
    await expect(update(deps, 'p_nope', { value: 20 }, adminUser)).rejects.toBeInstanceOf(NotFoundError)
  })

  it('update exitoso — patch.value se persiste', async () => {
    const existing = row({ id: 'p_ok', code: 'OK' })
    const { deps } = makeDeps({ rows: [existing] })
    const updated = await update(deps, 'p_ok', { value: 15 }, adminUser)
    expect(updated.value).toBe(15)
  })
})

// ─── delete ──────────────────────────────────────────────────────────────────
describe('remove (F2 2.2)', () => {
  it('delete exitoso → {deleted: true}', async () => {
    const existing = row({ id: 'p_del', code: 'DEL' })
    const { deps } = makeDeps({ rows: [existing] })
    const r = await remove(deps, 'p_del', adminUser)
    expect(r.deleted).toBe(true)
    expect(r.id).toBe('p_del')
  })

  it('delete inexistente → NotFoundError', async () => {
    const { deps } = makeDeps()
    await expect(remove(deps, 'p_nope', adminUser)).rejects.toBeInstanceOf(NotFoundError)
  })
})

// ─── list ────────────────────────────────────────────────────────────────────
describe('list (F2 2.2)', () => {
  it('lista solo del hotel del user y ordena createdAt DESC', async () => {
    const own = row({ id: 'p1', code: 'A', createdAt: '2026-01-01T00:00:00Z' })
    const ownNewer = row({ id: 'p2', code: 'B', createdAt: '2026-06-01T00:00:00Z' })
    const foreign = row({ id: 'p3', hotelId: 'h-OTRO', code: 'X' })
    const { deps } = makeDeps({ rows: [own, ownNewer, foreign] })
    const r = await list(deps, adminUser)
    expect(r.total).toBe(2) // foreign queda afuera
    expect(r.data[0].id).toBe('p2') // más nuevo primero
    expect(r.data[1].id).toBe('p1')
  })
})

// ─── PC-3 (auditoría 2026-08-19): fechas y rangos de la ventana ─────────────────────────
// Antes validFrom/validTo eran `type:'string'` sin formato: una fecha mal tipeada ("31/12/2026")
// no parseaba en runtime y el código quedaba vigente PARA SIEMPRE; maxUses:-5 → agotado
// permanente; maxUses:0 → código inutilizable creado sin error.
describe('create/update — validación de ventana y rangos (PC-3)', () => {
  const baseDto = (over: Partial<CreatePromoCodeDTO> = {}): CreatePromoCodeDTO => ({
    code: 'VERANO', kind: 'percent', value: 10, ...over,
  } as CreatePromoCodeDTO)

  it('create con validTo inválido ("31/12/2026") → ValidationError', async () => {
    const { deps } = makeDeps()
    await expect(create(deps, baseDto({ validTo: '31/12/2026' as any }), adminUser)).rejects.toBeInstanceOf(ValidationError)
  })

  it('create con validFrom ISO completa → OK (formato largo aceptado)', async () => {
    const { deps } = makeDeps()
    const created = await create(deps, baseDto({ validFrom: '2026-08-01T09:30:00Z' }), adminUser)
    expect(created.validFrom).toBe('2026-08-01T09:30:00Z')
  })

  it('create: date-only mismo día es válido (to = fin de día > from = inicio); ventana invertida → ValidationError', async () => {
    const { deps } = makeDeps()
    const ok = await create(deps, baseDto({ validFrom: '2026-08-10', validTo: '2026-08-10' }), adminUser)
    expect(ok.validTo).toBe('2026-08-10')
    const { deps: d2 } = makeDeps()
    await expect(create(d2, baseDto({ validFrom: '2026-08-11T00:00:00Z', validTo: '2026-08-10' }), adminUser))
      .rejects.toThrow(/posterior a validFrom/)
  })

  it('create con maxUses 0 / -5 / 2.5 → ValidationError; 1 → OK', async () => {
    const { deps } = makeDeps()
    await expect(create(deps, baseDto({ maxUses: 0 }), adminUser)).rejects.toBeInstanceOf(ValidationError)
    await expect(create(deps, baseDto({ maxUses: -5 }), adminUser)).rejects.toBeInstanceOf(ValidationError)
    await expect(create(deps, baseDto({ maxUses: 2.5 }), adminUser)).rejects.toBeInstanceOf(ValidationError)
    const ok = await create(deps, baseDto({ code: 'UN-USO', maxUses: 1 }), adminUser)
    expect(ok.maxUses).toBe(1)
  })

  it('create con minAmount negativo → ValidationError', async () => {
    const { deps } = makeDeps()
    await expect(create(deps, baseDto({ minAmount: -1 }), adminUser)).rejects.toBeInstanceOf(ValidationError)
  })

  it('update con validTo corrupto → ValidationError antes de persistir', async () => {
    const { deps, promoCodes } = makeDeps({ rows: [row({ id: 'p1', code: 'X' })] })
    await expect(update(deps, 'p1', { validTo: 'mañana' } as UpdatePromoCodeDTO, adminUser)).rejects.toBeInstanceOf(ValidationError)
    expect(promoCodes.rows[0].validTo).toBe(null) // no se persistió nada
  })

  it('update que invierte la ventana (to existente < from nuevo) → ValidationError', async () => {
    const { deps } = makeDeps({ rows: [row({ id: 'p1', code: 'X', validTo: '2026-08-05' })] })
    await expect(update(deps, 'p1', { validFrom: '2026-09-01' } as UpdatePromoCodeDTO, adminUser))
      .rejects.toThrow(/posterior a validFrom/)
  })

  it('update de OTRO campo con fechas legacy corruptas no se bloquea (NaN no compara)', async () => {
    const { deps } = makeDeps({ rows: [row({ id: 'p1', code: 'X', validTo: '31/12/2026' })] })
    const updated = await update(deps, 'p1', { active: false } as UpdatePromoCodeDTO, adminUser)
    expect(updated.active).toBe(false)
  })
})
