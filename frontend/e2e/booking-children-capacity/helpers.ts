import type { Page, Locator } from '@playwright/test'

// Fixture del hotel de demo (seed local, ver backend/migrate-db.ts) — YA tiene child_policy
// configurada (acceptChildren:true, maxChildAge:12, maxFreeAge:3) y 8 habitaciones (suite ×3,
// double ×3, single ×1, triple ×1). Para esta corrida de E2E se sembraron ADEMÁS (script ad-hoc,
// solo en la DB SQLite local — nunca migraciones ni prod):
//   - season_assignments + room_rates por OCUPACIÓN para 'double' (1→85, 2→100, 3→140) y
//     'single' (1→60), cubriendo STAY_DATES — sin esto el demo no tenía ninguna tarifa por
//     ocupación cargada y el precio no podía variar (siempre fromPrice/basePrice plano).
//   - configuration('room_type_capacity') = { triple: { capacity:3, maxAdults:2, maxChildren:1 } }
//     — para poder probar el límite POR TIPO (Requerimiento 2), no solo la capacidad física.
export const SLUG = 'hotel-boutique-palma'
export const STAY = { checkIn: '2026-09-14', checkOut: '2026-09-16' }

/** Tarjeta de un tipo de habitación en RoomsStep.vue/BookingModal.vue, escopeada por el <article>
 *  que contiene el heading con el nombre del tipo — evita ambigüedad entre las 4 tarjetas. */
export function roomCard(page: Page, typeName: string): Locator {
  return page.locator('article').filter({ has: page.getByRole('heading', { name: typeName, exact: true }) })
}

export async function gotoWizardWithDates(page: Page, opts: { checkIn?: string; checkOut?: string } = {}) {
  const ci = opts.checkIn ?? STAY.checkIn
  const co = opts.checkOut ?? STAY.checkOut
  await page.goto(`/book/${SLUG}?checkIn=${ci}&checkOut=${co}`)
  await page.getByRole('button', { name: 'Ver disponibilidad' }).click()
}

export function logConsoleAndHttpErrors(page: Page, bucket: string[]) {
  page.on('console', (msg) => {
    if (msg.type() === 'error') bucket.push(`[console] ${msg.text()}`)
  })
  page.on('pageerror', (err) => bucket.push(`[pageerror] ${err.message}`))
  page.on('response', (r) => {
    if (r.status() >= 400) bucket.push(`[http ${r.status()}] ${r.request().method()} ${r.url()}`)
  })
}
