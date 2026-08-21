/**
 * GH-17 / GH-18 — Guardián de campos de formulario del flujo operativo diario.
 *
 * El censo del 2026-08-20 encontró 418 de 439 `<input>` de `src/pages/` sin `name` ni `id`:
 * lectores de pantalla sin nada que anunciar y selectores de test que dependen de la clase CSS.
 * Este test NO pretende cubrir las 439 — fija el flujo que se toca todos los días (reservas,
 * check-in, huéspedes, cobros, habitaciones, pre-check-in) para que no vuelva a caerse.
 *
 * Es un test sobre el FUENTE, no sobre el componente montado: montar estas páginas exige el
 * router, Pinia y ~15 services mockeados, y el defecto que cuidamos es puramente declarativo.
 */
import { describe, it, expect } from 'vitest'

/**
 * Fuente cruda de cada página, vía `import.meta.glob` de Vite: `tsconfig.app.json` no incluye
 * `@types/node`, así que `node:fs` no compila acá. `eager: true` resuelve en build-time.
 */
const RAW_PAGES = import.meta.glob('./**/index.vue', {
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
