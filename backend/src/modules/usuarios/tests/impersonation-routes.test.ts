// impersonation-routes.test.ts — Qué rutas NO acepta un token de impersonación.
//
// El token de impersonación lleva `role: 'super_admin'` a propósito, para que el admin conserve
// los permisos DENTRO de la cuenta del cliente. El efecto colateral es que `requirePermission`
// le hace bypass a TODO, y varios handlers (`controller.store`/`update`, `switchHotel`) además
// saltean el anclaje por hotelId y `canAssignRole` cuando el rol es super_admin. Sin un candado
// explícito, una sesión de soporte de 2h podía:
//   · emitir por switch-hotel un token nuevo SIN la marca `impersonatedBy` y CON refresh token,
//     pisando de paso `users.token` del cliente y desloguéandolo;
//   · escribir `role: 'super_admin'` en la tabla o cambiar contraseñas sin pedir la actual
//     → una escalada de privilegios PERMANENTE a partir de una sesión temporal.
//
// Este test mira el cableado real del módulo (no el middleware aislado, que ya tiene el suyo):
// arma el módulo con dependencias de mentira, corre la cadena de middlewares de cada ruta con un
// `req.user` de impersonación y exige que alguna la rechace. Si alguien agrega una ruta sensible
// y se olvida del candado, esto se cae.
import { describe, it, expect, beforeAll } from 'bun:test'

process.env.JWT_SECRET ||= 'test-secret-para-el-modulo-usuarios'

type Ruta = { metodo: string; path: string; mws: any[] }

const rutas: Ruta[] = []

beforeAll(async () => {
  const { UsuariosModule } = await import('../index')
  const router: any = {}
  for (const m of ['get', 'post', 'put', 'delete', 'patch']) {
    router[m] = (path: string, mws: any, handler?: any) => {
      rutas.push({ metodo: m, path, mws: Array.isArray(mws) ? mws : handler ? [mws] : [] })
    }
  }
  const logger: any = { child: () => logger, info() {}, warn() {}, debug() {}, error() {} }
  const orm: any = { define() {}, findMany: async () => [], findOne: async () => null }
  // `authenticate` ya validó el token: acá interesa lo que viene DESPUÉS de él.
  const auth: any = { authenticate: () => async (_req: any, next: any) => next(), assertOwnership() {} }
  ;(UsuariosModule() as any).create({ logger, orm, cache: undefined, router, auth })
})

/** Corre la cadena de una ruta con el `req` dado. Devuelve el error si alguna la cortó. */
async function correrCadena(ruta: Ruta, req: any): Promise<Error | null> {
  try {
    for (const mw of ruta.mws) {
      let siguio = false
      await mw(req, async () => { siguio = true })
      if (!siguio) break
    }
    return null
  } catch (e) {
    return e as Error
  }
}

const buscar = (metodo: string, path: string) => {
  const r = rutas.find((x) => x.metodo === metodo && x.path === path)
  if (!r) throw new Error(`ruta no registrada: ${metodo.toUpperCase()} ${path}`)
  return r
}

const SENSIBLES: Array<[string, string]> = [
  ['post', '/api/auth/logout'],
  ['post', '/api/auth/change-password'],
  ['post', '/api/auth/switch-hotel/:id'],
  ['post', '/api/usuarios'],
  ['put', '/api/usuarios/:id'],
  ['delete', '/api/usuarios/:id'],
]

const usuarioImpersonando = () => ({ id: 'u-cliente', role: 'super_admin', hotelId: 'h1', userType: 'merchant', impersonatedBy: 'u-super' })
const superAdminDeVerdad = () => ({ id: 'u-super', role: 'super_admin', hotelId: 'platform', userType: 'admin' })

describe('rutas cerradas a una sesión de impersonación', () => {
  for (const [metodo, path] of SENSIBLES) {
    it(`${metodo.toUpperCase()} ${path} rechaza el token de impersonación`, async () => {
      const err = await correrCadena(buscar(metodo, path), { user: usuarioImpersonando(), params: {}, body: {} })
      expect(err).not.toBeNull()
      expect(String(err?.message)).toMatch(/cliente/i)
    })

    it(`${metodo.toUpperCase()} ${path} sigue abierta para un super admin de verdad`, async () => {
      const err = await correrCadena(buscar(metodo, path), { user: superAdminDeVerdad(), params: {}, body: {} })
      expect(err).toBeNull()
    })
  }

  it('la impersonación NO cierra las rutas que el admin sí necesita dentro de la cuenta del cliente', async () => {
    // Criterio 3 del issue: adentro tiene todos los permisos. Leer el perfil y listar los
    // usuarios del hotel son justo lo que se va a ver, así que no pueden quedar bloqueadas.
    for (const [metodo, path] of [['get', '/api/auth/me'], ['get', '/api/usuarios']] as Array<[string, string]>) {
      const err = await correrCadena(buscar(metodo, path), { user: usuarioImpersonando(), params: {}, body: {} })
      expect(err).toBeNull()
    }
  })
})
