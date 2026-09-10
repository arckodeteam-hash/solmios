// scripts/seed-platform-email-templates.ts — Seed de las plantillas de PLATAFORMA.
//
// Uso:
//   bun run scripts/seed-platform-email-templates.ts            # inserta las que faltan, no pisa
//   bun run scripts/seed-platform-email-templates.ts --refresh  # REEMPLAZA subject/body/variables
//                                                                # de las 10 con este texto (pisa
//                                                                # ediciones del admin; conserva
//                                                                # isActive). Correr en prod tras
//                                                                # cambiar el texto de acá.
//
// El nombre de la plataforma NO va escrito: es `{platform_name}` y se resuelve al enviar desde
// Configuración → Plataforma (shared/utils/platform-identity.ts). Lo mismo `{support_email}` y
// `{support_phone}`.
//
// La TABLA la crea el ORM (modelo `PlatformEmailTemplate`, registrado por el módulo
// platform-emails vía RUN_MIGRATE=1, igual que cualquier otro modelo del framework — ver
// "Database — Migraciones y Seeders" del CLAUDE.md). Este script SOLO inserta filas.
//
// UNIVERSAL (Postgres + SQLite), no solo Postgres como create-plans-table.ts: ese script asume
// una DB local `pg` fija y no sirve para dev con SQLite. Acá se sigue el criterio más nuevo del
// proyecto (migrate-db.ts, "UNIVERSAL vía DbAdapter del framework, elegido por DATABASE_URL");
// idéntico patrón idempotente (COUNT(*) previo → skip si ya existe), pero por FILA (una por
// `event`) en vez de por tabla completa, porque acá hace falta poder agregar un evento nuevo en
// el futuro sin que el script entero se auto-descarte por ver la tabla no vacía.
//
// Identificadores sin comillas: Postgres los pliega a minúsculas consistentemente en DDL y DML
// (el ORM ya creó la tabla así), así que camelCase sin quotear funciona en ambos motores.
import { SqliteAdapter } from 'arckode-framework/adapters/sqlite'
import { PostgresAdapter } from 'arckode-framework/adapters/postgres'
import type { DbAdapter } from 'arckode-framework'
// Los 3 correos del pedido de conexión de una OTA viven en src/ porque los comparte un test que
// verifica que renderizan sin dejar un {placeholder} colgado (ver el archivo).
import { CHANNEL_REQUEST_EMAIL_TEMPLATES } from '../src/shared/usecases/channel-request-email-templates'

const DATABASE_URL = process.env.DATABASE_URL
const db: DbAdapter & { connect(): Promise<void> } = DATABASE_URL
  ? new PostgresAdapter({ connectionString: DATABASE_URL })
  : new SqliteAdapter({ path: process.env.DB_PATH || './data/managerhotel.db', wal: true, foreignKeys: true })

const uuid = () => crypto.randomUUID()
const now = () => new Date().toISOString()

interface CountRow { c: number }

async function countByEvent(event: string): Promise<number> {
  const rows = (await db.query('SELECT COUNT(*) as c FROM platform_email_templates WHERE event=?', [event])) as CountRow[]
  return rows[0]?.c ?? 0
}

// Botón CTA reutilizado del estilo de verification-email.ts (usuarios/usecases/email-verification.ts):
// mismo tono visual (fondo #0a1322) para que todos los correos de la plataforma se vean parte de
// un mismo producto.
function ctaButton(link: string, label: string): string {
  return `<p><a href="${link}" style="background:#0a1322;color:#fff;padding:10px 20px;border-radius:8px;text-decoration:none;font-weight:bold">${label}</a></p>`
}

interface TemplateSeed {
  event: string
  subject: string
  body: string
  variables: string[]
}

const TEMPLATES: TemplateSeed[] = [
  // Desde el issue #69 el alta NO dispara esta plantilla: envía un único correo de bienvenida +
  // verificación construido en código (usuarios/usecases/email-verification.ts → welcomeVerificationEmail).
  // Esta entrada queda en el catálogo solo para envíos manuales desde el panel de super-admin, por eso
  // no promete una duración de prueba concreta: los días reales los decide el alta, no esta plantilla.
  {
    event: 'welcome',
    subject: '¡Bienvenido a {platform_name}, {hotel_name}!',
    body: `<p>Hola,</p>
<p>¡Gracias por registrar <strong>{hotel_name}</strong> en {platform_name}! Su cuenta ya está lista y su prueba
gratuita está activa para conocer el sistema: reservas, habitaciones, facturación y mucho más.</p>
${ctaButton('{link}', 'Ir a mi panel')}
<p>Ante cualquier duda, responda este correo y le ayudamos.</p>`,
    variables: ['hotel_name', 'link', 'platform_name'],
  },
  {
    event: 'trial_ending',
    subject: 'Tu prueba gratis en {platform_name} termina en {days_left} días',
    body: `<p>Hola,</p>
<p>Tu prueba gratis de <strong>{hotel_name}</strong> en {platform_name} termina en <strong>{days_left} días</strong>.
Para no perder acceso a tus reservas y datos, elegí un plan antes de que venza.</p>
${ctaButton('{link}', 'Elegir mi plan')}
<p>Si ya elegiste un plan, ignorá este correo.</p>`,
    variables: ['hotel_name', 'days_left', 'link', 'platform_name'],
  },
  {
    event: 'trial_expired',
    subject: 'Tu prueba gratis en {platform_name} terminó',
    body: `<p>Hola,</p>
<p>La prueba gratis de <strong>{hotel_name}</strong> en {platform_name} terminó. Tu cuenta y tus datos siguen
guardados, pero necesitás activar un plan para volver a operar.</p>
${ctaButton('{link}', 'Activar mi plan')}
<p>Cualquier duda, respondé este correo y te ayudamos.</p>`,
    variables: ['hotel_name', 'link', 'platform_name'],
  },
  {
    event: 'payment_succeeded',
    subject: 'Pago confirmado — tu suscripción a {platform_name} sigue activa',
    body: `<p>Hola,</p>
<p>Recibimos el pago de tu suscripción a {platform_name} para <strong>{hotel_name}</strong>. Todo sigue
funcionando normalmente.</p>
${ctaButton('{link}', 'Ver mi suscripción')}
<p>Gracias por confiar en nosotros.</p>`,
    variables: ['hotel_name', 'plan_name', 'amount', 'link', 'platform_name'],
  },
  {
    event: 'payment_failed',
    subject: 'No pudimos procesar el pago de tu suscripción a {platform_name}',
    body: `<p>Hola,</p>
<p>No pudimos procesar el cobro de la suscripción de <strong>{hotel_name}</strong> a {platform_name}. Revisá
tu método de pago para evitar que se interrumpa el servicio.</p>
${ctaButton('{link}', 'Actualizar método de pago')}
<p>Si ya lo resolviste, ignorá este correo.</p>`,
    variables: ['hotel_name', 'plan_name', 'amount', 'link', 'platform_name'],
  },
  {
    event: 'subscription_canceled',
    subject: 'Tu suscripción a {platform_name} fue cancelada',
    body: `<p>Hola,</p>
<p>Tu suscripción a {platform_name} para <strong>{hotel_name}</strong> fue cancelada. Tus datos se conservan
por si querés reactivarla más adelante.</p>
${ctaButton('{link}', 'Reactivar mi suscripción')}
<p>Si esto fue un error, escribinos y lo resolvemos.</p>`,
    variables: ['hotel_name', 'link', 'platform_name'],
  },
  {
    event: 'subscription_renewal_auto',
    subject: 'Tu suscripción a {platform_name} se renueva en {days_left} días',
    body: `<p>Hola,</p>
<p>En <strong>{days_left} días</strong> se cobrará automáticamente la renovación de la suscripción de
<strong>{hotel_name}</strong> a {platform_name} con la tarjeta que tenés registrada. No tenés que hacer nada.</p>
${ctaButton('{link}', 'Ver mi suscripción')}
<p>Si querés cambiar el método de pago, podés hacerlo antes de esa fecha.</p>`,
    variables: ['hotel_name', 'days_left', 'link', 'platform_name'],
  },
  {
    event: 'subscription_renewal_manual',
    subject: 'Tu suscripción a {platform_name} vence en {days_left} días',
    body: `<p>Hola,</p>
<p>La suscripción de <strong>{hotel_name}</strong> a {platform_name} vence en <strong>{days_left} días</strong>.
Como no tenés el pago automático activado, necesitás renovarla vos para no perder el acceso.</p>
${ctaButton('{link}', 'Renovar mi suscripción')}
<p>Si no renovás, el servicio se suspende cinco días después del vencimiento.</p>`,
    variables: ['hotel_name', 'days_left', 'link', 'platform_name'],
  },
  {
    event: 'subscription_suspended',
    subject: 'Tu suscripción a {platform_name} fue suspendida',
    body: `<p>Hola,</p>
<p>La suscripción de <strong>{hotel_name}</strong> a {platform_name} fue suspendida por falta de pago. El panel
y las reservas no están disponibles hasta que regularices el pago.</p>
${ctaButton('{link}', 'Regularizar el pago')}
<p>Apenas se confirme el pago, el servicio se reactiva automáticamente.</p>`,
    variables: ['hotel_name', 'link', 'platform_name'],
  },
  {
    event: 'subscription_reactivated',
    subject: '¡Tu suscripción a {platform_name} está activa de nuevo!',
    body: `<p>Hola,</p>
<p>Recibimos el pago y la suscripción de <strong>{hotel_name}</strong> a {platform_name} está activa de nuevo.
Ya podés volver a operar con normalidad.</p>
${ctaButton('{link}', 'Ir a mi panel')}
<p>Gracias por seguir confiando en nosotros.</p>`,
    variables: ['hotel_name', 'link', 'platform_name'],
  },
  // Pedido de conexión de una OTA (REQ-CAN-07): cita agendada, canal conectado, pedido rechazado.
  ...CHANNEL_REQUEST_EMAIL_TEMPLATES,
]

const REFRESH = process.argv.includes('--refresh') || process.env.PLATFORM_EMAILS_REFRESH === '1'

async function seed(): Promise<void> {
  await db.connect()
  let inserted = 0
  let refreshed = 0
  for (const t of TEMPLATES) {
    const c = await countByEvent(t.event)
    if (c > 0) {
      if (REFRESH) {
        await db.run(
          'UPDATE platform_email_templates SET subject=?, body=?, variables=?, updatedAt=? WHERE event=?',
          [t.subject, t.body, JSON.stringify(t.variables), now(), t.event],
        )
        console.log(`platform_email_templates: "${t.event}" reemplazada`)
        refreshed++
      } else {
        console.log(`platform_email_templates: "${t.event}" ya existe, skip`)
      }
      continue
    }
    await db.run(
      `INSERT INTO platform_email_templates (id, event, subject, body, variables, isActive, createdAt, updatedAt)
       VALUES (?,?,?,?,?,?,?,?)`,
      [uuid(), t.event, t.subject, t.body, JSON.stringify(t.variables), 1, now(), now()],
    )
    console.log(`platform_email_templates: "${t.event}" insertado`)
    inserted++
  }
  console.log(`✅ Seed completado (${inserted} insertadas, ${refreshed} reemplazadas, ${TEMPLATES.length - inserted - refreshed} ya existían)`)
  await db.close()
}

seed().catch((e) => { console.error('❌ Seed falló', e); process.exit(1) })
