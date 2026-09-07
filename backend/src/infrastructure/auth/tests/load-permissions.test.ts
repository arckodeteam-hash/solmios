// load-permissions.test.ts — De dónde salen los permisos de una sesión.
//
// El caso que importa acá es la impersonación: el token del super admin que "entra" a la cuenta de
// un cliente lleva el rol REAL del cliente (nunca 'super_admin'), porque ese literal es el que
// usan ~30 services para saltear su aislamiento por hotel. El acceso total del admin viaja por
// otro canal —el claim `impersonatedBy`— que ningún service usa para decidir tenancy: da permisos
// completos DENTRO del hotel del cliente y nada fuera de él.

import { describe, it, expect, vi } from 'bun:test'
import { loadPermissions } from '../load-permissions'
import { DEFAULT_ROLE_PERMISSIONS } from '../../../shared/permissions'

const run = async (user: any, roleRepo: any) => {
  const req = { user } as any
  const next = vi.fn().mockResolvedValue(undefined)
  await loadPermissions(roleRepo)(req, next)
  return { req, next }
}

const emptyRoleRepo = () => ({ findMany: vi.fn().mockResolvedValue([]) })

describe('loadPermissions', () => {
  it('impersonación: con impersonatedBy da permisos totales sin consultar el roleRepo', async () => {
    const roleRepo = emptyRoleRepo()
    const { req, next } = await run(
      { id: 'u1', role: 'receptionist', hotelId: 'h1', impersonatedBy: 'admin-1' },
      roleRepo,
    )

    // El rol del token es el del cliente (acá recepción, que no llega ni al 20% del panel), pero
    // el admin que entró tiene que ver todo lo del hotel: el comodín no depende del nombre del rol.
    expect(req.user.permissions).toEqual(['*:*'])
    expect(roleRepo.findMany).not.toHaveBeenCalled()
    expect(next).toHaveBeenCalled()
  })

  it('sin impersonatedBy, un rol normal se resuelve contra el roleRepo como siempre', async () => {
    const roleRepo = { findMany: vi.fn().mockResolvedValue([{ permissions: ['rooms:view', 'housekeeping:edit'] }]) }
    const { req, next } = await run({ id: 'u1', role: 'receptionist', hotelId: 'h1' }, roleRepo)

    expect(roleRepo.findMany).toHaveBeenCalledWith({ name: 'receptionist', hotelId: 'h1' })
    expect(req.user.permissions).toEqual(['rooms:view', 'housekeeping:edit'])
    expect(req.user.permissions).not.toContain('*:*')
    expect(next).toHaveBeenCalled()
  })

  it('sin fila en roles, un rol normal cae a los permisos por defecto (nunca al comodín)', async () => {
    const roleRepo = emptyRoleRepo()
    const { req } = await run({ id: 'u1', role: 'receptionist', hotelId: 'h1' }, roleRepo)

    expect(roleRepo.findMany).toHaveBeenCalled()
    expect(req.user.permissions).toEqual(DEFAULT_ROLE_PERMISSIONS.receptionist)
  })

  it('super_admin de verdad (sin impersonatedBy) sigue teniendo permisos totales', async () => {
    const roleRepo = emptyRoleRepo()
    const { req, next } = await run({ id: 'admin-1', role: 'super_admin', hotelId: null }, roleRepo)

    expect(req.user.permissions).toEqual(['*:*'])
    expect(roleRepo.findMany).not.toHaveBeenCalled()
    expect(next).toHaveBeenCalled()
  })

  it('sin usuario en el request no toca nada y sigue la cadena', async () => {
    const roleRepo = emptyRoleRepo()
    const { next } = await run(undefined, roleRepo)

    expect(roleRepo.findMany).not.toHaveBeenCalled()
    expect(next).toHaveBeenCalled()
  })
})
