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
escritura: primero el TIPO (`shared/usecases/type-availability.ts` → `availableOfType`, 409
`type_sold_out`, ver REQ-HAC-02) y después la unidad (`usecases/assign-room.ts` →
`assertNoRoomConflict`, 409 `room_overlap`, usada por create, reschedule y el PUT/asignación),
excluyendo `cancelled`/`no_show`, permitiendo back-to-back el mismo día
(checkOut de una = checkIn de la otra). El 409 por unidad MUST incluir en `details` las fechas
(`from`/`to`) y el id/localizador de la reserva que ocupa (`conflictReservationId`, `locator`).

#### Scenario: Solapamiento real rechazado

- GIVEN la habitación H1 con reserva activa del 2026-09-10 al 2026-09-15
- WHEN se crea una reserva de H1 del 2026-09-12 al 2026-09-18
- THEN el backend responde 409 `room_overlap` ("La habitación ya está ocupada esas noches", con
  `conflictReservationId`, `from`, `to`) — el chequeo por unidad vive en `assign-room.ts`
  (`assertNoRoomConflict`, REQ-HAC-02); antes de eso el TIPO ya tuvo que tener lugar (`availableOfType`)
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

### Requirement: Un huésped = una ficha al crear la reserva (MR-08, #273)

Toda creación de reserva que trae datos del huésped en lugar de un `guestId` MUST resolver
la ficha con el helper compartido `shared/usecases/find-or-create-guest.ts`, nunca con un
`create` directo en `Guests`: busca por `(hotelId, email lower/trim)`, después por
`(hotelId, teléfono E.164)` (`shared/utils/phone-e164.ts`, comparando también los teléfonos
guardados en cualquier formato) y sólo crea si no hay ninguna. Si la encuentra, reusa su id
y completa `name`/`phone`/`email` SOLO cuando estaban vacíos — nunca pisa lo que el hotel
cargó. El aislamiento es por `hotelId`: el mismo email en otro hotel es otra ficha.

Lo usan los dos POST públicos del motor (`bookingengine/usecases/public-booking.ts`,
`public-booking-group.ts`) DENTRO de su `orm.transaction`, y `POST /api/reservas`
(`reservas/usecases/crud.ts` `createReservation`) cuando el panel manda `guestEmail`
(opcionalmente `guestName`/`guestPhone`) sin `guestId`; esos tres campos NO se persisten en
`reservations`. Con `guestId` presente `guestEmail` se ignora.

Concurrencia: antes de buscar, el helper toma un lock de fila sobre `Hotels` del hotel
(`tx.updateMany('Hotels', {id}, {updatedAt})`) dentro de la tx del motor, después del lock
de `Rooms` (orden fijo Rooms → Hotels). En Postgres eso serializa las altas de huésped del
hotel hasta el COMMIT y la segunda tx ve la ficha de la primera; en SQLite la tx entera ya
está serializada. No hay índice único porque las bases existentes tienen duplicados
históricos: `idx_guests_hotel_email` (`migrate-db.ts`) es no único y
`scripts/merge-duplicate-guests.ts --dry|--apply [--hotel <id>]` los fusiona como paso
post-deploy opcional (canónica = la más antigua; reapunta `guestId` en todas las tablas que
lo tienen y `groups.leadGuestId`, suma `totalStays`/`totalSpent`/`loyaltyPoints`, borra las
demás; idempotente).

#### Scenario: Dos reservas públicas con el mismo email

- GIVEN una reserva web creada con `guestEmail:'Ana@Mail.com '`
- WHEN llega otra con `guestEmail:'ana@mail.com'` (mismo hotel)
- THEN hay UNA fila en `guests` (email `ana@mail.com`) y dos en `reservations` con el mismo `guestId`

#### Scenario: Mismo teléfono en formatos distintos, sin email coincidente

- GIVEN una ficha con `phone:'809-555-0000'`
- WHEN llega una reserva con otro email y `phone:'+1 809 555 0000'`
- THEN se reusa esa ficha (match por E.164) y su `phone` no cambia

#### Scenario: El panel crea con guestEmail sin guestId

- GIVEN el panel manda `{roomId, checkIn, checkOut, totalAmount, guestEmail}` sin `guestId`
- WHEN existe una ficha con ese email en el hotel
- THEN la reserva nace con ese `guestId` y no se crea ninguna ficha; si no existe, se crea una

#### Scenario: Dos POST concurrentes con el mismo email nuevo

- GIVEN dos transacciones simultáneas con `guestEmail` que todavía no existe
- WHEN ambas toman el lock de `Hotels` antes de buscar
- THEN sólo la primera crea; la segunda relee y reusa → una sola ficha

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

### Requirement: Enlace de check-in digital por correo y WhatsApp desde el detalle (#336)

La tarjeta "Check-in digital" del detalle (`ReservationModal.vue`, botones `checkin-link-wa` /
`checkin-link-email`) MUST permitir mandarle al huésped el enlace del formulario.
`POST /api/reservas/:id/send-checkin-link-email` (permiso `reservations:edit`,
`usecases/checkin-link-email.ts`) MUST enviar al email del huésped el evento `checkin_link` de
`notification-defaults` (es/en/pt) con `hotel_name`, `locator` (`externalLocator` o últimos 8 del
id), la invitación y `checkin_url = PUBLIC_URL/checkin/:hash` con `checkinHashFromId(id)` — el MISMO
hash que el `checkinCode` del detalle, nunca el de otra reserva. Ownership fail-closed → 404; sin
email del huésped o sin `PUBLIC_URL` → 400. Cada intento MUST quedar en `message_logs`
(`messageType:'email'`, `status` sent/failed, traza manual
`{kind:'manual', reference:'Enlace de check-in digital', byUserId}`) y se puede reenviar.
El botón "Enviar por WhatsApp" abre `wa.me/<teléfono del huésped>` con hotel, referencia,
invitación y el enlace, y registra `queued` vía `POST /api/reservas/:id/message-log`. Ambos botones
MUST quedar deshabilitados con aviso cuando falta teléfono/correo. Tests:
`reservas/tests/checkin-link-email.test.ts` y `ReservationModal.test.ts` ('check-in digital #336').

#### Scenario: Correo con el enlace de ESA reserva

- GIVEN reserva R del hotel H con huésped con email y `PUBLIC_URL` configurada
- WHEN staff de H con `reservations:edit` hace `POST /api/reservas/R/send-checkin-link-email`
- THEN se encola `checkin_link` al email del huésped con `checkin_url` terminado en
  `/checkin/<checkinHashFromId(R)>` (igual al `checkinCode` del detalle) y queda una fila `sent`
  en `message_logs` con la traza manual; si el encolado falla, queda `failed` y se puede reintentar
- WHEN lo pide staff de otro hotel
- THEN 404 y no se envía nada

#### Scenario: Huésped sin correo/teléfono

- GIVEN reserva cuyo huésped no tiene email ni teléfono
- WHEN se abre la tarjeta "Check-in digital" del detalle
- THEN "Enviar por WhatsApp" y "Enviar por correo" quedan deshabilitados con el aviso
  correspondiente, y el endpoint de correo responde 400 ("El huésped no tiene email cargado")

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
reescribe) y, cuando la composición incluye un bebé (clasificación de `childrenAges`,
`child-composition.ts`) Y el tipo elegido publica la cuna, la pregunta binaria
`needsCrib` (+`cribCount` 1/0 espejo). El backend re-valida cuna y capacidad al crear
— nunca confía en lo que manda el cliente — y en una reserva grupal cada room-line es
su propia fila `reservations` con su propia distribución (`public-booking-group.ts`).
`childrenRatePercentApplied` congela el % infantil efectivamente cotizado (auditoría:
cambiar el % después no toca reservas existentes).

Desde #292 la cuna NO es una configuración global del hotel: es la **amenidad
personalizada de la habitación** `RoomAmenities` con key `custom:cuna` (nombre, `price`
>= 0 e `isActive` por habitación, configurada en Habitaciones → editar; ver REQ-01 #290
más abajo). En el motor público la pregunta "¿Necesita cuna?" (Sí/No, con "(+ $precio)"
cuando tiene precio) se ofrece SOLO si la tarjeta declara al menos un bebé Y el tipo
publica `custom:cuna` en `GET /api/public/hotels/:slug/room-amenities` (unión de sus
unidades vendibles, precio mínimo); "Sí" agrega la key `custom:cuna` a `roomAmenities`
de esa línea y la cuna NO aparece en el checklist genérico de amenidades de la
habitación. En una reserva múltiple cada línea se evalúa contra su propio tipo. El
backend (`public-booking.ts` / `public-booking-group.ts`) resuelve `needsCrib` = bebés > 0
∧ `needsCrib: true` en el body ∧ alguna unidad libre del tipo ofrece `custom:cuna` activa
(`roomsOfferCrib`); si queda en true FUERZA la key `custom:cuna` en `roomAmenities` de la
línea (prefiere una unidad que la ofrezca y cobra su precio real en `roomAmenitiesTotal`,
nunca el del body) y si queda en false la QUITA aunque el cliente la haya mandado;
`cribCount` es siempre el espejo 1/0 de `needsCrib`.

Nota de compatibilidad: el catálogo global de amenidades infantiles (dado de baja en
#292) ya no existe — ni CRUD, ni endpoint público, ni editor, ni checklist en el motor —
y cualquier lista de amenidades infantiles que llegue en el body de la reserva pública
se ignora. Las columnas snapshot `childAmenities`/`childAmenitiesTotal` de `reservations`
se conservan SOLO para leer reservas históricas; toda reserva nueva las persiste en
`[]` / 0.

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
  "Cuna" activa a 15 en sus `RoomAmenities`, y un POST single con `roomType: 'double'`,
  `childrenAges: [1]` (un bebé), `needsCrib: true` y
  `roomAmenities: [{key:'custom:cuna', price: 0.01}]`
- THEN el backend asigna la unidad que ofrece la cuna, `priceBreakdown.roomAmenitiesTotal`
  = 15 (el precio del server, no el del body), el subtotal y el total lo incluyen, y la
  reserva persiste `needsCrib = true`, `roomAmenities` `[{key:'custom:cuna', name:'Cuna',
  price:15, quantity:1, total:15}]` y `roomAmenitiesTotal` = 15
- AND `custom:cuna` tiene una sola fuente de verdad (#292): sin bebé o sin `needsCrib: true`
  la key se descarta del body aunque venga en `roomAmenities`; para cualquier otra key
  `custom:*`, una que ninguna unidad del tipo ofrece, una key fija o una inactiva se ignora
  sin error y no se cobra; en un grupo, solo las filas de la línea que la pidió llevan
  snapshot, cada una al precio de su propia habitación

#### Scenario: Tipo que no publica cuna — no se pregunta y needsCrib queda en false

- GIVEN tipo "single" cuyas unidades no tienen ninguna fila `RoomAmenities` activa con key
  `custom:cuna`, y una tarjeta con 2 adultos y `childrenAges: [1]` (un bebé)
- WHEN el motor público arma la tarjeta
- THEN NO muestra "¿Necesita cuna?" y no manda `needsCrib` ni `custom:cuna`
- AND si un cliente igual hace POST con `needsCrib: true` y `roomAmenities:
  [{key:'custom:cuna'}]`, el backend persiste `needsCrib = false`, `cribCount = 0`, quita
  `custom:cuna` de `roomAmenities` y no cobra nada por ella

#### Scenario: Tipo con cuna a 15, bebé y "Sí"

- GIVEN tipo "double" con una unidad libre que tiene `RoomAmenities` `custom:cuna` activa a
  15, y una tarjeta con 2 adultos y `childrenAges: [1]`
- WHEN el motor público muestra "¿Necesita cuna? (+ $15)" y el cliente elige "Sí"
- THEN el POST lleva `needsCrib: true` y `custom:cuna` en `roomAmenities` de esa línea, y la
  reserva persiste `needsCrib = true`, `cribCount = 1`, `roomAmenities`
  `[{key:'custom:cuna', name:'Cuna', price:15, quantity:1, total:15}]` y
  `roomAmenitiesTotal` = 15 (precio de la fila de la unidad asignada, nunca el del body)
- AND `childAmenities` = `[]` y `childAmenitiesTotal` = 0
- AND sin bebé en la composición no se pregunta, y si el cliente elige "No" no viaja
  `custom:cuna` aunque haya quedado marcada antes

#### Scenario: Grupo de dos habitaciones con bebé en una

- GIVEN reserva grupal de 2 líneas: la primera del tipo "double" (publica `custom:cuna` a 15)
  con bebé y "Sí" a la cuna, la segunda del tipo "single" (sin `custom:cuna`) con un niño
- THEN cada línea persiste sus propios adults/children/childrenAges y SOLO la primera lleva
  `needsCrib = true` validado por el backend (`roomsOfferCrib` contra las unidades de SU
  tipo), con `custom:cuna` a 15 en su snapshot `roomAmenities`; la segunda queda con
  `needsCrib = false`, `cribCount = 0` y sin `custom:cuna`
- AND en el motor público cada tarjeta decide por separado si muestra "¿Necesita cuna?"
  según el catálogo de su propio tipo

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

### Requirement: Composición visible del motor público = composición cotizada (#343)

En el paso "Habitación" del motor público (widget `/book/:slug` → `RoomsStep.vue`, landing →
`BookingModal.vue`, ambos vía `frontend/src/composables/useGuestComposer.ts`) lo que el huésped
compone en cada tarjeta de tipo —adultos, cantidad y edad de cada niño (con su clasificación
niño/bebé y consume/no consume plaza), cuna, amenidades de habitación tildadas y régimen— MUST
persistir hasta que él lo cambie explícitamente. Ese estado (`ComposerState`, keyed por
`roomTypeId`) vive en el store Pinia `booking-widget` (`useBooking.ts` → `composerState`), NO en
la instancia del componente: un re-render, un recálculo de precio, un cambio de paso (el widget
desmonta `RoomsStep`) o cerrar y reabrir el modal MUST NOT reiniciarlo. Sólo lo cambian el
huésped, `editCartLine` (que devuelve una unidad de la línea al composer con exactamente lo
guardado) y `store.reset()` (cambio de hotel / desmontaje del widget). Cada tipo de habitación
tiene su propio estado, independiente del resto (reservas múltiples).

"Agregar esta habitación" MUST guardar en el carrito exactamente la composición visible y MUST
NOT reiniciar la tarjeta: después de agregar, la tarjeta sigue mostrando lo que acaba de entrar
al carrito; un segundo click suma otra unidad a la misma línea (agrupación por composición).

El resumen estimado previo al pago (`EstimatedTotals.vue`, montado en Habitación/Extras) MUST
listar por separado: subtotal de alojamiento (`roomsSubtotal`), cada upsell, cada amenidad de
habitación (`roomAmenityLines`, p.ej. "Cama"), cada régimen (`mealPlanLines`, "incluido" cuando
`priceMode: included`), el descuento promo, cada impuesto con su nombre y % tal como lo publica
`GET /api/public/hotels/:slug/rates` → `taxes` (origen: `configuration('taxes')` con fallback
`hotels.taxRate`, `hotel-taxes.ts`; nunca hardcodeado en la interfaz) y el total estimado. Lo
listado MUST cerrar: alojamiento + extras − descuento + impuestos = total, y una amenidad que
aparece destildada MUST NOT quedar en el total.

#### Scenario: Agregar y editar conserva la composición

- GIVEN una tarjeta con 2 adultos, niños de 5 y 1 años y la amenidad "Cama" (US$200) tildada
- WHEN el huésped pulsa "Agregar esta habitación"
- THEN el carrito tiene una línea con `adults:2`, `childrenAges:[5,1]`, `roomAmenities:[Cama 200]`
- AND la tarjeta sigue mostrando 2 adultos, edades 5 y 1 y Cama tildada
- AND al pulsar "Editar" la línea vuelve al composer con esos mismos datos

#### Scenario: El desglose cierra con la Cama a la vista

- GIVEN alojamiento de 390 + Cama 200 en el carrito y un impuesto ITBIS 18% configurado
- WHEN se muestra el resumen estimado
- THEN aparecen Subtotal 390.00 · Cama 200.00 · ITBIS (18%) 106.20 · Total estimado 696.20

#### Scenario: Destildar quita el importe

- GIVEN la composición anterior
- WHEN el huésped quita un niño, baja a 1 adulto y destilda Cama, y vuelve a agregar
- THEN `roomAmenitiesTotal` es 0 y el total estimado es el alojamiento de 1 adulto más su impuesto

#### Scenario: Cambiar de paso no reinicia la tarjeta

- GIVEN una composición armada en una tarjeta (2 adultos, 2 niños, Cama)
- WHEN el widget desmonta y vuelve a montar `RoomsStep` (otra instancia de `useGuestComposer()`)
- THEN la tarjeta muestra la misma composición y las otras tarjetas conservan la suya

### Requirement: Régimen reservable y cobrado por persona y noche desde la web (MR-03, #268)

El hotel configura sus regímenes en `meal_plans` (`code` breakfast|half_board|all_inclusive,
`active`, `priceMode` included|per_person_per_night, `price`). "Solo alojamiento" (`room_only`)
NO tiene fila: es la base implícita, siempre disponible y sin costo. El motor público MUST
aceptar `mealPlan` por habitación (`mealPlan` en el body single y en cada `rooms[i]` del grupo)
y resolverlo SIEMPRE contra el catálogo del hotel (`public-meal-plan-lines.ts`): precio y modo
se releen de `meal_plans`, nunca del body. Un código inexistente, inactivo o de otro hotel
MUST rechazar con 400 `meal_plan_unavailable` ANTES de escribir nada (a diferencia de las
amenidades, que se ignoran con warn: el régimen cambia el precio que el huésped vio y eligió).
El importe es `price × persons × nights` con `persons = adultos efectivos + niños con plaza`
(`childComposition.effectiveAdults + payingChildren`; bebés y niños libres no pagan) y
`included` → 0. Entra en `subtotal` ANTES de promo e impuestos, se desglosa en
`priceBreakdown.mealPlanTotal` y se resume en `notes` ("Régimen: Media pensión (2 pers × 3
noches = 90.00)"). Cada fila `reservations` persiste el snapshot congelado `mealPlan`,
`mealPlanPriceMode`, `mealPlanUnitPrice`, `mealPlanTotal` (unitario por habitación física;
en un grupo `priceBreakdown.mealPlanTotal` = Σ líneas × quantity) y escribe `regime` con el
mismo código para el panel. Cambiar `meal_plans` después NO altera reservas existentes.
Reservas anteriores o creadas desde el panel quedan `mealPlan = null` (el panel muestra "—" o
el `regime` manual). `GET /rates` MUST devolver `mealPlans[]` activos con `perNight`,
`totalForStay`, `persons` y `nights` ya resueltos para `guests + children` (misma fórmula,
en `chargeCurrency`, sin conversión) y la confirmación pública (`public-reservation.ts`)
expone el snapshot. El widget y la landing ofrecen el régimen como radio por habitación
("Solo alojamiento" + los activos; los no ofrecidos visibles y deshabilitados, sin
"Próximamente"), muestran el importe antes de agregar al carrito y la fila "Régimen: … · N
pers × M noches" en el desglose; el panel lo muestra en el modal, filtra por él en el listado
y lo ve recepción en las llegadas del día.

#### Scenario: Desayuno por persona y noche con niño con plaza y bebé

- GIVEN breakfast `per_person_per_night` 10 activo, 2 adultos + 1 niño con plaza + 1 bebé, 3 noches
- WHEN se reserva con `mealPlan: 'breakfast'`
- THEN `mealPlanTotal = 90`, `subtotal = habitación + 90`, impuestos sobre `(subtotal − promo)`,
  `Reservations.mealPlan = 'breakfast'`, `mealPlanUnitPrice = 10`, `regime = 'breakfast'`
- AND `GET /rates?guests=2&children=1` devolvió `mealPlans[breakfast].totalForStay = 90`

#### Scenario: Régimen inactivo en ese hotel

- GIVEN `half_board` inactivo (o inexistente) para el hotel
- WHEN se reserva con `mealPlan: 'half_board'`
- THEN 400 `meal_plan_unavailable` y ninguna reserva ni huésped creados

#### Scenario: Régimen incluido y snapshot congelado

- GIVEN `all_inclusive` con `priceMode: included`
- WHEN se reserva con él
- THEN `mealPlanTotal = 0`, `mealPlan = 'all_inclusive'`, `mealPlanPriceMode = 'included'`
- AND si después el hotel cambia el precio de un régimen, la reserva ya creada conserva su
  `mealPlanTotal`; una reserva nueva cobra el precio nuevo

#### Scenario: Grupo con regímenes distintos por línea

- GIVEN 2 líneas, una con breakfast y otra con half_board
- WHEN se reserva el grupo
- THEN cada fila `reservations` lleva su propio `mealPlan`/`mealPlanTotal` y
  `priceBreakdown.mealPlanTotal` es la suma

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

### Requirement: Confirmación de pago con desglose completo y recibo PDF (MR-05, #270)

Al pagar por el motor público, `sendBookingPaidEmail` (`shared/usecases/booking-paid-email.ts`,
evento `reservation_confirmed`) MUST armar el correo con el desglose completo desde datos
estructurados de la reserva — nunca desde `notes`: `priceBreakdown` (`subtotal`,
`promoDiscount`, `upsells[{id,name,kind,unitPrice,quantity,nights,persons?,total}]` (MR-10, #275 — la
línea de un extra por persona y noche MUST mostrar personas × noches, no un `× cantidad` plano),
`taxBreakdown[{name,rate,amount}]`,
`total`), `childAmenities`, `roomAmenities`, `promoCode`, `adults`, `children`, `childrenAges`,
`needsCrib`, y las columnas `estimatedArrival` y `specialRequests`, que el widget (single y
grupo) MUST persistir además del texto de `notes`. Variables: `adults`, `children`,
`children_ages`, `crib` (Sí/No por idioma), `meal_plan` (sin régimen persistido → "sólo
alojamiento"), `extras_lines`, `child_amenities_lines`, `room_amenities_lines`, `tax_lines`
(nombre · % · importe), `rooms_lines`, `rooms_count`, `promo_code`, `promo_discount`,
`subtotal`, `estimated_arrival`, `special_requests`, `hotel_logo_url`, `manage_url`
(`{PUBLIC_URL}/h/{slug}/confirm?booking=&token=`), `receipt_url`, `platform_name`. Las
variables `*_lines` son HTML (`<ul><li>`) con cada valor escapado por el usecase y el renderer
MUST NOT re-escaparlas (`isRawHtmlKey`). En un grupo `total_amount` y `deposit_amount` MUST ser
la suma de `totalAmount`/`deposit` de las hermanas no canceladas (MR-11, #276: `settle()`
prorratea el depósito, la líder sola no es lo que pagó el huésped) y `rooms_lines` MUST listar
esas mismas filas por tipo/nombre (nunca el número: la unidad puede reasignarse hasta la
víspera).

`GET /api/public/reservations/:id/receipt.pdf?token=` MUST responder `application/pdf` (A4 vía
`infrastructure/pdf.ts`, template `shared/usecases/payment-receipt.ts`, leyenda "Recibo de
pago · no es factura fiscal": hotel con `ownerTaxId`, huésped, localizador, líneas, impuestos,
total, método y `payments.reference`) con el MISMO HMAC y el MISMO body 404 que
`GET /api/public/reservations/:id` (`reservationTokenMatches`); rate limit 10/min por IP. El
correo MUST adjuntar ese PDF (`EmailQueue.attachments`, base64, techo 8 MB) de forma
best-effort: si la generación falla, el correo sale sin adjunto. La confirmación pública
(`booking-confirmation.vue`, `/h/:slug/confirm`) MUST mostrar "Descargar recibo (PDF)" con el
mismo id+token.

Si el encolado falla, la función MUST devolver `false` sin propagar y MUST crear una
notificación `type:'system'` al hotel (broadcast, sin `userId`) "No se pudo enviar la
confirmación a {email}" con `metadata.link` a la reserva. Las plantillas por defecto es/en/pt
usan "usted" y `{platform_name}`; un override del hotel en `auto_messages` no se pisa (no hay
seed que refrescar) y el flujo del panel (`reservation-email.ts`) parte de
`confirmationVariableDefaults` para que ningún `{placeholder}` llegue literal.

#### Scenario: Reserva con extras, promo e impuestos

- GIVEN una reserva pagada con 1 upsell ×2, 1 amenidad infantil, promo 10, 2 impuestos, 2 adultos + 1 niño (6) y cuna
- WHEN se encola la confirmación
- THEN `extras_lines`, `child_amenities_lines`, `tax_lines`, `promo_discount` y `subtotal` traen los importes exactos de `priceBreakdown` y `total_amount` = `priceBreakdown.total`

#### Scenario: Grupo de tres

- WHEN paga la líder de un grupo de 3 habitaciones
- THEN `total_amount` es la suma de las 3 hermanas y `rooms_lines` tiene 3 entradas sin números de habitación; una hermana cancelada no suma ni se lista

#### Scenario: Recibo público

- WHEN `GET /receipt.pdf` sin token o con token inválido → 404 con el mismo body; con token válido → `application/pdf` con el localizador y la referencia del pago

#### Scenario: El envío falla

- WHEN `enqueueNotification` lanza
- THEN se crea la notificación `system` al hotel con el email del huésped y la función devuelve `false`

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

### Requirement: Disponibilidad por tipo que cuenta reservas sin asignar (REQ-HAC-02, #257)

**Fuente única (`shared/usecases/type-availability.ts`).** `availableOfType(port, hotelId, roomType,
checkIn, checkOut, opts?)` → `{ rooms, booked, available, perNight }`. `rooms` = unidades del tipo con
`isRoomSellable(status)` (una en `maintenance`/`out_of_order` no cuenta). `booked(noche)` = reservas
del hotel del mismo `roomType` en estado bloqueante (`pending`, `confirmed`, `checked_in`) que solapan
esa noche — **asignadas o no** (`reservationOccupiesType`: con `roomId` manda la unidad física; sin
`roomId` manda `roomType`) — más los `RoomBlocks` de unidades del tipo. `available = rooms − booked`
por noche; la estadía entra si `min(available) ≥ n`. `opts.excludeReservationId` excluye la propia
reserva al reprogramar. Las consultas son acotadas (`Rooms {hotelId, type}`, `Reservations {hotelId,
roomType}`), nunca la tabla entera; el core (`countAvailableOfType`) filtra en memoria por tipo.
`daily-availability.ts` (rangos para Channex) comparte el mismo motor por noche.

**Quién decide por tipo.** El motor público (`public-booking.ts`, `public-booking-group.ts`,
`AvailabilityUseCase`), el alta desde el panel (`crud.ts`), la reprogramación (`reschedule.ts`) y la
ingesta OTA (`booking-ingestion.ts`) MUST decidir la disponibilidad con `availableOfType`; el widget y el
grupo responden 409 `No hay habitaciones de este tipo disponibles para esas fechas` / `Solo hay N ...`
cuando `available < cantidad`, y el panel 409 `type_sold_out`. El solape **por habitación** queda
SOLO en el camino de asignar (`assign-room.ts` → `assertNoRoomConflict`); `assertRoomAvailable` y el
`hasOverlap` del widget dejan de existir. Mientras el alta del panel siga exigiendo `roomId`, la
unidad se valida después del tipo con `assertNoRoomConflict` (409 `room_overlap`). La ingesta OTA
elige la primera unidad vendible no ocupada del tipo y, si no hay ninguna, igual crea la reserva
marcando `⚠ OVERBOOKING` en las notas (nunca dropea un booking OTA).

#### Scenario: Tres unidades, tres reservas sin asignar
- **GIVEN** un tipo con 3 unidades vendibles y 3 reservas `confirmed` sin `roomId` con ese `roomType` que solapan la estadía
- **WHEN** se consulta `availableOfType`
- **THEN** `available` es 0 y un cuarto pedido del tipo rebota 409 en widget, grupo y panel

#### Scenario: Mezcla de asignadas y sin asignar
- **GIVEN** 3 unidades, 2 reservas asignadas a unidades del tipo y 1 sin asignar del mismo tipo
- **WHEN** se pide una más
- **THEN** 409: `booked` es 3 y `available` 0

#### Scenario: Unidad fuera de servicio y grupo que no entra
- **GIVEN** 3 unidades con una en `maintenance` y 1 reserva activa
- **WHEN** un grupo pide 2 del tipo
- **THEN** `rooms` es 2, `available` 1 y el grupo rebota 409 con `available: 1`

#### Scenario: Reprogramar no choca consigo misma
- **GIVEN** 1 unidad y la propia reserva ocupándola
- **WHEN** se cotiza el reagendo con `excludeReservationId`
- **THEN** `available` es 1 y el reagendo es posible

### Requirement: El check-in exige habitación y la asigna en el mismo paso (REQ-HAC-04, #259)

**Sin unidad no hay check-in.** `POST /api/reservas/:id/checkin` acepta un body opcional
`CheckinSchema { roomId?: string; allowTypeChange?: boolean }` (`CheckinDTO`). Si la reserva no tiene
`roomId` y el body tampoco lo trae, el servidor MUST responder 409 con `details.reason =
'room_not_assigned'` **sin escribir nada** (ni folio, ni cargo, ni estado). Los chequeos de estado
(`checked_in` → «ya tiene check-in»; fuera de `confirmed|pending` → 409 por estado) MUST correr
**antes** que el de habitación, para que un body con `roomId` nunca asigne una unidad a una reserva
que igual no podía hacer check-in.

**Asignar y entrar en un solo POST.** Con `body.roomId` y la reserva sin unidad, el controller MUST
invocar `assignRoom` (usecases/assign-room.ts, con `allowTypeChange` del body) **antes** de
`executeCheckin`, con los mismos 409 (`room_overlap`, `type_mismatch`, `room_not_sellable`,
`invalid_status`) y el mismo 400 de habitación de otro hotel; si la asignación falla NO hay check-in
y la reserva queda como estaba. Recién con la reserva ya asignada corre el check-in atómico (folio con
esa `roomId`, cargo de la noche, habitación `occupied`), el push a Channex y el email de check-in
con la unidad final. Si la reserva **ya** tiene `roomId`, el body se ignora: cambiar de habitación es
`POST /assign-room`. `executeCheckin` sigue asertando `roomId` (defensa en profundidad): la
invariante `status ∈ {checked_in, checked_out} ⇒ roomId` se mantiene.

**Pre-check-in y panel.** `getPreCheckinData` MUST tolerar `roomId = null` (no consulta `Rooms` con
`{ id: null }`) y devolver `roomType` (el vendido o, si la fila es anterior al backfill, el de la
unidad) además de `roomNumber` (vacío sin unidad). En el panel, el botón **Check-in** de una reserva
sin unidad abre «Asignar habitación» (RoomAssignModal en modo check-in: sugerida preseleccionada,
ocupadas deshabilitadas) y confirma con un único `POST /checkin { roomId, allowTypeChange? }`.

#### Scenario: Check-in sin habitación y sin body
- **GIVEN** una reserva `confirmed` con `roomId = null` y `roomType = 'double'`
- **WHEN** se hace `POST /api/reservas/:id/checkin` sin body
- **THEN** responde 409 con `details.reason = 'room_not_assigned'`, la reserva sigue `confirmed` sin `roomId` y no existe ningún folio

#### Scenario: Check-in con habitación ocupada en el body
- **GIVEN** la misma reserva y la habitación 102 ocupada esas noches por otra reserva
- **WHEN** se hace `POST /checkin { roomId: '102' }`
- **THEN** responde 409 `room_overlap` con el localizador que choca, la reserva sigue `confirmed` sin `roomId` y sin folio

#### Scenario: Check-in con habitación libre en el body
- **GIVEN** la misma reserva y la habitación 101 libre y del tipo vendido
- **WHEN** se hace `POST /checkin { roomId: '101' }`
- **THEN** responde 200; la reserva queda `checked_in` con `roomId = '101'` y `roomAssignedAt`, el folio abierto lleva `roomId = '101'` y la habitación pasa a `occupied`. Con una unidad de otro tipo sin `allowTypeChange` es 409 `type_mismatch`; con `allowTypeChange: true` entra y `roomType` pasa al de la unidad

### Requirement: Extras pagados online entran al folio como cargos (MR-04, #269)

Cada extra que el huésped paga por el motor público —upsell, amenidad infantil, amenidad de
habitación; el régimen se suma cuando llegue MR-03— MUST materializarse como fila
`reservation_addons` en la MISMA transacción que crea la reserva (`public-booking.ts`,
`public-booking-group.ts`), con `source:'booking_engine'`, `kind`
`upsell|child_amenity|room_amenity`, `description`, `quantity`, `amount` (unitario),
`unitPrice` y `taxRate` (helper puro `shared/usecases/booking-engine-addons.ts`). En un grupo
todos los addons cuelgan de la reserva líder (la que lleva `priceBreakdown` y cobra Stripe);
las hermanas no reciben ninguno. Esas filas YA están dentro de `totalAmount`, así que
`addonsTotal`/`chargeableTotal`/`pendingBalance` (`shared/utils/reservation-balance.ts`) y las
líneas de `invoice-from-reservation.ts` MUST ignorarlas: sumarlas cobraría dos veces.

Al check-in (`reservas/usecases/checkin.ts`) el folio MUST recibir un `folio_charges`
`category:'extra'`, `source:'checkin'`, `reference:'addon:<id>'` por cada addon
`booking_engine` (impuesto de `configuration('taxes')`, mismo que la noche) ANTES de acreditar
el prepago, y el tope de `capPrepaidLines` MUST ser noche + extras. La idempotencia es por
`reference` contra los cargos existentes del folio. El night audit
(`folios/usecases/night-audit.ts`) MUST hacer el mismo posteo (`source:'night_audit'`) para
las reservas `checked_in` cuyo folio aún no tenga esos cargos — cubre estadías vivas al
momento del deploy — y lo informa como `extrasPosted`. `settle-folio-at-checkout` no cambia.

El panel (`ReservationModal.vue`) MUST mostrar la sección "Extras pagados" (una línea por
addon del motor + desglose completo de `priceBreakdown`) sin leer `notes`, y el CRUD manual
de servicios adicionales MUST excluir los `source:'booking_engine'`. El modal de checkout
(`pages/checkin/index.vue`) MUST avisar "Extras pagados online sin cargo en el folio: $X"
cuando `upsellsTotal + childAmenitiesTotal + roomAmenitiesTotal (+ mealPlanTotal)` del
`priceBreakdown` supera la Σ `amount` de los cargos `category:'extra'` del folio.
`scripts/backfill-reservation-addons-from-breakdown.ts` (paso post-deploy, idempotente) crea
las filas para las reservas del motor anteriores al cambio a partir de
`priceBreakdown`/`childAmenities`/`notes`.

#### Scenario: Reserva pública con extras

- GIVEN habitación 100/noche, upsell Transfer 30, amenidad infantil Cuna 10, impuesto 18 %
- WHEN `POST /api/public/booking` por 1 noche
- THEN `reservation_addons` tiene 2 filas `source:'booking_engine'` con Σ 40 y
  `reservations.totalAmount = 165.20`

#### Scenario: Check-in con extras pagados

- GIVEN esa reserva con un pago `completed` de 165.20
- WHEN `POST /:id/checkin`
- THEN el folio tiene 3 cargos (100+18, 30+5.40, 10+1.80) y crédito prepago 165.20 → saldo 0,
  sin "a favor"; un segundo check-in responde 409 y los cargos `addon:<id>` siguen siendo 2

#### Scenario: Grupo

- GIVEN grupo de 2 habitaciones con upsell y amenidad
- WHEN se crea y hace check-in
- THEN los addons y sus cargos están sólo en la líder; la hermana sólo tiene su noche

#### Scenario: Checkout

- GIVEN folio con noche + 2 extras y prepago 165.20
- WHEN checkout
- THEN factura con 3 líneas, `amountPaid = total`, saldo 0 y `creditBalance` 0

### Requirement: Reintentar el reembolso de una cancelación web (#272)

`POST /api/reservas/:id/retry-refund` (permiso `reservations:edit`; ownership post-findById con
bypass `super_admin`; sin body) vuelve a ejecutar en Stripe el reembolso que
`shared/usecases/web-booking-refund` dejó `failed` al cancelar desde el motor público
(`usecases/retry-refund.ts`, puerto `retryWebRefund` cableado por
`connectors/bookingengine-refunds.ts`; sin puerto → 400, fail-closed). MUST aplicar sólo a
reservas `cancelled` con `refundAmount > 0` (409 en otro caso) y usar SIEMPRE el
`refundAmount` de la reserva, nunca uno del cliente. Idempotente: `refundStatus:'done'` responde
200 con el estado actual sin tocar la pasarela. MUST responder 409 ("reembolso en curso") si hay
un `refundStatus:'pending'` FRESCO (escrito hace menos de `REFUND_PENDING_STALE_MS`, 10 min —
helper `isRefundInFlight`): es un reembolso en vuelo esperando a Stripe y el compare-and-swap
`claimRefund` (guard por `updatedAt`) solo no lo ve; un `pending` viejo (proceso muerto tras
reclamar) sí se reintenta. Mueve dinero → MUST auditar `reservation.refund_retry`
(`userId` del token, `detail: resultado=<status> monto=<refundAmount> refundPaymentId=<id|->`)
y el refund en `payments` se asienta a nombre del usuario que reintentó (no de `system`).
Respuesta 200 `{reservationId, refundStatus, refundedAt, refundPaymentId, refundAmount}`
releídos de la reserva.

#### Scenario: Reintento sobre un reembolso fallido

- GIVEN reserva `cancelled`, `refundAmount:100`, `refundStatus:'failed'`
- WHEN `POST /:id/retry-refund` con un usuario `reservations:edit` del hotel
- THEN 200 con `refundStatus:'done'`, `refundPaymentId` y `refundedAt`; `payments.refundPayment`
  recibió 100 con ese usuario como actor; audit `reservation.refund_retry` con
  `resultado=done monto=100 refundPaymentId=<id>`

#### Scenario: Ya reembolsada

- GIVEN `refundStatus:'done'`
- WHEN `POST /:id/retry-refund`
- THEN 200 con el estado actual y NO se llama a la pasarela

#### Scenario: Reembolso en curso

- GIVEN `refundStatus:'pending'` con `updatedAt` de hace 1 minuto
- WHEN `POST /:id/retry-refund`
- THEN 409 "Ya hay un reembolso en curso" sin llamar a la pasarela ni auditar
- AND con `updatedAt` de hace 15 minutos el reintento sí se ejecuta

#### Scenario: Sin plata que devolver o de otro hotel

- WHEN `POST /:id/retry-refund` sobre una reserva `confirmed`, o `cancelled` con `refundAmount:0`
- THEN 409 sin efectos
- AND un `hotel_admin` de otro hotel recibe 403

### Requirement: Rechazo manual de una reserva web pendiente de aprobación (#271 MR-06)

Cuando el hotel tiene apagada la "confirmación instantánea", una reserva web nace pagada pero
con `approvalStatus:'pending'`. El hotel MUST poder rechazarla, el huésped MUST enterarse del
resultado (aprobada o rechazada) por email y el hotel MUST recibir un recordatorio si se pasa
del plazo que él mismo configuró.

**Rechazar.** `POST /api/reservas/:id/reject { reason }` (`reservas/usecases/reject.ts`) MUST
exigir el permiso `reservations:edit` — el MISMO que aprobar; `/panel/roles` NO necesita un
permiso nuevo. `reason` MUST tener ≥ 10 caracteres (400): es el texto que lee el huésped. Sólo
una reserva con `approvalStatus:'pending'` y no cancelada se puede rechazar (409); una reserva
de otro hotel responde 404 (nunca 403). El rechazo MUST dejar `approvalStatus:'rejected'`,
`status:'cancelled'`, `cancellationReason` = motivo, reembolsar el 100 % de lo cobrado por
Stripe vía `payments.refundPayment` (fila `payments` `type:'refund'`, el cobro original pasa
a `refunded`), llamar `pushAvailability(hotelId, roomId)`, emitir `onReservationCancelled`
(libera depósito, código de puerta y uso de promo) y encolar el email `reservation_rejected`
con `{rejection_reason}` y `{refund_amount}`. Un grupo se rechaza entero desde cualquiera de
sus reservas con UN solo reembolso (el cobro vive en la líder); si falla el refund, la
reserva MUST NOT quedar cancelada.

**Aprobar.** `POST /api/reservas/:id/approve` MUST encolar `reservation_approved` al huésped
y marcar como leídas las notificaciones de la campanita del hotel asociadas a esa reserva
(`closeReservationNotifications`). Ambas plantillas (`reservation_approved`,
`reservation_rejected`) tienen defaults en `services/notification-defaults.ts` y el hotel las
edita en Marketing → Plantillas.

**Plazo y recordatorio.** `booking_config.approvalDeadlineHours` (entero 1–168, default 24,
editable en `/panel/booking-engine`). El cron `shared/usecases/approval-reminder-cron.ts`
MUST avisar al hotel (campanita + email interno) por cada reserva `approvalStatus:'pending'`
no cancelada cuyo `createdAt + approvalDeadlineHours` ya pasó, UNA sola vez por reserva
(marca `reservations.approvalReminderAt`; un grupo cuenta como una). El cron MUST NOT
aprobar ni rechazar automáticamente: sólo recuerda. Kill-switch
`BOOKING_APPROVAL_REMINDER_DISABLED=1` (loguea y no barre).

**Huésped.** `GET /api/public/reservation` MUST exponer `approvalStatus`
(`pending|approved|rejected|null`) y `approvalDeadlineHours`, y SOLO cuando
`approvalStatus:'rejected'` también `rejectionReason` y `refundAmount` (en cualquier otro
estado, `null`). La confirmación pública (`booking-confirmation.vue`) MUST mostrar, bajo el
aviso de "pendiente de aprobación", "El hotel revisará su reserva en las próximas {hours} h"
(`data-testid="confirm-approval-deadline"`); y si la reserva fue rechazada, en lugar del
bloque de éxito, "El hotel no pudo confirmar su reserva" con el motivo del hotel y el importe
devuelto (`data-testid="confirm-rejected"`, `confirm-rejected-reason`), sin botón "Cancelar
reserva". Una reserva `cancelled` + `approvalStatus:'rejected'` MUST NOT caer en la rama
"venció" ni en la de "pago rechazado".

**Database changes:** `reservations.approvalReminderAt` (TEXT, nullable — dedup del
recordatorio); `booking_config.approvalDeadlineHours` (INTEGER, nullable → 24). Ambas vía
`addColumnIfMissing` en `migrate-db.ts`; `approvalStatus` admite el valor `'rejected'`.

**API endpoints:** `POST /api/reservas/:id/reject { reason }` (`reservations:edit`) →
200 con la reserva + `refundedAmount` y `rejectedCount`; 400/404/409 según arriba.
`POST /api/reservas/:id/approve` sin cambios de contrato. `PUT /api/booking-engine/config`
acepta `approvalDeadlineHours`. `GET /api/public/reservation` suma los campos de arriba.

**UI requirements:** panel `/panel/reservations` con botón "Rechazar" junto a "Aprobar" para
las pendientes de aprobación, modal `RejectReservationModal.vue` con motivo obligatorio
(≥ 10) y aviso del reembolso; `/panel/booking-engine` con "Horas para aprobar" (1–168);
confirmación pública con plazo y rama rechazada (es/en/pt en `useBookingI18n.ts`).

#### Scenario: Rechazo con reembolso

- GIVEN una reserva web `pending` de aprobación con un pago Stripe `completed` de 150.00
- WHEN `POST /api/reservas/:id/reject { reason: 'Sin disponibilidad real esa noche' }` por un usuario con `reservations:edit`
- THEN queda `approvalStatus:'rejected'`, `status:'cancelled'`, `cancellationReason` = motivo, hay una fila `payments` `type:'refund'` de 150.00, se llamó `pushAvailability` y se encoló `reservation_rejected` con motivo e importe

#### Scenario: Motivo corto, estado incorrecto, otro hotel

- WHEN el motivo tiene 5 caracteres → 400; la reserva ya está `approved` o `cancelled` → 409; es de otro hotel → 404

#### Scenario: Grupo

- GIVEN un grupo de 3 con el cobro en la líder
- WHEN se rechaza cualquiera de las tres
- THEN las tres quedan `cancelled`/`rejected` y hay UN solo refund

#### Scenario: Aprobación avisa al huésped

- WHEN `POST /api/reservas/:id/approve`
- THEN se encola `reservation_approved` y las notificaciones del hotel de esa reserva quedan leídas

#### Scenario: Recordatorio una sola vez

- GIVEN `approvalDeadlineHours` 24 y una reserva pendiente creada hace 25 h
- WHEN corre el cron dos veces
- THEN el hotel recibe UN aviso, `approvalReminderAt` queda seteado y la reserva sigue `pending` (no se aprobó ni rechazó); con `BOOKING_APPROVAL_REMINDER_DISABLED=1` no se avisa

#### Scenario: Confirmación pública

- WHEN el huésped abre la confirmación de una reserva pendiente → ve "El hotel revisará su reserva en las próximas 24 h"
- AND de una rechazada con `refundAmount` 150.00 → ve "El hotel no pudo confirmar su reserva", "Se reembolsó 150.00 USD al medio de pago original" y el motivo, sin enlace "Cancelar reserva"

### Requirement: Envío automático de la habitación asignada al huésped (#297)

El hotel MUST poder configurar con cuánta anticipación se le manda al huésped la información
de su habitación **realmente asignada**, y el sistema MUST mandarla solo por el canal que el
hotel eligió, sin hardcodear el plazo.

**Configuración.** `configuration` key `room_info_config` por hotel (`GET/POST
/api/configuracion`, editable en `/panel/settings` → "Datos de la habitación al huésped"):
`{ enabled: boolean, hoursBefore: 1–168, channel: 'email'|'whatsapp'|'both',
whatsappTemplateId: string }`. `parseRoomInfoConfig` (`shared/usecases/room-info-notice.ts`)
aplica defaults `{enabled:false, hoursBefore:24, channel:'email'}` y clampa las horas: un
valor fuera de rango NUNCA apaga ni desborda el aviso. Kill-switch operativo
`ROOM_INFO_NOTICE_DISABLED=1` (loguea y no barre).

**Cron.** `shared/usecases/room-info-cron.ts` (tick 10 min, registrado en
`composition-root.ts`) MUST recorrer, por hotel habilitado, las reservas `confirmed` (lista
blanca: `pending` no pagó, `checked_in` ya tiene la habitación) con llegada real —
`reservationAccessWindow().startMs`, en la zona del hotel — a `<= hoursBefore` horas y no más
de 24 h pasada. Sin `roomId` MUST NOT mandar nada (CA13). En cada tick relee habitación,
código vigente de `lock_codes` (`status:'active'`) y huésped: el aviso lleva SIEMPRE los datos
actuales (CA14).

**Contenido.** Número de habitación, nombre/identificador si existe, código de acceso si hay
uno activo, horario de acceso (`effectiveCheckInTime/OutTime`) y enlace al check-in digital
(`PUBLIC_URL/checkin/<hash>`) si `preCheckinStatus != 'completed'`. Una sección sin dato no se
muestra; nunca se manda un campo vacío o inventado. Email renderizado en runtime
(`renderRoomInfoEmail`, encolado con `EmailService.enqueue`, `relatedType:'room_info'`);
WhatsApp por la Cloud API de Meta con la plantilla **aprobada** que el hotel configuró
(`reservas.whatsappPort`, variables por `resolverVariables`, que ahora resuelve `lock_codes`).

**Dedup y reintento.** Cada intento MUST quedar en `message_logs` con `channel`
(`email`|`whatsapp_api`), `status` (`sent`|`failed`), `recipient`, `sentAt`, `errorMessage`
(motivo ya traducido) y `response = auto:room_info:<huella>`, donde la huella es
`sha256(roomId|código)` recortada (no deja el PIN en texto plano). Misma huella + canal ya
`sent` → MUST NOT reenviar (CA15); huella distinta (se reasignó la habitación o cambió el
código) → se manda de nuevo con los datos nuevos. Un `failed` se reintenta en el tick
siguiente hasta 3 veces por huella + canal (CA20); el tope se reinicia solo si cambia la
huella. Sin plantilla aprobada, sin teléfono válido, sin WhatsApp conectado o sin email del
huésped, el intento queda `failed` con su motivo, visible en Mensajería → Historial de envíos.

#### Scenario: Anticipación configurable

- GIVEN `room_info_config` `{enabled:true, hoursBefore:12, channel:'email'}` y una reserva `confirmed` con habitación 204 que llega mañana 15:00
- WHEN corre el cron faltando 13 h → no manda; faltando 11 h → encola UN email con "204", el código activo de `lock_codes` y el horario de acceso, y deja `message_logs` `channel:'email'`, `status:'sent'`
- AND con `hoursBefore:48` manda faltando 40 h

#### Scenario: Sin habitación, sin duplicados, datos actualizados

- GIVEN la misma config y una reserva sin `roomId` → el cron no manda ni registra nada
- WHEN corre dos veces sobre una reserva ya avisada → un solo envío
- AND se reasigna la reserva a otra habitación → el siguiente tick manda el aviso con la habitación nueva

#### Scenario: Fallo registrado y reintento

- GIVEN el encolado del email falla
- THEN queda una fila `failed` con `errorMessage` y el tick siguiente reintenta; tras 3 `failed` con la misma huella no vuelve a intentar hasta que cambie la habitación o el código

#### Scenario: WhatsApp según config

- GIVEN `channel:'both'` y una plantilla `approved` con `{room_number}` y `{lock_codes}` → email + `sendTemplate` con el número y el código, fila `whatsapp_api` `sent` con `providerMessageId`
- AND `channel:'whatsapp'` sin plantilla configurada → fila `whatsapp_api` `failed` con motivo, sin llamar a Meta

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
