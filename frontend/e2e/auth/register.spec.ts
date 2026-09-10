import { test, expect } from '../fixtures'
import type { APIRequestContext } from '@playwright/test'

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

// El backend real detrás del proxy de Vite. Se le pega DIRECTO (no vía /api del front) para que
// el trialEndsAt comparado sea el que guardó el alta, sin nada en el medio. Mismo default que
// global-setup.ts.
const BACKEND = process.env.E2E_BACKEND_URL || 'http://localhost:3001'

// La prueba gratis dura 15 días: TRIAL_DAYS en backend/src/modules/subscriptions/usecases/signup.ts
// y DEFAULT_TRIAL_DAYS en src/services/Signup.service.ts. Si cambia, cambia acá también: este
// número es justamente lo que el test viene a comprobar.
const TRIAL_DAYS = 15
const MS_PER_DAY = 24 * 60 * 60 * 1000

// El envelope del backend anida: `{ success, data: { data: <payload> } }` en las rutas de
// subscriptions (ver controller.myStatus → `{ data }` + el wrapper del framework).
function unwrapData(body: any): any {
  return body?.data?.data ?? body?.data ?? body
}

/**
 * #71: el alta sólo acepta planes con `plans.trialEligible` (400 "no se prueba, se contrata" en
 * caso contrario) y `/registro` sólo ofrece esos. Se toma el primero elegible del catálogo
 * público — si no hay ninguno, el entorno no está sembrado y se dice claro en vez de fallar
 * más adelante con un select vacío.
 */
async function firstTrialEligiblePlan(request: APIRequestContext): Promise<{ id: string; name: string }> {
  const res = await request.get(`${BACKEND}/api/public/plans`)
  expect(res.ok(), `GET /api/public/plans respondió ${res.status()}`).toBeTruthy()
  const list = unwrapData(await res.json())
  const eligible = (Array.isArray(list) ? list : []).filter((p: any) => p?.trialEligible !== false)
  expect(
    eligible.length,
    'no hay ningún plan con trialEligible en GET /api/public/plans: sembrá uno activo (isActive=1, trialEligible=1) en la tabla plans del backend bajo prueba',
  ).toBeGreaterThan(0)
  return { id: String(eligible[0].id), name: String(eligible[0].name) }
}

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

  // #71: el alta con un plan elegible asigna EXACTAMENTE 15 días de prueba, y el panel muestra
  // ese mismo número. Se comprueba en los dos lugares donde podría desviarse: en los datos
  // (`trialEndsAt` de GET /api/subscription/me contra la hora del alta + 15 días) y en la pantalla
  // (/panel/suscripcion dice "quedan 15 días"). Un copy que diga 15 con un trial de 7 en la base
  // —o al revés— es exactamente lo que este test tiene que ver.
  //
  // Precondición del entorno: `subscription_settings.requireCardOnTrial` en false (igual que el
  // primer test: con la tarjeta exigida el alta va a Stripe y no entra al panel) y al menos un plan
  // activo con trialEligible=1 en la tabla `plans`.
  test('el alta asigna 15 días exactos y /panel/suscripcion los muestra igual', async ({ page, request }) => {
    const policy = await request.get(`${BACKEND}/api/public/signup-policy`)
    expect(policy.ok(), `GET /api/public/signup-policy respondió ${policy.status()}`).toBeTruthy()
    const policyData = unwrapData(await policy.json())
    expect(
      policyData?.requireCardOnTrial,
      'requireCardOnTrial está en true: el alta iría a Stripe y no entraría al panel. Apagalo en subscription_settings (scope platform) del backend bajo prueba',
    ).toBe(false)

    const plan = await firstTrialEligiblePlan(request)
    const email = uniqueEmail()

    await page.goto('/registro')
    await page.getByTestId('register-owner-name').fill('QA Automatizada')
    await page.getByTestId('register-email').fill(email)
    await page.getByTestId('register-password').fill(VALID_PASSWORD)
    await page.getByTestId('register-step1-submit').click()

    await expect(page.getByTestId('register-hotel-name')).toBeVisible()
    await page.getByTestId('register-hotel-name').fill(`Hotel E2E Trial ${Date.now()}`)
    // El select sólo lista planes elegibles: elegir el mismo que se va a comparar después.
    await page.locator('select[name="planId"]').selectOption(plan.id)
    await page.getByTestId('register-terms-checkbox').check()

    // Ventana en la que el backend fijó `trialEndsAt = now + 15 días`: entre el click y la
    // respuesta del alta. La tolerancia (±5 min) absorbe reloj y latencia, no un día de más o de menos.
    const clickedAt = Date.now()
    await page.getByTestId('register-submit').click()
    await expect(page).toHaveURL(/\/panel\/dashboard/, { timeout: 15_000 })
    const landedAt = Date.now()
    await expect(page.getByTestId('register-error')).not.toBeAttached()

    // — Los datos: la suscripción del hotel recién creado, con la sesión que dejó el alta —
    const token = await page.evaluate(() => localStorage.getItem('token'))
    expect(token, 'el alta no dejó token en localStorage').toBeTruthy()
    const me = await request.get(`${BACKEND}/api/subscription/me`, {
      headers: { Authorization: `Bearer ${token}` },
    })
    expect(me.ok(), `GET /api/subscription/me respondió ${me.status()}: ${await me.text()}`).toBeTruthy()
    const sub = unwrapData(await me.json())

    expect(sub.status).toBe('trialing')
    expect(sub.planId).toBe(plan.id)
    expect(sub.trialEndsAt, 'la suscripción no tiene trialEndsAt').toBeTruthy()
    const trialEndsAt = new Date(sub.trialEndsAt).getTime()
    expect(Number.isNaN(trialEndsAt), `trialEndsAt no es una fecha: ${sub.trialEndsAt}`).toBe(false)
    const TOLERANCE_MS = 5 * 60 * 1000
    expect(trialEndsAt).toBeGreaterThanOrEqual(clickedAt + TRIAL_DAYS * MS_PER_DAY - TOLERANCE_MS)
    expect(trialEndsAt).toBeLessThanOrEqual(landedAt + TRIAL_DAYS * MS_PER_DAY + TOLERANCE_MS)
    // Y en días enteros, que es lo que se le dice al hotel: 15, ni 14 ni 16.
    expect(Math.round((trialEndsAt - clickedAt) / MS_PER_DAY)).toBe(TRIAL_DAYS)
    expect(sub.daysLeft).toBe(TRIAL_DAYS)

    // — La pantalla: /panel/suscripcion dice lo mismo que la base —
    // El número aparece dos veces y las dos tienen que decir 15: la tarjeta "Estado" de la página
    // ("Te quedan 15 días de prueba.", con punto — el punto es lo que la distingue) y el aviso del
    // layout (SubscriptionBanner, "Te quedan 15 días de prueba", sin punto, `exact`). Se anclan por
    // separado para que ninguno tape al otro. Substring y no regex anclada: el texto de la tarjeta
    // viene partido en nodos (texto + <strong> + texto) y el regex de Playwright no lo normaliza.
    await page.goto('/panel/suscripcion')
    await expect(page.getByRole('heading', { name: 'Tu suscripción' })).toBeVisible()
    await expect(page.getByText(`quedan ${TRIAL_DAYS} días de prueba.`)).toBeVisible()
    await expect(page.getByText(`Te quedan ${TRIAL_DAYS} días de prueba`, { exact: true })).toBeVisible()
    await expect(page.locator('body')).not.toContainText('7 días')
  })
})
