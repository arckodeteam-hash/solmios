// me-impersonation.test.ts — GET /auth/me delata la sesión de impersonación.
import { describe, it, expect, vi, beforeEach } from 'bun:test'
import { UsuariosController } from '../controller'

// Perfil tal como sale de `service.me`: es la fila del usuario IMPERSONADO, con SUS permisos.
const PROFILE = {
  id: 'u1',
  name: 'Ana',
  email: 'ana@hotel.com',
  role: 'hotel_admin',
  hotelId: 'h1',
  hotelName: 'Hotel Caribe',
  permissions: ['reservations:view'],
}

describe('UsuariosController.me', () => {
  let service: any
  let logger: any
  let controller: UsuariosController

  beforeEach(() => {
    service = { me: vi.fn().mockResolvedValue({ ...PROFILE }) }
    logger = { info: vi.fn(), debug: vi.fn(), warn: vi.fn(), error: vi.fn() }
    controller = new UsuariosController(service, logger)
  })

  it('token normal: devuelve el perfil tal cual, sin impersonatedBy y sin pisar permisos', async () => {
    const res = await controller.me({ user: { id: 'u1', role: 'hotel_admin', hotelId: 'h1' } } as any)

    expect(res.status).toBe(200)
    expect(res.body).toEqual({ ...PROFILE })
    expect((res.body as any).impersonatedBy).toBeUndefined()
    expect((res.body as any).permissions).toEqual(['reservations:view'])
  })

  it('token de impersonación: agrega impersonatedBy y permisos totales, conservando el perfil', async () => {
    const res = await controller.me({
      user: { id: 'u1', role: 'super_admin', hotelId: 'h1', impersonatedBy: 'admin-1' },
    } as any)

    expect(res.status).toBe(200)
    expect((res.body as any).impersonatedBy).toBe('admin-1')
    // Los permisos totales NO salen del rol del token (que es el REAL del cliente): los da
    // loadPermissions por el claim impersonatedBy. `/auth/me` no pasa por ese middleware, así
    // que los devuelve acá para que la UI no esconda botones que el backend sí permite usar.
    expect((res.body as any).permissions).toEqual(['*:*'])
    expect(res.body).toMatchObject({
      id: 'u1',
      name: 'Ana',
      email: 'ana@hotel.com',
      role: 'hotel_admin',
      hotelId: 'h1',
      hotelName: 'Hotel Caribe',
    })
  })

  it('consulta el perfil del usuario impersonado (el id del token), no el del admin', async () => {
    await controller.me({ user: { id: 'u1', role: 'super_admin', impersonatedBy: 'admin-1' } } as any)

    expect(service.me).toHaveBeenCalledTimes(1)
    expect(service.me).toHaveBeenCalledWith('u1')
  })
})
