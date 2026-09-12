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

REQ-01 (#290) agrega, con el mismo patrón, las **amenidades personalizadas de la
habitación**: filas `RoomAmenities` con `amenityKey` `custom:<slug>`, `name`, `price` >= 0
e `isActive`, configuradas desde el formulario de CADA habitación (las keys fijas del
catálogo siguen siendo features gratuitas). Como el huésped elige un TIPO y no una unidad,
`GET /api/public/hotels/:slug/room-amenities` expone por `roomType` la unión (por key) de
las custom activas de sus habitaciones vendibles con el precio MÍNIMO
(`public-room-amenities.ts`). El cliente las pide por habitación (`roomAmenities: [{key}]`
en el body single y en cada `rooms[i]` del grupo); el backend prefiere, entre las unidades
libres del tipo, las que ofrecen TODAS las keys pedidas, cobra el precio REAL de las filas
`RoomAmenities` de la unidad asignada (NUNCA el del body), ignora con warn una key fija,
inactiva o no ofrecida por esa unidad, y persiste en cada fila `reservations` el snapshot
`roomAmenities` `[{key,name,price,quantity,total}]` + `roomAmenitiesTotal`. Su importe entra
en `subtotal` y `priceBreakdown.roomAmenitiesTotal` lo desglosa; en un grupo cada unidad
física resuelve contra sus propias filas (dos unidades del mismo tipo pueden cobrar la misma
key a precio distinto) y lleva su propio snapshot. Sin `roomAmenities` en el body nada de
esto se lee y el flujo queda idéntico al anterior.

REQ-03 (#235) agrega a `child_policy` el **máximo de niños que no consumen plaza por
habitación** (`maxFreeChildrenPerRoom`): lo define cada hotel en Configuración junto a las demás
políticas infantiles, es general del hotel (NO por tipo de habitación) y se aplica a CADA
habitación/línea de la reserva. `null`/ausente = sin límite — el sistema NUNCA asume un número
por default; al guardar (`hoteles-queries.ts`) se exige entero ≥ 0 y al leer
(`resolveChildPolicy`) cualquier basura cae a `null`. Los `freeChildren` (bebés incluidos) siguen
sin consumir `capacity`/`maxChildren`, pero cuentan para este tope: `freeChildrenLimitError`
(`child-composition.ts`) devuelve el motivo específico y lo aplican el motor público (single y
por línea del grupo, 409 antes de resolver unidad), `assertReservationFitsCapacity` (panel/API/IA
con `childrenAges`; sin edades no aplica) y el reagendado sobre las edades proyectadas al nuevo
check-in. El composer público (`useGuestComposer`) bloquea "Agregar" con el mismo motivo y lo
re-evalúa en vivo al cambiar la edad de un menor.

#### Scenario: Amenidad de habitación que solo ofrece una unidad del tipo

- GIVEN tipo "double" con dos unidades libres, la más barata sin "Cuna" y la otra con
  "Cuna" activa a 15 en sus `RoomAmenities`, y un POST single con `roomType: 'double'` y
  `roomAmenities: [{key:'custom:cuna', price: 0.01}]`
- THEN el backend asigna la unidad que ofrece la cuna, `priceBreakdown.roomAmenitiesTotal`
  = 15 (el precio del server, no el del body), el subtotal y el total lo incluyen, y la
  reserva persiste `roomAmenities` `[{key:'custom:cuna', name:'Cuna', price:15, quantity:1,
  total:15}]` y `roomAmenitiesTotal` = 15
- AND una key que ninguna unidad del tipo ofrece, una key fija o una inactiva se ignora sin
  error y no se cobra; en un grupo, solo las filas de la línea que la pidió llevan snapshot,
  cada una al precio de su propia habitación

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

#### Scenario: Máximo de niños sin plaza por habitación (REQ-03)

- GIVEN hotel con `child_policy.maxFreeChildrenPerRoom = 1`, `maxFreeAge = 5`, y una línea con
  2 adultos y `childrenAges: [1, 2]` en una habitación de `capacity` 2
- THEN la capacidad física NO se excede (los dos niños son libres) pero el motor rechaza con 409
  "admite hasta 1 niño(s) que no consumen plaza; la reserva tiene 2"; con `[1]` se crea, y sin
  `maxFreeChildrenPerRoom` configurado `[1, 2]` también se crea
- AND en un grupo solo la línea que excede rechaza (el mensaje la nombra); el panel con
  `childrenAges` y el reagendado aplican el mismo tope; un caller sin `childrenAges` no se ve
  afectado

#### Scenario: Regla de capacidad explica qué se incumple

- GIVEN una línea que excede maxAdults/maxChildren/capacity
- THEN el motor rechaza con el motivo específico de la regla violada, no un error genérico

### Requirement: Intentos de la pasarela en el detalle de la reserva (REQ-RWP-02)

El detalle extendido (`GET /api/reservations/:id`) MUST devolver `paymentAttempts[]`: la
bitácora `payment_attempts` (dueña: `payment-gateways`, REQ-RWP-01) proyectada a
`PaymentAttemptView` (`shared/usecases/payment-attempt-view.ts`, función pura: `amount` en
unidades mayores, `dashboardUrl` de Stripe según `mode`, `''` para otros proveedores), del
más reciente al más viejo. `reservas` NO importa el módulo de pasarelas: lee por el puerto
`orchestrationDeps.listPaymentAttempts` que cablea `connectors/reservas-payment-gateways.ts`.
La lectura es best-effort: es bitácora, no dinero — un fallo del puerto NUNCA tumba el detalle.

#### Scenario: El puerto de intentos falla

- GIVEN una reserva y un puerto `listPaymentAttempts` que lanza (o no está cableado)
- WHEN se pide `GET /api/reservations/:id`
- THEN responde 200 con `paymentAttempts: []` y el resto del detalle intacto

#### Scenario: Reserva web con un rechazo y un cobro

- GIVEN `payment_attempts` con un `failed` (Stripe test, `failureMessage`) y un `paid` posterior
- WHEN se pide el detalle
- THEN `paymentAttempts[0]` es el `paid` y `[1]` el `failed` con su motivo, y el de Stripe test
  trae `dashboardUrl` `https://dashboard.stripe.com/test/payments/<providerRef>`

### Requirement: Registrar pago manual con evidencia (REQ-RWP-06)

`POST /api/reservas/:id/mark-paid` (permiso `billing:create` — con `POST /:id/invoice`, los dos únicos endpoints
del módulo con permiso de facturación, porque tocan dinero; ownership post-findById con bypass
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

### Requirement: Emitir factura desde la reserva, con o sin folio (REQ-FDR-02)

`POST /api/reservas/:id/invoice` (permiso `billing:create` — el mismo que
`POST /api/facturas`; ownership post-findById con bypass `super_admin`; body `{notes?}`
validado, ≤ 500 caracteres) emite la factura de la reserva en UNA sola operación del
servidor y el camino NO lo elige el cliente (`usecases/issue-invoice.ts`): con folio
`open` (lector `folioReader`, mismo criterio que la guarda de deuda del checkout) delega
en `folios.closeAndCreateInvoice` — el folio queda `closed` con `invoiceId` y la factura
lleva los cargos del folio, exactamente como `POST /api/folios/:id/invoice`; sin folio (o
con el folio ya cerrado) delega en `facturas.invoiceFromReservation`
(`facturas/usecases/invoice-from-reservation.ts`): items = alojamiento
(`chargeableTotal`) + extras (`reservation_addons`, descuentos con signo) + otros cobros,
llevados a neto con la tasa de `configuration('taxes')` (fallback `hotels.taxRate`,
nada hardcodeado) porque `reservations.totalAmount` es bruto; numeración y NCF por el
contador atómico de `facturas`; moneda de la reserva. La factura VINCULA los
`payments` de la reserva (`status` `completed`/`refunded`, `invoiceId` vacío) escribiendo
`payments.invoiceId` por el puerto `facturas-payments`, `amountPaid` = Σ neto de refunds,
`status:'paid'` si `amountPaid ≥ amount − BALANCE_EPSILON`; MUST NOT crear filas en
`payments`. Idempotente: reserva con factura `type:'invoice'` no `cancelled` → 409 con
`invoiceId` de la existente (anular ≠ borrar: una factura anulada sí deja emitir otra).
Reserva `cancelled` → 409. Sin conector `reservas-facturas` → 400 (fail-closed, nunca
"ok" sin factura). Audit `invoice.issued_from_reservation`. Respuesta 201 con
`{invoiceId, invoiceNumber, source: 'folio'|'reservation', folioId?, linkedPayments?,
amountPaid?}`. `reservas` NO importa `facturas` ni `folios`: `ReservationInvoicingPort`
lo inyecta `connectors/reservas-facturas.ts`.

#### Scenario: Reserva pagada online sin folio

- GIVEN reserva `confirmed` sin folio, total bruto 590 con impuesto del hotel 18 % en
  `configuration('taxes')`, y un `payment` `charge`/`completed` de 590 por Stripe con
  `reservationId` y sin `invoiceId`
- WHEN `POST /:id/invoice`
- THEN 201 `source:'reservation'`, la factura es `type:'invoice'`, `status:'paid'`,
  `amount ≈ 590`, `taxes ≈ 90`, el payment queda con `invoiceId` = la factura y la tabla
  `payments` tiene la misma cantidad de filas que antes

#### Scenario: Segunda emisión

- GIVEN la reserva ya tiene una factura `invoice` viva
- WHEN `POST /:id/invoice` otra vez
- THEN 409 con `invoiceId` de la existente y no se crea ninguna factura

#### Scenario: Con folio abierto

- GIVEN reserva `checked_in` con folio `open`
- WHEN `POST /:id/invoice`
- THEN 201 `source:'folio'`, el folio queda `closed` con `invoiceId` y la factura incluye
  los cargos del folio (camino `folios-facturas` existente)

#### Scenario: Sin permiso de facturación

- GIVEN un rol sin `billing:create` (p.ej. housekeeper)
- WHEN `POST /:id/invoice`
- THEN 403 sin efectos

### Requirement: Estado de pago por fila en el listado y origen web (REQ-RWP-04)

`GET /api/reservas` MUST devolver en cada fila de la página `paidAmount` (number) y
`paymentState` (`pending` | `partial` | `paid`), calculados con la MISMA fuente de "lo
pagado" que el detalle y `mark-paid` (`paidSource()` del módulo →
`shared/usecases/reservation-paid.ts`: `payments` por folio, factura y vínculo directo,
nunca `reservations.deposit` a secas) y con `paymentState()` de
`shared/utils/reservation-balance.ts` sobre el total cobrable (alojamiento + otros cobros +
extras). El cálculo se acota a las filas de la página (≤ `limit`, máximo 100) y corre en
paralelo por fila (`usecases/crud.ts`); MUST NOT cargar `payments` del hotel entero en
memoria. El resultado se cachea junto con la página y lo invalida la misma notificación
de cambio que ya dispara cada cobro/extra.

Origen: las reservas creadas por el motor público (`bookingengine/usecases/public-booking.ts`
y `public-booking-group.ts`) nacen con `source:'web'`; las cargadas desde el panel
(`/api/panel/reservas`) conservan el default `source:'direct'`. `channel` sigue siendo
`'direct'` en ambas: los reportes de "directas" (`usecases/booking-engine.ts`) cuentan por
`channel`, y el cambio de `source` MUST NOT sacar a la reserva web de ese conteo.
`CHANNEL_ENUM` acepta `web`. Backfill idempotente en cada deploy
(`scripts/backfill-reservation-source-web.ts`, llamado desde `migrate-db.ts`):
`source='direct' AND accessToken no nulo → 'web'` (sólo el flujo público setea
`accessToken`); una segunda corrida no toca filas.

Panel (`pages/reservations/index.vue`): columna **Pago** con badge Pendiente (coral) ·
Parcial (dorado) · Pagada (teal) desde `paymentState` (helper compartido
`utils/payment-state.ts`, el mismo que usa la ficha); KPI **Cobradas** (reservas
`paymentState:'paid'` no canceladas) junto a "Confirmadas"; canal `web` → "Web" con icono
de globo y opción "Web" en el filtro de canal; por debajo de 768px el badge de pago va
debajo del estado y no se oculta.

#### Scenario: Dos confirmadas, una cobrada y otra no

- GIVEN dos reservas `confirmed` de 300, una con un `payment` `completed` por 300 y otra sin cobros
- WHEN `GET /api/reservas`
- THEN la primera trae `paymentState:'paid'`, `paidAmount:300` y la segunda `pending`, `0`
- AND `paidOf` se consultó exactamente una vez por fila de la página

#### Scenario: Reserva web vs. reserva de recepción

- WHEN el motor público crea una reserva
- THEN `source:'web'` y `channel:'direct'`, y el reporte de directas la sigue contando
- AND una reserva cargada por el panel queda con `source:'direct'`

#### Scenario: Backfill idempotente

- GIVEN filas `direct`+`accessToken`, `direct` sin token y `booking`
- WHEN corre el backfill dos veces
- THEN sólo la primera pasa a `web` en la primera corrida y la segunda corrida cambia 0 filas

### Requirement: Facturas de la reserva en el detalle (REQ-FDR-01)

El detalle extendido (`GET /api/reservations/:id`, `usecases/detail.ts`) MUST devolver
`invoices: ReservationInvoiceView[]` — `{ id, number, type, status, amount, taxes,
amountPaid, balance, currency, issuedAt, ncf }` — con las facturas de la reserva de la más
reciente a la más vieja (`issueDate` desc, desempate `createdAt` desc). Es una PROYECCIÓN
(`usecases/reservation-invoices.ts`): `number` ← `invoices.invoiceNumber`, `issuedAt` ←
`invoices.issueDate`, `balance = amount − amountPaid` derivado; MUST NOT exponer la fila cruda
del módulo `facturas` (`hotelId`, `reservationId`, `notes`, …). Las filas se leen por el
puerto reserva→facturas ya cableado por `connectors/reservas-money.ts`
(`ReservationMoneyPort.invoices` → `FacturasService.invoicesOfReservation`), SIEMPRE con el
hotel de la reserva; `reservas` MUST NOT importar `modules/facturas`. Best-effort: si el
puerto falla, `invoices: []` y el detalle se devuelve igual (200). El frontend espeja el
tipo en `types/index.ts` (`ReservationInvoiceView`, `ReservationDetail.invoices?`).

#### Scenario: Reserva con una factura

- GIVEN una reserva con una factura `F-0001` de 500 con `amountPaid` 200
- WHEN `GET /api/reservations/:id`
- THEN `invoices[0].number` es `F-0001` y `invoices[0].balance` es 300

#### Scenario: Más reciente primero

- GIVEN dos facturas emitidas el 2026-08-01 y el 2026-09-05
- WHEN se pide el detalle
- THEN `invoices[0]` es la de septiembre

#### Scenario: El puerto de facturas falla

- GIVEN el puerto reserva→facturas lanza
- WHEN se pide el detalle
- THEN responde 200 con `invoices: []` y el resto del detalle intacto

### Requirement: Reserva web sin pago vence sola e idempotencia del widget (MR-01, #266)

Una reserva creada por el motor público nace `pending` con `paymentDeadlineAt` =
`createdAt + booking_config.pendingTtlMinutes` (entero 15–1440, default 60, editable en
`/panel/booking-engine` como "Minutos para completar el pago"; reemplaza el
`pendingPaymentTtlHours` de #248, cuya columna queda huérfana). El cron
`shared/usecases/pending-payment-expiry-cron.ts` (primer tick a 20 s, luego cada 5 min,
kill-switch `BOOKING_PENDING_TTL_DISABLED=1`) MUST cancelar toda reserva `pending` web
(`accessToken` no nulo o `source:'web'`) con `paymentDeadlineAt < now`, `deposit = 0` y sin
`payments` `completed` ni actividad de pago reciente, vía `reservas.cancelBySystem` en modo
`no-charge` con `cancellationReason:'payment_timeout'` (emite `onReservationCancelled`, que es
lo que libera depósito, código de puerta y uso de promo), y además MUST llamar
`pushAvailability(hotelId, roomId)`. Una fila con `paymentDeadlineAt` nulo (anterior a #266)
o sin `accessToken` (panel) MUST NOT vencer. Un grupo vence entero o nada; al vencer entero,
`groups.status = 'cancelled'`. El webhook `checkout.session.expired`
(`bookingengine/usecases/stripe.ts#settle`) MUST cerrar la reserva con el MISMO usecase
(`expirePendingReservation`) si sigue `pending` sin pago, y MUST ser no-op con log si ya está
`confirmed`.

`POST /api/public/booking` (single y grupo) MUST persistir `idempotencyKey` (string ≤ 128,
sólo en la líder del grupo) con índice único `(hotelId, idempotencyKey)`
(`idx_reservations_hotel_idempotency`, `migrate-db.ts`). Una segunda llamada con la misma
key y hotel MUST devolver 200 con la misma `reservationId`/`accessToken` y un `checkoutUrl`
recreado, sin crear otra fila; la misma key en otro hotel crea una reserva nueva; si la
reserva ya venció responde 409 `reservation_expired`.

El correo de abandono (`abandon-recovery`) MUST decir el plazo real del hotel
(`{pending_ttl}` desde `pendingTtlMinutes`) y MUST NOT encolarse si la reserva ya venció o
si el hotel no tiene pasarela configurada. `GET /api/public/reservation` expone
`cancellationReason`; la confirmación pública (`booking-confirmation.vue`) muestra "Tu reserva
venció porque no se completó el pago" con CTA "Volver a reservar" cuando
`cancelled` + `payment_timeout`.

#### Scenario: Vence sin pago

- GIVEN una reserva web `pending` con `paymentDeadlineAt` un minuto en el pasado, `deposit` 0 y sin pagos
- WHEN corre el barrido
- THEN queda `cancelled` con `cancellationReason:'payment_timeout'` y se llamó `pushAvailability` con su `roomId`
- AND una con `paymentDeadlineAt` futuro, una con un `payment` `completed`, una sin `accessToken` y una sin `paymentDeadlineAt` siguen `pending`

#### Scenario: Grupo de tres con la líder vencida

- WHEN vence la líder
- THEN las tres hermanas quedan `cancelled` y `groups.status` es `cancelled`

#### Scenario: Webhook expirado

- WHEN llega `checkout.session.expired` de una `pending` → `cancelled`; de una `confirmed` → sigue `confirmed` con `deposit` intacto

#### Scenario: Misma idempotencyKey

- WHEN dos `POST /api/public/booking` con la misma key y hotel
- THEN una sola fila en `Reservations`, misma `reservationId`, la segunda con 200; con otro hotel, dos filas

### Requirement: La reserva vende un tipo; la habitación física se asigna (REQ-HAC-01 mínimo + REQ-HAC-03, #258)

**Modelo (HAC-01, lo mínimo que HAC-03 necesita; el resto de #256 —tipo obligatorio y `roomId`
opcional en el alta— es HAC-05).** `reservations.roomType` (string, indexado) es el tipo vendido
(= `rooms.type`); `roomId` es nullable ("dónde duerme"); `roomAssignedAt`/`roomAssignedBy` registran
quién y cuándo asignó. El alta desde el panel sigue exigiendo `roomId` y rellena `roomType` con el
`type` de esa habitación cuando no viene. Migración por script (`ormMigrate` NO relaja `NOT NULL`):
`scripts/relax-reservations-roomid.ts` (PG `ALTER COLUMN roomid DROP NOT NULL`; SQLite recrea la tabla
sin la restricción, copiando por nombre e índices, en transacción) y
`scripts/backfill-reservation-room-type.ts` (`roomType = rooms.type` de la asignada, SQL puro),
ambos idempotentes y llamados desde `migrate-db.ts` tras `addColumnIfMissing` de las tres columnas.

**Un solo camino para asignar (`usecases/assign-room.ts`).** `validateRoomAssignment` MUST: 400 si la
habitación no existe o no es del hotel de la reserva; 409 `room_not_sellable` si `isRoomSellable`
falla (`maintenance`/`out_of_order`); 409 `room_overlap` (con `conflictReservationId`, `locator` =
`externalLocator || id`, o `blockId`) si otra reserva **asignada** no cancelada/no_show solapa las
noches o hay un `RoomBlock` sobre ellas (`assertNoRoomConflict`); 409 `type_mismatch` (`expected`,
`actual`) si `rooms.type` difiere del tipo vendido y no viene `allowTypeChange` — con él se actualiza
`roomType` y se audita `reservation.room_type_changed`. El tipo vendido es `roomType` o, en filas
anteriores al backfill, el de la habitación actual; sin ninguno no hay mismatch y se fija el de la
unidad. Los códigos viajan en `details.reason` del 409.

`assignRoom` MUST rechazar 409 `invalid_status` en `cancelled`/`no_show`/`checked_out`, ser idempotente
si ya tiene esa habitación, escribir `roomId/roomAssignedAt/roomAssignedBy`, auditar
`reservation.room_assigned` `{from, to}` y emitir `onRoomAssigned({reservationId, hotelId, roomId,
previousRoomId})`. Reasignar una `checked_in` MUST mover el folio abierto (`folios.roomId`), poner la
anterior en `cleaning` (el vocabulario real de "dirty", `shared/usecases/room-status.ts`) y la nueva
en `occupied`, **en la misma transacción que la fila de la reserva** (`ReservasQueries.transaction`,
`FolioRoomWriter.updateReservation`): si mover falla, la reserva no queda apuntando a una unidad cuyo
folio sigue en la anterior. `unassignRoom` sólo en `pending`/`confirmed` (409 `invalid_status`),
deja `roomId/roomAssignedAt/roomAssignedBy` en null, conserva `roomType`, audita
`reservation.room_unassigned` y emite `onRoomAssigned` con `roomId: null`.

**Endpoints** (todos `guard('reservations','edit')` + `moduleGuard`, ownership post-findById con
bypass `super_admin`): `GET /api/reservas/:id/assignable-rooms` devuelve las unidades vendibles del
hotel sin solape esas noches (reservas asignadas + bloqueos; la propia reserva no choca consigo
misma) como `{id, number, floor, status, cleaningStatus: clean|dirty, typeMismatch, suggested}`,
sólo del tipo vendido salvo `?allTypes=1`, ordenadas limpia+available → libre con otro estado →
resto (`suggested` en la primera del primer grupo). `POST /api/reservas/:id/assign-room`
`{roomId, allowTypeChange?}` (`AssignRoomSchema`) y `DELETE /api/reservas/:id/assign-room`. El
controller mapea `ConflictError` a 409 con `details` y hace push de disponibilidad a Channex para la
nueva y la anterior (best-effort).

`PUT /api/reservas/:id` con `roomId` distinto delega en `validateRoomAssignment` (mismos 409; sin
`allowTypeChange` en el body → `type_mismatch`), rechaza 409 `use_unassign_endpoint` si viene vacío,
`use_assign_endpoint` si la reserva está `checked_in` (mover una estadía es `POST /assign-room`) e
`invalid_status` en cerradas; tras persistir audita y emite `onRoomAssigned`. `validate-update.ts`
ya no valida solape por su cuenta: sólo cuando cambian fechas sin cambiar habitación re-chequea la
unidad actual con `assertNoRoomConflict`. `POST /:id/reschedule` con cambio de habitación manda
`allowTypeChange: true` (el quote ya decidió tipo y precio) y, si la reserva está `checked_in`,
pre-valida el rango nuevo y delega en `assignRoom` antes de persistir fechas/total (deuda #314: las
dos escrituras no comparten transacción).

**Código de puerta al asignar (`connectors/reservas-ttlock.ts`, `payment-requests-ttlock.ts`).**
`onRoomAssigned` genera el código TTLock sólo si la reserva está confirmada/pagada (`confirmed`,
`checked_in`, `depositStatus: paid` o saldo 0 con total > 0): primera asignación →
`generateCodeIfAbsent`; cambio de habitación → `generateCode` (que revoca los anteriores:
**un código vigente por reserva**); `roomId: null` → `expireCodesByReservation`. Al pagarse la seña
sólo se genera si la reserva ya tiene habitación (sin unidad no hay cerradura; 0 códigos). Todo
best-effort: TTLock caído no rompe ni la asignación ni el webhook de Stripe.

#### Scenario: asignar en estadía mueve folio y estados
- **GIVEN** una reserva `checked_in` en la 101 con folio abierto
- **WHEN** `POST /assign-room {roomId: 102}`
- **THEN** 200; `folios.roomId = 102`; la 101 queda `cleaning` y la 102 `occupied`; audit `reservation.room_assigned {from: 101, to: 102}`; `onRoomAssigned` con `previousRoomId: 101` y TTLock reemplaza el código

#### Scenario: la ocupada no aparece y el tipo distinto exige el flag
- **GIVEN** la 101 ocupada esas noches por otra reserva y la 201 de tipo `suite` para una reserva `double`
- **WHEN** `GET /assignable-rooms`
- **THEN** no devuelve la 101; sin `?allTypes=1` tampoco la 201; con él la marca `typeMismatch: true`; `POST /assign-room {roomId: 201}` → 409 `type_mismatch` y con `allowTypeChange: true` → 200 con `roomType: suite`

#### Scenario: pago sin habitación no genera código
- **GIVEN** una reserva web pagada sin `roomId`
- **WHEN** llega `onPaymentRequestPaid`
- **THEN** 0 códigos; al asignarle habitación → 1 código activo

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
