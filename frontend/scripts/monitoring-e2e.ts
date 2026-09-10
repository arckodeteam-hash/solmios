// scripts/monitoring-e2e.ts — Verificación en navegador de /admin/monitoring contra un backend REAL (#96).
//
// No es un spec de Playwright Test: es un script suelto (chromium headless) que recorre la pantalla
// como lo haría una persona y falla (exit ≠ 0) ante cualquier cosa que no cuadre. Comprueba:
//   1. login super_admin por el formulario y llegada a /admin/monitoring
//   2. la página muestra lecturas reales (sin skeleton, sin "Comprobando…") y NINGÚN literal de la maqueta vieja
//   3. tras generar tráfico, la tarjeta API lista rutas
//   4. "Refrescar" vuelve a pedir las lecturas y el contador de peticiones crece
//   5. "Crear backup" muestra progreso y el archivo aparece en la lista
//   6. "Descargar" entrega EL archivo: evento `download`, respuesta 200 de /download, mismo tamaño que informó
//      el POST, cabecera "SQLite format 3" si es .sqlite y, si BACKUP_DIR está definido, bytes idénticos al
//      archivo que dejó el backend en disco
//   7. "Borrar" + confirmación lo quita de la lista
//   8. capturas a 1280px y 375px
//   9. un merchant autenticado recibe 403 en /api/admin/backups y en /api/admin/monitoring/*
//
// Requisitos: backend levantado (SQLite sirve) con el seed demo de migrate-db.ts y Vite sirviendo el
// frontend con el proxy /api. Ejecutar desde frontend/:
//   PLAYWRIGHT_BROWSERS_PATH=/opt/playwright bun run scripts/monitoring-e2e.ts
//
// Variables (todas con default):
//   BASE_URL            frontend (default http://localhost:5180)
//   API_URL             backend directo, para el chequeo del merchant (default http://localhost:3001)
//   ADMIN_EMAIL / ADMIN_PASSWORD        super_admin del seed (admin@solmios.com / demo123)
//   MERCHANT_EMAIL / MERCHANT_PASSWORD  usuario de hotel del seed (admin@caribeparadise.com / demo123)
//   SCREENSHOT_DIR      dónde dejar monitoring.png y monitoring-375.png (default os.tmpdir())
//   CHROMIUM_PATH       ejecutable de chromium si el bundle de Playwright no coincide con el instalado
//   BACKUP_DIR          el mismo BACKUP_DIR del backend: si se indica, la descarga se compara byte a byte
import { chromium, type Browser, type Page } from 'playwright'
import { existsSync, readFileSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const BASE_URL = process.env.BASE_URL || 'http://localhost:5180'
const API_URL = process.env.API_URL || 'http://localhost:3001'
const ADMIN_EMAIL = process.env.ADMIN_EMAIL || 'admin@solmios.com'
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'demo123'
const MERCHANT_EMAIL = process.env.MERCHANT_EMAIL || 'admin@caribeparadise.com'
const MERCHANT_PASSWORD = process.env.MERCHANT_PASSWORD || 'demo123'
const SCREENSHOT_DIR = process.env.SCREENSHOT_DIR || tmpdir()
const CHROMIUM_PATH = process.env.CHROMIUM_PATH
const BACKUP_DIR = process.env.BACKUP_DIR

const TIMEOUT_MS = 30_000
/**
 * Literales de la maqueta anterior, con la unidad con la que aparecían ("99.99%", "8.2GB", "34/100", "42 días",
 * "1,892 enviados", proveedores). Se buscan con su unidad porque un número suelto (68.9, 24.5, 45 ms) puede ser
 * una medición real; el grep sin unidad sobre el código fuente lo cubre la tarea 5 (`grep -ciE … → 0`).
 */
const LITERALES_MAQUETA = /99\.99 ?%|8\.2 ?GB|34\/100|1[.,]240 (?:archivos|imágenes)|24\.5 ?GB|1[.,]892 enviados|42 días|AWS|\bS3\b|CloudFront|SendGrid/i
/** Endpoints nuevos que un merchant no puede tocar (REQ-MON tasks 1.5, 2.5, 3.4, 4.4, 5.1). */
const ENDPOINTS_SUPER_ADMIN = [
  '/api/admin/backups',
  '/api/admin/monitoring/api',
  '/api/admin/monitoring/errors',
  '/api/admin/monitoring/system',
  '/api/admin/monitoring/queues',
]

function assert(cond: unknown, msg: string): asserts cond {
  if (!cond) throw new Error(msg)
}

function paso(n: number, msg: string): void {
  console.log(`[${n}] ${msg}`)
}

async function apiLogin(email: string, password: string): Promise<string> {
  const res = await fetch(`${API_URL}/api/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email, password }),
  })
  assert(res.ok, `login API de ${email} devolvió ${res.status}`)
  const body = (await res.json()) as { data?: { token?: string }; token?: string }
  const token = body.data?.token ?? body.token
  assert(token, `login API de ${email} no devolvió token`)
  return token
}

async function loginUI(page: Page): Promise<void> {
  await page.goto(`${BASE_URL}/login`)
  await page.getByTestId('login-email').fill(ADMIN_EMAIL)
  await page.getByTestId('login-password').fill(ADMIN_PASSWORD)
  await page.getByTestId('login-submit').click()
  await page.waitForURL(/\/admin/, { timeout: TIMEOUT_MS })
}

/** Espera a que las cinco lecturas hayan terminado: el estado global deja de ser "Comprobando…" y no queda skeleton. */
async function esperarLecturas(page: Page): Promise<void> {
  const estado = page.getByTestId('estado-global')
  await estado.waitFor({ timeout: TIMEOUT_MS })
  await page.waitForFunction(
    () => !document.querySelector('[data-testid="estado-global"]')?.textContent?.includes('Comprobando'),
    null,
    { timeout: TIMEOUT_MS },
  )
  // SkeletonLoader marca sus bloques con aria-label="Cargando"
  await page.waitForFunction(() => document.querySelectorAll('[aria-label="Cargando"]').length === 0, null, { timeout: TIMEOUT_MS })
}

async function peticionesTotales(page: Page): Promise<number> {
  // Bloque "N / PETICIONES" del resumen de la tarjeta API (el número va arriba del rótulo)
  const bloque = page.locator('div.text-center').filter({ has: page.getByText('Peticiones', { exact: true }) }).first()
  const txt = await bloque.locator('div.text-xl').first().innerText()
  const n = Number(txt.replace(/[^\d]/g, ''))
  assert(Number.isFinite(n), `no se pudo leer el total de peticiones ("${txt}")`)
  return n
}

async function generarTrafico(token: string): Promise<void> {
  const h = { authorization: `Bearer ${token}` }
  for (let i = 0; i < 3; i++) {
    await fetch(`${API_URL}/api/health`)
    await fetch(`${API_URL}/api/admin/monitoring/system`, { headers: h })
  }
}

async function main(): Promise<void> {
  const adminToken = await apiLogin(ADMIN_EMAIL, ADMIN_PASSWORD)
  const merchantToken = await apiLogin(MERCHANT_EMAIL, MERCHANT_PASSWORD)

  const browser: Browser = await chromium.launch({ headless: true, executablePath: CHROMIUM_PATH })
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 }, acceptDownloads: true })
  const page = await ctx.newPage()
  const erroresConsola: string[] = []
  page.on('pageerror', (e) => erroresConsola.push(e.message))

  try {
    // 1. login + navegación
    await loginUI(page)
    await page.goto(`${BASE_URL}/admin/monitoring`)
    await page.getByRole('heading', { name: 'Monitoreo de la plataforma' }).waitFor({ timeout: TIMEOUT_MS })
    paso(1, `login como ${ADMIN_EMAIL} y /admin/monitoring cargado`)

    // 2. lecturas reales, sin skeleton ni literales de maqueta
    await esperarLecturas(page)
    const estado = (await page.getByTestId('estado-global').innerText()).trim()
    assert(!/sin respuesta/i.test(estado), `el backend no respondió a las lecturas: "${estado}"`)
    assert((await page.getByTestId('fallo-global').count()) === 0, 'la página muestra fallos de lectura con el backend arriba')
    for (const titulo of ['API HTTP', 'Sistema y base de datos', 'Errores recientes', 'Colas', 'Backups']) {
      assert((await page.getByRole('heading', { name: titulo, exact: true }).count()) > 0, `falta la tarjeta "${titulo}"`)
    }
    const texto = await page.locator('body').innerText()
    const literal = texto.match(LITERALES_MAQUETA)
    const contexto = literal ? texto.slice(Math.max(0, (literal.index ?? 0) - 40), (literal.index ?? 0) + 40).replace(/\s+/g, ' ') : ''
    assert(!literal, `la pantalla sigue mostrando un literal de la maqueta: "${literal?.[0]}" (…${contexto}…)`)
    paso(2, `estado global "${estado}", 5 tarjetas con datos y sin literales de maqueta`)

    // 3. tráfico → la tarjeta API lista rutas
    await generarTrafico(adminToken)
    await Promise.all([
      page.waitForResponse((r) => r.url().includes('/api/admin/monitoring/api') && r.ok(), { timeout: TIMEOUT_MS }),
      page.getByRole('button', { name: 'Refrescar' }).click(),
    ])
    await esperarLecturas(page)
    const filasRutas = page.locator('tbody tr').filter({ hasText: /\b(GET|POST|PUT|PATCH|DELETE)\b/ }).filter({ hasText: '/api/' })
    assert((await filasRutas.count()) > 0, 'la tarjeta API no lista ninguna ruta tras generar tráfico')
    assert((await page.getByText('Sin peticiones registradas').count()) === 0, 'la tarjeta API sigue vacía tras generar tráfico')
    const rutaEjemplo = (await filasRutas.first().innerText()).replace(/\s+/g, ' ').trim()
    paso(3, `${await filasRutas.count()} rutas en la tarjeta API (p.ej. "${rutaEjemplo}")`)

    // 4. Refrescar vuelve a leer: el total de peticiones crece (la propia lectura suma)
    const antes = await peticionesTotales(page)
    await generarTrafico(adminToken)
    await Promise.all([
      page.waitForResponse((r) => r.url().includes('/api/admin/monitoring/api') && r.ok(), { timeout: TIMEOUT_MS }),
      page.getByRole('button', { name: 'Refrescar' }).click(),
    ])
    await esperarLecturas(page)
    const despues = await peticionesTotales(page)
    assert(despues > antes, `Refrescar no recargó: peticiones ${antes} → ${despues}`)
    paso(4, `Refrescar recargó las lecturas: peticiones ${antes} → ${despues}`)

    // 5. Crear backup: progreso visible y el archivo nuevo en la lista
    const idsAntes = await page.locator('li .font-mono').allInnerTexts()
    const creado = page.waitForResponse((r) => r.url().includes('/api/admin/backups') && r.request().method() === 'POST', { timeout: 120_000 })
    await page.getByRole('button', { name: 'Crear backup' }).click()
    await page.getByRole('status').filter({ hasText: 'Generando el volcado' }).waitFor({ state: 'visible', timeout: TIMEOUT_MS })
    const resCreado = await creado
    assert(resCreado.ok(), `POST /api/admin/backups devolvió ${resCreado.status()}`)
    const cuerpoCreado = (await resCreado.json()) as { data?: { archivo?: { id?: string; bytes?: number } } }
    const backupId = cuerpoCreado.data?.archivo?.id
    assert(backupId, 'el POST de backup no devolvió archivo.id')
    assert(!idsAntes.includes(backupId), `el backup ${backupId} ya estaba en la lista antes de crearlo`)
    await page.getByRole('status').filter({ hasText: 'Generando el volcado' }).waitFor({ state: 'hidden', timeout: TIMEOUT_MS })
    const fila = page.locator('li').filter({ hasText: backupId })
    await fila.waitFor({ state: 'visible', timeout: TIMEOUT_MS })
    paso(5, `backup creado: ${backupId} (${cuerpoCreado.data?.archivo?.bytes ?? '?'} bytes) con progreso visible y ahora en la lista`)

    // 6. Descargar: evento download + respuesta 200 con contenido
    const [download, resDescarga] = await Promise.all([
      page.waitForEvent('download', { timeout: TIMEOUT_MS }),
      page.waitForResponse((r) => r.url().includes(`/api/admin/backups/${encodeURIComponent(backupId)}/download`), { timeout: TIMEOUT_MS }),
      fila.getByRole('button', { name: 'Descargar' }).click(),
    ])
    assert(resDescarga.status() === 200, `GET /download devolvió ${resDescarga.status()}`)
    assert(Number(resDescarga.headers()['content-length'] || 0) > 0, 'la descarga vino sin Content-Length')
    const rutaDescarga = await download.path()
    assert(rutaDescarga, 'Playwright no guardó la descarga')
    const bytesDescarga = statSync(rutaDescarga).size
    assert(bytesDescarga > 0, `el archivo descargado tiene ${bytesDescarga} bytes`)
    assert(download.suggestedFilename() === backupId, `nombre sugerido "${download.suggestedFilename()}" ≠ ${backupId}`)
    // El archivo bajado tiene que ser EL volcado, byte a byte: mismo tamaño que informó el POST y sin
    // envoltorio JSON (un Buffer serializado como {"type":"Buffer","data":[…]} no restaura nada).
    const bytesInformados = cuerpoCreado.data?.archivo?.bytes
    const contenidoDescarga = readFileSync(rutaDescarga)
    const cabecera = contenidoDescarga.subarray(0, 16).toString('latin1')
    assert(!cabecera.startsWith('{"type":"Buffer"'), `la descarga es un Buffer serializado como JSON, no el archivo (${bytesDescarga} bytes)`)
    assert(bytesDescarga === bytesInformados, `la descarga pesa ${bytesDescarga} bytes y el backup creado ${bytesInformados}`)
    if (backupId.endsWith('.sqlite')) assert(cabecera.startsWith('SQLite format 3'), `la descarga no arranca con la cabecera SQLite ("${cabecera}")`)
    let comparacion = 'cabecera válida'
    if (BACKUP_DIR) {
      const enDisco = join(BACKUP_DIR, backupId)
      assert(existsSync(enDisco), `el backend no dejó ${backupId} en BACKUP_DIR=${BACKUP_DIR}`)
      assert(contenidoDescarga.equals(readFileSync(enDisco)), `la descarga no es byte a byte igual a ${enDisco}`)
      comparacion = `bytes idénticos a ${enDisco}`
    }
    paso(6, `descarga de ${backupId}: HTTP 200, ${bytesDescarga} bytes en disco (= ${bytesInformados} informados), ${comparacion}`)

    // 7. Borrar + confirmar → desaparece de la lista
    await fila.getByRole('button', { name: 'Borrar' }).click()
    const modal = page.locator('.app-modal-panel').filter({ hasText: 'Borrar backup' })
    await modal.waitFor({ state: 'visible', timeout: TIMEOUT_MS })
    await Promise.all([
      page.waitForResponse((r) => r.url().includes('/api/admin/backups/') && r.request().method() === 'DELETE' && r.ok(), { timeout: TIMEOUT_MS }),
      modal.getByRole('button', { name: 'Borrar', exact: true }).click(),
    ])
    await fila.waitFor({ state: 'detached', timeout: TIMEOUT_MS })
    assert((await page.locator('li').filter({ hasText: backupId }).count()) === 0, `${backupId} sigue en la lista tras borrarlo`)
    paso(7, `backup ${backupId} borrado tras confirmar y ya no aparece en la lista`)

    // 8. capturas
    const captura1280 = join(SCREENSHOT_DIR, 'monitoring.png')
    const captura375 = join(SCREENSHOT_DIR, 'monitoring-375.png')
    await page.screenshot({ path: captura1280, fullPage: true })
    await page.setViewportSize({ width: 375, height: 812 })
    await page.screenshot({ path: captura375, fullPage: true })
    paso(8, `capturas: ${captura1280} (1280px) y ${captura375} (375px)`)

    // 9. merchant → 403 en los endpoints nuevos
    for (const ep of ENDPOINTS_SUPER_ADMIN) {
      const res = await fetch(`${API_URL}${ep}`, { headers: { authorization: `Bearer ${merchantToken}` } })
      assert(res.status === 403, `merchant GET ${ep} devolvió ${res.status}, se esperaba 403`)
    }
    const resPost = await fetch(`${API_URL}/api/admin/backups`, { method: 'POST', headers: { authorization: `Bearer ${merchantToken}`, 'content-type': 'application/json' }, body: '{}' })
    assert(resPost.status === 403, `merchant POST /api/admin/backups devolvió ${resPost.status}, se esperaba 403`)
    paso(9, `merchant ${MERCHANT_EMAIL}: 403 en ${ENDPOINTS_SUPER_ADMIN.length} GET + POST /api/admin/backups`)

    assert(erroresConsola.length === 0, `errores JS en la página: ${erroresConsola.join(' | ')}`)

    console.log(`OK — backup ${backupId} creado/descargado (${bytesDescarga} bytes)/borrado · Refrescar ${antes}→${despues} peticiones · merchant 403 · captura ${captura1280}`)
  } finally {
    await browser.close()
  }
}

main().catch((e: unknown) => {
  console.error(`FALLO: ${(e as Error)?.message ?? e}`)
  process.exit(1)
})
