// deny-impersonation.test.ts — El candado que le saca al token de impersonación el poder
// que la impersonación deliberadamente le quitó al admin.
//
// EL AGUJERO QUE CIERRA: el token que emite `usecases/impersonate.ts` lleva `role: 'super_admin'`
// (para que el admin no pierda permisos dentro de la cuenta del cliente). `requirePermission`
// hace bypass total con ese rol, así que con el token de impersonación se llegaba a
// POST /api/auth/switch-hotel/:id, donde `currentRole === 'super_admin'` anula el chequeo de
// pertenencia: el admin saltaba al hotel de CUALQUIER otro cliente y recibía un token nuevo
// SIN el claim `impersonatedBy` (se perdía la marca de auditoría) y CON refresh token de verdad
// (la impersonación no tiene refresh a propósito: dura 2h y muere sola), y de paso `users.token`
// del cliente quedaba pisado, deslogueándolo. Lo mismo valía para /api/auth/logout (cortarle la
// sesión real al cliente) y /api/auth/change-password (tomarle la cuenta).
//
// Si esto se borra en un refactor, las tres garantías de impersonate.ts vuelven a ser evitables.
import { describe, it, expect, vi } from 'bun:test'
import { denyImpersonation } from '../../../infrastructure/auth/deny-impersonation'

const IMPERSONATED = { id: 'u1', role: 'super_admin', hotelId: 'h1', userType: 'merchant', impersonatedBy: 'admin-1' }
const REAL_ADMIN = { id: 'admin-1', role: 'super_admin', hotelId: null, userType: 'admin' }

describe('denyImpersonation', () => {
  it('rechaza el token de impersonación y no deja pasar al handler', async () => {
    const mw = denyImpersonation()
    const next = vi.fn()

    await expect(mw({ user: { ...IMPERSONATED } } as any, next as any))
      .rejects.toThrow('No disponible mientras estás viendo la cuenta de un cliente')
    expect(next).not.toHaveBeenCalled()
  })

  it('deja pasar una sesión normal (sin el claim impersonatedBy)', async () => {
    const mw = denyImpersonation()
    const next = vi.fn().mockResolvedValue({ status: 200 })

    await mw({ user: { ...REAL_ADMIN } } as any, next as any)
    expect(next).toHaveBeenCalledTimes(1)
  })

  it('falla cerrado si no hay usuario en el request', async () => {
    // Misma convención que require-permission.ts / require-user-type.ts: sin token
    // autenticado el middleware lanza en vez de asumir "no es impersonación, pasá".
    const mw = denyImpersonation()
    const next = vi.fn()

    await expect(mw({} as any, next as any)).rejects.toThrow('Authentication required')
    expect(next).not.toHaveBeenCalled()
  })
})
