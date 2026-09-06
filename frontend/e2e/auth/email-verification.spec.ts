import { test, expect } from '../fixtures'
import type { APIRequestContext } from '@playwright/test'
import { DatabaseSync } from 'node:sqlite'
import { randomUUID } from 'node:crypto'
import { resolve } from 'node:path'
import {
  mailboxConfigured,
  uniqueRecipient,
  waitForMessageTo,
  extractVerificationLink,
  closeMailbox,
} from '../helpers/mailbox'

// AUTH-02 — El correo de verificación del alta llega DE VERDAD y su enlace verifica la cuenta.
//
// Punta a punta y sin mocks: da el alta contra el backend real, espera el correo en un buzón real
// (IMAP), abre el enlace con Chromium y comprueba el efecto en la pantalla Y en la tabla `users`.
// Un 200 que no verifica nada es el clásico de este flujo, por eso la afirmación es sobre lo que
// se ve y sobre los datos, nunca sobre el código HTTP.
//
// ── Cómo se levanta el backend bajo prueba ───────────────────────────────────────────────────
//   cd backend
//   JWT_SECRET=e2e-secret DB_PATH=data/e2e-verify.db RUN_MIGRATE=1 bun run src/composition-root.ts  # migra y sale
//   JWT_SECRET=e2e-secret DB_PATH=data/e2e-verify.db bun run migrate-db.ts                          # tablas extra + seeds
//   JWT_SECRET=e2e-secret PORT=3001 PUBLIC_URL=http://localhost:5173 DB_PATH=data/e2e-verify.db \
//     bun run src/composition-root.ts
//
// `PUBLIC_URL` TIENE que ser el origen del FRONTEND (:5173), no el del backend: el backend arma el
// link del correo con esa base (`signup.ts` → `${PUBLIC_URL}/api/public/verify-email?token=…`) y el
// 302 de la verificación manda un `Location` RELATIVO (`/verificar-email?status=…`,
// `usuarios/controller.ts:39`). Vite proxea `/api` a :3001 (vite.config.ts), así que con el origen
// del front el link verifica Y cae en la pantalla; con el del backend verifica pero la pantalla no
// existe (404) y el usuario se queda sin respuesta.
//
// ── Variables del buzón ──────────────────────────────────────────────────────────────────────
//   MAILBOX_PASS   (obligatoria)  clave IMAP/SMTP de la casilla de pruebas — sin ella el test se salta
//   MAILBOX_USER / MAILBOX_DOMAIN / MAILBOX_IMAP_HOST / MAILBOX_IMAP_PORT  (opcionales, ver helpers/mailbox.ts)
//   MAILBOX_SMTP_HOST / MAILBOX_SMTP_PORT / MAILBOX_FROM                   (opcionales, config SMTP sembrada)
//   E2E_DB_PATH    ruta de la SQLite del backend bajo prueba (default `../backend/data/managerhotel.db`)
//
// ── Efectos que persisten ────────────────────────────────────────────────────────────────────
// Igual que `register.spec.ts`, el alta PERSISTE un hotel + un usuario nuevos en cada corrida, y
// además siembra la config SMTP de plataforma en la tabla `configuration`. NO correr contra
// producción: es un E2E real contra la base del entorno de prueba.

test.describe('verificación de email del alta', () => {
  // Skip honesto: sin buzón no se puede comprobar que el correo llega, y un test que "pasa" sin
  // haber mirado el correo es exactamente el verde falso que este spec viene a evitar.
  test.skip(
    !mailboxConfigured(),
    'MAILBOX_PASS no está definida: sin buzón no se puede comprobar que el correo llega',
  )

  test.afterAll(async () => {
    await closeMailbox()
  })

  // Misma contraseña que register.spec.ts — cumple shared/password-policy.ts (10+, mayúscula,
  // minúscula, número, no común).
  const VALID_PASSWORD = 'Solmios2026Segura!'

  // La SQLite del backend bajo prueba. Se abre sólo para sembrar precondiciones y para comprobar
  // el EFECTO del flujo (que la pantalla no puede mostrar): el token es de un solo uso.
  // `node:sqlite` viene sin flag desde Node 22 y los specs de Playwright corren en Node.
  const DB_PATH = resolve(process.cwd(), process.env.E2E_DB_PATH || '../backend/data/managerhotel.db')

  function withDb<T>(fn: (db: DatabaseSync) => T): T {
    const db = new DatabaseSync(DB_PATH)
    try {
      return fn(db)
    } finally {
      db.close()
    }
  }

  interface UserRow {
    id: string
    emailVerifiedAt: string | null
    emailVerificationToken: string | null
    emailVerificationExpires: number | null
  }

  function findUser(email: string): UserRow | null {
    return withDb(
      (db) =>
        (db
          .prepare(
            'SELECT id, emailVerifiedAt, emailVerificationToken, emailVerificationExpires FROM users WHERE email = ?',
          )
          .get(email) as UserRow | undefined) ?? null,
    )
  }

  /**
   * `EmailService` NO lee la config SMTP del entorno: la busca en la tabla `configuration`
   * (key `email_config`, primero con el hotelId del alta y después con el scope literal
   * `'platform'` — email-service.ts:276-294). Sin fila, `normalizeSmtpConfig` devuelve null, el
   * correo queda `pending` con `lastError='no provider configured'` y no llega nunca.
   * Se siembra de forma idempotente el scope `platform` (el hotel del alta todavía no existe).
   * La clave sale SIEMPRE del entorno, nunca del repositorio.
   */
  function seedPlatformSmtpConfig(): void {
    const value = JSON.stringify({
      host: process.env.MAILBOX_SMTP_HOST || 'mx.bot.zx89.site',
      // El 587 autenticado, no el 25: el 25 del servidor de pruebas no ofrece AUTH y esta config
      // exige user+pass (sin `pass`, normalizeSmtpConfig devuelve null). `secure:false` porque el
      // 587 anuncia AUTH PLAIN/LOGIN sin STARTTLS.
      port: Number(process.env.MAILBOX_SMTP_PORT || 587),
      secure: false,
      user: process.env.MAILBOX_USER || 'autowork@bot.zx89.site',
      pass: process.env.MAILBOX_PASS,
      from: process.env.MAILBOX_FROM || 'pruebas@bot.zx89.site',
      fromName: 'SolmiOS Pruebas',
    })
    const now = new Date().toISOString()
    withDb((db) => {
      const row = db
        .prepare("SELECT id FROM configuration WHERE hotelId = 'platform' AND key = 'email_config'")
        .get() as { id: string } | undefined
      if (row) {
        db.prepare('UPDATE configuration SET value = ?, updatedAt = ? WHERE id = ?').run(value, now, row.id)
      } else {
        db.prepare(
          'INSERT INTO configuration (id, hotelId, key, value, createdAt, updatedAt) VALUES (?, ?, ?, ?, ?, ?)',
        ).run(randomUUID(), 'platform', 'email_config', value, now, now)
      }
    })
  }

  /**
   * `POST /api/public/signup` exige `planId` ("Elegí un plan para empezar tu prueba") y el plan
   * tiene que existir y estar activo (`assertPlanAvailable`). En una base recién migrada la tabla
   * `plans` viene vacía, así que se asegura uno con id fijo (idempotente entre corridas).
   */
  async function ensureActivePlanId(request: APIRequestContext): Promise<string> {
    const res = await request.get('/api/public/plans')
    expect(res.ok(), `GET /api/public/plans respondió ${res.status()}`).toBeTruthy()
    const body = await res.json()
    const list = body?.data?.data ?? body?.data ?? body
    if (Array.isArray(list) && list.length > 0 && list[0]?.id) return String(list[0].id)

    const id = 'e2e-plan-trial'
    const now = new Date().toISOString()
    withDb((db) =>
      db
        .prepare(
          'INSERT OR IGNORE INTO plans (id, name, slug, price, currency, isActive, sortOrder, createdAt, updatedAt) ' +
            'VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
        )
        .run(id, 'Prueba E2E', 'e2e-trial', 0, 'USD', 1, 0, now, now),
    )
    return id
  }

  test('el alta manda el correo, el enlace verifica la cuenta y no se puede reusar', async ({
    page,
    request,
    baseURL,
  }) => {
    // El correo sale de una cola con worker (tick 30s; `enqueue` dispara un `processQueue()`
    // inmediato). Llega en segundos, pero si el primer intento falla el reintento es a los 60s.
    test.setTimeout(180_000)

    seedPlatformSmtpConfig()
    const planId = await ensureActivePlanId(request)

    // Destinatario único por corrida, con SUB-DIRECCIÓN a propósito: el buzón de pruebas NO tiene
    // catch-all, así que un `alta-<uuid>@bot.zx89.site` suelto REBOTA con "550 User doesn't exist"
    // después de que el SMTP ya contestó 250 (el correo se pierde y el test fallaría por el buzón,
    // no por la app). `autowork+alta-<uuid>@…` entra al INBOX con el To: intacto.
    const recipient = uniqueRecipient('alta')
    const hotelName = `Hotel E2E Verificación ${Date.now()}`

    // — Alta —
    const signup = await request.post('/api/public/signup', {
      data: { hotelName, email: recipient, password: VALID_PASSWORD, ownerName: 'QA Automatizada', planId },
    })
    expect(signup.status(), `POST /api/public/signup: ${await signup.text()}`).toBe(201)

    // Antes de abrir el link: la cuenta existe SIN verificar y con el hash del token guardado.
    const before = findUser(recipient)
    expect(before, `no se creó el usuario ${recipient} en ${DB_PATH}`).not.toBeNull()
    expect(before!.emailVerifiedAt).toBeNull()
    expect(before!.emailVerificationToken).toBeTruthy()
    expect(before!.emailVerificationExpires).toBeGreaterThan(Date.now())

    // — El correo llega a un buzón de verdad —
    const message = await waitForMessageTo(recipient, { timeoutMs: 120_000, pollMs: 3_000 })
    expect(message.subject).toContain('Verificá tu email')
    expect(message.to).toContain(recipient)

    const link = extractVerificationLink(message.html || message.text)
    // El host del link sale de PUBLIC_URL: si no es el del frontend, el 302 relativo de la
    // verificación cae en un origen que no sirve la SPA y la pantalla nunca aparece.
    expect(
      new URL(link).origin,
      `el link del correo (${link}) no apunta al frontend: revisá PUBLIC_URL en el backend`,
    ).toBe(new URL(baseURL!).origin)

    // — Abrir el enlace en el navegador: se sigue el 302 hasta la pantalla real —
    await page.goto(link)
    await expect(page).toHaveURL(/\/verificar-email\?status=verified\b/)
    await expect(page.getByRole('heading', { name: '¡Email verificado!' })).toBeVisible()
    await expect(page.getByText('Tu correo quedó confirmado')).toBeVisible()
    await expect(page.getByRole('link', { name: 'Ir al panel' })).toBeVisible()

    // — El efecto en los datos, que la pantalla no puede probar —
    const after = findUser(recipient)
    expect(after!.emailVerifiedAt, 'la pantalla dijo "verificado" pero users.emailVerifiedAt sigue nulo').not.toBeNull()
    expect(after!.emailVerificationToken, 'el token debe consumirse (un solo uso)').toBeNull()

    // — El mismo enlace, una segunda vez: ya no vale —
    await page.goto(link)
    await expect(page).toHaveURL(/\/verificar-email\?status=invalid\b/)
    await expect(page.getByRole('heading', { name: 'Enlace inválido' })).toBeVisible()
    await expect(page.getByText('El enlace de verificación no es válido')).toBeVisible()
  })
})
