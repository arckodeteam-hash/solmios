# Change Proposal: rediseno-techo-cobro

## Summary

El techo que impide cobrarle a un huésped más de lo que debe **no sostiene su invariante**. Cuatro
rondas de corrección taparon cuatro puertas distintas y las cuatro veces se midió exactamente el
mismo resultado contra el service real: **$600 cobrables sobre un saldo de $300**. Quedan al menos
cuatro puertas más abiertas, halladas en la última ronda.

Este change reemplaza el enfoque de parches por un rediseño del invariante. Decisión del usuario,
2026-08-20.

## El invariante que se declara y no se cumple

`backend/src/modules/payment-requests/usecases/charge-ceiling.ts:18-24` afirma sostener:

> *una fila `pending` tiene a lo sumo una sesión de Stripe abierta*

y el techo se calcula como `balance(reserva) − Σ(importes de las filas pending)`.

Los dos lados de esa desigualdad son estado mutable, y **ninguno está atado a lo que Stripe
realmente tiene abierto**:

- **Lado izquierdo** (qué filas cuentan): una fila deja de contar por muchas vías — cambiar su
  `status`, borrarla, marcarla `paid` a mano — y sólo dos de ellas expiran la sesión
  (`releaseSession` tiene 0 hits fuera de `update-request.ts` y `delete-request.ts`).
- **Lado derecho** (el `balance`): `totalAmount` y `otherCharges` son escribibles por
  `PUT /api/reservas/:id` (`reservas/validators/schema.ts:75`), y `deleteAddon` también lo baja.
  Nada de eso toca Stripe. El comentario del código ni siquiera menciona este lado.

Mientras el techo se derive de filas propias en vez de las sesiones vivas del proveedor, cada
ronda va a encontrar otra puerta. Ya pasó cuatro veces seguidas.

## Las puertas, con su estado

| # | Dónde | Estado |
|---|---|---|
| P1 | `stripeSessionId`/`stripePaymentUrl`/`paidAt` escribibles por el PUT | **cerrada**, con test que muere si se descablea |
| P2 | la baja de sesión sólo se disparaba por `dto.status`, no por importe | **cerrada**, idem |
| P3 | `service.ts:169` — el único guard de `create-checkout` es `if (pr.status === 'paid')`; sobre una fila **cancelada** emite una sesión viva que `committedPending` no cuenta (`charge-ceiling.ts:58` filtra por `pending`) y que el webhook liquida igual (`stripe-webhook.ts:106` sólo saltea `paid`) | **abierta** |
| P4 | `reservas/usecases/crud.ts:230` + `validators/schema.ts:75` — inflar `totalAmount`, emitir los links, volver a bajarlo. Ídem `addons.ts:88` | **abierta** |
| P5 | `update-request.ts:74` — `PUT {status:'paid'}` manual sobre un `pending` cuya sesión ya fue abonada: el webhook posterior descarta la liquidación entera, no queda fila en `payments`, `paidForReservation` sigue en 0 y el techo autoriza otro link | **abierta** |
| P6 | `shared/usecases/auto-payment-request.ts:22` — crea filas `pending` con `orm.create` directo: sin techo, sin lock, sin `assertCeilingAfterCommit`, y su guard de duplicados consulta sin `hotelId` | **abierta** |

Todas reproducidas ejecutando contra `PaymentRequestsService` real, no razonadas.

## Motivation

Lo que hace este bug distinto de un bug común es que **la suite no lo ve**: 3891 tests en verde,
`arckode analyze` sin violaciones, typecheck y build limpios, con el invariante roto. Los gates
miden que el código compile y que las funciones hagan lo que sus tests dicen; ninguno mide la
propiedad de negocio *"no se le puede cobrar al huésped más de lo que debe"*.

Por eso el rediseño no es sólo cambiar el cálculo: es hacer que esa propiedad sea **verificable**.

## Approach propuesto

Tres piezas, en orden de dependencia:

1. **La verdad de qué está abierto vive donde está el dinero.** El techo deja de contar filas
   `pending` propias y pasa a contar sesiones de Stripe efectivamente abiertas para esa reserva —
   consultándolas, o manteniendo una tabla de sesiones vivas con ciclo de vida propio (creada al
   emitir, cerrada por webhook o por expiración explícita) que sea la única fuente. Una fila de
   `payment_requests` deja de ser el registro de una sesión.

2. **Un solo portón de entrada.** Toda creación de cobro pasa por el mismo camino con techo, lock y
   verificación post-commit. Hoy `auto-payment-request.ts:22` entra por la ventana. Si hay un solo
   lugar donde nace un cobro, hay un solo lugar que auditar.

3. **El `balance` deja de ser libremente mutable con links vivos.** O bajar `totalAmount`/
   `otherCharges`/addons con sesiones abiertas revalida y expira lo que sobra, o queda prohibido
   mientras existan sesiones vivas. Hoy no hace ninguna de las dos.

## Cómo se verifica que quedó cerrado

No alcanza con tests por puerta: eso es lo que falló cuatro veces. Hace falta una prueba de la
**propiedad**, no de los casos: un test que recorra combinaciones de operaciones (crear cobro,
cancelar, cambiar importe, editar la reserva, borrar addon, marcar pagado a mano, disparar webhook)
y afirme, después de cada secuencia, que la suma de lo cobrable por sesiones vivas **nunca** supera
el saldo. Property-based o tabla exhaustiva de secuencias cortas; el criterio es que el test no
enumere las puertas conocidas, sino que las encuentre.

## Riesgo y rollback

Toca el camino del dinero de punta a punta. El rollback es por commit individual, pero el estado
intermedio importa: un rediseño a medias puede dejar sesiones vivas sin registro. Se implementa
detrás del flujo actual hasta que la prueba de propiedad pase, y recién ahí se corta.

## Deuda de datos que arrastra

`payments.reservationId` (agregada en el intento anterior) **no tiene backfill**, y el comentario
que lo justifica —`migrate-db.ts:1203`, "no se puede reconstruir a qué reserva pertenecían"— es
falso: `charge-reschedule-diff.ts:44` ya escribía `metadata:{reservationId, source:'reschedule'}` en
esas mismas filas y esa línea no cambió. En producción los cobros de reprogramación anteriores
siguen invisibles para `paidForReservation`, y el techo los autoriza a recobrar. El backfill entra
en este change.
