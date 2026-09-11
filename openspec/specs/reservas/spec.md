# Reservas — Ciclo de Vida (Specification)

## Purpose

Especifica el comportamiento del módulo de reservas del panel del hotel: creación con
disponibilidad real, máquina de estados, check-in, checkout con settlement, cancelación
con preview, no-show, tarjeta de garantía con PIN, pre-checkin público, acompañantes,
addons y reprogramación. Documenta lo IMPLEMENTADO (con referencia a archivo) y fija las
invariantes que ningún cambio futuro puede romper.

Fuentes: `backend/src/modules/reservas/` (model, types, usecases, index),
`backend/src/modules/reports/usecases/no-show-cron.ts`,
`backend/src/shared/usecases/cancellation-math.ts`, `room-overlap.ts`.

## Requirements

### Requirement: Reserva con disponibilidad real (sin sobrevender)

El sistema MUST rechazar (`409 ConflictError`) crear o editar una reserva cuya habitación
se solape en fechas con otra reserva activa. La validación la hace el BACKEND en toda
escritura (`usecases/availability.ts` → `assertRoomAvailable`, usada por create y update),
sin excluir `cancelled`/`no_show`, permitiendo back-to-back el mismo día
(checkOut de una = checkIn de la otra). El mensaje de conflicto MUST incluir las fechas y
el id de la reserva que ocupa (`availability.ts:36`).

#### Scenario: Solapamiento real rechazado

- GIVEN la habitación H1 con reserva activa del 2026-09-10 al 2026-09-15
- WHEN se crea una reserva de H1 del 2026-09-12 al 2026-09-18
- THEN el backend responde 409 con "Habitación no disponible en esas fechas (ocupada del
  2026-09-10 al 2026-09-15 por la reserva {id})"
- AND no se persiste ninguna reserva nueva

#### Scenario: Back-to-back el mismo día permitido

- GIVEN la habitación H1 con reserva activa hasta el 2026-09-15
- WHEN se crea una reserva de H1 desde el 2026-09-15
- THEN la reserva se crea (201) — el borde checkout=checkin no es solapamiento

#### Scenario: Reserva cancelada no bloquea

- GIVEN la habitación H1 con una reserva CANCELADA del 2026-09-10 al 2026-09-15
- WHEN se crea una reserva de H1 en esas fechas
- THEN la reserva se crea (201)

### Requirement: Máquina de estados con transiciones legales

El sistema MUST validar toda transición de `status` contra la tabla de transiciones
(`usecases/state-machine.ts`): `pending → confirmed|cancelled|no_show`;
`confirmed → checked_in|cancelled|pending`; `checked_in → checked_out`;
`checked_out → []` (terminal); `cancelled → pending` (reactivación);
`no_show → cancelled`. Transición ilegal → `409 ConflictError`. `super_admin` MAY forzar
una transición ilegal (el check se omite antes de llamar).

#### Scenario: Checkout de una cancelada rechazado

- GIVEN una reserva con status `cancelled`
- WHEN se llama a cualquier operación que intente moverla a `checked_out`
- THEN el backend responde 409 "Transición de estado no permitida: cancelled → checked_out"

#### Scenario: Reactivación de cancelada

- GIVEN una reserva `cancelled`
- WHEN se la mueve a `pending`
- THEN la transición se permite (es el camino de reactivación)

### Requirement: Crear reserva con datos completos del huésped y canal

`POST /api/reservas` (permiso `reservations:create`) MUST requerir roomId, hotelId,
checkIn, checkOut y totalAmount (`model.ts` required), con channel/source de la lista
soportada (`direct|booking|airbnb|expedia|agoda|trip|phone|email|walk_in`,
`types.ts`). Estados iniciales: `pending` por defecto. Creaciones desde canales externos
(booking engine, webhook QScanPro) MUST pasar por las mismas validaciones de
disponibilidad y esquema que la creación manual.

#### Scenario: Creación directa mínima

- GIVEN un huésped existente y la habitación H1 libre del 10 al 12 de septiembre
- WHEN `POST /api/reservas` con `{guestId, roomId, checkIn, checkOut, totalAmount}`
- THEN se crea con `status:'pending'`, `channel:'direct'`, `currency:'USD'` (defaults)
- AND se dispara el email de confirmación (`lifecycle-email.ts`)

### Requirement: Check-in atómico con folio y código de cerradura

`POST /api/reservas/:id/checkin` (permiso `reservations:checkin`) MUST ejecutarse como
transacción todo-o-nada: mover status a `checked_in` (CAS — una segunda llamada
concurrente con status viejo NO pasa, `checkin-race.test.ts`), setear `checkedInAt`,
crear el folio con el cargo de habitación de la primera noche, y generar el código TTLock
de la habitación con su email al huésped (`lock-code-email.ts`). Si cualquier paso
falla, la reserva MUST quedar en su estado previo.

#### Scenario: Check-in feliz

- GIVEN reserva `confirmed` de hoy
- WHEN `POST /:id/checkin`
- THEN status=`checked_in`, `checkedInAt` seteado, folio creado con cargo de habitación,
  código TTLock generado y email enviado

#### Scenario: Doble check-in concurrente

- GIVEN dos recepcionistas haciendo check-in de la MISMA reserva a la vez
- WHEN ambas operaciones leen status `confirmed` y compiten por escribir
- THEN solo una gana el CAS; la otra falla sin efectos parciales

### Requirement: Checkout con settlement como una sola operación del servidor

`POST /api/reservas/:id/checkout` (permiso `reservations:checkout`) acepta
`settle?: {method, amount, reference?}` y MUST: (1) mover status a `checked_out` y
setear `checkedOutAt` PRIMERO, (2) correr el settlement DESPUÉS
(close folio → invoice → payment vía `settle-port.ts`). Este orden es una invariante: si
el settlement falla tras el cambio de estado, la reserva queda `checked_out` con folio
abierto y el staff factura desde `/panel/billing` — el orden inverso (settle OK + estado
sin mover) reintenta y cobra DOS veces. `settle` ausente → checkout sin settlement;
`amount <= 0` tras cerrar el folio → cierra sin factura. El frontend MUST NOT orquestar
folio+factura en dos requests propios.

#### Scenario: Checkout con pago en la misma operación

- GIVEN reserva `checked_in` con folio de saldo 100
- WHEN `POST /:id/checkout` con `settle:{method:'cash', amount:100}`
- THEN status=`checked_out`, folio cerrado, factura emitida, payment registrado (tabla
  `payments`, única fuente de verdad del dinero)

#### Scenario: Settlement falla no duplica cobro

- GIVEN el paso de factura/descargo cae tras mover el estado
- THEN la reserva queda `checked_out` con folio abierto (recuperable desde billing)
- AND NO existe ningún camino que registre el pago dos veces

### Requirement: Preview de cancelación antes de ejecutar

`GET /api/reservas/:id/cancel-preview` MUST responder 200 SIEMPRE (nunca 409): si no se
puede cancelar, responde `canCancel:false` + `blockedReason` en español. El preview y la
ejecución (`cancel.ts`) MUST usar EXACTAMENTE la misma matemática
(`shared/usecases/cancellation-math.ts`: `resolvePolicy` + `computePenalty`) — duplicar
el cálculo es el bug que esta separación evita. El preview incluye:
`hoursUntilCheckIn`, `refundable`, `penaltyPercent`, `cancellationFee`, `refundAmount`,
moneda y datos del huésped (contrato consumido por `pages/reservations` — no renombrar).

#### Scenario: Preview refleja la política del hotel

- GIVEN política del hotel con penalidad 50% y check-in en 10 horas
- WHEN `GET /:id/cancel-preview`
- THEN 200 con `refundable:true`, `penaltyPercent:50`, `cancellationFee` = 50% del total,
  `refundAmount` = resto — los mismos números que persistiría el POST de cancelación

#### Scenario: No cancelable devuelve motivo, no error

- GIVEN una reserva en estado terminal (`checked_out`)
- WHEN `GET /:id/cancel-preview`
- THEN 200 con `canCancel:false` y `blockedReason` humano (ej: "La reserva ya está
  cerrada")

### Requirement: Cancelación libera todo lo que la reserva tomó

`POST /api/reservas/:id/cancel` (permiso `reservations:edit`) MUST, atómicamente:
validar transición (`state-machine`), aplicar penalidad/refund según la misma
matemática del preview, mover status a `cancelled`, liberar la habitación
(`rooms.status='available'`), revocar el código TTLock (con log si el conector falla —
nunca silencioso) y notificar por sockets/webhook de canales.

#### Scenario: Cancelar una confirmed

- GIVEN reserva `confirmed` con habitación y código TTLock activo
- WHEN `POST /:id/cancel`
- THEN status=`cancelled`, habitación disponible, código TTLock revocado, y el preview
  que vio el recepcionista coincide con lo persistido

#### Scenario: Vencimiento de una reserva web sin pago (sin cargo ni política)

- GIVEN reserva `pending` creada desde el motor público, sin pago y más vieja que el TTL
  del hotel (`booking_config.pendingPaymentTtlHours`)
- WHEN el sistema la cancela con `cancelBySystem(..., { penaltyMode: 'no-charge',
  reason: 'payment_timeout' })` (#248, REQ-RWP-05)
- THEN status=`cancelled`, `cancellationReason='payment_timeout'`, `cancellationFee=0`,
  `refundAmount=0`, `policyApplied.policyId='payment_timeout'`, NO se consulta la política
  del hotel, y `onReservationCancelled` se emite igual (con `refundAmount: 0`) para que los
  conectores liberen lo que la reserva tomó

### Requirement: No-show automático sin overbooking

El cron de night audit (cada 3h, todos los hoteles,
`reports/usecases/no-show-cron.ts`) MUST marcar `no_show` solo reservas
`pending`/`confirmed` cuyo `checkIn` < hoy (query filtrada, no scan total), liberar su
habitación (`available` — sin esto Channex la muestra fuera de inventario y produce
overbooking) y disparar el email lifecycle `no_show`. El marcado es idempotente por fecha
(dedup). El endpoint manual `POST /api/night-audit/mark-no-shows` sigue la misma regla.

#### Scenario: Huésped que no llegó

- GIVEN reserva `confirmed` con checkIn ayer
- WHEN corre el cron
- THEN status=`no_show`, habitación liberada, email enviado — y una segunda corrida el
  mismo día NO la vuelve a tocar

### Requirement: Tarjeta de garantía parcial protegida por PIN

El sistema MUST guardar solo datos parciales de tarjeta (`cardHolder`, `cardBrand`,
`cardLast4`, mes/año de vencimiento — `model.ts`): NUNCA el número completo ni el CVV
(PCI). Revelar los datos (`POST /api/reservations/:id/guarantee-card/unlock`) MUST exigir el
PIN de garantía del hotel (4-8 dígitos, guardado HASHEADO en
`configuration('guarantee_pin')` por hotel). La verificación MUST tener tope anti
fuerza-bruta para staff: 5 intentos fallidos por hotel → lock 15 minutos
(`usecases/guarantee.ts`, estado in-memory). Badge "Configurado/Sin configurar" en
`/panel/config` refleja SOLO la existencia de la fila, nunca el valor.

#### Scenario: PIN correcto revela, incorrecto descuenta intentos

- GIVEN el hotel tiene `guarantee_pin` configurado y la reserva tiene tarjeta
- WHEN se desbloquea con el PIN correcto
- THEN devuelve `{cardHolder, cardBrand, cardLast4, cardExpMonth, cardExpYear}` y limpia
  el contador de fallos
- WHEN se desbloquea con PIN incorrecto
- THEN responde error con los intentos restantes; al 5º fallo, lock 15 minutos

### Requirement: Pre-checkin público por hash

El link público `GET/POST /api/public/pre-checkin/:hash` MUST permitir al huésped
completar sus datos y subir foto de documento ANTES de llegar, con estados
`pending → sent → completed | expired` (`types.ts`), límite de tamaño de foto por
`bodyLimit` y registro de aceptaciones GDPR/marketing/terms con timestamp
(`usecases/pre-checkin.ts`). El hash es la ÚNICA credencial — el endpoint no exige
session y MUST validar ownership implícita por hash→reserva.

#### Scenario: Huésped completa antes de llegar

- GIVEN reserva con `preCheckinStatus:'sent'` y hash H
- WHEN el huésped abre el link y sube su documento
- THEN `preCheckinStatus='completed'`, foto guardada, aceptaciones con timestamp, y el
  recepcionista ve el check-in listo en el detalle

### Requirement: Acompañantes, addons y reprogramación como operaciones de dominio

- Acompañantes (`companions.ts`): CRUD sobre `/api/reservations/:id/companions` con
  datos completos (documento, nacimiento) — alimentan ocupación y registro.
- Addons (`addons.ts`): extras con `quantity` que cargan al folio (campo declarado en el
  modelo — descartarlo silenciosamente es el anti-patrón ORM histórico).
- Reprogramación (`reschedule.ts` + `reschedule/quote`): mover fechas cotizando el nuevo
  período primero (delta visible) y revalidando disponibilidad de la habitación nueva al
  confirmar.

#### Scenario: Reprogramar muestra el delta antes de aplicar

- GIVEN reserva del 10 al 12 en H1 a USD 200
- WHEN se pide quote de reprogramación al 15-18 (tarifa distinta)
- THEN el quote devuelve el precio nuevo y la diferencia; solo al confirmar el POST se
  revalida disponibilidad y se aplica

### Requirement: Ocupación con niños, bebé y solicitud de cuna persistidas por reserva

Toda reserva creada desde el motor público MUST persistir su composición real:
`adults`, `children`, `childrenAges` (edades declaradas, auditoría de lo tipeado —
un niño con edad > maxChildAge cuenta en `adults` pero su edad queda en el array),
`childrenAgesAsOf` (checkIn vigente al declarar; ancla temporal que NUNCA se
reescribe) y, cuando el hotel habilita `childPolicy.cribAvailable` y la composición
incluye un bebé (clasificación de `childrenAges`, `child-composition.ts`), la
pregunta binaria `needsCrib` (+`cribCount` 1/0 espejo). El backend re-valida cuna
y capacidad al crear — nunca confía en lo que manda el cliente — y en una reserva
grupal cada room-line es su propia fila `reservations` con su propia distribución
(`public-booking-group.ts`). `childrenRatePercentApplied` congela el % infantil
efectivamente cotizado (auditoría: cambiar el % después no toca reservas existentes).
La cuna sigue siendo Sí/No sin precio. Aparte de ella, REQ-01 (#233) agrega las
**amenidades para niños/bebés configurables por el hotel** (tabla `child_amenities`:
nombre libre, `price` >= 0 con 0 permitido, `active`; CRUD `/api/child-amenities` con
permiso `upsells:*`, catálogo público `GET /api/public/hotels/:slug/child-amenities`
solo activas). El cliente las elige POR HABITACIÓN (`childAmenities: [{id}]` en el
body single y en cada `rooms[i]` del grupo); el backend las acepta SOLO si esa línea
declara al menos un menor y `childPolicy.acceptChildren`, ignora ids inexistentes,
inactivos, de otro hotel o duplicados, y persiste en cada fila `reservations` el
snapshot `childAmenities` `[{id,name,price,quantity,total}]` + `childAmenitiesTotal`
con el precio vigente al reservar. Su importe entra en `subtotal` (alojamiento +
upsells + amenidades) → base imponible → impuestos → total cobrado, y
`priceBreakdown.childAmenitiesTotal` lo desglosa (`public-booking.ts`,
`public-booking-group.ts`).

#### Scenario: Grupo de dos habitaciones con bebé en una

- GIVEN hotel con cribAvailable y una reserva grupal de 2 líneas, una con bebé + cuna
- THEN cada línea persiste sus propios adults/children/childrenAges y SOLO la del bebé
  lleva needsCrib=true validado por el backend

#### Scenario: Amenidad infantil elegida en una sola habitación del grupo

- GIVEN hotel con la amenidad activa "Kit de bebé" a 10 y una reserva grupal de 2 líneas,
  la segunda con un niño, quantity 2 y `childAmenities: [{id}]`
- THEN `priceBreakdown.childAmenitiesTotal` = 20, el subtotal y el total lo incluyen, cada
  reserva física de la segunda línea persiste el snapshot con quantity 1 y total 10, y la
  primera línea no lleva amenidades
- AND una amenidad inactiva, de otro hotel o pedida en una línea sin menores se ignora
  sin error y no se cobra

#### Scenario: Regla de capacidad explica qué se incumple

- GIVEN una línea que excede maxAdults/maxChildren/capacity
- THEN el motor rechaza con el motivo específico de la regla violada, no un error genérico

### Requirement: Registrar pago manual con evidencia (REQ-RWP-06)

`POST /api/reservas/:id/mark-paid` (permiso `billing:create` — el único endpoint del módulo
con permiso de facturación, porque registra dinero; ownership post-findById con bypass
`super_admin`) recibe `{method: cash|transfer|card|other, amount > 0, reference?, note?}`
y MUST: rechazar con 400 `reference` vacía para `transfer`/`card` (evidencia para
conciliar con el banco; `cash`/`other` no la exigen), rechazar con 400
`amount > pendingBalance + BALANCE_EPSILON` con el saldo en el mensaje (misma regla que
facturas: el excedente no se absorbe en silencio), rechazar con 409 reservas `cancelled`
/ `no_show`; asentar PRIMERO la fila en `payments` (`type:'charge'`, `status:'completed'`,
`reservationId`, `reference`, `createdBy` = usuario del token — nunca del body —,
`description: 'Cobro manual · {method} · {note}'`) vía el puerto `manualPayment`
(`usecases/mark-paid.ts`, connector `connectors/reservas-payments.ts`) y recién DESPUÉS
actualizar la reserva: `pendingAmount` recalculado con `pendingBalance` sobre lo ya
cobrado + este cobro (nunca una resta a mano) y `status` `pending → confirmed` (otros
estados no cambian); audit `reservation.marked_paid`. Si el asiento en `payments` falla,
la reserva queda intacta. MUST NOT escribir `reservations.deposit` (no es el libro del
dinero; `payments` es la única fuente de verdad). Efectos derivados sin código propio:
`onPaymentCompleted` → caja (`payments-caja`) para efectivo; `onPaymentCreated` → resync
de `pendingAmount` (`payments-reservas`). Respuesta 201 con la reserva + `paymentId`,
`paidAmount`, `pendingAmount`, `paymentState`. En la ficha (`ReservationModal.vue`,
tarjeta "Importe y Pago") el botón "Registrar pago" (visible con `billing:create` y
`pending > 0`) abre `MarkPaidModal.vue` con el monto prellenado con el saldo; al guardar se
refrescan el detalle (badge y "Historial de cobros" con "Registró: {nombre}") y el listado.

#### Scenario: Cobro manual salda la reserva

- GIVEN reserva `pending` con saldo 354 y sin cobros previos
- WHEN `POST /:id/mark-paid` con `{method:'transfer', amount:354, reference:'TRF-1'}`
- THEN 201, existe una fila en `payments` `charge`/`completed` con `createdBy` del token,
  `paymentState:'paid'`, `pendingAmount:0`, status `confirmed`, audit
  `reservation.marked_paid`
- AND `reservations.deposit` no cambia

#### Scenario: Sobrepago rechazado

- GIVEN reserva con saldo 354
- WHEN `POST /:id/mark-paid` con `amount:400`
- THEN 400 con "$354" en el mensaje y NO se crea ningún payment ni se toca la reserva

#### Scenario: Transferencia sin referencia rechazada

- WHEN `POST /:id/mark-paid` con `{method:'transfer', amount:354}` sin `reference`
- THEN 400 y ningún payment
- AND `{method:'cash', amount:354}` sin referencia sí se acepta

#### Scenario: Sin permiso de facturación

- GIVEN un rol sin `billing:create` (p.ej. housekeeper)
- WHEN `POST /:id/mark-paid`
- THEN 403 sin efectos

### Requirement: Transversales de toda operación de reservas

Toda query del módulo MUST filtrar por `hotelId` (multi-tenant) y toda ruta MUST exigir
su permiso de acción (`reservations:view/create/edit/checkin/checkout/delete`,
`index.ts`). El detalle extendido (`GET /api/reservations/:id`) y el audit trail
(`GET /api/reservations/:id/audit`) MUST estar disponibles para reconstruir quién hizo
qué. Los listados usan caché versionada (invalidate por token, no por clave fija).

#### Scenario: Staff de otro hotel no ve la reserva

- GIVEN un usuario del hotel A con token válido
- WHEN pide el detalle de una reserva del hotel B
- THEN recibe error de ownership (assertOwnership) — nunca datos cruzados

## Deuda conocida (documentada, no cubierta por este spec)

- **Depósitos = ledger desconectado**: `createDeposit/refund/release` no tocan Stripe ni
  `payments` — un depósito "held" no es plata capturada.

Deuda resuelta con posterioridad a la primer versión de este spec:

- ~~**Wizard sin filtro de fecha** (#648)~~: resuelto en `10815f4` — el selector del wizard
  consulta `GET /api/habitaciones?checkIn=&checkOut=` (rama sin cache que anota
  `available`/`unavailableReason`, `shared/usecases/habitaciones-availability.ts`) con
  debounce de 300ms; sin fechas completas o si el fetch falla, lista todo (comportamiento
  previo). El 409 del backend sigue siendo la barrera de sobrevendo.
- ~~**E2E de precio por temporada intermitente** (#54)~~: resuelto en `194758d0` — el
  `beforeAll` de `reservas/tests/season-pricing.e2e.test.ts` levanta una SQLite real, migra
  los modelos de shared/hoteles/habitaciones/reservas y siembra el catálogo de temporadas:
  entre 2 y 9 s de trabajo contra los 5 s que bun le da a un hook por defecto. Ahora lleva
  el timeout explícito (`beforeAll(fn, 60_000)`). No cambió ningún comportamiento de
  reservas — los 6 escenarios que cubre el test son los mismos — pero el fallo engañaba
  (`a beforeEach/afterEach hook timed out`, que no nombra ni el hook ni el código lento) y
  se leía como un bug de precios. Los e2e de `ari-outbox` ya habían recibido el mismo
  timeout en `6d2d9adf`, citando justamente a este test; era el último que faltaba.
- ~~**CORS sin headers en 401**~~: resuelto con `corsWithErrorHeaders`
  (`shared/middlewares/cors-error-headers.ts`) — el ErrorContract lanzado se convierte a
  respuesta ANTES de que el cors la decore, así el 401/403/409/429 llega con
  `Access-Control-Allow-Origin` y el browser no lo reporta como error de CORS.
