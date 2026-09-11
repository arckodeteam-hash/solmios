// require-any-permission.test.ts — #209: "cualquiera de" varios module:action.
//
// Nació para `GET /api/restaurant/in-house`, que sirve a dos roles con permisos distintos (mozo con
// `restaurant:create`, cajero con `restaurant:pay`). Contrato idéntico a `requirePermission`: sin usuario
// 403, super_admin pasa, `*:*` y `module:*` cuentan, y sin NINGUNO de los listados → 403 que nombra todos.
import { describe, it, expect, vi } from 'bun:test'
import { ForbiddenError } from 'arckode-framework'
import { requireAnyPermission } from '../require-permission'

const run = async (user: any, ...required: Array<[string, string]>) => {
  const req = { user } as any
  const next = vi.fn().mockResolvedValue(undefined)
  const err = await requireAnyPermission(...required)(req, next).then(() => null, (e: unknown) => e)
  return { next, err }
}
const PAY_OR_CREATE: Array<[string, string]> = [['restaurant', 'pay'], ['restaurant', 'create']]

describe('requireAnyPermission', () => {
  it('con uno solo de los permisos alcanza (pay sin create, create sin pay)', async () => {
    expect((await run({ role: 'cajero', permissions: ['restaurant:pay'] }, ...PAY_OR_CREATE)).next).toHaveBeenCalled()
    expect((await run({ role: 'waiter', permissions: ['restaurant:create'] }, ...PAY_OR_CREATE)).next).toHaveBeenCalled()
  })

  it('sin ninguno → 403 que nombra los permisos aceptados; next no corre', async () => {
    const { next, err } = await run({ role: 'kitchen', permissions: ['restaurant:view', 'restaurant:edit'] }, ...PAY_OR_CREATE)
    expect(err).toBeInstanceOf(ForbiddenError)
    expect((err as Error).message).toBe('Sin permiso: restaurant:pay o restaurant:create')
    expect(next).not.toHaveBeenCalled()
  })

  it('sin usuario → 403; super_admin y comodines (*:* / restaurant:*) pasan', async () => {
    expect((await run(undefined, ...PAY_OR_CREATE)).err).toBeInstanceOf(ForbiddenError)
    expect((await run({ role: 'super_admin', permissions: [] }, ...PAY_OR_CREATE)).next).toHaveBeenCalled()
    expect((await run({ role: 'x', permissions: ['*:*'] }, ...PAY_OR_CREATE)).next).toHaveBeenCalled()
    expect((await run({ role: 'x', permissions: ['restaurant:*'] }, ...PAY_OR_CREATE)).next).toHaveBeenCalled()
  })

  it('sin permisos listados es un error de programación, no una ruta abierta', () => {
    expect(() => requireAnyPermission()).toThrow()
  })
})
