# Design — crm-integracion-real

## Decisiones técnicas

### D1 — Canje→promo: una transacción, tres efectos

`redeemPoints` hace debit + transacción redeem + promo code. Si el ORM lo permite
(`orm.transaction` como `checkin.ts`), todo adentro; si el promo-create falla, rollback del
debit. Los tres repos son del mismo orm → transacción única es viable. El código generado:
`POINTS-` + 6 chars base32 (colisión → retry). `promo_codes` model ya soporta
`type:'fixed'`, single-use y expira — no extender el modelo.

### D2 — Idempotencia del award por reservationId

`loyalty_transactions.reservationId` (columna nueva vía ormMigrate ADD COLUMN). Antes de
insertar: `findMany({ hotelId, reservationId, type: 'earn' })` → si existe, skip. Barato
(la tabla es chica) y sin unique index físico (la col es nullable para earns manuales).

### D3 — Connector checkout→CRM, fire-and-forget

`connectors/reservas-crm.ts` escucha el evento/hook de checkout de reservas (mismo patrón
que `reservas-deposits.ts`). Dentro: award idempotente + recompute de tier del huésped.
Try/catch total: fallo del CRM **jamás** rompe el checkout; se loguea y queda para el
recompute masivo. Flag `crm_loyalty.enabled` chequeado server-side en cada corrida.

### D4 — Tiers con ratchet

Recompute = solo sube (gold no baja a silver si config cambia). Regla: `tierActual en
orden bronze<silver<gold`; asigno el mayor entre actual y el que corresponde por noches.
Noches acumuladas = suma de noches de reservas checked-out del huésped (query existente
del LTV, mismo criterio — consistencia de dato).

### D5 — Config en configuration KV, no tabla nueva

`crm_loyalty` como objeto JSON en `configuration` (patrón `taxes`/`electronic_invoicing`).
Defaults en código (un solo lugar, `crm/usecases/loyalty-config.ts`) para hoteles sin
config. UI de edición en `/panel/settings` tab CRM (nueva) — fuera del panel CRM (config
no es operación diaria).

### D6 — Deprecación 410, no DELETE de rutas

`index.ts` es append-only (regla del proyecto): los handlers de coupons se reescriben a
constantes 410 con puntero a `/api/promo-codes`. El frontend nunca más los llama. Tabla
`coupons` sin drop: 0 filas, rollback gratis.

### D7 — Segment filter en guests sin duplicar lógica

`getGuestsInSegment` (crm) evalúa rules server-side. Para el filtro en `/panel/guests`,
el backend de huespedes recibe los ids resueltos por el CRM via connector
`crm-huespedes.ts` (el módulo huespedes NO importa crm — regla de connectors). Export CSV
arma las filas en el usecase (mismo array de miembros).

## Riesgos y mitigaciones

| Riesgo | Mitigación |
|---|---|
| Award rompe checkout | Connector fire-and-forget + try/catch + flag apagable sin deploy |
| Puntos otorgados doble (retry) | Idempotencia por reservationId (D2) |
| Promo code huérfano si el debit falla | Transacción única (D1) |
| Config inválida tira el módulo | Defaults + validación de shape al leer (NaN → default) |
| Consumers viejos de coupons | 410 explícito, no silent break (D6) |
