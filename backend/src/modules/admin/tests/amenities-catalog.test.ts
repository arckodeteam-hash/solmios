// admin/tests/amenities-catalog.test.ts — CRUD del catálogo de amenities de la plataforma.
//
// El catálogo NO es de un hotel: es un recurso de la plataforma. Las cuatro operaciones se
// extrajeron de `admin/service.ts` sin red de tests; acá quedan cubiertas, incluido el
// `assertOwnership` del alta (antes sólo lo tenían update y delete).

import { describe, it, expect } from 'bun:test'
import type { RepositoryAdapter } from 'arckode-framework'
import { Auth } from 'arckode-framework'
import { silentLogger } from 'arckode-framework/testing'
import { ValidationError, ConflictError, NotFoundError } from 'arckode-framework'
import {
  listAmenitiesCatalog, createAmenityCatalog, updateAmenityCatalog, deleteAmenityCatalog,
  type AmenitiesCatalogDeps,
} from '../usecases/amenities-catalog'
import { AdminController } from '../controller'

const PLATFORM = '__platform__'
const SA = { id: 'admin1', role: 'super_admin' }
const MERCHANT = { id: 'u1', role: 'hotel_admin' }

// QA7-1: el `Auth` REAL del framework, no un doble. Un stub de `assertOwnership` no reproduce la
// rama `requestingUserId === resourceOwnerId` (kernel/auth.ts) — con ella, el test validaba su
// propia imitación en vez de la función que corre en producción. Mismo criterio que
// `reservas/tests/manual-message-log.test.ts` y `addons-pending.test.ts`.
const realAuth = new Auth({ sign: () => '', verify: () => ({}) } as any, 'test-secret', silentLogger())

function makeDeps(rows: any[] = []): AmenitiesCatalogDeps & { rows: any[]; audited: any[] } {
  const state = [...rows]
  const audited: any[] = []
  const repo = {
    findMany: async (f: any) => (f?.key ? state.filter((r) => r.key === f.key) : state),
    findById: async (id: string) => state.find((r) => r.id === id) ?? null,
    create: async (d: any) => { const row = { id: `a${state.length + 1}`, ...d }; state.push(row); return row },
    update: async (id: string, patch: any) => {
      const row = state.find((r) => r.id === id)
      if (row) Object.assign(row, patch)
      return row
    },
    delete: async (id: string) => { const i = state.findIndex((r) => r.id === id); if (i >= 0) state.splice(i, 1); return i >= 0 },
  } as unknown as RepositoryAdapter<any>

  return {
    repo,
    logger: silentLogger(),
    platformResource: PLATFORM,
    auth: realAuth,
    auditPort: () => ({ record: async (e: any) => { audited.push(e) } } as any),
    rows: state,
    audited,
  }
}

describe('amenities-catalog', () => {
  it('list devuelve el catálogo completo con el total', async () => {
    const deps = makeDeps([{ id: 'a1', key: 'wifi', label: 'WiFi' }])
    expect(await listAmenitiesCatalog(deps)).toEqual({ data: [{ id: 'a1', key: 'wifi', label: 'WiFi' }] as any, total: 1 })
  })

  it('create exige key y label', async () => {
    const deps = makeDeps()
    await expect(createAmenityCatalog(deps, { key: 'wifi' }, SA)).rejects.toThrow('key y label requeridos')
  })

  it('create rechaza una key duplicada', async () => {
    const deps = makeDeps([{ id: 'a1', key: 'wifi', label: 'WiFi' }])
    await expect(createAmenityCatalog(deps, { key: 'wifi', label: 'Otro' }, SA)).rejects.toThrow('Amenity ya existe')
  })

  it('create aplica los defaults documentados', async () => {
    const deps = makeDeps()
    const row = await createAmenityCatalog(deps, { key: 'pool', label: 'Piscina' }, SA)
    expect(row).toMatchObject({ category: 'interior', icon: '', isActive: 1, sortOrder: 0 })
  })

  // SEC-5: el alta tenía la puerta de la ruta pero no la defensa en profundidad de update/delete.
  it('create bloquea a quien no es super_admin (recurso de plataforma)', async () => {
    const deps = makeDeps()
    await expect(createAmenityCatalog(deps, { key: 'spa', label: 'Spa' }, MERCHANT)).rejects.toThrow('Forbidden')
    expect(deps.rows).toHaveLength(0)
  })

  it('update sólo toca los campos declarados y normaliza isActive a 0/1', async () => {
    const deps = makeDeps([{ id: 'a1', key: 'wifi', label: 'WiFi', isActive: 1 }])
    // `hacker` no está en `AmenityCatalogInput`: se manda igual (as any) para probar que el patch
    // sólo copia los campos declarados, tal cual llegaría de un body sin validar.
    const row = await updateAmenityCatalog(deps, 'a1', { label: 'WiFi rápido', isActive: false, hacker: 'x' } as any, SA)
    expect(row).toMatchObject({ label: 'WiFi rápido', isActive: 0 })
    expect((row as any).hacker).toBeUndefined()
  })

  it('update rechaza a quien no es super_admin y no encuentra un id inexistente', async () => {
    const deps = makeDeps([{ id: 'a1', key: 'wifi', label: 'WiFi' }])
    await expect(updateAmenityCatalog(deps, 'a1', { label: 'x' }, MERCHANT)).rejects.toThrow('Forbidden')
    await expect(updateAmenityCatalog(deps, 'nope', { label: 'x' }, SA)).rejects.toThrow('Amenity no encontrado')
  })

  it('delete borra y deja rastro en el audit log', async () => {
    const deps = makeDeps([{ id: 'a1', key: 'wifi', label: 'WiFi' }])
    await deleteAmenityCatalog(deps, 'a1', SA)
    expect(deps.rows).toHaveLength(0)
    expect(deps.audited).toHaveLength(1)
  })

  it('delete rechaza a quien no es super_admin', async () => {
    const deps = makeDeps([{ id: 'a1', key: 'wifi', label: 'WiFi' }])
    await expect(deleteAmenityCatalog(deps, 'a1', MERCHANT)).rejects.toThrow('Forbidden')
    expect(deps.rows).toHaveLength(1)
  })

  // La rama que el doble tapaba: el `Auth` real deja pasar a quien coincide con el DUEÑO del
  // recurso antes de mirar el rol. Un recurso de plataforma no tiene dueño — ni siquiera un usuario
  // cuyo id fuese literalmente el centinela puede entrar por esa puerta.
  it('un usuario cuyo id ES el centinela sigue sin poder tocar el catálogo', async () => {
    const deps = makeDeps()
    await expect(createAmenityCatalog(deps, { key: 'spa', label: 'Spa' }, { id: PLATFORM, role: 'hotel_admin' }))
      .rejects.toThrow('Forbidden')
    expect(deps.rows).toHaveLength(0)
  })

  it('sin usuario tampoco (role undefined ≠ super_admin)', async () => {
    const deps = makeDeps()
    await expect(createAmenityCatalog(deps, { key: 'spa', label: 'Spa' }, undefined)).rejects.toThrow('Forbidden')
    expect(deps.rows).toHaveLength(0)
  })
})

// ── COR-3/SEC-5: el status HTTP sale del TIPO de error, no de un número fijo por handler ───────
describe('AdminController — mapeo de errores del catálogo de amenities', () => {
  function controllerThrowing(error: Error) {
    const service = {
      createAmenityCatalog: async () => { throw error },
      updateAmenityCatalog: async () => { throw error },
      deleteAmenityCatalog: async () => { throw error },
    } as any
    return new AdminController(service, silentLogger())
  }
  const body = { key: 'spa', label: 'Spa' }

  it('el ForbiddenError del assertOwnership es 403, NO 409 "ya existe"', async () => {
    // Regresión exacta: el `catch` del alta devolvía 409 para todo. Un merchant que intentaba dar
    // de alta una amenity recibía "Amenity ya existe" con status de conflicto.
    let thrown: any = null
    try {
      makeDeps().auth.assertOwnership(PLATFORM, '', 'hotel_admin', 'super_admin')
    } catch (e) { thrown = e }
    expect(thrown).toBeTruthy()
    const res = await controllerThrowing(thrown).createAmenityCatalog({ body } as any)
    expect(res.status).toBe(403)
  })

  // STR-4: el mapeo va por TIPO. Los errores los tira el usecase con las clases del framework
  // (`ValidationError`/`ConflictError`/`NotFoundError`), así que cambiar el texto del mensaje —que
  // es copy de UI— ya NO puede mover el status.
  it('la key duplicada sigue siendo 409 (ConflictError)', async () => {
    const res = await controllerThrowing(new ConflictError('Amenity ya existe')).createAmenityCatalog({ body } as any)
    expect(res.status).toBe(409)
  })

  it('los campos faltantes son 400 (ValidationError), no 409', async () => {
    const res = await controllerThrowing(new ValidationError('key y label requeridos')).createAmenityCatalog({ body } as any)
    expect(res.status).toBe(400)
  })

  it('el status NO depende del texto del mensaje', async () => {
    // Mismo texto de antes, pero como Error pelado: cae al 400 por defecto en vez de "adivinar"
    // 409 desde el string. Reescribir el copy de la UI no puede cambiar el contrato HTTP.
    const res = await controllerThrowing(new Error('Amenity ya existe')).createAmenityCatalog({ body } as any)
    expect(res.status).toBe(400)
  })

  // SEC-3: el permiso se decide ANTES de leer. Con el `findById` primero, un usuario sin permiso
  // recibía 404 para un id inexistente y 403 para uno existente: un oráculo de existencia gratis.
  it('sin permiso, update/delete dan 403 aunque el id no exista — y no tocan la tabla', async () => {
    const deps = makeDeps([{ id: 'a1', key: 'wifi', label: 'WiFi' }])
    let leyo = false
    const espiado = { ...deps, repo: { ...deps.repo, findById: async (id: string) => { leyo = true; return (deps.repo as any).findById(id) } } as any }
    await expect(updateAmenityCatalog(espiado, 'no-existe', { label: 'x' }, MERCHANT)).rejects.toThrow('Forbidden')
    await expect(deleteAmenityCatalog(espiado, 'no-existe', MERCHANT)).rejects.toThrow('Forbidden')
    expect(leyo).toBe(false)
  })

  it('update/delete de un id inexistente siguen en 404 (NotFoundError)', async () => {
    const err = new NotFoundError('Amenity no encontrado')
    expect((await controllerThrowing(err).updateAmenityCatalog({ params: { id: 'x' }, body: {} } as any)).status).toBe(404)
    expect((await controllerThrowing(err).deleteAmenityCatalog({ params: { id: 'x' } } as any)).status).toBe(404)
  })

  it('update/delete sin permiso son 403, no 404', async () => {
    let thrown: any = null
    try {
      makeDeps().auth.assertOwnership(PLATFORM, '', 'hotel_admin', 'super_admin')
    } catch (e) { thrown = e }
    expect((await controllerThrowing(thrown).updateAmenityCatalog({ params: { id: 'a1' }, body: {} } as any)).status).toBe(403)
    expect((await controllerThrowing(thrown).deleteAmenityCatalog({ params: { id: 'a1' } } as any)).status).toBe(403)
  })
})
