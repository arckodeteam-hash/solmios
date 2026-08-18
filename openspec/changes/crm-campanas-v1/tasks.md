# Tasks — crm-campanas-v1

> Protocolo: cada tarea se creó tras 10 ciclos de diseño y nace con **5 validaciones** de sus
> supuestos contra el código real (✓ = ya verificado al diseñar; ⬜ = gate al implementar).
> Gates de cierre por tarea: analyze 0 · typecheck b/f · tests · build.

## Fase A — Campañas a segmentos

### T1: Modelo campaigns + campaign_sends (crm)
Validaciones: ✓ email_queue existe con worker (módulo email-queue, status pending) ·
⬜ `registerCrmModels` acepta 2 tablas más sin choque de nombres · ⬜ ormMigrate crea ambas
en SQLite y PG (RUN_MIGRATE) · ⬜ índice por (hotelId, campaignId) en sends para el dedupe ·
⬜ analyzer 0 con los modelos nuevos.

### T2: Usecase send-campaign (crm)
Validaciones: ✓ `SegmentUseCase.guestsIn` resuelve miembros (misma fuente que la vista) ·
✓ patrón usecase puro del crm (redeem-with-promo como referencia) · ⬜ miembros sin email se
omiten sin abortar · ⬜ variables {{nombre}}/{{hotel}}/{{puntos}} resueltas al encolar ·
⬜ tests: envío completo / sin email / reenvío 409 / dedupe de guest duplicado.

### T3: ~~Connector~~ → setEmailDeps (puerto enqueue)
> Corregido en implementación: EmailService es servicio compartido (no módulo) — el patrón
> del proyecto es inyección post-init como wallet-pass. Sin connector.
Validaciones: ✓ patrón connector = crm-promocodes (setPort + delegación plana) ·
✓ email-queue es módulo registrado (resolveModule lo encuentra) · ⬜ el puerto no mete lógica
(analyzer: connectors solo wirean) · ⬜ sin import directo crm→email-queue ·
⬜ tests del connector con mock de resolveModule.

### T4: Endpoints campaigns (crm/index.ts + controller)
Validaciones: ✓ guard compuesto existente `guard('guests', a)` + moduleGuard('crm') ·
⬜ validateSchema en POST (regla del proyecto) · ⬜ send con `guests:edit` y 409 si ya sent ·
⬜ ownership: campañas solo del hotel del token · ⬜ tests de rutas con permisos.

### T5: Tab Campañas en la vista CRM
Validaciones: ✓ patrón de tabs existente (value/label/icon + activeTab) ·
✓ SectionCard/AppModal/ConfirmModal del design system · ⬜ select de segmentos reusa
listSegments() ya cargado · ⬜ confirm muestra "se enviará a N huéspedes" antes de send ·
⬜ typecheck + vitest del componente si aplica.

## Fase B — Triggers de huésped

### T6: Enum + handler `birthday` (marketing)
Validaciones: ✓ `guests.birthDate` existe (huespedes/model.ts:29) ·
✓ cron auto-messages ya registrado en composition-root · ⬜ enum validators + types sin
romper los 5 triggers existentes · ⬜ dedupe mismo-día contra el log de envíos de marketing
(misma fuente, no log paralelo) · ⬜ test: nace el 18/8, no reenvía en segunda corrida.

### T7: Enum + handler `inactive_guests` (marketing)
Validaciones: ✓ precedente de offset variable (DT-18 pre_checkin) ·
✓ LTV ya calcula lastVisit (ltv.ts) — mismo criterio de "última estadía" ·
⬜ query de reservas futuras para excluir al que ya volvió · ⬜ cron semanal separado del
diario (birthday) · ⬜ test: 190 días inactivo envía, con reserva futura no.

### T8: UI de triggers nuevos (vista marketing)
Validaciones: ✓ la vista lista auto-messages del enum (los nuevos aparecen solos al
actualizar el select) · ⬜ label del offset para inactive = "días de inactividad" ·
⬜ sin campos nuevos requeridos (usa subject/plantilla existentes) · ⬜ typecheck front ·
⬜ QA manual del alta de un birthday en dev.

## Fase C — Preferencias

### T9: Columna guests.preferences
Validaciones: ✓ birthDate duplicado en huespedes/model.ts:29 Y shared/models.ts:233 →
⬜ identificar el orm.define GANADOR (módulos se registran después de shared) y declarar
preferences SOLO ahí (anti modelo-dual, regla CLAUDE.md) · ⬜ ADD COLUMN en SQLite+PG ·
⬜ PATCH anti descarte silencioso: preferences en el schema del validator de update ·
⬜ el ORM no trunca texto largo (text, no string) · ⬜ RUN_MIGRATE idempotente.

### T10: UI preferencias (ficha + check-in)
Validaciones: ✓ ficha ya tiene bloques editables (padrón del modal de puntos) ·
⬜ textarea 2 líneas con placeholder · ⬜ guardado vía GuestsService existente (sin
endpoint nuevo si el update ya pasa campos libres) · ⬜ línea readonly en detalle check-in ·
⬜ typecheck + QA manual.

## Fase D — Cierre

### T11: Gates + deploy + QA prod
Validaciones: ⬜ analyze 0 · ⬜ bun test backend + vitest front completos · ⬜ typecheck b/f +
build · ⬜ QA: campaña real a segmento de prueba (verificar llegada en email_queue), birthday
con huésped de prueba, preferencia persistida · ⬜ docs: proposal/specs marcados y memoria de
session si hay learnings.

## Dependencias

T1→T2→T3→T4→T5 (campañas en cadena) · T6/T7 paralelos · T8 tras T6+T7 · T9→T10 · T11 al final.
