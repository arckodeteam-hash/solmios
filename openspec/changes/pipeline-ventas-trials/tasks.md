# pipeline-ventas-trials — Tasks

> Prod 2026-09-10: 0 leads del formulario, 19 trials (15 vencidos en `trialing`), 5 hoteles que
> cargaron habitaciones y nadie llamó, 7 que nunca entraron. Sin aviso interno al registrarse, sin
> extender trial, sin WhatsApp en la landing. Evidencia en `proposal.md` y
> `docs/analisis-leads-ventas-2026-09-10.md`.
>
> Reglas del repo que aplican: sin SQL crudo (repos `OrmRepository<T>`), sin import entre módulos
> (connector en `src/connectors/`), `validateSchema` en todo POST/PUT, `requireUserType('admin')`
> en todo `/api/admin/*`, campos nuevos declarados en `orm.define` (anti-patrón de descarte
> silencioso). `arckode analyze` en 0 es gate.

## Fase A

### 1. Modelo y lectura del pipeline (REQ-PIPE-01, 02, 03)

- [x] 1.1 `sales-leads/model.ts`: modelo `SalesProspects` (tabla `sales_prospects`) con `hotelId`,
      `leadId`, `nextStepAt`, `nextStepNote`, `assignedTo`, `contactedAt`, `lostAt`, `lostReason`,
      `notes`, `sequenceSent` (json), timestamps. Índices en `hotelId` y `leadId`.
      **Aceptación**: `RUN_MIGRATE=1` crea la tabla en SQLite y PG; test que escribe y lee TODOS los
      campos (protege del descarte silencioso del ORM).
- [x] 1.2 `sales-leads/usecases/pipeline.ts`: `buildPipeline(deps)` con repos inyectados de
      `Subscriptions`, `Hotels`, `Rooms`, `RoomRates`, `ChannelConfig`, `Reservations`, `Auditlog`,
      `SalesLeads`, `SalesProspects`. Calcula etapa, señales, calor y orden.
      **Aceptación**: tests unitarios con repos en memoria que cubren las 6 etapas, los 2 ejemplos de
      calor del spec (warm=4, hot=7) y el orden (vencido → calor → daysLeft). Sin SQL.
- [x] 1.3 `GET /api/admin/sales-pipeline` en `sales-leads/index.ts` (append-only).
      **Aceptación**: test de ruta: `merchant` → 403; respuesta con `whatsappUrl` en E.164
      (`809-555-0000` → `https://wa.me/18095550000`).
- [x] 1.4 `PUT /api/admin/sales-pipeline/:key` con `UpdateProspectSchema` (validateSchema), upsert,
      `lostReason` ⇒ `lostAt`, escritura en `audit_log`.
      **Aceptación**: test: PUT parcial no borra los otros campos; `lostReason` sin `lostAt` setea
      `lostAt`; motivo fuera del enum → 400; queda fila en `audit_log`.

### 2. Aviso inmediato al alta (REQ-PIPE-04)

- [x] 2.1 `subscriptions` expone socket `onHotelSignedUp(hotel, owner, planId)`; connector
      `src/connectors/subscriptions-sales-alert.ts` lo une a `sales-leads.notifySignup()`.
      **Aceptación**: `arckode analyze` 0 violaciones (sin import cruzado).
- [x] 2.2 `sales-leads/usecases/emails.ts`: `buildSignupAlertEmail` con `wa.me` + texto prellenado +
      link a `/admin/leads-ventas`. Best-effort (el encolado vive en `usecases/signup-alert.ts`).
      **Aceptación**: test de `signup`: al terminar hay `email_queue` con
      `relatedType='sales-pipeline:signup'` y `relatedId=hotelId`; con el sender roto el alta sigue
      devolviendo 200.

### 3. Extender trial (REQ-PIPE-05)

- [x] 3.1 `POST /api/admin/subscriptions/:hotelId/extend-trial {days}` en `admin` (delega a
      `subscriptions.extendTrial()` vía connector existente o nuevo).
      **Aceptación**: test: vencido hace 5 días + 7 → `trialEndsAt = now+7d`, `status='trialing'`,
      `trialReminderSentAt` y `trialExpiredEmailSentAt` en null; `days: 31` → 400; `merchant` → 403;
      fila en `audit_log`.
      **Solo aplica a PRUEBAS**: `status ∈ {trialing, expired}` y sin `stripeSubscriptionId`. Una
      sub `active`/`past_due`/`suspended`/`canceled` (o `expired` que ya fue paga) → 409 sin tocar
      la fila; para esas están reactivar y condiciones especiales. `days` es entero JSON:
      `"7"` (string) y `7.5` → 400.
- [x] 3.2 Plantilla `trial_extended` en `seed-platform-email-templates.ts` + `PlatformEmailEvent` +
      etiquetas del frontend (`PLATFORM_EMAIL_EVENTS`/`LABELS`).
      **Aceptación**: seed idempotente inserta 1 fila nueva; `/admin/email-templates` la lista como
      "Trial extendido"; el extend encola `platform_email:trial_extended`.

### 4. Vista del pipeline (REQ-PIPE-06)

- [x] 4.1 `frontend/src/services/SalesPipeline.service.ts` + tipos en `types/`.
- [x] 4.2 Reescribir `pages/super-admin/leads-ventas.vue`: bloque "Vencen hoy", filtros
      (etapa/calor), buscador, fila con contacto (WhatsApp/Email/Llamar), chips de señales, badge de
      calor, días restantes, próximo paso inline, acciones Extender (7/15) · Contactado · Perdido
      (motivo obligatorio). Cargar `solmios-ui` antes de escribir markup.
      **Aceptación**: `bun run typecheck`; QA en navegador con la SQLite local (seed de 3 hoteles en
      etapas distintas); "Perdido" sin motivo no dispara petición (Network); `nextStepAt` ayer →
      aparece en "Vencen hoy".
      - [ ] 4.2.1 Screenshot de la vista adjunto al issue (screenshots en evidencia LoopKit,
            pendiente adjuntar a #147/#148).
- [x] 4.3 Menú: "Leads de Ventas" pasa a llamarse "Pipeline de ventas" (`SuperAdminLayout.vue`, ruta
      igual).

### 5. WhatsApp en la landing (REQ-PIPE-07)

- [x] 5.1 `GET /api/public/platform-contact` → `{ whatsappUrl | null }` desde
      `configuration('plataforma').supportPhone` (usa `shared/utils/platform-identity.ts` +
      `shared/utils/phone-e164.ts`).
      **Aceptación**: test: `809-555-0000` → `https://wa.me/18095550000?text=...`; vacío → `null`.
- [x] 5.2 Botón flotante en `pages/landing/index.vue` solo si hay URL.
      **Aceptación**: sin número el DOM no tiene el botón.
      - [ ] 5.2.1 Screenshot con y sin número adjunto al issue (screenshots en evidencia LoopKit,
            pendiente adjuntar a #147/#148).

### 6. Cierre de A

- [ ] 6.1 `cd backend && bun run typecheck && bun test && arckode analyze` (0) ·
      `cd frontend && bun run typecheck && bun run build`.
- [ ] 6.2 Deploy + en prod: los 15 trials vencidos aparecen en etapa `expired`; el equipo marca los 5
      con habitaciones como "contactado" o los extiende. **Aceptación**: `GET /api/admin/sales-pipeline`
      en prod devuelve ≥ 17 filas con `signals` no nulos.
- [ ] 6.3 `CLAUDE.md`: sección "Pipeline de ventas" (etapas, calor, dónde vive cada cosa).

## Fase B

### 7. Secuencia de activación (REQ-PIPE-08)

- [ ] 7.1 4 plantillas nuevas en el seed (`activation_no_rooms`, `activation_no_rates`,
      `activation_no_channel`, `trial_offer`) + tipos + etiquetas.
      **Aceptación**: seed idempotente; las 4 visibles en `/admin/email-templates`.
- [ ] 7.2 `shared/usecases/activation-sequence-cron.ts` (diario) con dedup en
      `sales_prospects.sequenceSent` y pausa si `contactedAt` < 2 días.
      **Aceptación**: tests: cada regla dispara su evento; máximo 1 correo por hotel por corrida;
      dedup por evento; hotel contactado ayer → 0 correos.
- [ ] 7.3 Registro del cron en `composition-root.ts`.

### 8. Rescate de trial vencido (REQ-PIPE-09)

- [ ] 8.1 Plantillas `trial_rescue_1`, `trial_rescue_2`.
- [ ] 8.2 En el mismo cron: +2 d y +7 d correos; +14 d sin actividad ni contacto → `lostAt`,
      `lostReason='no_response'`. Extender trial reinicia (`sequenceSent` se limpia de los `rescue`).
      **Aceptación**: tests de los 3 umbrales y del reinicio.

### 9. Embudo (REQ-PIPE-10)

- [ ] 9.1 `GET /api/admin/sales-pipeline/funnel?weeks=8`.
      **Aceptación**: test con fixture (10 altas, 4 activadas, 1 pagando) → `40%` / `10%`.
- [ ] 9.2 Tarjeta "Embudo (8 semanas)" en el dashboard del super-admin (cargar `dataviz` antes).
      **Aceptación**: screenshot; los números coinciden con el endpoint.

### 10. Cierre de B

- [ ] 10.1 Gates (mismos que 6.1) + deploy.
- [ ] 10.2 Tras 4 semanas en prod: comparar `paying/registered` contra el 5–10% de partida
      (dato 2026-09-10: 1–2 de 19). Registrar en `docs/analisis-leads-ventas-2026-09-10.md`.
