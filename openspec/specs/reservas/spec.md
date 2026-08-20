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
- ~~**CORS sin headers en 401**~~: resuelto con `corsWithErrorHeaders`
  (`shared/middlewares/cors-error-headers.ts`) — el ErrorContract lanzado se convierte a
  respuesta ANTES de que el cors la decore, así el 401/403/409/429 llega con
  `Access-Control-Allow-Origin` y el browser no lo reporta como error de CORS.
