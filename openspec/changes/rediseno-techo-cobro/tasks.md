# Tasks — Rediseño del techo de cobro

Verificado el 2026-08-20 contra el diff `6e3bf5c788d9ba8c`. Todas las puertas fueron **reproducidas
ejecutando** contra `PaymentRequestsService` real, no inferidas de la lectura.

Orden: RTC-0 primero (dejar de sangrar), después el rediseño, después el backfill.

---

## RTC-0 — Contención inmediata 🔴

Mientras el rediseño no esté, estas puertas estaban abiertas en el código actual.

**Re-verificado ejecutando el 2026-08-21** con `tests/ceiling-property.test.ts` + `ceiling-world.ts`
(SQLite in-memory, ORM y repos reales). Tres de las cinco ya estaban cerradas por el trabajo previo
de esta rama: el enunciado de abajo describe el estado del 2026-08-20, no el de hoy.

**Auditoría de cierre (2026-08-21, corrida posterior)**: las cinco se volvieron a comprobar UNA POR
UNA con el test de propiedad como juez, y cada cierre se validó **por mutación** — neutralizar el
guard tiene que resucitar la violación, si no el test no está probando nada.

⚠️ **La tabla anterior de esta sección no reproducía** (12 / 42 / 1 / 11 / 1). Los números de abajo
se volvieron a MEDIR el 2026-08-21 (tarde) con el alfabeto de **22 operaciones** de RTC-7 —el viejo
tenía 19—, así que no son comparables con los anteriores: el mismo guard neutralizado cae en más
secuencias porque hay más secuencias. Cada celda es una corrida real, mutación aplicada y
`bun test src/modules/payment-requests/tests/ceiling-property.test.ts` de por medio; el desglose es
por profundidad porque el total agregado escondía en qué nivel aparece la puerta.

| Puerta | Mutación aplicada | Secuencias que caen (prof. 1 / 2 / 3) |
|---|---|---|
| 0.1 | `checkoutBlockedReason` deja de mirar el estado | 0 / 0 / 21 — y cae además el control negativo "revivir un cobro cancelado vuelve a emitir link" |
| 0.2 | `clampRequestsToCeiling` devuelve 0 sin hacer nada | 5 / 148 / 3.594 |
| 0.3 | `releaseSession(…, {allowPaid: dto.status === 'paid'})` | 0 / 0 / 1 |
| 0.4 | hook con `orm.create` directo **+** sin la revalidación del techo en la emisión | 0 / 1 / 38 |
| 0.5 | `assertNoSettledCharge` sin el corte por dinero | 0 / 0 / 1 |
| 7.1 | el clamp del `PUT` vuelve a condicionarse a `totalAmount`/`otherCharges` | 1 / 29 / 696 |
| 7.2 | `createAddon` sin `ceilingGuard` | 1 / 29 / 694 |
| 7.3 | `syncPendingAfterPayment` sin `ceilingGuard` | 1 / 31 / 778 |

La afirmación previa de que la doble mutación de 0.4 "queda verde" **no se reproduce**: con el
alfabeto de hoy cae en 39 secuencias (1 en profundidad 2 + 38 en profundidad 3), entre ellas
`requerir-pago → auto-cobro-alta → emitir-link` = $700 sobre $400.

Sin mutar: **0 violaciones** en profundidad 1-3 (22 + 484 + 10.648 = **11.154** secuencias, ~26 s)
y **0 violaciones en profundidad 4** (234.256 secuencias, 621 s, corrida del 2026-08-21 con
`CEILING_DEPTH_ONLY=4 CEILING_TIMEOUT_MS=2400000`). La primera corrida de profundidad 4 de ese día
**no terminó** —`bun test` la cortó a los 600 s— y por eso el timeout dejó de ser una constante: un
nivel que se corta no es un nivel verde.

- [x] 0.1 **P3** — `backend/src/modules/payment-requests/service.ts:169`: el único guard de
      `createCheckout` es `if (pr.status === 'paid')`. `cancelled` y `expired` pasan y emiten una
      sesión viva que `charge-ceiling.ts:58` no cuenta (filtra `r.status === 'pending'`) y que
      `stripe-webhook.ts:106` liquida igual (sólo saltea `paid`).
      Medido: `checkout` sobre fila cancelada + `checkout` del segundo cobro = dos sesiones vivas,
      **$600 sobre un saldo de $300**.
      **CERRADA.** `usecases/create-checkout.ts:checkoutBlockedReason` concentra las precondiciones
      de la emisión y devuelve 409 para todo estado que no sea `pending` (503 sin Stripe, 400 si ya
      está pagado). Reproducida antes del fix por la propiedad del techo en 12 secuencias, entre
      ellas `requerir-pago → cancelar-cobro → emitir-link → requerir-pago` = **$800 sobre $400**.
      Control negativo: revivir el cobro (`PUT {status:'pending'}`) vuelve a emitir link.
      Mutación verificada: neutralizar el guard resucita las 12 secuencias.
- [x] 0.2 **P4** — `reservas/usecases/crud.ts:230` + `reservas/validators/schema.ts:75`:
      `totalAmount` y `otherCharges` escribibles por `PUT /api/reservas/:id`. Inflar 500→5000,
      emitir dos links de $300 con sesión viva, volver a 500 → **$600 open sobre $300**. Mismo
      camino por `addons.ts:88` (`deleteAddon` baja el cobrable sin tocar Stripe).
      **YA ESTABA CERRADA** por `usecases/clamp-to-ceiling.ts` + connector `reservas-payment-requests`.
      Verificado ejecutando: las secuencias `… → desinflar-total`, `… → bajar-otros-cargos` y
      `… → borrar-extra` de la prueba de propiedad no dejan exposición por encima del saldo.
- [x] 0.3 **P5** — `update-request.ts:74`: `releaseSession(previous, {allowPaid: nextStatus === 'paid'})`.
      Un `PUT {status:'paid'}` manual sobre un `pending` cuya sesión ya fue abonada no corta con 409,
      y el webhook posterior descarta la liquidación entera (`if (pr.status === 'paid') return null`):
      sin fila en `payments`, sin cargo de folio, sin bump de `deposit`, sin audit. `paidForReservation`
      queda en 0 y el techo autoriza un segundo link por el mismo saldo.
      **YA ESTABA CERRADA** (`update-request.ts`, COR-C: `allowPaid` siempre `false`). Verificado
      ejecutando contra el service real: `PUT {status:'paid'}` sobre un `pending` con la sesión ya
      abonada corta con `ConflictError` y la fila queda en `pending`.
- [x] 0.4 **P6** — `shared/usecases/auto-payment-request.ts:22`: crea filas `pending` con `orm.create`
      directo, sin `assertChargeableAmount`, sin `withLock(chargeLockKey)` y sin
      `assertCeilingAfterCommit` — las tres capas que `service.ts:114-128` declara obligatorias. Su
      guard de duplicados (`:20`) consulta `findMany('PaymentRequests', {reservationId})` **sin
      `hotelId`**.
      **YA ESTABA CERRADA**: `handleReservationCreated` recibe el `PaymentRequestsCreator` del
      connector y llama a `PaymentRequestsService.create` (techo + lock + `assertCeilingAfterCommit`);
      el dedup lo hace el propio techo. Verificado ejecutando: dos disparos seguidos del hook dejan
      **una** sola fila `pending`.
      **Ahora también bajo el juez**: el hook entró al alfabeto como `auto-cobro-alta`
      (`tests/ceiling-property.test.ts`), sobre el service REAL. La mutación de una sola capa NO la
      tumba, y eso es un resultado, no una omisión: está cerrada DOS veces. La fila creada por la
      ventana no es exposición mientras no tenga sesión, y `service.createCheckout:177`
      (`assertChargeableAmount` con `excludeRequestId`) niega la emisión. Hacen falta las dos
      mutaciones juntas para que aparezcan las 11 secuencias
      (`requerir-pago → auto-cobro-alta → emitir-link` = $700 sobre $400).
      Para que el juez pudiera llegar hasta ahí hubo que tapar un punto ciego suyo: las operaciones
      del panel sólo alcanzaban las filas creadas por el propio test, así que una fila entrada por
      la ventana era intocable. `adoptarFilasNuevas()` barre `payment_requests` después de cada
      paso — el panel lista la tabla, no un array del test.
- [x] 0.5 `reservas/usecases/crud.ts:305` — `deleteReservation` no expira las sesiones de sus
      `payment_requests` pendientes. Al cobrarse, `stripe-webhook.ts:368` no encuentra la reserva y
      sale sin aplicar, pero `recordStripePayment` (`:141`) ya asentó la plata → cobro huérfano.
      El enunciado quedó **parcialmente obsoleto** —`releaseRequestsOfReservation` ya expiraba los
      `pending`— pero el cobro huérfano seguía saliendo por **dos ventanas** que la prueba de
      conservación encontró sola, y las dos están cerradas ahora en `clamp-to-ceiling.ts`:
      · el huésped ya abonó y el webhook no llegó: la fila sigue `pending`, `expireSessionQuietly`
        devuelve `'paid'` y el borrado seguía derecho → ahora `releaseRequestsOfReservation` corta
        con 409 (`abortIfPaid`) y la reserva NO se borra;
      · el webhook YA aterrizó: la fila quedó `paid`, `pendingRowsOf` no la ve y el borrado seguía
        derecho → ahora `assertNoSettledCharge` corta con 409 ("anular ≠ borrar").
      Medido antes del fix: $400 asentados en `payments` sin folio, sin factura y sin reserva.
      Control negativo: una reserva sin cobros abonados se sigue borrando.
      **Faltaba la mitad del cierre y el test la denunció**: `assertNoSettledCharge` pregunta por
      `payments{hotelId, reservationId}`, y ese vínculo lo escribe
      `connectors/payment-requests-payments.ts` — pero el banco de pruebas tenía una COPIA A MANO de
      ese mapeo que no se actualizó, así que en el mundo del test el asiento nacía sin
      `reservationId` y el guard no lo encontraba. La secuencia
      `requerir-pago → huesped-paga → webhook-cobro → borrar-reserva` seguía en rojo.
      Arreglado en la raíz, no en el doble: el mapeo cobro → fila de `payments` vive ahora en UN
      solo lugar (`usecases/payment-port.ts:stripeChargeDto`) y lo usan el connector y el test. Un
      campo nuevo entra por las dos rutas a la vez o por ninguna.

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

- [x] 4.1 Test que recorra secuencias de operaciones (crear cobro · cancelar · cambiar importe ·
      editar la reserva · borrar addon · marcar `paid` a mano · borrar la reserva · disparar webhook)
      y afirme tras cada secuencia que **la suma de lo cobrable por sesiones vivas nunca supera el
      saldo**. Property-based o tabla exhaustiva de secuencias cortas. El criterio: que el test
      **encuentre** puertas nuevas, no que enumere las conocidas.
      **HECHO** — `backend/src/modules/payment-requests/tests/ceiling-property.test.ts`. Alfabeto de
      18 operaciones sobre el prefijo "Requerir pago" (crear + emitir), tabla exhaustiva de
      longitudes 1, 2 y 3 = 6.174 secuencias, con la propiedad evaluada **después de cada paso**.
      Dos propiedades, no una:
      · **techo** — Σ(sesiones que Stripe todavía deja pagar) ≤ saldo cobrable;
      · **conservación** — la plata que el huésped ya puso nunca queda sin reserva a la que
        aplicarse, y lo liquidado aparece reconocido por `paidForReservation`.
      La segunda hizo falta porque la primera sólo mira sesiones ABIERTAS: un cobro que ya entró
      sale de esa cuenta, y todo lo que le pase después es invisible para ella.
      Cumplió el criterio: **falló al escribirse** (13 secuencias) y encontró **dos puertas que no
      estaban en esta lista** — ver 0.1 y 0.5. Después encontró una tercera cosa que tampoco estaba
      en la lista: el doble del asiento en `payments` había derivado del connector real (ver 0.5).
      Alfabeto final: **22** operaciones = 22 + 484 + 10.648 = **11.154** secuencias, ~26 s.
      (Fue 19 hasta RTC-7, que sumó `subir-anticipo`, `crear-descuento` y `cobro-en-caja`.)
      **La profundidad es un parámetro, no una constante editada a mano.** La exploración profunda
      se corre sin tocar el archivo:

      ```bash
      CEILING_DEPTH_ONLY=4 bun test src/modules/payment-requests/tests/ceiling-property.test.ts
      ```

      `CEILING_DEPTH=n` corre 1..n; `CEILING_DEPTH_ONLY=n` corre sólo ese nivel; `CEILING_TIMEOUT_MS`
      levanta el techo de tiempo por nivel (600 s por defecto). Por defecto 1..3, que es lo que entra
      en la suite del gate: la combinatoria es 22^n y el nivel 4 son **234.256** secuencias — de
      hecho una copia byte-a-byte del test fijada en `[4]` (`tests/zz-deep.test.ts`) colgaba la suite
      y **fue eliminada**; la herramienta no se perdió, quedó detrás de la variable de entorno.
      ⚠️ El nivel 4 se corrió con el alfabeto VIEJO (19 operaciones, 130.321 secuencias) y dio 0
      violaciones; es el que tumbó la primera versión del guard de 0.5 (miraba
      `payment_requests.status`, y `cancelar-cobro`/`expirar-cobro`/`borrar-cobro` borraban la
      evidencia antes del borrado). Con el alfabeto de 22 se volvió a correr entero el 2026-08-21:
      **0 violaciones** en 234.256 secuencias, 621 s (`CEILING_DEPTH_ONLY=4
      CEILING_TIMEOUT_MS=2400000`). La corrida anterior de ese día se había cortado a los 600 s por
      el timeout de `bun test` — por eso el timeout dejó de ser una constante: un nivel que se corta
      no es un nivel verde, y estaba a punto de anotarse como tal.
- [x] 4.2 Que la prueba corra contra el service real con repos de verdad, no contra dobles. Hoy todo
      el flujo de Stripe está detrás de stubs y `paidForReservation` nunca se ejerció contra una DB:
      los nombres de modelo y campos se cotejaron a mano contra los `orm.define`, pero nadie los
      corrió. Patrón disponible: `bookingengine/tests/migrate-public-bookings.test.ts:22` monta
      `SqliteAdapter(':memory:')`.
      **HECHO** — `tests/ceiling-world.ts`: `SqliteAdapter(':memory:')` + `ORM` + `orm.migrate()`
      sobre los `ModelDefinition` REALES (`registerSharedModels` + los `model.ts` de reservas,
      folios, facturas, payments, payment-gateways, usuarios — no copias) + `OrmRepository` +
      `PaymentRequestsService`, `PaymentEventStore` y los usecases de `reservas` de verdad,
      cableados como lo hacen los connectors. `paidForReservation` corre contra las tres tablas
      (`folios`/`invoices`/`payments`) por primera vez, con un control que lo comprueba.
      Lo único fingido es Stripe, y con un LIBRO de sesiones con estado (`open`/`complete`/
      `expired`), no un stub: es lo que hace medible "lo que el proveedor todavía deja pagar".
      El otro doble —el asiento en `payments`— dejó de ser una copia y pasó a compartir el mapeo
      con el connector de producción (`stripeChargeDto`): un doble que no espeja al connector no es
      evidencia de nada, y ya había derivado una vez (ver 0.5).
      También se sumaron al mundo `Auditlog` y la fila `configuration('automation_config')`, que son
      la precondición del hook del alta (puerta 0.4).

## RTC-5 — Deuda de datos 🟡

- [ ] 5.1 **Backfill de `payments.reservationId`.** `migrate-db.ts:1203` dice que de las filas viejas
      "no se puede reconstruir a qué reserva pertenecían" y es **falso**:
      `shared/usecases/charge-reschedule-diff.ts:44` ya escribía `metadata:{reservationId,
      source:'reschedule'}` en esas mismas filas, y esa línea no cambió en el diff.
      `payments.metadata` es TEXT (`migrate-db.ts:904`). En prod PG los cobros de reprogramación
      anteriores siguen invisibles para `paidForReservation` y el techo los autoriza a recobrar.
- [x] 5.2 `reservas/usecases/sync-pending-after-payment.ts:65` — el guard
      `if (!row?.folioId && !row?.invoiceId) return null` corta **antes** de mirar `reservationId`.
      Toda la plomería del vínculo directo (`MoneyRowRef.reservationId`, `connectors/payments-reservas.ts:38`,
      `money-port.ts` que dice "gana el vínculo DIRECTO") es código muerto en esa ruta. Ejecutado:
      fila `{hotelId, reservationId}` → `null`, cero UPDATE. `reservations.pendingAmount` queda
      inflada tras un cobro de reprogramación en efectivo o tarjeta.
      **YA ESTABA CERRADA** (`sync-pending-after-payment.ts:74`, COR-A: el guard es
      `!folioId && !invoiceId && !reservationId`). Re-verificado ejecutando contra la base real:
      una fila `{hotelId, reservationId}` de $100 sobre la reserva de $400 devuelve `300` y
      **persiste** `reservations.pendingAmount = 300`.
      Cubierta además por `connectors/tests/payments-reservas.test.ts:151` (COR-A), contra dobles.
      **NO la juzga la prueba de propiedad**: sus dos invariantes miran sesiones vivas y plata
      liquidada, no la columna `reservations.pendingAmount`. Meter esa columna como tercera
      propiedad no es gratis —el clamp del techo no la toca a propósito— así que queda anotado como
      lo que es: verificado por código y por su test, no por el juez de secuencias.
- [ ] 5.3 Test de la migración del esquema: `migrate-db.ts:1206` (`addColumnIfMissing`) y `:1207`
      (índice) no tienen ninguno, y ningún test importa `PaymentModel` — el anti-patrón ORM
      `allowedFields` del `CLAUDE.md` (6 casos históricos) queda descubierto porque los dobles
      aceptan cualquier campo.

## RTC-6 — Que el gate pueda ver este tipo de bug 🟡

> El kit NO vive en este repo: `~/.loopkit-home` → `/home/phantom/Documents/proyectos/universal/real/.loopkit`.
> Desde 6.4 tiene git propio: línea base `0b48b6a`, arreglos de RTC-6 en `3680684`.

- [x] 6.1 `LOOPKIT_ENFORCE=0` **no era** el motivo de que nada bloqueara. `lk ship` corre el gate y
      sale 1 pase lo que pase — nunca consultó el flag (`core/lk`, rama `ship)`). Los dos
      bloqueadores que sí lo leen estaban **rotos por ruta** en toda instalación compartida (kit
      fuera del repo) y no evaluaban nada ni con el flag en 1:
      · `adapters/claude/hooks/lk-gate-stop.sh:26` fijaba `LK="$ROOT/.loopkit"` → no encontraba
        `task.json` → `phase` vacía → salía por el `case` ANTES de correr el gate.
      · `adapters/git/pre-push:5` exigía `$ROOT/.loopkit/core/gate.py` → `exit 0` siempre.
      · `adapters/claude/hooks/lk-subagent.sh:41` calculaba el hash con `cwd=$KIT/repos` (no es un
        repo git) y sin `LOOPKIT_STATE`: quedaba `e3b0c44298fc1c14` = sha256(""). **1686 de 1690**
        registros del estado de solmios tenían ese valor → la única prueba de que un auditor corrió
        sobre el diff era basura.
      Los tres arreglados y re-sincronizados a `~/.claude/hooks/`; el pre-push viejo de este repo se
      refrescó solo (`LOOPKIT-HOOK-V2` + `ensure_git_hook`).
      **El flag sigue en 0**, y el motivo está escrito en su `commands.env`: hay otra corrida en
      vuelo sobre este mismo repo y estado, y subirlo a 1 la trabaría en el medio. Costo de
      activarlo, medido: (a) todo turno en BUILD/VERIFY sin `measured.json` + `scorecard.json` +
      registro de subagente sobre el diff actual queda bloqueado; (b) este repo no tiene linter de
      backend (`LINT=""`) → D8=80 → el techo de veredicto pasa a `READY_WITH_RISKS`; (c) la tarea
      abierta hoy tiene base de stash y no cerraría hasta reabrirse con una base válida.
- [x] 6.2 La base era `git stash create` (`core/lk:117`): un commit que YA CONTIENE el árbol y **no
      es ancestro de HEAD**, así que `git diff base` lo cancela. Verificado sobre el estado real:
      `a2ed80ec` y `fea4bd99` son ambos `WIP on main:` y `git merge-base --is-ancestor <b> HEAD`
      falla para los dos. Ahora:
      · sin `--base` la base es **HEAD siempre**; si el árbol venía sucio se avisa que esos cambios
        cuentan como alcance (medir de más, nunca de menos en silencio);
      · `--base` **rechaza con exit 2** todo commit no alcanzable desde HEAD (el árbol vacío sigue
        aceptado: `lk audit` lo usa a propósito);
      · `core/gate.py` (GAT-3) denuncia una base inalcanzable ya escrita en `task.json`, y lo hace
        **antes** de exigir `measured/scorecard` — si la base miente, el resto no importa;
      · `core/verify.sh` ya no se traga el aviso de `gate.py --base` cuando la resolución "funciona".
      Regresión en `test/smoke.sh`: base cancelando el trabajo → diff de 0 líneas vs 7 reales.
- [x] 6.3 Manda la **herramienta**: la proporción es la semántica estricta (un gate que no se puede
      ejecutar no aprueba nada) y fue un fix deliberado; el "binaria 100 o 0" del documento quedó
      viejo. `core/RUBRICA.md` reescrito (fila D8, anti-inflación #3, tabla de veredicto) con la
      fórmula exacta de `verify.sh`. Además `core/gate.py` **ahora exige D8=100 para `READY`** —
      la rúbrica lo pedía desde siempre y nadie lo verificaba. Con un gate en N/V el techo real es
      `READY_WITH_RISKS`. Esto endurece: corridas anteriores con `lint` en N/V y veredicto `READY`
      habrían sido rechazadas.
- [x] 6.4 Kit bajo git propio en su directorio. `0b48b6a` = estado actual tal cual estaba (para que
      los arreglos sean diffeables), `3680684` = RTC-6. `.gitignore` deja fuera `state/` y
      `repos/*/state/` (se reescriben en cada corrida, megas de evidencia) y versiona a propósito
      `repos/*/commands.env`, que es config a mano. Escaneado antes de commitear: sin secretos —
      lo único que matchea es la clave falsa de prueba (`sk-` + relleno) del fixture de
      `test/smoke.sh`, que existe justamente para probar el detector de secretos.

**Verificación del `diff_hash`** (lo pedido: `lk verify` vs `gate.py --hash` con `LOOPKIT_STATE`).
Las dos rutas de cálculo dan lo MISMO cuando se las mide en el mismo instante — en solmios
`52f8b0cb1760e7ea` por las dos vías, y en un repo controlado sin editores concurrentes
`lk verify`, `gate.py --hash` y `lk status` coinciden en `a2cd843f3fb11fe3`. Lo que NO coincide es
el `65dc1b3a458b82de` que dejó escrito el `lk verify` de esta corrida: los otros dos agentes
modificaron 44 archivos de `frontend/` a las 11:52:02 y 3 de `backend/` a las 11:53, con los gates
ya corriendo (arrancaron 11:51:50). El hash caducó **durante** la medición. Eso es el gate
funcionando, no un defecto de herramienta — pero significa que en este repo, con tres agentes
escribiendo a la vez, **ninguna corrida de `lk verify` puede producir evidencia válida**: el código
cambia antes de que termine. Es un problema de coordinación, no de tooling, y sigue abierto.

**Lo que la corrida SÍ mostró**, y antes no se veía: el aviso de base inalcanzable ahora encabeza
la salida de `lk verify` (antes iba a `evidence/base-resolve.txt`, que sólo se imprimía si la
resolución fallaba), y D8 salió 80 con `lint` en N/V — el número que ahora también dice la rúbrica.

**Suite del kit** (`lk selftest`): de 91 ok / 5 fallos a **99 ok / 2 fallos**. Los 2 que quedan son
previos y ajenos a RTC-6: el fixture de `lk audit` espera 3 y 1 archivos, pero el instalador deja
`.gitignore` y `.claude/settings.json` en el repo de prueba y el conteo honesto es 5 y 3.

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

## RTC-7 — Las tres puertas que quedaban (2026-08-21) 🔴

El patrón de las siete apariciones es siempre el mismo: **algo baja el saldo cobrable o sube lo
pagado, y nadie recorta las sesiones vivas**. El juez de RTC-4 no las veía porque su alfabeto no
las contenía — su encabezado prometía "las operaciones que mueven cualquiera de los dos lados de la
desigualdad" y le faltaban tres. Primero se ampliaron las operaciones y se comprobó que el test
**falla** (profundidad 1, tres secuencias, salida literal):

```
[techo] [requerir-pago → subir-anticipo]  tras el paso 2: $400 cobrables en Stripe sobre un saldo de $0
[techo] [requerir-pago → crear-descuento] tras el paso 2: $400 cobrables en Stripe sobre un saldo de $100
[techo] [requerir-pago → cobro-en-caja]   tras el paso 2: $400 cobrables en Stripe sobre un saldo de $0
```

- [x] 7.1 **`reservas/usecases/crud.ts`** — el clamp del `PUT /api/reservas/:id` sólo disparaba con
      `if (dto.totalAmount !== undefined || dto.otherCharges !== undefined)`. `deposit` es escribible
      por el mismo endpoint (`validators/schema.ts:84`) y entra a lo pagado por `combinePaid`
      (`shared/usecases/reservation-paid.ts`): subir el anticipo bajaba el saldo cobrable **sin
      disparar el clamp**. Once líneas más abajo el propio archivo ya decía que
      "`otherCharges`/`totalAmount`/`deposit` mueven el total cobrable" — el código contradecía al
      comentario. **CERRADA**: el hook corre SIEMPRE, sin enumerar campos. Enumerar es la forma del
      bug; el clamp es idempotente y sale en la primera query si no hay cobros `pending`.
- [x] 7.2 **`reservas/controller.ts`** — `createAddon` no recibía `service.addonsCeilingGuard()`; el
      `deleteAddon` de la línea siguiente sí. Un `POST /api/reservations/:id/addons
      {kind:'discount', amount:300}` con permiso `reservations:edit` baja el total cobrable con signo
      (`shared/utils/reservation-balance.ts:40`) sin clamp. **CERRADA**: el alta recibe el MISMO
      guard que la baja (son la misma palanca con distinto signo).
- [x] 7.3 **`payment-requests/usecases/clamp-to-ceiling.ts`** — `clampRequestsToCeiling` tenía **cero
      callers fuera de `reservas`**: se disparaba cuando alguien EDITABA la reserva, nunca cuando
      entraba plata. Cobrar el saldo en caja, por folio o por factura asienta en `payments`, deja el
      saldo en 0 y **dejaba el link vivo**. Es el más ancho de los tres: no es un campo que alguien
      edita, es el flujo normal de cobro del hotel. **CERRADA** en el choke point que ya existía:
      `payments.createPayment` → `onPaymentCreated` → `connectors/payments-reservas` →
      `reservas.syncPendingAfterPayment`, que ahora además recorta. Cubre de una sola vez a TODOS los
      escritores del libro del dinero (folios-payments, facturas-payments, restaurante-payments,
      payment-requests-payments, charge-reschedule-diff y el settlement del checkout).
- [x] 7.4 **`clamp-to-ceiling.ts:186`** — `deps.paidRepos.paymentRepo.findMany({…} as any)`.
      `paidRepos` está documentado en `reservas/usecases/money-port.ts:41-44` como shim de
      compatibilidad **sólo** para `reservation-paid`; usarlo como repo genérico desde otro módulo
      reabría la lectura cruda cross-módulo que se cerró por puerto, con un `as any` para pasar el
      tipado. **CERRADO**: la pregunta la contesta el dueño de la tabla
      (`payments.settledNetOfReservation`, contract 1.2.0) y llega por
      `connectors/payment-requests-money`. Sin connector, preguntar **rompe** (fail-closed por
      construcción, no `?? 0`).
- [x] 7.5 **El alfabeto del juez cubre ahora los dos lados de la desigualdad.** Entraron
      `subir-anticipo` (mueve `deposit` por el `PUT` real), `crear-descuento` (`createAddon` con
      `kind:'discount'`) y `cobro-en-caja` (`PaymentsService.createPayment` REAL, con sus sockets
      reales — el mundo del test monta el módulo `payments` entero, no un doble). El mundo también
      dejó de armar `paidRepos` a mano: usa el puerto de los módulos dueños
      (`buildReservationMoneyPort`), igual que producción.

### Barrido de la cuarta puerta — qué se miró y qué se encontró

Enumerados **todos** los escritores de `payments` (`rg createPayment|recordPayment`) y **todos** los
caminos que tocan `deposit`/`totalAmount`/`otherCharges`/addons:

| Camino | Estado |
|---|---|
| `PUT /api/reservas/:id` (`totalAmount`, `otherCharges`, **`deposit`**) | 7.1 — cerrado, clamp incondicional |
| `POST /addons` (`discount`) · `DELETE /addons/:id` | 7.2 — cerrado, mismo guard en alta y baja |
| `folios.applyPayment` · `facturas.pay` · caja · restaurante · settlement del checkout · `charge-reschedule-diff` · webhook de Stripe | 7.3 — todos pasan por `payments.createPayment`; el clamp cuelga de ahí |
| `reschedule` (`commitReschedule`) | ya tenía clamp (`reschedule.ts:244`, vía `afterCeilingDrop`) |
| `deleteReservation` | ya tenía `releaseRequestsOfReservation` (RTC-0.5) |
| `refundPayment` | pasa por el mismo choke point; una devolución **sube** el saldo, no puede romper el techo |
| check-in / night audit / `post-room-charges` | escriben `folio_charges` y `status`, no el total cobrable de la reserva |
| ingesta OTA (`canales/booking-ingestion`) | una revisión con importe distinto sobre una reserva existente **no se aplica** (`return {created:false}`) |
| `bookingengine` (alta pública) | crea la reserva con `deposit: 0`; el cobro entra por `post-booking-payment` → `payments.createPayment` |

**Encontrado y NO cerrado acá (fuera del invariante de esta tarea)**: `cancel-core.ts:applyCancellation`
cancela la reserva sin tocar `totalAmount`/`deposit`/`otherCharges`, así que el saldo cobrable **no
cambia** y el techo se sigue cumpliendo — pero el link de pago de una reserva **cancelada** queda
vivo y el huésped puede pagarlo. No es una violación de `Σ(sesiones vivas) ≤ saldo`; es una regla de
negocio distinta ("una reserva cancelada no cobra"), y meterla acá sería cambiarle el enunciado a la
propiedad sin decirlo. Queda anotado como hallazgo, sin cerrar.

---

## RTC-8 — `payments` tiene su propia vía de cobro, fuera del techo 🔴

Hallado el 2026-08-21 por **dos auditores independientes**, ambos con probe ejecutable contra
el mundo real del test. Es la **octava aparición** del mismo bug, y la primera que muestra que la
causa no está en `payment-requests`.

```
requerir-pago($400)  → exposición $400 / saldo $400   ok
+ chargeCard($400)   → exposición $800 / saldo $400   ROTO
payments: [{ status: "processing", amount: 400, reservationId: "r1" }]
```

- [x] 8.1 `backend/src/modules/payments/usecases/charge-card.ts:47` — `POST /api/payments/charge`
      (`payments/index.ts:81`, permiso `billing:create`, que tiene `receptionist` según
      `shared/permissions.ts:189`) abre una Checkout Session real. **`assertChargeableAmount` no
      tiene un solo caller en todo `modules/payments/`**: sus únicos llamadores son
      `payment-requests/service.ts:124,178`, `update-request.ts` y `auto-payment-request.ts`.
      Cero techo. N llamadas = N sesiones vivas por el saldo completo.
- [x] 8.2 La sesión es invisible **por los dos lados** de la desigualdad:
      `committedPending` (`charge-ceiling.ts:53`) sólo suma filas de `payment_requests`, así que no
      la cuenta como comprometida; y `paidForReservation` sólo cuenta `completed|refunded`
      (`shared/usecases/reservation-paid.ts:82`) mientras ese pago nace `pending` y pasa a
      `processing` (`payment-crud.ts:76`, `charge-card.ts:62`), así que tampoco baja el saldo.
- [x] 8.3 **Nadie la expira jamás.** `clampUnlocked` (`clamp-to-ceiling.ts:121`) y `releaseUnlocked`
      (`:226`) iteran `pendingRowsOf` (`:57`), que es el repo de `payment_requests`; esa sesión vive
      en `payments.stripeSessionId`. Bajar el total o borrar la reserva la deja viva y pagable.
- [x] 8.4 `charge-card.ts:56` — la metadata de la sesión lleva `paymentId`/`hotelId` y **no**
      `reservationId` (`payment-requests/usecases/create-checkout.ts:100` sí lo manda). Sin eso, ni
      desde el objeto de Stripe se puede atribuir la sesión a la reserva.
- [x] 8.5 **El choke point de RTC-0 no es único.** `payments/usecases/settle-webhook.ts:51` hace
      `crud.updateStatus(paymentId,'completed')` — mueve plata al único estado que el techo cuenta —
      **sin pasar por `createPayment`**, y `connectors/payments-reservas.ts:43-46` suscribe
      `onPaymentCreated` y `onRefundProcessed` pero **no `onPaymentCompleted`**. Cuando el webhook
      confirma un cobro de charge-card o POS, `syncPendingAfterPayment` no corre y el clamp tampoco.
- [x] 8.6 `clamp-to-ceiling.ts:197` — `assertNoSettledCharge` mide `settledNetOfReservation`, que
      suma sólo `completed|refunded`. Una sesión de charge-card en `processing` **no bloquea el
      borrado de la reserva**: es el cobro huérfano de RTC-0.5 otra vez, por esta puerta.
- [x] 8.7 `reservas/usecases/cancel-core.ts:159` — confirmado: `service.ts:191` arma
      `cancelReservation` **sin** el puerto `paymentRequestsCeiling` (lo tienen sólo update, delete y
      addons), y `pendingBalance` (`reservation-balance.ts:68`) no mira `status`. Reserva cancelada =
      saldo intacto = link `pending` y pagable. `cancelBySystem` (`service.ts:194`) igual.

### Por qué esto cierra la discusión sobre parchear vs rediseñar

Meter `chargeCard` al alfabeto del test **haría fallar la prueba, no la arreglaría**: el clamp no
puede alcanzar una sesión que no vive en su tabla. El invariante se definió sobre
`payment_requests` y hay al menos un módulo entero que emite sesiones fuera de ahí. Es exactamente
lo que RTC-1 plantea: la verdad de qué está abierto tiene que vivir donde está el dinero —Stripe, o
una tabla de sesiones vivas alimentada por TODOS los emisores— y no en las filas de un módulo.

### Lo que sí quedó cerrado en RTC-0, verificado por mutación reproducible

Primera vez en la sesión que los números declarados reproducen exactos (secuencias que caen, prof. 1/2/3):

| Guard | Declarado | Reproducido |
|---|---|---|
| `crud.ts:301` clamp siempre | 1 / 29 / 696 | **1 / 29 / 696** |
| `addons.ts:62` guard en createAddon | 1 / 29 / 694 | **1 / 29 / 694** |
| choke point `onPaymentCreated` | 1 / 31 / 778 | **1 / 31 / 778** |

`reservas/tests/ceiling-wiring.test.ts` cae 2 de 3 al sacar los argumentos de cableado; el que
queda verde es el control negativo.

### Deuda menor, del mismo diff

- [x] 8.8 `reservas/usecases/addons.ts:43` y `:97` — el clamp entra como parámetro **opcional** y
      `reservas/service.ts:143` devuelve `undefined` si el connector no está cableado: fail-open. El
      mismo cambio eligió fail-closed para el puerto hermano (`payment-requests/service.ts:43`), y
      `crud.ts:307` argumenta que un parámetro opcional "reintroduce la divergencia en silencio".
- [x] 8.9 `sync-pending-after-payment.ts:104` — el `ceilingGuard` corre dentro del `try`; si el
      clamp tira (Stripe caído), el catch loguea "No se pudo resincronizar el saldo" —que sí se
      resincronizó— y devuelve `null`. El link queda vivo sobre un saldo ya bajado.
- [x] 8.10 `addons.ts:44` — `createAddon` pasó de 9 a 10 parámetros posicionales; el call site
      (`controller.ts:148`) es una línea de 240 caracteres donde el orden de 10 argumentos es lo
      único que separa lo correcto de lo roto.

### No verificado

El no-determinismo de la suite (`3436/1 fail` y `0 fail` alternando en una ronda anterior) **no
reprodujo**: 5 corridas dieron 3488 pass / 0 fail. Cinco corridas verdes no prueban ausencia de una
carrera — queda abierto sin causa raíz.
