import { test, expect } from '../fixtures'

// Alta pública (`/registro`, pages/auth/register.vue) — flujo de 2 pasos:
//   1) datos de la persona (nombre, email, contraseña) → "Continuar"
//   2) datos del hotel (nombre obligatorio) + aceptar términos → crea la cuenta y entra al panel
//
// Corre contra el backend real de dev (proxy /api → :3001, ver vite.config.ts) y el signup
// PERSISTE un hotel nuevo en la SQLite local en cada corrida — es intencional (es un E2E real,
// no mockeado), no correr esto contra producción. El endpoint tiene rate-limit por IP
// (20 intentos / 5 min, ver shared/middlewares/rate-limit.ts): correr el archivo muchas veces
// seguidas en poco tiempo puede toparlo.
//
// Email único por corrida (timestamp + random) para no chocar con "ya existe una cuenta con
// ese email" de una corrida anterior.
function uniqueEmail(): string {
  return `e2e.registro.${Date.now()}.${Math.floor(Math.random() * 1e6)}@example.com`
}

// Cumple shared/password-policy.ts: 10+ caracteres, mayúscula, minúscula, número,
// no está en el diccionario de comunes, no es un solo carácter repetido.
const VALID_PASSWORD = 'Solmios2026Segura!'

test.describe('registro público', () => {
  test('completa los 2 pasos y entra al panel', async ({ page }) => {
    const email = uniqueEmail()

    await page.goto('/registro')

    // — Paso 1: la persona —
    await expect(page.getByTestId('register-step1-submit')).toBeDisabled()
    await page.getByTestId('register-owner-name').fill('QA Automatizada')
    await page.getByTestId('register-email').fill(email)
    await page.getByTestId('register-password').fill(VALID_PASSWORD)
    await expect(page.getByTestId('register-step1-submit')).toBeEnabled()
    await page.getByTestId('register-step1-submit').click()

    // — Paso 2: el hotel —
    await expect(page.getByTestId('register-hotel-name')).toBeVisible()
    await page.getByTestId('register-hotel-name').fill(`Hotel E2E ${Date.now()}`)
    await expect(page.getByTestId('register-submit')).toBeDisabled() // falta aceptar términos
    await page.getByTestId('register-terms-checkbox').check()
    await expect(page.getByTestId('register-submit')).toBeEnabled()
    await page.getByTestId('register-submit').click()

    // El alta loguea automáticamente y redirige al panel (ver submit() en register.vue).
    await expect(page).toHaveURL(/\/panel\/dashboard/, { timeout: 15_000 })
    await expect(page.getByTestId('register-error')).not.toBeAttached()
  })

  test('paso 1 no avanza con contraseña débil', async ({ page }) => {
    await page.goto('/registro')
    await page.getByTestId('register-owner-name').fill('QA Automatizada')
    await page.getByTestId('register-email').fill(uniqueEmail())
    await page.getByTestId('register-password').fill('123')
    await expect(page.getByTestId('register-step1-submit')).toBeDisabled()
    // Sigue en paso 1: el campo del hotel (paso 2) todavía no existe en el DOM.
    await expect(page.getByTestId('register-hotel-name')).toHaveCount(0)
  })

  // #94: la prueba gratis es de 15 días (TRIAL_DAYS del backend + DEFAULT_TRIAL_DAYS del frontend).
  // Cubre el copy visible en /registro: badge de la columna de marca, subtítulo del paso 1,
  // bullets de la columna de marca y CTA del paso 2 — y que no quede ningún "7 días" viejo.
  test('muestra 15 días de prueba en badge, CTA y bullets, sin "7 días"', async ({ page }) => {
    await page.goto('/registro')

    // — Badge (columna de marca, visible en el viewport desktop del proyecto chromium) —
    await expect(page.getByText('15 días gratis', { exact: true })).toBeVisible()

    // — Subtítulo del paso 1 —
    await expect(page.getByText(/Empiezas con 15 días gratis/)).toBeVisible()

    // — Bullets: el último dice la política vigente (con tarjeta → "15 días sin cargo…";
    //   sin tarjeta → "Sin tarjeta de crédito"). En ningún caso puede decir "7 días".
    const perks = page.locator('ul li', { hasText: 'Reservas, habitaciones y huéspedes' }).locator('..')
    await expect(perks.locator('li')).toHaveCount(4)
    await expect(perks.locator('li').last()).toHaveText(/15 días sin cargo|Sin tarjeta de crédito/)
    await expect(perks).not.toContainText('7 días')

    // — CTA del paso 2: hay que pasar el paso 1 (no crea nada hasta el submit final) —
    await page.getByTestId('register-owner-name').fill('QA Automatizada')
    await page.getByTestId('register-email').fill(uniqueEmail())
    await page.getByTestId('register-password').fill(VALID_PASSWORD)
    await page.getByTestId('register-step1-submit').click()
    await expect(page.getByTestId('register-submit')).toHaveText('Empezar mis 15 días gratis')

    // — Nada de "7 días" en toda la página (ni en el paso 2 ni en la columna de marca) —
    await expect(page.locator('body')).not.toContainText('7 días')
  })
})
