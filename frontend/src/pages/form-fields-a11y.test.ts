/**
 * GH-17 / GH-18 — Guardián de campos de formulario del flujo operativo diario.
 *
 * Censo sobre `<input|select|textarea>` de `src/pages/` (616 campos en total):
 *   - 2026-08-20, antes de la 1ª pasada: 572 anónimos (sin `id`, `name` ni `aria-label`).
 *   - 2026-08-21, antes de la 2ª pasada: 492 anónimos.
 *   - 2026-08-21, después de la 2ª pasada: 242 anónimos.
 * Un campo anónimo es un lector de pantalla sin nada que anunciar y un selector de test atado
 * a la clase CSS. Este test NO cubre los 616: fija el flujo diario (1ª pasada) más toda la
 * operación del hotel (2ª pasada). Lo que queda son pantallas de configuración de una sola vez
 * (`settings`, `super-admin/*`, `pagina-publica/*`) — ver `openspec/changes/github-issues-pendientes/tasks.md`.
 *
 * Es un test sobre el FUENTE, no sobre el componente montado: montar estas páginas exige el
 * router, Pinia y ~15 services mockeados, y el defecto que cuidamos es puramente declarativo.
 */
import { describe, it, expect } from 'vitest'

/**
 * Fuente cruda de cada página, vía `import.meta.glob` de Vite: `tsconfig.app.json` no incluye
 * `@types/node`, así que `node:fs` no compila acá. `eager: true` resuelve en build-time.
 */
const RAW_PAGES = import.meta.glob('./**/*.vue', {
  query: '?raw',
  import: 'default',
  eager: true,
}) as Record<string, string>

/** Flujo operativo diario cubierto por este sprint. */
const OPERATIONAL_PAGES = [
  'reservations/index.vue',
  'checkin/index.vue',
  'guests/index.vue',
  'payments/index.vue',
  'pagos/index.vue',
  'folios/index.vue',
  'billing/index.vue',
  'rooms/index.vue',
  'pre-checkin/index.vue',
]

function template(file: string): string {
  const src = RAW_PAGES[`./${file}`]
  expect(src, `${file}: no se pudo leer el fuente de la página`).toBeTypeOf('string')
  const m = src.match(/<template>([\s\S]*)<\/template>/)
  expect(m, `${file}: no se encontró el bloque <template>`).not.toBeNull()
  return m![1]
}

/** Tags de campo (input/select/textarea) tal como aparecen en el fuente. */
function fieldTags(tpl: string): string[] {
  return tpl.match(/<(?:input|select|textarea)\b[^>]*>/g) ?? []
}

/** ¿El campo tiene algo que un lector de pantalla o un selector de test pueda usar? */
function isIdentified(tag: string): boolean {
  return /\s:?(?:id|name|aria-label|aria-labelledby)=/.test(tag)
}

describe('GH-17 — todo campo del flujo operativo se puede nombrar', () => {
  for (const file of OPERATIONAL_PAGES) {
    it(`${file}: ningún input/select/textarea sin id, name ni aria-label`, () => {
      const tags = fieldTags(template(file))
      expect(tags.length, `${file}: no se detectó ningún campo — ¿cambió el marcado?`).toBeGreaterThan(0)
      const anonymous = tags.filter((t) => !isIdentified(t))
      expect(anonymous, `${file}: ${anonymous.length} campo(s) anónimo(s)`).toEqual([])
    })
  }
})

describe('GH-17 — las etiquetas apuntan a un id que existe y ningún id se repite', () => {
  for (const file of OPERATIONAL_PAGES) {
    it(`${file}: sin id duplicado y sin <label for> colgado`, () => {
      const tpl = template(file)

      // `id="..."` literal (excluye `:id="..."`, que es dinámico).
      const staticIds = [...tpl.matchAll(/(?<![:\w-])id="([^"{}]+)"/g)].map((m) => m[1])
      const duplicated = staticIds.filter((id, i) => staticIds.indexOf(id) !== i)
      expect([...new Set(duplicated)], `${file}: id duplicado`).toEqual([])

      // Un `for` que no resuelve es peor que no tener `for`: el lector anuncia el campo equivocado.
      const staticFors = [...tpl.matchAll(/(?<![:\w-])for="([^"{}]+)"/g)].map((m) => m[1])
      const dangling = [...new Set(staticFors.filter((f) => !staticIds.includes(f)))]
      expect(dangling, `${file}: <label for> sin id destino`).toEqual([])

      // Par dinámico: `:for="\`x-${i}\`"` tiene que tener su `:id="\`x-${i}\`"` gemelo.
      const dynIds = [...tpl.matchAll(/:id="`([^`]+)`"/g)].map((m) => m[1])
      const dynFors = [...tpl.matchAll(/:for="`([^`]+)`"/g)].map((m) => m[1])
      const danglingDyn = [...new Set(dynFors.filter((f) => !dynIds.includes(f)))]
      expect(danglingDyn, `${file}: :for dinámico sin :id gemelo`).toEqual([])
    })
  }
})

describe('GH-17 — un id estático dentro de un v-for se repetiría en el DOM', () => {
  for (const file of OPERATIONAL_PAGES) {
    it(`${file}: los campos repetidos llevan id dinámico`, () => {
      const offenders = (template(file).match(/<[a-zA-Z][^>]*>/g) ?? []).filter(
        (tag) => /\bv-for=/.test(tag) && /(?<![:\w-])id="[^"{}]+"/.test(tag),
      )
      expect(offenders, `${file}: id fijo dentro de un v-for`).toEqual([])
    })
  }
})

/**
 * GH-18 — el atributo `required` espeja el validador del backend, no al revés.
 * Cada entrada cita el schema que lo hace obligatorio. Si el backend deja de exigirlo,
 * este test es el recordatorio de sacar el atributo (y no al revés).
 */
const REQUIRED_MIRRORS: Array<{ file: string; id: string; schema: string }> = [
  // folios/validators/schema.ts → PostChargeSchema
  { file: 'folios/index.vue', id: 'folio-charge-description', schema: 'folios PostChargeSchema.description' },
  { file: 'folios/index.vue', id: 'folio-charge-amount', schema: 'folios PostChargeSchema.amount' },
  // folios/validators/schema.ts → ApplyPaymentSchema
  { file: 'folios/index.vue', id: 'folio-pay-amount', schema: 'folios ApplyPaymentSchema.amount' },
  // idem, desde el check-out del check-in
  { file: 'checkin/index.vue', id: 'checkin-charge-description', schema: 'folios PostChargeSchema.description' },
  { file: 'checkin/index.vue', id: 'checkin-charge-amount', schema: 'folios PostChargeSchema.amount' },
  // payment-requests/validators/schema.ts → CreatePaymentRequestSchema
  { file: 'payments/index.vue', id: 'payment-link-reservation', schema: 'payment-requests Create.reservationId' },
  { file: 'payments/index.vue', id: 'payment-link-amount', schema: 'payment-requests Create.amount' },
  // facturas/validators/schema.ts → PayFacturasSchema.amount / CreateFacturasSchema.amount
  { file: 'billing/index.vue', id: 'billing-pay-amount', schema: 'facturas PayFacturasSchema.amount' },
  { file: 'billing/index.vue', id: 'billing-charge-amount', schema: 'facturas CreateFacturasSchema.amount' },
  // facturas/validators/schema.ts → CreditNoteSchema.reason (anular ≠ borrar: sin motivo no hay rastro)
  { file: 'billing/index.vue', id: 'credit-note-reason', schema: 'facturas CreditNoteSchema.reason' },
  // habitaciones/validators/schema.ts → CreateHabitacionesSchema / BatchCreateSchema
  { file: 'rooms/index.vue', id: 'room-number', schema: 'habitaciones Create.number' },
  { file: 'rooms/index.vue', id: 'room-base-price', schema: 'habitaciones Create.basePrice' },
  { file: 'rooms/index.vue', id: 'batch-from', schema: 'habitaciones BatchCreate.from' },
  { file: 'rooms/index.vue', id: 'batch-to', schema: 'habitaciones BatchCreate.to' },
  { file: 'rooms/index.vue', id: 'batch-base-price', schema: 'habitaciones BatchCreate.basePrice' },
  // huespedes/validators/schema.ts → CreateHuespedesSchema.name
  { file: 'guests/index.vue', id: 'guest-name', schema: 'huespedes Create.name' },
  // reservas/validators/schema.ts → PreCheckinSchema
  { file: 'pre-checkin/index.vue', id: 'prechk-name', schema: 'reservas PreCheckinSchema.name' },
  { file: 'pre-checkin/index.vue', id: 'prechk-contract-accepted', schema: 'reservas PreCheckinSchema.contractAccepted' },
  { file: 'pre-checkin/index.vue', id: 'prechk-gdpr-accepted', schema: 'reservas PreCheckinSchema.gdprAccepted' },
]

describe('GH-18 — los campos obligatorios del backend lo declaran en el HTML', () => {
  for (const { file, id, schema } of REQUIRED_MIRRORS) {
    it(`${file} #${id} → ${schema}`, () => {
      const tag = fieldTags(template(file)).find((t) => t.includes(`id="${id}"`))
      expect(tag, `${file}: no existe el campo #${id}`).toBeDefined()
      expect(/\brequired\b/.test(tag!), `#${id} debe declarar required (${schema})`).toBe(true)
      expect(/aria-required="true"/.test(tag!), `#${id} debe declarar aria-required`).toBe(true)
    })
  }
})

/**
 * El contrapeso del test de arriba: `required` NO se pone donde el backend acepta vacío.
 * Estos campos son opcionales en el schema; marcarlos rompería el formulario para el huésped
 * que no los completa (ver el comentario de `PreCheckinSchema` en reservas/validators/schema.ts).
 */
const MUST_STAY_OPTIONAL: Array<{ file: string; id: string; schema: string }> = [
  { file: 'pre-checkin/index.vue', id: 'prechk-email', schema: 'reservas PreCheckinSchema.email' },
  { file: 'pre-checkin/index.vue', id: 'prechk-phone', schema: 'reservas PreCheckinSchema.phone' },
  { file: 'pre-checkin/index.vue', id: 'prechk-document', schema: 'reservas PreCheckinSchema.document' },
  { file: 'pre-checkin/index.vue', id: 'prechk-nationality', schema: 'reservas PreCheckinSchema.nationality' },
  { file: 'pre-checkin/index.vue', id: 'prechk-marketing-accepted', schema: 'reservas PreCheckinSchema.marketingAccepted' },
  { file: 'folios/index.vue', id: 'folio-charge-quantity', schema: 'folios PostChargeSchema.quantity' },
  { file: 'folios/index.vue', id: 'folio-pay-reference', schema: 'folios ApplyPaymentSchema.reference' },
  { file: 'payments/index.vue', id: 'payment-link-sent-to', schema: 'payment-requests Create.sentTo' },
  { file: 'rooms/index.vue', id: 'batch-capacity', schema: 'habitaciones BatchCreate.capacity' },
  { file: 'rooms/index.vue', id: 'room-floor', schema: 'habitaciones Create.floor' },
]

describe('GH-18 — lo que el backend acepta vacío NO lleva required', () => {
  for (const { file, id, schema } of MUST_STAY_OPTIONAL) {
    it(`${file} #${id} sigue opcional (${schema})`, () => {
      const tag = fieldTags(template(file)).find((t) => t.includes(`id="${id}"`))
      expect(tag, `${file}: no existe el campo #${id}`).toBeDefined()
      expect(/\brequired\b/.test(tag!), `#${id} NO debe declarar required (${schema} es opcional)`).toBe(false)
    })
  }
})

/* ───────────────────────── 2ª pasada (2026-08-21) ─────────────────────────
 * GH-17.2 — el resto de la operación del hotel: limpieza, mantenimiento, cerraduras,
 * equipo, asistencia, CRM, grupos, restaurante, tarifas, compras, tesorería, contabilidad
 * y las pantallas de acceso. Quedan afuera, a propósito, las de configuración de una sola
 * vez (`settings`, `super-admin/*`, `pagina-publica/*`, `auto-messages`, `ai-receptionist`,
 * `whatsapp-templates`, `hotel-fundador`, `devices`).
 */
const SECOND_PASS_PAGES = [
  'attendance/index.vue',
  'auth/forgot-password.vue',
  'auth/login.vue',
  'auth/register.vue',
  'booking-engine/index.vue',
  'cerraduras/index.vue',
  'channel-manager/index.vue',
  'compras/ordenes.vue',
  'compras/requisiciones.vue',
  'contabilidad/libro-diario.vue',
  'contabilidad/plan-cuentas.vue',
  'contabilidad/reportes.vue',
  'crm/index.vue',
  'empleados/index.vue',
  'gastos/index.vue',
  'groups/index.vue',
  'housekeeping/index.vue',
  'maintenance/index.vue',
  'message-logs/index.vue',
  'notifications/index.vue',
  'opiniones/index.vue',
  'packages/index.vue',
  'payroll/index.vue',
  'promo-codes/index.vue',
  'push-tokens/index.vue',
  'reembolsos/index.vue',
  'referidos/index.vue',
  'reports/index.vue',
  'restaurante/carta.vue',
  'restaurante/cobrar.vue',
  'restaurante/comanda.vue',
  'rrhh-evaluacion/index.vue',
  'support/index.vue',
  'tarifas/index.vue',
  'team/index.vue',
  'technical-providers/index.vue',
  'tesoreria/bancos.vue',
  'tesoreria/caja-chica.vue',
  'tesoreria/presupuesto.vue',
  'tesoreria/proveedores.vue',
]

describe('GH-17.2 — todo campo de la operación del hotel se puede nombrar', () => {
  for (const file of SECOND_PASS_PAGES) {
    it(`${file}: ningún input/select/textarea sin id, name ni aria-label`, () => {
      const tags = fieldTags(template(file))
      expect(tags.length, `${file}: no se detectó ningún campo — ¿cambió el marcado?`).toBeGreaterThan(0)
      const anonymous = tags.filter((t) => !isIdentified(t))
      expect(anonymous, `${file}: ${anonymous.length} campo(s) anónimo(s)`).toEqual([])
    })
  }
})

/**
 * Las dos trampas caras de este repo se chequean sobre TODAS las páginas, no solo las
 * cubiertas: un `id` repetido o un `<label for>` colgado son peores que no tener `id`,
 * y no cuesta nada impedir que aparezcan en una página que todavía no migramos.
 */
const ALL_PAGES = Object.keys(RAW_PAGES).map((k) => k.replace(/^\.\//, '')).sort()

describe('GH-17.2 — en NINGUNA página se repite un id ni cuelga un <label for>', () => {
  for (const file of ALL_PAGES) {
    it(`${file}: ids únicos y for con destino`, () => {
      const tpl = template(file)

      const staticIds = [...tpl.matchAll(/(?<![:\w-])id="([^"{}]+)"/g)].map((m) => m[1])
      const duplicated = staticIds.filter((id, i) => staticIds.indexOf(id) !== i)
      expect([...new Set(duplicated)], `${file}: id duplicado`).toEqual([])

      const staticFors = [...tpl.matchAll(/(?<![:\w-])for="([^"{}]+)"/g)].map((m) => m[1])
      const dangling = [...new Set(staticFors.filter((f) => !staticIds.includes(f)))]
      expect(dangling, `${file}: <label for> sin id destino`).toEqual([])

      const dynIds = [...tpl.matchAll(/:id="`([^`]+)`"/g)].map((m) => m[1])
      const dynFors = [...tpl.matchAll(/:for="`([^`]+)`"/g)].map((m) => m[1])
      expect(
        [...new Set(dynFors.filter((f) => !dynIds.includes(f)))],
        `${file}: :for dinámico sin :id gemelo`,
      ).toEqual([])
    })
  }
})

/**
 * El chequeo de `v-for` del bloque de arriba (1ª pasada) solo mira el tag que TIENE el
 * `v-for`. No alcanza: lo habitual es `<div v-for>` con el `<input>` adentro, y ese `id`
 * fijo igual se repite una vez por fila. Acá se recorre el árbol y se mira todo ancestro.
 */
const VOID_TAGS = new Set(['input', 'img', 'br', 'hr', 'meta', 'link', 'source', 'area', 'col', 'embed'])

/** Devuelve cada tag de apertura junto a la cadena de ancestros abiertos en ese punto. */
function tagsWithAncestors(tpl: string): Array<{ raw: string; name: string; ancestors: string[] }> {
  const out: Array<{ raw: string; name: string; ancestors: string[] }> = []
  const stack: Array<{ name: string; raw: string }> = []
  const re = /<!--[\s\S]*?-->|<\/?([a-zA-Z][\w.-]*)((?:"[^"]*"|'[^']*'|[^>"'])*)>/g
  let m: RegExpExecArray | null
  while ((m = re.exec(tpl))) {
    if (m[0].startsWith('<!--')) continue
    const name = m[1].toLowerCase()
    if (m[0].startsWith('</')) {
      for (let i = stack.length - 1; i >= 0; i--) if (stack[i].name === name) { stack.length = i; break }
      continue
    }
    out.push({ raw: m[0], name, ancestors: stack.map((s) => s.raw) })
    if (!/\/>$/.test(m[0]) && !VOID_TAGS.has(name)) stack.push({ name, raw: m[0] })
  }
  return out
}

describe('GH-17.2 — ningún campo repetido por v-for lleva id fijo (incluye ancestros)', () => {
  for (const file of [...OPERATIONAL_PAGES, ...SECOND_PASS_PAGES]) {
    it(`${file}: los campos dentro de un v-for llevan :id dinámico`, () => {
      const offenders = tagsWithAncestors(template(file))
        .filter((t) => ['input', 'select', 'textarea'].includes(t.name))
        .filter((t) => /\bv-for=/.test(t.raw) || t.ancestors.some((a) => /\bv-for=/.test(a)))
        .filter((t) => /(?<![:\w-])id="[^"{}]+"/.test(t.raw))
        .map((t) => t.raw.replace(/\s+/g, ' ').slice(0, 120))
      expect(offenders, `${file}: id fijo dentro de un v-for`).toEqual([])
    })
  }
})

/**
 * GH-18.1 — segunda tanda de espejos `required` ↔ validador del backend.
 * Igual que arriba: la fuente de verdad es el `validators/schema.ts` del módulo; el atributo
 * HTML lo copia. Un `required` sobre un campo que el backend acepta vacío rompe el envío.
 */
const REQUIRED_MIRRORS_2: Array<{ file: string; id: string; schema: string }> = [
  // gastos/validators/schema.ts → CreateGastosSchema
  { file: 'gastos/index.vue', id: 'gasto-concept', schema: 'gastos CreateGastosSchema.concept' },
  { file: 'gastos/index.vue', id: 'gasto-amount', schema: 'gastos CreateGastosSchema.amount' },
  // grupos/validators/schema.ts → CreateGruposSchema.name (min 2)
  { file: 'groups/index.vue', id: 'groups-nombre-del-grupo', schema: 'grupos CreateGruposSchema.name' },
  // mantenimiento/validators/schema.ts → CreateMantenimientoSchema.title / CreateProviderSchema.name
  { file: 'maintenance/index.vue', id: 'maintenance-titulo', schema: 'mantenimiento CreateMantenimientoSchema.title' },
  { file: 'technical-providers/index.vue', id: 'technical-providers-nombre', schema: 'mantenimiento CreateProviderSchema.name' },
  // promo-codes/validators/schema.ts → CreatePromoCodeSchema
  { file: 'promo-codes/index.vue', id: 'promo-codes-codigo', schema: 'promo-codes CreatePromoCodeSchema.code' },
  { file: 'promo-codes/index.vue', id: 'promo-codes-tipo-de-descuento', schema: 'promo-codes CreatePromoCodeSchema.kind' },
  { file: 'promo-codes/index.vue', id: 'promo-codes-valor', schema: 'promo-codes CreatePromoCodeSchema.value' },
  // paquetes/validators/schema.ts → CreatePaquetesSchema
  { file: 'packages/index.vue', id: 'packages-nombre', schema: 'paquetes CreatePaquetesSchema.name' },
  { file: 'packages/index.vue', id: 'packages-precio', schema: 'paquetes CreatePaquetesSchema.price' },
  // usuarios/validators/schema.ts → CreateUsuarioSchema (password NO: el alta lo autogenera si va vacío)
  { file: 'team/index.vue', id: 'team-nombre', schema: 'usuarios CreateUsuarioSchema.name' },
  { file: 'team/index.vue', id: 'team-email', schema: 'usuarios CreateUsuarioSchema.email' },
  // tickets/validators/schema.ts → CreateTicketsSchema.subject
  { file: 'support/index.vue', id: 'support-asunto', schema: 'tickets CreateTicketsSchema.subject' },
  // ttlock/validators/schema.ts → CreateMasterKeySchema.userId
  { file: 'cerraduras/index.vue', id: 'cerraduras-persona', schema: 'ttlock CreateMasterKeySchema.userId' },
  // crm/validators/schema.ts → ValidateCouponSchema / CreateCouponSchema / CreateSegmentSchema / CreateCampaignSchema
  { file: 'crm/index.vue', id: 'crm-codigo', schema: 'crm ValidateCouponSchema.code' },
  { file: 'crm/index.vue', id: 'crm-monto-de-la-compra', schema: 'crm ValidateCouponSchema.amount' },
  { file: 'crm/index.vue', id: 'crm-codigo-2', schema: 'crm CreateCouponSchema.code' },
  { file: 'crm/index.vue', id: 'crm-tipo', schema: 'crm CreateCouponSchema.type' },
  { file: 'crm/index.vue', id: 'crm-valor', schema: 'crm CreateCouponSchema.value' },
  { file: 'crm/index.vue', id: 'crm-nombre', schema: 'crm CreateSegmentSchema.name' },
  { file: 'crm/index.vue', id: 'crm-nombre-interno', schema: 'crm CreateCampaignSchema.name' },
  { file: 'crm/index.vue', id: 'crm-segmento', schema: 'crm CreateCampaignSchema.segmentId' },
  { file: 'crm/index.vue', id: 'crm-asunto', schema: 'crm CreateCampaignSchema.subject' },
  // attendance/validators/schema.ts → ManualRecordSchema / CreateScheduleSchema
  { file: 'attendance/index.vue', id: 'attendance-empleado', schema: 'attendance ManualRecordSchema.employeeId' },
  { file: 'attendance/index.vue', id: 'attendance-hora-de-entrada', schema: 'attendance ManualRecordSchema.clockIn' },
  { file: 'attendance/index.vue', id: 'attendance-nombre-del-turno', schema: 'attendance CreateScheduleSchema.name' },
  { file: 'attendance/index.vue', id: 'attendance-hora-inicio', schema: 'attendance CreateScheduleSchema.startTime' },
  { file: 'attendance/index.vue', id: 'attendance-hora-fin', schema: 'attendance CreateScheduleSchema.endTime' },
  // treasury/validators/schema.ts → CreateBankAccountSchema / CreateSupplierSchema / CreateBudgetSchema
  { file: 'tesoreria/bancos.vue', id: 'tesoreria-bancos-nombre', schema: 'treasury CreateBankAccountSchema.name' },
  { file: 'tesoreria/proveedores.vue', id: 'tesoreria-proveedores-nombre', schema: 'treasury CreateSupplierSchema.name' },
  { file: 'tesoreria/presupuesto.vue', id: 'tesoreria-presupuesto-periodo', schema: 'treasury CreateBudgetSchema.period' },
  { file: 'tesoreria/presupuesto.vue', id: 'tesoreria-presupuesto-categoria', schema: 'treasury CreateBudgetSchema.category' },
  // caja-chica/validators/schema.ts → CreateFundSchema / CreateReplenishmentSchema
  { file: 'tesoreria/caja-chica.vue', id: 'tesoreria-caja-chica-nombre', schema: 'caja-chica CreateFundSchema.name' },
  { file: 'tesoreria/caja-chica.vue', id: 'tesoreria-caja-chica-custodio', schema: 'caja-chica CreateFundSchema.custodianId' },
  { file: 'tesoreria/caja-chica.vue', id: 'tesoreria-caja-chica-tope-del-fondo', schema: 'caja-chica CreateFundSchema.targetAmount' },
  { file: 'tesoreria/caja-chica.vue', id: 'tesoreria-caja-chica-monto-a-reponer', schema: 'caja-chica CreateReplenishmentSchema.amount' },
  // accounting/validators/schema.ts → CreateAccountSchema
  { file: 'contabilidad/plan-cuentas.vue', id: 'contabilidad-plan-cuentas-codigo', schema: 'accounting CreateAccountSchema.code' },
  { file: 'contabilidad/plan-cuentas.vue', id: 'contabilidad-plan-cuentas-nombre', schema: 'accounting CreateAccountSchema.name' },
  { file: 'contabilidad/plan-cuentas.vue', id: 'contabilidad-plan-cuentas-tipo', schema: 'accounting CreateAccountSchema.type' },
  // usuarios/validators/schema.ts → LoginSchema / ForgotPasswordSchema
  { file: 'auth/login.vue', id: 'auth-login-email', schema: 'usuarios LoginSchema.email' },
  { file: 'auth/login.vue', id: 'auth-login-password', schema: 'usuarios LoginSchema.password' },
  { file: 'auth/forgot-password.vue', id: 'auth-forgot-password-email', schema: 'usuarios ForgotPasswordSchema.email' },
  // subscriptions/validators/schema.ts → SignupSchema (ownerName NO: el schema lo acepta vacío)
  { file: 'auth/register.vue', id: 'auth-register-email', schema: 'subscriptions SignupSchema.email' },
  { file: 'auth/register.vue', id: 'auth-register-contrasena', schema: 'subscriptions SignupSchema.password' },
  { file: 'auth/register.vue', id: 'auth-register-nombre-del-hotel', schema: 'subscriptions SignupSchema.hotelName' },
]

describe('GH-18.1 — los campos obligatorios del backend lo declaran en el HTML (2ª tanda)', () => {
  for (const { file, id, schema } of REQUIRED_MIRRORS_2) {
    it(`${file} #${id} → ${schema}`, () => {
      const tag = fieldTags(template(file)).find((t) => t.includes(`id="${id}"`))
      expect(tag, `${file}: no existe el campo #${id}`).toBeDefined()
      expect(/\brequired\b/.test(tag!), `#${id} debe declarar required (${schema})`).toBe(true)
      expect(/aria-required="true"/.test(tag!), `#${id} debe declarar aria-required`).toBe(true)
    })
  }
})

/** Líneas de detalle dentro de un `v-for`: el `id` es dinámico, así que se busca por `:id`. */
const REQUIRED_MIRRORS_VFOR: Array<{ file: string; dynId: string; schema: string }> = [
  { file: 'compras/ordenes.vue', dynId: 'orden-linea-${idx}-descripcion', schema: 'compras OrderLineSchema.description' },
  { file: 'compras/requisiciones.vue', dynId: 'requisicion-linea-${idx}-descripcion', schema: 'compras RequisitionLineSchema.description' },
]

describe('GH-18.1 — las líneas de compra exigen descripción, igual que el backend', () => {
  for (const { file, dynId, schema } of REQUIRED_MIRRORS_VFOR) {
    it(`${file} :id="\`${dynId}\`" → ${schema}`, () => {
      const tag = fieldTags(template(file)).find((t) => t.includes(`:id="\`${dynId}\`"`))
      expect(tag, `${file}: no existe el campo :id="\`${dynId}\`"`).toBeDefined()
      expect(/\brequired\b/.test(tag!), `${dynId} debe declarar required (${schema})`).toBe(true)
      expect(/aria-required="true"/.test(tag!), `${dynId} debe declarar aria-required`).toBe(true)
    })
  }
})

/**
 * El contrapeso, 2ª tanda. Estos campos llevan un `*` en la pantalla pero el validador del
 * backend los acepta vacíos: ponerles `required` bloquearía un envío que el servidor aceptaría.
 * La divergencia entre el `*` visible y el schema está anotada en `tasks.md` — se resuelve
 * en el backend o en el texto, NO agregando el atributo acá.
 */
const MUST_STAY_OPTIONAL_2: Array<{ file: string; id: string; schema: string }> = [
  { file: 'groups/index.vue', id: 'groups-contacto', schema: 'grupos CreateGruposSchema.leadGuestId' },
  { file: 'groups/index.vue', id: 'groups-fecha-check-in', schema: 'grupos CreateGruposSchema.checkIn' },
  { file: 'groups/index.vue', id: 'groups-fecha-check-out', schema: 'grupos CreateGruposSchema.checkOut' },
  { file: 'groups/index.vue', id: 'groups-habitaciones', schema: 'grupos CreateGruposSchema.totalRooms' },
  { file: 'maintenance/index.vue', id: 'maintenance-categoria', schema: 'mantenimiento CreateMantenimientoSchema.category' },
  { file: 'maintenance/index.vue', id: 'maintenance-prioridad', schema: 'mantenimiento CreateMantenimientoSchema.priority' },
  { file: 'maintenance/index.vue', id: 'maintenance-descripcion', schema: 'mantenimiento CreateMantenimientoSchema.description' },
  { file: 'maintenance/index.vue', id: 'maintenance-costo-estimado', schema: 'mantenimiento CreateMantenimientoSchema.estimatedCost' },
  // El alta autogenera la contraseña si el campo va vacío (team/index.vue: `password || undefined`).
  { file: 'team/index.vue', id: 'team-contrasena-temporal', schema: 'usuarios CreateUsuarioSchema.password' },
  // `ownerName` NO entra acá: SignupSchema lo acepta vacío, pero el formulario lo exige por
  // decisión propia y coherente (`required` ya venía en el marcado y `canSubmit` en
  // auth/register.vue lo corrobora con `form.ownerName.trim().length > 0`). Es el frontend
  // siendo MÁS estricto que el backend, que es seguro; lo peligroso es al revés.
  { file: 'auth/register.vue', id: 'auth-register-ciudad', schema: 'subscriptions SignupSchema.address' },
  // El PIN de la llave maestra es opcional: si va vacío, TTLock lo genera.
  { file: 'cerraduras/index.vue', id: 'cerraduras-pin-opcional', schema: 'ttlock CreateMasterKeySchema.code' },
  { file: 'crm/index.vue', id: 'crm-mensaje-html', schema: 'crm CreateCampaignSchema.body' },
  { file: 'technical-providers/index.vue', id: 'technical-providers-email', schema: 'mantenimiento CreateProviderSchema.email' },
  { file: 'support/index.vue', id: 'support-descripcion-detallada', schema: 'tickets CreateTicketsSchema.description' },
]

describe('GH-18.1 — lo que el backend acepta vacío NO lleva required (2ª tanda)', () => {
  for (const { file, id, schema } of MUST_STAY_OPTIONAL_2) {
    it(`${file} #${id} sigue opcional (${schema})`, () => {
      const tag = fieldTags(template(file)).find((t) => t.includes(`id="${id}"`))
      expect(tag, `${file}: no existe el campo #${id}`).toBeDefined()
      expect(/\brequired\b/.test(tag!), `#${id} NO debe declarar required (${schema} es opcional)`).toBe(false)
    })
  }
})
