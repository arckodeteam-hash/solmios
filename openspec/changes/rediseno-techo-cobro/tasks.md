# Tasks — Rediseño del techo de cobro

Verificado el 2026-08-20 contra el diff `6e3bf5c788d9ba8c`. Todas las puertas fueron **reproducidas
ejecutando** contra `PaymentRequestsService` real, no inferidas de la lectura.

Orden: RTC-0 primero (dejar de sangrar), después el rediseño, después el backfill.

---

## RTC-0 — Contención inmediata 🔴

Mientras el rediseño no esté, estas cuatro puertas están abiertas en el código actual.

- [ ] 0.1 **P3** — `backend/src/modules/payment-requests/service.ts:169`: el único guard de
      `createCheckout` es `if (pr.status === 'paid')`. `cancelled` y `expired` pasan y emiten una
      sesión viva que `charge-ceiling.ts:58` no cuenta (filtra `r.status === 'pending'`) y que
      `stripe-webhook.ts:106` liquida igual (sólo saltea `paid`).
      Medido: `checkout` sobre fila cancelada + `checkout` del segundo cobro = dos sesiones vivas,
      **$600 sobre un saldo de $300**.
- [ ] 0.2 **P4** — `reservas/usecases/crud.ts:230` + `reservas/validators/schema.ts:75`:
      `totalAmount` y `otherCharges` escribibles por `PUT /api/reservas/:id`. Inflar 500→5000,
      emitir dos links de $300 con sesión viva, volver a 500 → **$600 open sobre $300**. Mismo
      camino por `addons.ts:88` (`deleteAddon` baja el cobrable sin tocar Stripe).
- [ ] 0.3 **P5** — `update-request.ts:74`: `releaseSession(previous, {allowPaid: nextStatus === 'paid'})`.
      Un `PUT {status:'paid'}` manual sobre un `pending` cuya sesión ya fue abonada no corta con 409,
      y el webhook posterior descarta la liquidación entera (`if (pr.status === 'paid') return null`):
      sin fila en `payments`, sin cargo de folio, sin bump de `deposit`, sin audit. `paidForReservation`
      queda en 0 y el techo autoriza un segundo link por el mismo saldo.
- [ ] 0.4 **P6** — `shared/usecases/auto-payment-request.ts:22`: crea filas `pending` con `orm.create`
      directo, sin `assertChargeableAmount`, sin `withLock(chargeLockKey)` y sin
      `assertCeilingAfterCommit` — las tres capas que `service.ts:114-128` declara obligatorias. Su
      guard de duplicados (`:20`) consulta `findMany('PaymentRequests', {reservationId})` **sin
      `hotelId`**.
- [ ] 0.5 `reservas/usecases/crud.ts:305` — `deleteReservation` no expira las sesiones de sus
      `payment_requests` pendientes. Al cobrarse, `stripe-webhook.ts:368` no encuentra la reserva y
      sale sin aplicar, pero `recordStripePayment` (`:141`) ya asentó la plata → cobro huérfano.

## RTC-1 — La verdad de qué está abierto 🔴

- [ ] 1.1 Decidir la fuente: consultar a Stripe las sesiones abiertas de la reserva, o mantener una
      tabla de sesiones vivas con ciclo propio (alta al emitir, baja por webhook o expiración
      explícita). Trade-off a resolver: latencia y rate limits del proveedor contra el riesgo de que
      una tabla propia vuelva a desincronizarse — que es exactamente el bug que estamos cerrando.
- [ ] 1.2 `committedPending` deja de derivarse de `r.status === 'pending'`. Una fila de
      `payment_requests` deja de ser el registro de una sesión.
- [ ] 1.3 Toda salida de una fila del conjunto "cobrable" expira su sesión, por construcción y no por
      enumeración de casos. Hoy `releaseSession` tiene 0 hits fuera de `update-request.ts` y
      `delete-request.ts` (grep sobre todo `src`).

## RTC-2 — Un solo portón de entrada 🟡

- [ ] 2.1 Un único camino de creación de cobro, con techo + lock + verificación post-commit. Que sea
      imposible crear una fila cobrable sin pasar por ahí (hoy `auto-payment-request.ts` entra por la
      ventana).
- [ ] 2.2 Revisar el resto del repo por el mismo patrón: cualquier `orm.create('PaymentRequests')`
      fuera del portón.

## RTC-3 — El balance deja de moverse libremente 🟡

- [ ] 3.1 Bajar `totalAmount`/`otherCharges`/addons con sesiones vivas: o revalida y expira lo que
      sobra, o se rechaza mientras existan. Hoy no hace ninguna de las dos.
- [ ] 3.2 `charge-ceiling.ts:23-24` documenta sólo el lado izquierdo de la desigualdad. Que el
      comentario describa el invariante completo, o que no prometa lo que no cumple.

## RTC-4 — Verificación de la propiedad, no de los casos 🔴

Esto es lo que faltó las cuatro veces: había test por puerta, y aparecía la puerta siguiente.

- [ ] 4.1 Test que recorra secuencias de operaciones (crear cobro · cancelar · cambiar importe ·
      editar la reserva · borrar addon · marcar `paid` a mano · borrar la reserva · disparar webhook)
      y afirme tras cada secuencia que **la suma de lo cobrable por sesiones vivas nunca supera el
      saldo**. Property-based o tabla exhaustiva de secuencias cortas. El criterio: que el test
      **encuentre** puertas nuevas, no que enumere las conocidas.
- [ ] 4.2 Que la prueba corra contra el service real con repos de verdad, no contra dobles. Hoy todo
      el flujo de Stripe está detrás de stubs y `paidForReservation` nunca se ejerció contra una DB:
      los nombres de modelo y campos se cotejaron a mano contra los `orm.define`, pero nadie los
      corrió. Patrón disponible: `bookingengine/tests/migrate-public-bookings.test.ts:22` monta
      `SqliteAdapter(':memory:')`.

## RTC-5 — Deuda de datos 🟡

- [ ] 5.1 **Backfill de `payments.reservationId`.** `migrate-db.ts:1203` dice que de las filas viejas
      "no se puede reconstruir a qué reserva pertenecían" y es **falso**:
      `shared/usecases/charge-reschedule-diff.ts:44` ya escribía `metadata:{reservationId,
      source:'reschedule'}` en esas mismas filas, y esa línea no cambió en el diff.
      `payments.metadata` es TEXT (`migrate-db.ts:904`). En prod PG los cobros de reprogramación
      anteriores siguen invisibles para `paidForReservation` y el techo los autoriza a recobrar.
- [ ] 5.2 `reservas/usecases/sync-pending-after-payment.ts:65` — el guard
      `if (!row?.folioId && !row?.invoiceId) return null` corta **antes** de mirar `reservationId`.
      Toda la plomería del vínculo directo (`MoneyRowRef.reservationId`, `connectors/payments-reservas.ts:38`,
      `money-port.ts` que dice "gana el vínculo DIRECTO") es código muerto en esa ruta. Ejecutado:
      fila `{hotelId, reservationId}` → `null`, cero UPDATE. `reservations.pendingAmount` queda
      inflada tras un cobro de reprogramación en efectivo o tarjeta.
- [ ] 5.3 Test de la migración del esquema: `migrate-db.ts:1206` (`addColumnIfMissing`) y `:1207`
      (índice) no tienen ninguno, y ningún test importa `PaymentModel` — el anti-patrón ORM
      `allowedFields` del `CLAUDE.md` (6 casos históricos) queda descubierto porque los dobles
      aceptan cualquier campo.

## RTC-6 — Que el gate pueda ver este tipo de bug 🟡

- [ ] 6.1 `commands.env:7` tiene `LOOPKIT_ENFORCE=0`: el gate **reporta pero no bloquea**.
- [ ] 6.2 `state/task.json` tomó como base un commit de **stash** (`core/lk:117`,
      `BASE=$(git stash create)`) por segunda vez en la sesión. Con base `fea4bd99` el diff medido
      cubrió **63 de 128 rutas**: 68 archivos / 2398 líneas / 61 marcas de deuda fuera de la
      medición, incluidos `payments/model.ts` (la columna nueva) y `charge-reschedule-diff.ts` (su
      único escritor). D10, D11 y `secret_hits=0` describieron el 49% del cambio.
- [ ] 6.3 `RUBRICA.md:31` dice "D8 binaria 100 o 0" y `verify.sh:194` publica 80 proporcional: el
      documento y la herramienta dan números distintos para la misma corrida.
- [ ] 6.4 El kit de LoopKit vive **fuera del repo, sin VCS ni backups**: las ediciones a
      `gate.py`/`verify.sh`/`commands.env` no entran al diff, ni al hash, ni a la auditoría. El
      builder lo editó cuatro veces en esta sesión y no hay forma de auditar qué cambió en cada una.
      Versionarlo.

---

## Cerrado en el intento anterior — no re-litigar

Verificado por mutación (se borró el código y murieron tests), no por leer comentarios:

- `assertCeilingAfterCommit` ya no se puede descablear en silencio: borrar `service.ts:128` mata
  `tests/ceiling-bypass.test.ts:229`; borrar la gemela de `update-request.ts:88-92` mata `:236`.
  En la ronda previa se borraba entera y 74/74 seguían verdes.
- P1 y P2 (puntero escribible, baja sólo por `status`), con control negativo.
- Lock unificado contra `shared/utils/async-lock` · `PlanCatalogService` con sus 3 consumidores ·
  tenant único en `createCheckout` · `combinePaid` partiendo `deposit` de `payments`.
- Infraestructura: la suite gateada ya no corre con las claves reales del `.env` (`commands.env:24`
  usa `bun run test`); `ai-gerente/tests/service.test.ts:21-29` ya no sale a internet; `verify.sh:30-37`
  avisa fuerte si cae al fallback de base.
