# crm-campanas-v1

## Intent

Cerrar la dimensión "campañas" del CRM (la #5 del mapa de alcance): convertir los segmentos
en envíos reales, sumar triggers de HUÉSPED (no de reserva) al motor de auto-messages que ya
existe, y estructurar las preferencias del huésped. Oleada 1 del roadmap CRM 2026-08-18.

## Contexto (verificado 2026-08-18, 10 ciclos contra el código)

Lo que YA existe y este change REUSA (no duplica):
- **Journey transaccional COMPLETO**: `marketing/usecases/auto-messages-cron.ts` corre con
  triggers `on_reservation, pre_checkin (offset variable), checkin_day, checkout_day,
  post_checkout` — el email pre/post estadía ya funciona con plantillas y variables.
- **Cola de envíos**: módulo `email-queue` (hotelId, to, subject, html, status pending) con
  worker corriendo — una campaña solo encola N filas.
- **Plantillas gestionables**: `platform-emails` (subject+body, admin) — las campañas usan
  cuerpo propio, no reusan plantillas transaccionales.
- **Miembros de segmento**: `SegmentUseCase.guestsIn` ya resuelve el destinatario exacto.
- **`guests.birthDate`** existe (huespedes/model.ts:29) → trigger cumpleaños sin migración.
- **Scheduler**: 5 crons ya registrados en composition-root (patrón a seguir).

El gap REAL (lo que este change construye):
1. Campañas manuales a segmentos (componer + enviar + log + anti-reenvío).
2. Triggers `birthday` e `inactive_guests` en auto-messages (fecha del HUÉSPED, no de reserva).
3. Preferencias del huésped visibles en la ficha y en check-in.

## Decisión (2026-08-18)

- Campañas = módulo crm (dueño de segmentos) + cola existente vía connector `crm-emailqueue`
  (puerto enqueueCampaign, el CRM no importa email-queue directo — regla de connectors).
- Variables simples `{{nombre}}` `{{hotel}}` `{{puntos}}` resueltas al encolar (mismo espíritu
  que las variables de auto-messages).
- `inactive_guests` reusa `triggerOffset` como días de inactividad (precedente: DT-18 usa
  offset variable para pre_checkin).
- Preferencias v1: campo de texto estructurado-libre en la ficha (sin taxonomía rígida —
  la data dirá qué etiquetas merecen chips).

## Scope

- Tablas `campaigns` + `campaign_sends` (crm).
- `POST /api/crm/campaigns`, `POST /api/crm/campaigns/:id/send` (guests:edit para enviar).
- Enum auto-messages + `birthday`/`inactive_guests` + handlers en el cron.
- `guests.preferences` (texto) + UI en ficha.
- Tab Campañas en la vista CRM.

## Out of scope (explícito)

- WhatsApp (bloqueado por creds Meta), SMS.
- Segmentos RFM calculados, scoring, beneficios por tier (Oleada 2).
- A/B testing, métricas de apertura (requiere pixel/webhook — infra nueva).

## Rollback

- Enviar campaña es acción explícita del usuario (no automática) → sin kill-switch.
- Los triggers nuevos son `AutoMessages` que el hotel NO crea → inactivos por defecto;
  desactivar = borrar el auto-message desde la UI de marketing existente.
- Sin migraciones destructivas (2 tablas nuevas + 1 columna).
