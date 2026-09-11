import { test, expect, type Page } from '@playwright/test'
import { mkdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import ts from 'typescript'
import { ADMIN_STORAGE_STATE } from '../global-setup'

// UI-07 — Auditoría responsive a 375px (iPhone SE, 375x667). Recorre TODAS las rutas sin params
// del router (públicas + /panel/* + /admin/*), guarda un screenshot fullPage por ruta en
// e2e/.artifacts/mobile-375/<slug>.png y falla si la página desborda horizontalmente
// (document.documentElement.scrollWidth > 375). Un test por ruta para que el reporte diga cuál.
//
// Corre solo en el proyecto `mobile-375` (playwright.config.ts):
//   npx playwright test --project=mobile-375
//
// Las rutas se extraen del AST de src/router/index.ts en tiempo de colección (sin importar el
// router, que arrastra stores/componentes Vue): un route cuenta si tiene `component`, no tiene
// `redirect` y su path completo no lleva `:param`. Así una ruta nueva entra sola a la auditoría.
// Para ver la lista: `npx playwright test --project=mobile-375 --list`.

const VIEWPORT_WIDTH = 375
const ARTIFACTS_DIR = join('e2e', '.artifacts', 'mobile-375')
const ROUTER_FILE = join('src', 'router', 'index.ts')

// Credenciales del seed de dev (migrate-db.ts). /admin requiere super_admin; /panel usa la sesión
// hotel_admin que ya persiste global-setup (ADMIN_STORAGE_STATE).
const SA_EMAIL = process.env.E2E_SUPER_ADMIN_EMAIL || 'admin@solmios.com'
const SA_PASS = process.env.E2E_SUPER_ADMIN_PASSWORD || 'demo123'
const BACKEND = process.env.E2E_BACKEND_URL || 'http://localhost:3001'

// ── Extracción de rutas ────────────────────────────────────────────────────────────────────────
function extractRoutes(file: string): string[] {
  const src = readFileSync(file, 'utf8')
  const sf = ts.createSourceFile(file, src, ts.ScriptTarget.Latest, true)
  const out = new Set<string>()

  const prop = (obj: ts.ObjectLiteralExpression, name: string) =>
    obj.properties.find(
      (p): p is ts.PropertyAssignment => ts.isPropertyAssignment(p) && p.name.getText() === name,
    )

  const walk = (arr: ts.ArrayLiteralExpression, prefix: string) => {
    for (const el of arr.elements) {
      if (!ts.isObjectLiteralExpression(el)) continue
      const path = prop(el, 'path')
      if (!path || !ts.isStringLiteral(path.initializer)) continue
      let full = path.initializer.text
      if (!full.startsWith('/')) full = `${prefix.replace(/\/$/, '')}/${full}`
      full = full.replace(/\/+$/, '') || '/'
      const children = prop(el, 'children')
      // Un padre con `children` es un layout: se auditan sus hijos (el índice '' resuelve al padre).
      if (!children && prop(el, 'component') && !prop(el, 'redirect') && !full.includes(':')) {
        out.add(full)
      }
      if (children && ts.isArrayLiteralExpression(children.initializer)) walk(children.initializer, full)
    }
  }

  const visit = (node: ts.Node) => {
    if (
      ts.isPropertyAssignment(node) &&
      node.name.getText() === 'routes' &&
      ts.isArrayLiteralExpression(node.initializer)
    ) {
      walk(node.initializer, '')
    }
    ts.forEachChild(node, visit)
  }
  visit(sf)
  return [...out]
}

const ALL_ROUTES = extractRoutes(ROUTER_FILE)
const ADMIN_ROUTES = ALL_ROUTES.filter((r) => r === '/admin' || r.startsWith('/admin/'))
const PANEL_ROUTES = ALL_ROUTES.filter((r) => r === '/panel' || r.startsWith('/panel/'))
const PUBLIC_ROUTES = ALL_ROUTES.filter((r) => !ADMIN_ROUTES.includes(r) && !PANEL_ROUTES.includes(r))

const slug = (route: string) => (route === '/' ? 'home' : route.replace(/^\//, '').replace(/\//g, '__'))

// ── Auditoría de una ruta ──────────────────────────────────────────────────────────────────────
async function auditRoute(page: Page, route: string) {
  await page.goto(route)
  // networkidle + un settle corto: las vistas del panel cargan datos en onMounted y algunas
  // renderizan gráficos/tablas recién con la respuesta. Sin esto el scrollWidth se mide en el
  // skeleton y no en la página real.
  await page.waitForLoadState('networkidle', { timeout: 30_000 }).catch(() => {})
  await page.waitForTimeout(500)

  mkdirSync(ARTIFACTS_DIR, { recursive: true })
  await page.screenshot({ path: join(ARTIFACTS_DIR, `${slug(route)}.png`), fullPage: true })

  const { scrollWidth, bodyScrollWidth, finalPath } = await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    bodyScrollWidth: document.body.scrollWidth,
    finalPath: location.pathname,
  }))
  // Si el guard rebotó (rol sin acceso, módulo fuera del plan) se estaría auditando OTRA
  // página: eso es un fallo, no cobertura. Con el seed de dev ninguna ruta sin params redirige.
  expect(finalPath, `${route} redirigió a ${finalPath}: la ruta no se auditó`).toBe(route)
  expect(
    Math.max(scrollWidth, bodyScrollWidth),
    `${route} (renderizada en ${finalPath}) desborda a ${VIEWPORT_WIDTH}px: scrollWidth=${scrollWidth} body=${bodyScrollWidth}`,
  ).toBeLessThanOrEqual(VIEWPORT_WIDTH)
}

test.describe('mobile-375: cobertura del router', () => {
  test('el router expone al menos 100 rutas sin params', () => {
    // Guarda contra una regresión del extractor (si el router cambia de forma y el AST ya no
    // matchea, el describe de abajo quedaría vacío y la suite "pasaría" sin auditar nada).
    expect(PUBLIC_ROUTES.length, 'rutas públicas').toBeGreaterThan(0)
    expect(PANEL_ROUTES.length, 'rutas /panel').toBeGreaterThan(0)
    expect(ADMIN_ROUTES.length, 'rutas /admin').toBeGreaterThan(0)
    expect(ALL_ROUTES.length).toBeGreaterThanOrEqual(100)
  })
})

test.describe('mobile-375: rutas públicas (sin sesión)', () => {
  for (const route of PUBLIC_ROUTES) {
    test(`${route} no desborda a 375px`, async ({ page }) => {
      await auditRoute(page, route)
    })
  }
})

test.describe('mobile-375: /panel (hotel_admin)', () => {
  test.use({ storageState: ADMIN_STORAGE_STATE })
  for (const route of PANEL_ROUTES) {
    test(`${route} no desborda a 375px`, async ({ page }) => {
      await auditRoute(page, route)
    })
  }
})

test.describe('mobile-375: /admin (super_admin)', () => {
  // Misma sesión que arma global-setup pero para el super_admin: login por API contra el backend
  // (una vez por worker) y se inyecta en localStorage bajo el origin del frontend antes de navegar.
  let session: { token: string; refreshToken: string; user: unknown }

  test.beforeAll(async ({ request }) => {
    const res = await request.post(`${BACKEND}/api/auth/login`, {
      data: { email: SA_EMAIL, password: SA_PASS },
    })
    if (!res.ok()) {
      throw new Error(
        `mobile-375: login super_admin falló (${res.status()}). ¿Backend corriendo en ${BACKEND} con el seed demo?`,
      )
    }
    const body = await res.json()
    const data = body.data ?? body
    const { token, refreshToken, user } = data
    session = { token, refreshToken, user }
  })

  test.beforeEach(async ({ page }) => {
    await page.addInitScript((s) => {
      localStorage.setItem('token', s.token)
      localStorage.setItem('refreshToken', s.refreshToken)
      localStorage.setItem('user', JSON.stringify(s.user))
    }, session)
  })

  for (const route of ADMIN_ROUTES) {
    test(`${route} no desborda a 375px`, async ({ page }) => {
      await auditRoute(page, route)
    })
  }
})
