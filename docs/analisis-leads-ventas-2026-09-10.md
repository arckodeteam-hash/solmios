# /admin/leads-ventas — análisis (2026-09-10)

## Qué es hoy
Bandeja del botón "Hablar con Ventas" de la landing (`SalesContactModal.vue`). Módulo `backend/src/modules/sales-leads`:
crea el lead (público, rate-limited), acuse al visitante, aviso a `ventas@solmios.com`, y el super-admin cambia estado
(`new → contacted → won/lost`) y deja notas. Sin asignación, sin recordatorios, sin relación con registro/trial/pago.

## Por qué "no funciona"
`sales_leads` en prod: **0 filas**. Nadie usó ese CTA. Los prospectos reales entran por el registro con trial y no
aparecen en ningún pipeline.

Prod 2026-09-10: 17 hoteles (12 en 30 días) · 4 trials vigentes · **15 trials vencidos en `trialing`** · 2 pagando
(1 es Test Property) · referidos 0 · aliados 0 · correos de plataforma: 9 trial_ending + 9 trial_expired.

Actividad: 5 hoteles cargaron 7–14 habitaciones y 0 reservas, 1–12 acciones, última vez 02–06 sep; 7 hoteles
**nunca entraron**. Trial de 7 días hasta el 09-sep (15 desde entonces). Nadie los contactó.

## Industria
- Trial→pago mediana 8%; sin tarjeta 9–18%; con tarjeta 31–49%.
- Contacto en 5 min = 21× más calificación que a los 30 min; media B2B ≈ 2 días.
- 7 días solo si el valor es inmediato; 14 para B2B con setup; 90% decide en los primeros 5 días.
- PQL: el lead que ya usó el producto (cargar habitaciones = señal).
- Cloudbeds/Mews: sin precio público, demo-first, onboarding coach dedicado.

## VS
| Etapa | Hoy | Debería |
|---|---|---|
| Captación | Trial + "Hablar con Ventas" (0 usos). Sin WhatsApp | Trial + WhatsApp/demo visibles |
| Pipeline | 3 silos (`sales_leads`, `subscriptions`, `referrals`) | Uno: contacto → registrado → activado → pagó |
| Speed-to-lead | Solo correo automático | Aviso inmediato a ventas + contacto humano < 1 h |
| Activación | Barra de progreso + 2 correos de trial | Secuencia por comportamiento en los primeros 5 días |
| Calificación | Ninguna | PQL score con señales de la base (habitaciones, tarifas, canal, reservas, último login) |
| Seguimiento | Notas libres | Próximo paso + fecha + responsable |
| Trial vencido | Zombi en `trialing` | Extender / rescatar / perdido con motivo |
| Métrica | Nada | Embudo semanal + motivos de pérdida |

## Opciones
- **A (mínimo, 1–2 sem)**: pipeline unificado en `/admin/leads-ventas` con señales de producto y orden por calor;
  aviso inmediato (email + WhatsApp a ventas, botón wa.me); próximo paso/fecha/responsable; extender trial / perdido
  con motivo; botón WhatsApp en la landing.
- **B (3–4 sem)**: A + secuencia de activación por comportamiento sobre `platform_email_templates`, PQL score
  automático, rescate de trial vencido, embudo en dashboard admin.
- **C**: CRM externo (HubSpot/Pipedrive) alimentado por webhooks; `/admin/leads-ventas` se elimina o espejo.

Recomendación: **A ahora, B después**. Decisiones previas: quién responde en < 1 h; tarjeta en el trial (no todavía).

## Línea base — 2026-09-10 (día 0, Fases A y B recién desplegadas)

Fuente: `GET /api/admin/sales-pipeline/funnel?weeks=8` en prod (issue #181). Semanas ISO; "activados" =
cargaron su primera habitación dentro de los 7 días del alta; "pagando" = primer cobro de plataforma en
esa semana; "perdidos" por semana de `lostAt`.

| Semana | Registrados | Activados | Pagando | Perdidos |
|---|---|---|---|---|
| 2026-W30 | 3 | 1 | 0 | 0 |
| 2026-W31 | 0 | 0 | 0 | 0 |
| 2026-W32 | 0 | 0 | 0 | 0 |
| 2026-W33 | 0 | 0 | 0 | 0 |
| 2026-W34 | 3 | 2 | 0 | 0 |
| 2026-W35 | 1 | 0 | 0 | 0 |
| 2026-W36 | 6 | 6 | 0 | 0 |
| 2026-W37 | 2 | 0 | 2 | 2 |
| **Total 8 sem** | **15** | **9 (60%)** | **2 (13.3%)** | **2** (`no_response`, marcados por el cron a +14 d) |

Contexto del día 0: pipeline con 16 hoteles (expired 9 · paying 2 · activated 1 · registered 2 · lost 2);
primer tick del cron mandó `trial_rescue_1` ×3, `trial_offer` ×1, `activation_no_rooms` ×1. El 13.3%
"pagando" son los 2 hoteles que ya pagaban antes de todo esto (uno es "Test Property"): la tasa real de
partida sigue siendo el 5–10% del análisis, no 13.3%.

## Resultado a 4 semanas — pendiente (≈ 2026-10-08, issue #181)

Repetir la misma consulta y completar:

| | Día 0 (2026-09-10) | +4 semanas | Δ |
|---|---|---|---|
| Registrados (8 sem) | 15 | | |
| Activados / tasa | 9 / 60% | | |
| Pagando / tasa | 2 / 13.3% | | |
| Perdidos por motivo | 2 `no_response` | | |
| Correos de secuencia enviados (`email_queue` `platform_email:activation_*`/`trial_*`) | 5 | | |
| Trials vencidos contactados por una persona (`contactedAt`) | 0 | | |

Pregunta a responder: ¿la secuencia automática (#149/#150) movió `payingRate` por encima del 5–10% de
partida, o lo que falta sigue siendo la llamada humana en < 1 h?

## Fuentes
- https://www.shno.co/marketing-statistics/free-trial-conversion-statistics
- https://userpilot.com/blog/saas-average-conversion-rate/
- https://www.growthspreeofficial.com/blogs/b2b-saas-trial-to-paid-conversion-rate-benchmarks-2026-by-trial-type-acv-length-credit-card
- https://www.leadangel.com/blog/operations/lead-response-time/
- https://ainora.lt/blog/lead-response-time-statistics-every-study-2026
- https://ordwaylabs.com/blog/saas-free-trial-length-conversion/
- https://www.artisangrowthstrategies.com/blog/b2b-saas-free-trial-length-7-vs-14-vs-30-days-data
- https://www.factors.ai/blog/product-qualified-lead
- https://saasfractionalcpo.com/blog/product-qualified-leads-complete-guide/
- https://www.digitalapplied.com/blog/saas-customer-onboarding-email-sequence-2026-crm-playbook
- https://www.cloudbeds.com/pricing/
- https://www.mews.com/en/compare/mews-vs-cloudbeds
