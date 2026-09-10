# Spec — Facturación de la plataforma (super-admin)

Convención: UI en español, base de datos y API en inglés (RFC 2119). Toda ruta `/api/admin/billing/*`
exige `auth.authenticate('super_admin')` + `requireUserType('admin')`. Dinero con `round2` de
`shared/utils/money.ts`. Ningún valor en pantalla puede ser un literal del HTML o del script.

---

## REQ-BIL-01 — Fuente de verdad: `platform_invoices`

MUST existir el modelo `platform_invoices` en `modules/subscriptions/model.ts`:
`{ id, hotelId (indexed), subscriptionId, stripeInvoiceId? (UNIQUE INDEX explícito), number?,
status ('open'|'paid'|'void'|'uncollectible'|'failed'), amountDue, amountPaid, currency,
planId?, planName?, periodStart?, periodEnd?, issuedAt, dueAt?, paidAt?, method ('card'|'manual'),
reference?, hostedInvoiceUrl?, invoicePdfUrl?, recordedByUserId?, notes? (text) }` + timestamps.

**Given** `RUN_MIGRATE=1`
**When** arranca contra SQLite y contra Postgres
**Then** la tabla existe con el índice único sobre `stripeInvoiceId`, y todo campo usado por el
service/DTO/frontend está en el `orm.define` (check anti-patrón ORM).

## REQ-BIL-02 — Los webhooks persisten la factura

`handle-stripe-event.ts` MUST hacer UPSERT en `platform_invoices` por `stripeInvoiceId` en
`invoice.finalized` (→ `open`), `invoice.paid` (→ `paid`, `amountPaid`, `paidAt`),
`invoice.payment_failed` (→ `failed`) e `invoice.voided` (→ `void`), tomando `number`, `amount_due`,
`amount_paid`, `currency`, `period_start/end`, `due_date`, `hosted_invoice_url`, `invoice_pdf` y el
plan del `line_items[0].price`. El comportamiento actual (status de la suscripción, correos) MUST
mantenerse.

**Given** un `invoice.paid` recibido dos veces con el mismo `id`
**When** se procesa
**Then** hay UNA fila `paid` con el monto correcto.

**Given** `invoice.paid` para una suscripción sin fila local previa (`finalized` no llegó)
**When** se procesa
**Then** se crea la fila directamente en `paid`.

## REQ-BIL-03 — Backfill desde Stripe

`scripts/backfill-platform-invoices.ts` MUST recorrer las suscripciones con `stripeCustomerId`,
listar sus facturas en Stripe (`invoices.list`, paginado) y hacer UPSERT. MUST ser idempotente y
MUST NOT tocar filas con `method = 'manual'`.

**Given** un hotel con 3 facturas en Stripe y una manual local
**When** se corre dos veces
**Then** hay exactamente 4 filas y la manual está intacta.

## REQ-BIL-04 — Listado, detalle, stats, export

- `GET /api/admin/billing/invoices?status&planId&from&to&q&page&limit` MUST devolver
  `{ data, total, page, limit }` ordenado por `issuedAt` desc. `q` busca en `number`, nombre del
  hotel y `reference`. Los filtros se aplican en el usecase (no en el navegador sobre todo el set).
- `GET /api/admin/billing/invoices/:id` MUST devolver la factura con `hotelName`, `hotelEmail`,
  `subscriptionStatus`, `isRecurring`, `currentPeriodEnd`.
- `GET /api/admin/billing/stats?from&to` MUST devolver `{ collected, open, overdue, failed,
  collectionRate, mrr }` calculados desde `platform_invoices` (`overdue` = `open` con `dueAt < now`)
  y `mrr` desde `listSubscriptions`.
- `GET /api/admin/billing/export.csv` con los mismos filtros MUST devolver `text/csv` con BOM UTF-8
  y separador `;`.

**Given** 2 facturas `paid` de 49 y 99, 1 `open` vencida de 49 y 1 `failed` de 99
**When** se piden las stats sin filtro
**Then** `collected = 148`, `open = 49`, `overdue = 49`, `failed = 99`, `collectionRate = 50`.

## REQ-BIL-05 — Recordar

`POST /api/admin/billing/invoices/:id/remind` MUST enviar al hotel la plantilla `payment_failed`
si la factura está `failed`, o `subscription_renewal_manual`/`_auto` (según `isRecurring`) si está
`open`, con `amount`, `plan_name`, `link`. MUST rechazar con 409 si la factura está `paid`/`void`.
MUST registrar en `Auditlog` (usuario, factura, plantilla) y guardar `lastReminderAt` en la fila.
MUST NOT enviar dos veces en menos de 24 h (409 con la hora del último envío).

**Given** una factura `open` recordada hace 2 h
**When** el admin vuelve a recordar
**Then** 409, sin correo, y la UI muestra "Ya se envió hoy a las HH:MM".

## REQ-BIL-06 — Registrar pago manual

`POST /api/admin/billing/manual-payment` con `{ hotelId, amount (>0), currency, paidAt (ISO, no
futuro), reference (obligatoria), periodEnd (ISO), notes? }` validado con `validateSchema()` MUST:
crear la fila `platform_invoices` (`method: 'manual'`, `status: 'paid'`, `recordedByUserId`), y vía
connector `admin-subscriptions-billing` poner la suscripción en `active`, setear
`currentPeriodEnd = periodEnd` y limpiar gracia/suspensión (misma regla que `invoice.paid`). MUST
registrar en `Auditlog`. Si la factura seleccionada estaba `open`/`failed`, el pago manual MUST
marcarla `paid` en vez de crear otra.

**Given** un hotel `past_due` sin tarjeta
**When** el admin registra un pago de 49 USD con referencia "TRF-1234" y `periodEnd` en 30 días
**Then** hay una fila `paid`/`manual`, la suscripción queda `active` con ese `currentPeriodEnd`, y el
audit log tiene la entrada con el usuario.

## REQ-BIL-07 — Pantalla sin datos inventados

`billing.vue` MUST leer todo de `PlatformBilling.service.ts` (sin `any`). Cada fila MUST mostrar
número real (o "Manual · <ref>"), hotel, plan real, monto con moneda, método, estado real con badge,
**fecha de emisión real** y vencimiento. Las opciones del filtro de plan MUST venir de `plans`; el
filtro de fecha MUST aplicarse (vía `from/to` del endpoint). Stats desde REQ-BIL-04. Estados
loading / vacío / error propios. Toast solo con `useToast`.

**Given** la pantalla cargada en prod
**When** se revisa el código
**Then** `grep -n "PLAN_PRICE\|Junio 2026\|'Tarjeta'\|INV-\|showToastMessage\|: any" billing.vue` → vacío
y ninguna fila tiene la fecha vacía.

## REQ-BIL-08 — "Ver" muestra la factura

El detalle MUST abrir sin error con: hotel (link a `/admin/subscriptions?hotel=<id>`), plan,
período, monto, método, estado, emisión, vencimiento, pago, referencia, y —si existe— botones
"Ver en Stripe" (`hostedInvoiceUrl`) y "PDF" (`invoicePdfUrl`). Acciones según estado: Recordar
(`open`/`failed`), Registrar pago manual (`open`/`failed`), ninguna en `paid`/`void`.

**Given** una factura `paid` de Stripe
**When** el admin toca "Ver"
**Then** ve todos los campos, el botón PDF abre el PDF de Stripe y no hay botón "Pagado".

## REQ-BIL-09 — Auditoría y permisos

Toda ruta de este spec MUST devolver 403 a un `merchant` autenticado. Las dos acciones (recordar,
pago manual) MUST dejar entrada en `Auditlog` con `userId`, acción, `invoiceId`/`hotelId`, monto.
