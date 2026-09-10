# pipeline-ventas-trials

## Intent

Que el equipo de ventas de SOLMI OS tenga **una lista de a quién llamar hoy**, con los datos para
hacerlo y con lo que esa persona ya hizo en el producto; y que el sistema empuje solo a los trials
que se enfrían. Hoy `/admin/leads-ventas` mide un canal que no genera nada (0 leads en prod) mientras
los prospectos reales —los que se registran y prueban— no aparecen en ningún pipeline y nadie los
contacta.

Referencia MisterPlan: no aplica (es el proceso comercial del SaaS, no una función del PMS). Referencia
de mercado: Cloudbeds/Mews venden demo-first con onboarding dedicado; SOLMI OS vende autoservicio a un
público que espera contacto humano por WhatsApp. Ver `docs/analisis-leads-ventas-2026-09-10.md`.

## El problema, con evidencia (prod, 2026-09-10)

| Dato | Valor | Fuente |
|---|---|---|
| `sales_leads` | **0 filas** | `SELECT count(*) FROM sales_leads` |
| Hoteles registrados / últimos 30 días | 17 / **12** | `hotels` |
| Trials vencidos que siguen en `trialing` | **15** | `subscriptions WHERE status='trialing' AND trialendsat < now()` |
| Pagando | 2 (uno es "Test Property") | `subscriptions WHERE status='active'` |
| Hoteles que cargaron 7–14 habitaciones y 0 reservas, sin contacto | 5 | `rooms`/`reservations`/`audit_log` por hotel |
| Hoteles que se registraron y nunca entraron | 7 | `audit_log` sin filas |
| Contacto humano tras el registro | ninguno: solo `welcome` + `trial_ending` + `trial_expired` | `email_queue.relatedtype` |
| Aviso interno al registrarse un hotel | no existe | `grep` en `subscriptions/usecases/signup.ts` |
| Extender un trial desde admin | no existe | endpoints de `admin/index.ts` |
| WhatsApp en la landing | no existe | `grep wa.me frontend/src/pages/landing` → 0 |

Benchmarks: trial→pago mediana 8% (sin tarjeta 9–18%); contactar en 5 min = 21× más calificación que
a los 30 min; 90% decide en los primeros 5 días; el lead que ya usó el producto (PQL) es el más valioso.

## Decisión de alcance

- **Fase A (ahora)**: pipeline unificado + aviso inmediato + próximo paso + extender trial + WhatsApp
  en la landing. Con datos que **ya están en la base**.
- **Fase B (después)**: secuencia de activación por comportamiento, score PQL automático, rescate de
  trial vencido, embudo semanal.
- **Descartado**: CRM externo (HubSpot/Pipedrive). Sin una persona de ventas full-time viviendo en el
  CRM, es otro sistema que nadie mira; se reevalúa si el volumen supera ~50 altas/mes.
- **No se pide tarjeta en el trial** en este cambio (12 altas/mes: primero entender por qué no
  convierten hablando con ellos).

## Fuera de alcance

Envío de WhatsApp **desde la plataforma** (el modelo vigente es "un WhatsApp por hotel"; un número de
la plataforma es decisión aparte). En A y B los toques por WhatsApp son enlaces `wa.me` que abre el
vendedor; lo automático va por email.

## Rollback

Fase A es aditiva: tabla nueva `sales_prospects`, endpoints nuevos bajo `/api/admin/sales-pipeline`,
un endpoint nuevo de extensión de trial, un botón en la landing. Nada existente cambia de
comportamiento. Revertir el commit devuelve todo.
