# admin-facturacion-real

## Intent

Que `/admin/billing` muestre **los cobros reales de la plataforma a los hoteles** (suscripciones
SaaS): qué factura emitió Stripe, por cuánto, cuándo, si se pagó, y que las acciones "Recordar" y
"Marcar pagado" hagan algo de verdad. Hoy la pantalla fabrica facturas a partir de la lista de
suscripciones, con nombres de campo que el backend no devuelve — por eso la fecha sale vacía y "Ver"
no muestra nada.

Referencia MisterPlan: no aplica — es la facturación interna del SaaS, no una función del PMS.

## El problema, con evidencia

Reporte del usuario en prod (2026-09-10): "no muestra la fecha y en Ver no muestra nada".

| Dato en pantalla | Realidad | Evidencia |
|---|---|---|
| Fecha | Lee `h.createdAt`; `listSubscriptions` no lo devuelve | `billing.vue:241` vs `admin/usecases/dashboard-queries.ts:132-144` |
| "Ver" en blanco | Lee `h.name` (el campo es `hotelName`) → `hotel` undefined → `selectedInvoice.hotel[0]` rompe el render del modal | `billing.vue:237`, `billing.vue:118` |
| Estado siempre "Pagado", tasa 100% | Compara con `'pendiente'`/`'suspendido'`; los estados reales son `trialing/active/past_due/expired/canceled/suspended` | `billing.vue:234` vs `subscriptions/model.ts:21-27` |
| Plan siempre "Starter" | Lee `h.plan`; el campo es `planName` | `billing.vue:232` |
| Monto | `PLAN_PRICE` hardcodeado (199/99/49), ignora `plans.price` | `billing.vue:223` |
| Nº de factura `INV-001` | Índice del array | `billing.vue:236` |
| Concepto "Plan x — Junio 2026", método "Tarjeta" | Literales | `billing.vue:239-240` |
| Filtro "Fecha" | `dateFilter` nunca se aplica | `billing.vue:283-303` |
| Opciones de plan | Hardcodeadas (Enterprise/Professional/Starter); no vienen de `plans` | `billing.vue:33-35` |
| "Recordar" | Cierra el modal y muestra un toast; no envía nada | `billing.vue:326` |
| "Pagado" | Cambia el estado en memoria; al recargar vuelve | `billing.vue:330-335` |
| Exportar | CSV de las filas inventadas | `billing.vue:337-349` |
| Toast | Implementación propia además de `useToast` | `billing.vue:187-190, 351-356` |

**No existe en el código** una tabla de cobros de la plataforma: `subscriptions/model.ts` define
`subscriptions`, `subscription_discounts`, `special_category_config`, `founder_history`. El webhook
`invoice.paid` solo cambia `status` y `currentPeriodEnd` (`handle-stripe-event.ts:221-256`); el
monto, el número y el PDF de la factura de Stripe se descartan. Nadie lee `stripe.invoices.list`
(`grep -rn "invoices.list\|hosted_invoice_url" backend/src frontend/src` → 0).

## Lo que SÍ existe y hay que reutilizar

- `listSubscriptions` con hotel, plan real, `status`, `currentPeriodEnd`, `mrr` (`dashboard-queries.ts:121-147`).
- Webhook de plataforma `POST /api/stripe/webhook/platform` con `invoice.paid` / `invoice.payment_failed` ya enrutados.
- Plantillas de correo `subscription_renewal_manual`, `subscription_renewal_auto`, `payment_failed`
  (`seed-platform-email-templates.ts`) y `notifyPlatformEmail`.
- `isRecurring` distingue tarjeta (auto) de pago manual (`subscription-suspension-cron.ts:88`).
- `reactivateSubscription` del admin (`admin/index.ts:137`).
- `Auditlog` para dejar rastro de acciones del admin.

## Replanteo

`/admin/billing` = **libro de cobros de la plataforma**, con una fuente de verdad persistida:

1. Tabla `platform_invoices`: una fila por factura de Stripe (o por pago manual registrado por el
   admin). La alimentan los webhooks (`invoice.finalized`, `invoice.paid`, `invoice.payment_failed`,
   `invoice.voided`) y un backfill inicial desde Stripe para las suscripciones existentes.
2. Endpoints admin de solo lectura (listado paginado con filtros, detalle, stats, CSV).
3. Dos acciones reales: **Recordar** (manda la plantilla que corresponde, con dedup y auditoría) y
   **Registrar pago manual** (para hoteles sin tarjeta: crea la fila, activa la suscripción y
   extiende el período, vía connector — sin import directo entre módulos).
4. Pantalla reescrita sin un solo dato inventado.

## Alternativas consideradas

| Opción | Tradeoff | Decisión |
|---|---|---|
| Leer `stripe.invoices.list` en vivo en cada carga | Sin tabla nueva, pero N llamadas a Stripe por pantalla, sin filtros locales, sin pagos manuales, y cae si Stripe cae | ❌ |
| Persistir en `platform_invoices` alimentada por webhooks + backfill | Una tabla y 2 eventos más en el webhook; listado local rápido, admite pago manual, sobrevive a Stripe caído | ✅ |
| Reusar el módulo `facturas` (facturas del hotel a sus huéspedes) | Otro dominio, otro tenant (`hotelId` del hotel emisor), NCF, impuestos — mezclarlos es un error contable | ❌ |
| "Marcar pagado" como cambio de estado sin monto | No deja rastro de cuánto ni cuándo; es lo que hay hoy en memoria | ❌ |

## Alcance

1. Modelo `platform_invoices` + persistencia desde webhooks + backfill.
2. Endpoints admin: listado, detalle, stats, export.
3. Acciones: recordar, registrar pago manual.
4. Pantalla.
5. Verificación + deploy (eventos nuevos habilitados en Stripe).

## Fuera de alcance

- Emitir comprobantes fiscales propios (NCF/CFDI) por los cobros de la plataforma.
- Notas de crédito / reembolsos de suscripción (se registran si llegan por webhook como `void`, sin
  acción desde el panel).
- Facturación de consumo de WhatsApp (va en el plan; ver `whatsapp_usage_daily`).

## Riesgo y rollback

| Riesgo | Mitigación |
|---|---|
| Webhook duplicado crea dos filas | UPSERT por `stripeInvoiceId` (UNIQUE INDEX explícito: el ORM no lo crea) |
| Backfill pisa un pago manual | Backfill solo inserta filas con `stripeInvoiceId`; las manuales no tienen |
| Pago manual sin control activa una suscripción por error | Solo `super_admin`, monto > 0, referencia obligatoria, confirmación en UI, audit log con usuario |
| Eventos `invoice.finalized`/`invoice.voided` no habilitados en el dashboard de Stripe | Tarea de deploy explícita; hasta entonces `invoice.paid` alcanza para las pagadas |

**Rollback**: aditivo. La tabla queda huérfana sin romper el arranque; la vista vuelve al commit
anterior; los `case` nuevos del webhook se pueden quitar sin afectar los existentes.

## Módulos afectados

- `backend/src/modules/subscriptions/` (model, handle-stripe-event, usecases nuevos)
- `backend/src/modules/admin/` (endpoints de billing)
- `backend/src/connectors/admin-subscriptions-billing.ts` (nuevo)
- `backend/scripts/backfill-platform-invoices.ts` (nuevo)
- `frontend/src/pages/super-admin/billing.vue` (reescritura)
- `frontend/src/services/PlatformBilling.service.ts` (nuevo)
