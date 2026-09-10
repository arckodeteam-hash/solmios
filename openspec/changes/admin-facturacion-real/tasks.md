# admin-facturacion-real — Tasks

> `/admin/billing` fabrica facturas desde `listSubscriptions` con campos que no existen
> (`billing.vue:231-244`): fecha vacía, "Ver" en blanco, todo "Pagado". No hay tabla de cobros de la
> plataforma; el webhook `invoice.paid` descarta monto/número/PDF (`handle-stripe-event.ts:221-256`).
> Spec: `specs/facturacion-plataforma/spec.md`.

## 1. Fuente de verdad (REQ-BIL-01, REQ-BIL-02, REQ-BIL-03)

- [x] 1.1 Modelo `platform_invoices` + `CREATE UNIQUE INDEX` sobre `stripeInvoiceId` (el ORM no crea
      unique) en `subscriptions/model.ts` y registro.
      **Aceptación**: `RUN_MIGRATE=1` en SQLite y PG crea tabla e índice; check anti-patrón ORM.
- [x] 1.2 Usecase `upsert-platform-invoice.ts` (mapeo `Stripe.Invoice` → fila; UPSERT por
      `stripeInvoiceId`).
      **Aceptación**: test con el mismo `id` dos veces → 1 fila; test de mapeo de `period_*`,
      `due_date`, `hosted_invoice_url`, `invoice_pdf`, plan del `line_items[0]`.
- [x] 1.3 `handle-stripe-event.ts`: `invoice.finalized` → open, `invoice.paid` → paid,
      `invoice.payment_failed` → failed, `invoice.voided` → void. Sin cambiar lo que ya hacen.
      **Aceptación**: tests existentes verdes + 4 tests nuevos (uno por evento); `paid` sin
      `finalized` previo crea la fila.
- [x] 1.4 `scripts/backfill-platform-invoices.ts` idempotente, paginado, no toca `manual`.
      **Aceptación**: test con cliente Stripe falso (3 facturas + 1 manual local, corrido 2 veces →
      4 filas).

## 2. Endpoints admin (REQ-BIL-04, REQ-BIL-09)

- [x] 2.1 `GET /api/admin/billing/invoices` con filtros y paginación en el usecase.
      **Aceptación**: test de `status`, `planId`, `from/to`, `q` por número/hotel/referencia; 403
      con `merchant`.
- [x] 2.2 `GET /api/admin/billing/invoices/:id` enriquecido (hotel, suscripción).
      **Aceptación**: test de forma del payload; 404 si no existe.
- [x] 2.3 `GET /api/admin/billing/stats` desde `platform_invoices` + `mrr`.
      **Aceptación**: test del escenario del spec (148/49/49/99/50).
- [x] 2.4 `GET /api/admin/billing/export.csv` (BOM, `;`, mismos filtros).
      **Aceptación**: test que abre el CSV y verifica encabezados y una fila.

## 3. Acciones (REQ-BIL-05, REQ-BIL-06)

- [x] 3.1 `POST /:id/remind`: plantilla por estado/`isRecurring`, dedup 24 h, `lastReminderAt`,
      `Auditlog`.
      **Aceptación**: tests: `paid` → 409; segundo envío en 2 h → 409; `failed` usa
      `payment_failed`; `open` + `isRecurring=false` usa `subscription_renewal_manual`.
- [x] 3.2 Connector `admin-subscriptions-billing.ts` (activar + `currentPeriodEnd` + limpiar
      gracia) sin import directo del módulo.
      **Aceptación**: `arckode analyze` 0 violaciones.
- [x] 3.3 `POST /api/admin/billing/manual-payment` con `validateSchema()`: crea/actualiza fila,
      activa suscripción, `Auditlog`.
      **Aceptación**: tests: monto 0 → 400; `paidAt` futuro → 400; sin `reference` → 400; caso
      feliz deja `active` + fila `manual`/`paid` + audit.

## 4. Pantalla (REQ-BIL-07, REQ-BIL-08)

- [x] 4.1 `PlatformBilling.service.ts` tipado (sin `any`).
      **Aceptación**: `vue-tsc -b` limpio.
- [x] 4.2 Reescribir `billing.vue`: tabla con datos reales, fecha de emisión y vencimiento, planes
      desde `plans`, filtro de fecha aplicado, paginación, stats reales, loading/vacío/error.
      **Aceptación**: `grep -n "PLAN_PRICE\|Junio 2026\|'Tarjeta'\|INV-\|showToastMessage\|: any"
      billing.vue` → vacío; captura en prod con fechas visibles en todas las filas.
- [x] 4.3 Modal "Ver" con todos los campos, links Stripe/PDF, link al detalle de suscripción.
      **Aceptación**: abre sin error en consola para `paid`, `open`, `failed` y `manual`.
- [x] 4.4 Modal Recordar (muestra qué plantilla va a salir; respeta el 409 con la hora) y modal
      Registrar pago manual (monto, moneda, fecha, referencia, período, notas; confirmación).
      **Aceptación**: verificado en navegador: tras registrar, la fila pasa a `paid` sin recargar y
      `/admin/subscriptions` muestra la suscripción `active`.
- [x] 4.5 Exportar llama al endpoint CSV con los filtros activos.
      **Aceptación**: archivo abre en LibreOffice con acentos correctos.

## 5. Verificación + deploy

- [ ] 5.1 `arckode analyze` 0 violaciones; `bun run typecheck && bun test`; frontend
      `bun run typecheck && bun run build`.
- [ ] 5.2 Deploy: `RUN_MIGRATE=1`, correr `backfill-platform-invoices.ts` en prod, habilitar
      `invoice.finalized` e `invoice.voided` en el endpoint de webhook de Stripe (dashboard).
      **Aceptación**: en prod, `/admin/billing` lista las facturas históricas de Stripe con fecha y
      "Ver" muestra el PDF.
