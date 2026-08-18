# Tasks — crm-integracion-real

> Orden por dependencia. Cada tarea cierra con sus gates: `bun run analyze` (0 violaciones),
> `bun run typecheck`, `bun test` (backend) / `vue-tsc -b` + `vitest` (frontend).

## Fase 0 — Configuración (base de todo)

> **Corrección tras análisis de código (2026-08-18, protocolo F1)**: el award automático
> al checkout, la idempotencia por `reservationId` y el ratchet de tiers YA EXISTEN
> (`onCheckoutComplete` + `shared/usecases/credit-stay-to-crm.ts` + connector
> `reservas-huespedes`; `usecases/loyalty.ts` con TIERS y ratchet). Lo que falta de eso
> es solo: configurabilidad (hoy `POINTS_PER_CURRENCY_UNIT=10` y THRESHOLDS hardcodeados),
> recompute masivo, award manual con UI, y canje con propósito.

- [ ] T1: `crm/usecases/loyalty-config.ts` — leer/validar `configuration('crm_loyalty')`
  con defaults `{ enabled, pointsPerNight: 10, pointValue: 1, tiers: { silver: 5, gold: 15 } }`
  (D5). Tests: defaults sin key, shape inválido → defaults, flag false.
- [ ] T2: Tab CRM en `/panel/settings` — editar ratio, pointValue, tiers y flag
  (persistir como objeto, no array — ver mem electronic_invoicing).

## Fase 1 — Otorgar (el ciclo arranca)

- [x] T3: ~~reservationId~~ — YA EXISTE en el modelo (crm/model.ts:9).
- [x] T4: ~~idempotencia~~ — YA EXISTE (service.ts:63 `yaAcreditada`).
- [ ] T5: Botón "Otorgar puntos" en ficha de huésped (`guests/index.vue`) espejando el
  canje (form puntos + nota, permiso guests:edit).
- [ ] T6: SOLO el endpoint masivo `POST /api/crm/tiers/recompute` (guests:edit) — el
  recompute individual y el ratchet YA EXISTEN (`checkTierUpgrade` + `nextTier`).

## Fase 2 — Connector checkout

- [x] T7: ~~connector~~ — YA EXISTE (`connectors/reservas-huespedes.ts` + `credit-stay-to-crm`),
  fire-and-forget e idempotente. Solo se le agrega el chequeo del flag `crm_loyalty.enabled`.
- [x] T8: ~~QA local~~ — cubierto por tests existentes del connector.

## Fase 3 — Canje → promo code (el ciclo cierra)

- [ ] T9: `redeemPoints` extendido: transacción debit+redeem+`promo-codes` create (D1),
  código `POINTS-XXXXXX` single-use con expiración de la config, respuesta `{ code, discountValue }`.
  Tests: canje completo, sin balance (422 sin efectos), fallo promo → rollback.
- [ ] T10: Ficha de huésped — mostrar código generado con copiar al portapapeles.

## Fase 4 — Cupones consolidados (matar la duplicación)

- [ ] T11: Backend — handlers de `/api/crm/coupons*` → 410 con puntero (D6). Actualizar
  tests del módulo al contrato nuevo. `Crm.service.ts` front pierde métodos coupons.
- [ ] T12: Vista CRM — sección Cupones sobre `PromoCode.service.ts` (listar/crear) +
  validador vía `/api/promo-codes/preview` + link a `/panel/config/promociones`.
- [ ] T13: Verificación end-to-end: cupón creado en CRM → aplicado en reserva del motor
  público (widget o landing) → `totalBreakdown.promoDiscount` correcto.

## Fase 5 — Segmentos con salida

- [ ] T14: `GET /api/crm/segments/:id/export` (text/csv, guests:view) con columnas del
  spec. Tests: con miembros, vacío.
- [ ] T15: Connector `crm-huespedes.ts` — guests filtrable por ids de segmento (D7).
- [ ] T16: Vista CRM: botones "Ver en Huéspedes" + "Exportar CSV" por segmento.
- [ ] T17: `/panel/guests?segment=` — chip de filtro activo + limpiar.

## Fase 6 — Cierre

- [ ] T18: Gates completos (analyze/typecheck/tests b+f/build) + deploy a staging +
  QA funcional en prod de los 3 flujos (ganar/canjear/cupón-aplicado).
- [ ] T19: Documentar en CLAUDE.md: config `crm_loyalty`, connector, coupons deprecados.
