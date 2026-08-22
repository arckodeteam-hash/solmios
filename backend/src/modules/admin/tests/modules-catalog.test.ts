// modules-catalog.test.ts — GET /api/admin/modules/catalog (árbol módulo→sub-módulos).
//
// Fuente única: el MISMO MODULE_CATALOG que lee el gate (usecases/modules.ts) — el editor de
// planes del super_admin no duplica la lista en el frontend. El test monta el módulo admin REAL
// sobre un Router/HotelAuth reales (route-permission-helpers) y verifica:
//   (a) el guard de plataforma: solo super_admin con userType admin (un merchant del panel no
//       puede enumerar el catálogo aunque tenga el rol);
//   (b) el árbol es una proyección fiel del catálogo: mismas claves/labels, hijos como
//       `children` (solo key+label, forma estable para el frontend).
import { describe, it, expect } from 'bun:test'
import { mountModule } from '../../../infrastructure/auth/tests/route-permission-helpers'
import { AdminModule } from '../index'
import { MODULE_CATALOG } from '../usecases/modules'

const { router, auth } = mountModule(AdminModule)

/** Token directo (tokenFor de los helpers hardcodea userType merchant — acá importa el userType). */
const headersFor = (role: string, userType: string) => ({
  authorization: `Bearer ${auth.createToken({ id: `user-${role}`, role, hotelId: 'platform', userType })}`,
})

describe('GET /api/admin/modules/catalog — guard de plataforma', () => {
  // Mappeo del framework: AuthError → 401 (sin token / userType rechazado por
  // requireUserType), ForbiddenError → 403 (rol rechazado por authenticate).
  it('super_admin con userType merchant → 401 (requireUserType admin lo corta)', async () => {
    const res = await router.resolve('GET', '/api/admin/modules/catalog', { headers: headersFor('super_admin', 'merchant') })
    expect(res.status).toBe(401)
  })

  it('hotel_admin (merchant) → 403 (authenticate super_admin)', async () => {
    const res = await router.resolve('GET', '/api/admin/modules/catalog', { headers: headersFor('hotel_admin', 'merchant') })
    expect(res.status).toBe(403)
  })

  it('sin token → 401', async () => {
    const res = await router.resolve('GET', '/api/admin/modules/catalog')
    expect(res.status).toBe(401)
  })
})

describe('GET /api/admin/modules/catalog — forma del árbol', () => {
  it('super_admin (userType admin) → 200 con el árbol completo del catálogo', async () => {
    const res = await router.resolve('GET', '/api/admin/modules/catalog', { headers: headersFor('super_admin', 'admin') })
    expect(res.status).toBe(200)
    const tree = res.body as Array<{ key: string; label: string; children: Array<{ key: string; label: string }> }>
    expect(Array.isArray(tree)).toBe(true)
    // Mismas claves, mismo orden que el catálogo del gate — es una proyección, no una copia.
    expect(tree.map((m) => m.key)).toEqual(MODULE_CATALOG.map((m) => m.key))
    const finance = tree.find((m) => m.key === 'finance')!
    expect(finance.label).toBe('Finanzas')
    expect(finance.children).toContainEqual({ key: 'finance.billing', label: 'Facturación' })
  })

  it('los submódulos viajan como children (solo key+label) y un módulo sin submódulos en [] (no undefined)', async () => {
    const res = await router.resolve('GET', '/api/admin/modules/catalog', { headers: headersFor('super_admin', 'admin') })
    const tree = res.body as any[]
    const reservations = MODULE_CATALOG.find((m) => m.key === 'reservations')!
    expect(tree.find((m) => m.key === 'reservations')!.children)
      .toEqual(reservations.submodules!.map((s) => ({ key: s.key, label: s.label })))
    const crm = tree.find((m) => m.key === 'crm')!
    expect(crm.children).toEqual([]) // forma estable para el editor: iterar sin guard de undefined
  })

  // Claves nuevas del feature-gating (2026-08-21): tienen que llegar al editor para que el
  // dueño las agregue/saque de los planes (CS-9 marca inválida cualquier clave fuera del catálogo).
  it('site-pages (+4 tabs de API), settings.rates y settings.audit están en el árbol del editor', async () => {
    const res = await router.resolve('GET', '/api/admin/modules/catalog', { headers: headersFor('super_admin', 'admin') })
    const tree = res.body as any[]
    const sitePages = tree.find((m) => m.key === 'site-pages')!
    expect(sitePages.label).toBe('Página pública')
    expect(sitePages.children).toEqual([
      { key: 'site-pages.landing', label: 'Landing' },
      { key: 'site-pages.media', label: 'Media' },
      { key: 'site-pages.booking', label: 'Motor de reservas' },
      { key: 'site-pages.promos', label: 'Códigos de descuento' },
    ])
    const settings = tree.find((m) => m.key === 'settings')!
    expect(settings.children).toContainEqual({ key: 'settings.rates', label: 'Temporadas y Tarifas' })
    expect(settings.children).toContainEqual({ key: 'settings.audit', label: 'Auditoría' })
  })
})
