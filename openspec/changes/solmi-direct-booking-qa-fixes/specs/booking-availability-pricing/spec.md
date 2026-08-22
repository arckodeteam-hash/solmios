# Booking Availability & Pricing Integrity Specification

## Purpose

Cerrar los gaps de integridad del motor de reservas directo entre **búsqueda**,
**selección** y **pago**: hoy el widget puede mostrar un tipo de habitación sin
disponibilidad real, un precio que ignora la configuración de ocupación del hotel, o
dejar avanzar una búsqueda cuya ocupación excede la capacidad de la habitación. Cubre
las Tareas 1, 2, 10, 11, 12 y 15 del documento de hallazgos de QA (2026-08-20).

Fuente de la regla de negocio: SIEMPRE el PMS (inventario, tarifas, capacidad
configurados por el hotel). El motor consulta y valida — nunca decide por sí mismo.

## Requirements

### Requirement: Disponibilidad real en el resultado de búsqueda — VERIFICADO, YA CUMPLE

El motor MUST consultar el inventario real para las fechas seleccionadas antes de
mostrar un tipo de habitación como resultado. Un tipo de habitación sin unidades libres
para el rango buscado MUST NOT aparecer en los resultados.

**Auditado 2026-08-20**: `AvailabilityUseCase.aggregate()`
(`backend/src/modules/bookingengine/usecases/availability.ts`) ya excluye del todo un
tipo sin ninguna unidad vendible, y `GET /rates` hereda ese filtro. Cubierto por test
dedicado `tests/public-rates-occupancy-integrity.test.ts` (caso "sin NINGUNA unidad
libre el tipo sí se cae"). Sin trabajo pendiente en este requirement — se deja
documentado como referencia, no como pendiente de implementación.

#### Scenario: Tipo de habitación sin disponibilidad se oculta

- GIVEN un hotel con 14 habitaciones, todas las "Estándar" ocupadas para 2026-09-10 a
  2026-09-12
- WHEN un huésped busca disponibilidad para esas fechas
- THEN el resultado NO incluye "Estándar" como opción reservable

#### Scenario: Resultado incluye solo tipos con inventario libre

- GIVEN un hotel con Estándar (0 libres) y Deluxe (3 libres) para el rango buscado
- WHEN se ejecuta la búsqueda
- THEN el resultado devuelve únicamente Deluxe, con `availableCount=3` y la tarifa
  aplicable a esas fechas

### Requirement: El calendario no puede prometer un rango que la búsqueda no puede cumplir

**Hallazgo real (auditado 2026-08-20)**: `GET /calendar` (que alimenta tanto
`RateCalendar.vue` de la landing como `CalendarView.vue` del widget) calcula la
disponibilidad de cada día como la suma agregada de TODOS los tipos de habitación
(`public-calendar.ts`, `available += free` por cada tipo). Una noche se marca
seleccionable si CUALQUIER tipo tiene stock ese día — no valida que un mismo tipo
tenga stock continuo para todo el rango. Esto permite armar un rango donde cada noche
individual "tiene lugar" (de algún tipo), pero ningún tipo tiene disponibilidad
continua para el rango completo, y `GET /rates` devuelve `roomTypes: []` recién
después de que el huésped ya eligió fechas.

**Decisión de alcance (2026-08-20)**: NO se modifica el cálculo de disponibilidad del
calendario (day-level agregado) — evita tocar el contrato de `GET /calendar`, su cache
(`rate-calendar:*`), y los dos componentes que lo consumen. En su lugar, el motor
MUST comunicar con claridad el caso "rango sin ningún tipo con disponibilidad
continua" en el paso siguiente (selección de habitación), en vez de un estado vacío
genérico indistinguible de "este hotel no tiene nada".

#### Scenario: Calendario permite un rango que ningún tipo cubre completo

- GIVEN Tipo A libre la noche 1 pero ocupado la noche 2, Tipo B ocupado la noche 1 pero
  libre la noche 2 (ambas noches muestran stock agregado > 0 en el calendario)
- WHEN el huésped selecciona ese rango de 2 noches en el calendario
- THEN el calendario permite la selección (comportamiento actual, sin cambios)
- AND al llegar al paso de habitaciones, `GET /rates` devuelve `roomTypes: []`
- AND el widget MUST mostrar un mensaje específico explicando que ESE rango no tiene
  ningún tipo con disponibilidad continua (no un "no hay resultados" genérico),
  sugiriendo probar otro rango o fechas más cortas

#### Scenario: Día realmente agotado sigue bloqueado (sin cambios)

- GIVEN un día sin ninguna unidad libre de ningún tipo
- WHEN el huésped intenta seleccionarlo en el calendario
- THEN sigue sin ser seleccionable (`day.closed=true`), comportamiento actual intacto

### Requirement: La vitrina comercial de habitaciones no depende de una búsqueda de fechas

**Hallazgo real (2026-08-20)**: la sección "Habitaciones" de la landing pública
(`RoomsBlock.vue`) es contenido comercial (qué tipos vende el hotel), no el resultado
de una búsqueda de disponibilidad. Antes reusaba `GET /rates` con una fecha indicativa
fija ("mañana + N noches") para decidir qué tarjetas mostrar — un tipo ocupado justo
esa ventana puntual (ej. reservado varios días que solapan con "mañana") desaparecía
ENTERO de la vitrina, aunque fuera un producto real y vendible en cualquier otra
fecha.

El motor MUST separar "qué tipos de habitación vende el hotel" (catálogo, no depende
de fechas ni de reservas) de "qué está disponible para ESTA búsqueda" (`/rates`). La
vitrina comercial MUST mostrar todos los tipos configurados por el hotel, enriquecidos
con precio/disponibilidad en vivo cuando `/rates` los incluya, y con un precio base de
referencia cuando no.

**RESUELTO 2026-08-20**: nuevo endpoint `GET /api/public/hotels/:slug/room-types`
(catálogo sin filtro de disponibilidad) + merge en el orquestador de la landing.

#### Scenario: Tipo reservado en la ventana indicativa sigue en la vitrina

- GIVEN una Suite reservada para varios días que incluyen la ventana indicativa
  ("mañana + 2 noches") que la landing usa para pedir `/rates`
- WHEN se carga la sección "Habitaciones" de `/h/:slug`
- THEN la Suite sigue apareciendo, con un precio de referencia (`basePrice × noches`)
  en vez de desaparecer de la vitrina

#### Scenario: Catálogo caído no rompe la vitrina

- GIVEN `GET /room-types` falla (caído, 500, timeout)
- WHEN se carga la sección "Habitaciones"
- THEN la vitrina muestra exactamente lo que `/rates` haya traído, sin error visible
  (degradación graceful, comportamiento previo a este fix)

### Requirement: Precio derivado de la configuración de ocupación del hotel

El motor MUST calcular el precio mostrado a partir de la configuración de tarifa por
ocupación que el hotel definió en el PMS, no de una regla propia del motor. Un hotel
MAY configurar tarifa creciente por huésped adicional, o MAY configurar tarifa plana
hasta la capacidad máxima; el motor MUST respetar cualquiera de las dos sin lógica
hardcodeada.

**Auditado 2026-08-20 — el motor YA cumple, el gap real estaba en la configurabilidad**:
`shared/utils/rate-resolution.ts` (`pickRate`/`sumStayPrice`) ya resuelve el precio por
`room_rates.occupancy` correctamente — el motor no decide nada por su cuenta. El gap
real es que **no había forma accesible de configurar la Configuración A** (tarifa
creciente por ocupación) desde el panel: la única pantalla con el switch
"por habitación / por huésped" y la grilla por ocupación era
`ChannelRatesEditor.vue`, montado únicamente dentro de Channel Manager → el detalle de
un canal OTA ya conectado (`channel-detail/index.vue`). Un hotel sin canal conectado
(caso común, sobre todo reserva-directa-only) no tenía forma descubrible de activarla
y quedaba siempre en `Rooms.basePrice` plano.

**RESUELTO 2026-08-20**: el switch "Por habitación / Por huésped" y la grilla por
ocupación se agregaron a `/panel/tarifas` ("Temporadas y Tarifas"), la pantalla natural
donde un hotelero configura precios — sin depender de tener un canal conectado.
Backend: `PricingQueries.listBaseRates()` (nueva) devuelve las tarifas base reales si
existen, o las deriva de `Rooms` × `pricing_mode` (mismo criterio "nunca vacío" que ya
usaba `listChannelRates` para canales, ahora también para la base). Alcance acotado:
cambiar el modo con tarifas YA guardadas no las reparte de nuevo automáticamente (evita
pisar precios/cierres ya configurados sin pedido explícito) — mismo comportamiento
preexistente en `listChannelRates`, no una limitación nueva.

#### Scenario: Tarifa creciente por huésped

- GIVEN una habitación configurada con 1 huésped=RD$4,000, 2=RD$5,000, 3=RD$6,000
- WHEN el huésped cambia la ocupación de 1 a 2 en el buscador
- THEN el precio mostrado se actualiza de RD$4,000 a RD$5,000

#### Scenario: Tarifa plana hasta capacidad máxima

- GIVEN una habitación configurada con RD$5,000 fijo para 1 a 4 huéspedes
- WHEN el huésped cambia la ocupación de 1 a 4
- THEN el precio mostrado permanece en RD$5,000 en todos los casos

#### Scenario: Hotel sin canales conectados puede activar precio por huésped igual

- GIVEN un hotel de reserva directa, sin ningún canal OTA conectado en Channel Manager
- WHEN el hotelero entra a `/panel/tarifas` y togglea "Por huésped"
- THEN la matriz se re-arma con una fila por ocupación (1..capacidad) por tipo,
  sin necesitar pasar por Channel Manager

### Requirement: Ocupación validada contra capacidad de la habitación

El motor MUST descartar como resultado válido cualquier tipo de habitación cuya
capacidad configurada sea menor a la ocupación solicitada por habitación en la
búsqueda.

#### Scenario: Búsqueda excede capacidad de la única opción

- GIVEN una habitación con capacidad máxima de 2 adultos
- WHEN se busca 1 habitación para 4 adultos
- THEN esa habitación NO aparece como resultado válido, aunque tenga inventario libre

**HALLAZGO Y FIX 2026-08-21 — la capacidad se validaba en la BÚSQUEDA pero no al
ESCRIBIR la reserva**: este requirement ya cumplía para `/rates` (matriz de
ocupación, `over_capacity`) y `AvailabilityUseCase` (búsqueda/agregado). Pero
`createPublicBookingDirect` (`public-booking.ts`, 1 habitación) y
`createPublicBookingGroup` (`public-booking-group.ts`, grupo) — los dos endpoints
que efectivamente CREAN la reserva — no volvían a chequear `room.capacity` contra
la ocupación pedida al elegir la unidad física. La UI ya bloquea esto (fila
deshabilitada), pero un POST directo a la API pública (sin auth, incluyendo el path
de compat con `roomId` explícito) podía crear una reserva con más huéspedes de los
que la habitación admite. RESUELTO: ambos usecases ahora filtran las unidades
candidatas por capacidad antes de asignar (priorizando capacidad sobre precio,
cubre tipos con unidades de capacidad mixta), y `public-booking.ts` agrega además
una red de seguridad final que cubre el path `roomId` directo. Ver Tarea 10 en
`tasks.md` para el detalle de verificación (8 tests nuevos, confirmados con revert
manual).

### Requirement: Búsqueda combinada — fechas + inventario + habitaciones + ocupación + capacidad + tarifa

El motor MUST evaluar simultáneamente disponibilidad, cantidad de habitaciones
solicitadas, huéspedes por habitación, capacidad configurada y tarifa aplicable en una
sola operación de búsqueda — no en pasos independientes que puedan divergir entre sí.

### Requirement: Múltiples habitaciones del mismo tipo en una reserva

El motor MUST permitir reservar N unidades del mismo tipo de habitación en una sola
operación, siempre que N no supere el inventario disponible para esas fechas. El motor
MUST NOT forzar al huésped a completar reservas separadas para unidades del mismo tipo.

#### Scenario: 2 unidades Deluxe en una sola reserva

- GIVEN el huésped busca 4 adultos / 2 habitaciones, y hay 3 Deluxe disponibles
- WHEN selecciona "Deluxe × 2"
- THEN el motor crea una única reserva con 2 unidades de Deluxe, sin pedir una segunda
  reserva independiente

#### Scenario: Cantidad solicitada excede inventario

- GIVEN hay 1 Deluxe disponible
- WHEN el huésped intenta seleccionar "Deluxe × 2"
- THEN el motor rechaza la selección y muestra el máximo real disponible (1)

### Requirement: Combinar tipos de habitación distintos en una reserva

**DECISIÓN TOMADA 2026-08-21 — Opción A**: una misma reserva SÍ permite combinar
unidades de tipos de habitación distintos (ej. 1 Estándar + 1 Deluxe), además de
múltiples unidades del mismo tipo (Tarea 10 original). Confirmado explícitamente por
el dueño de producto al ampliar el alcance de Tarea 10.

**Modelo de datos elegido (frente a la alternativa de una entidad "Booking" nueva)**:
reusar `Groups` (módulo `grupos`, YA EXISTÍA — hoy usado por el panel para reservas de
agencia armadas a mano) + `Reservations.groupId` (columna YA EXISTENTE, apuntaba a
`Groups` desde antes de esta tarea). Una reserva de grupo del motor público crea 1 fila
en `Groups` + 1 fila en `Reservations` POR CADA unidad física reservada, todas
compartiendo `groupId`. Cero migración nueva. Cero cambios en folios, check-in,
housekeeping o planning — todos siguen operando sobre `Reservations` individuales,
exactamente como ya sabían hacerlo. Alternativa descartada: una entidad "Booking"
nueva que envuelva N `Reservations` — más "correcta" en el papel pero exige adaptar
esos 4 módulos operativos para un beneficio que `groupId` ya cubre.

**RESUELTO 2026-08-21 (backend)**: `POST /api/public/booking/group` (nuevo endpoint,
`bookingengine/usecases/public-booking-group.ts`) acepta `rooms: [{roomType, adults,
children?, quantity}]` — cualquier combinación de tipos y cantidades en una sola
operación atómica (todo o nada: si una sola unidad se vende concurrentemente, se
aborta el grupo entero). Un solo cobro de Stripe (Checkout Session sobre la reserva
LÍDER, por el total combinado); el webhook (`stripe.ts handleWebhook`) cascada la
confirmación de pago a las hermanas del mismo `groupId`. El endpoint de 1 habitación
(`POST /api/public/booking`) NO se tocó — sigue existiendo para compat.
**RESUELTO 2026-08-21 (frontend)**: `useBooking.ts` reemplazó la selección única por
un carrito (`cart: CartLine[]`, `addToCart`/`removeCartLine`/`setCartLineQuantity`).
`RoomsStep.vue` (widget) y `BookingModal.vue` (landing) agregan/quitan líneas con un
stepper +/− por fila de ocupación en vez de "elegir y avanzar". El resumen pre-pago
(`PayStep.vue` y el bloque de resumen de `BookingModal.vue`) lista todas las líneas
del carrito con huéspedes totales, habitaciones a reservar y noches. `pay()` sigue
usando `POST /api/public/booking` (sin crear `Groups`) cuando el carrito es 1 línea ×
1 unidad — el caso dominante no cambia de endpoint ni de comportamiento. Ver Tarea 10
en `tasks.md` para el detalle de verificación (typecheck/build/tests).

### Requirement: Revalidación completa antes de confirmar pago

El motor MUST revalidar, inmediatamente antes de procesar el pago, que: el inventario
sigue existiendo, la tarifa sigue siendo válida, la cantidad de unidades solicitada
sigue disponible, la ocupación sigue siendo válida contra capacidad, los extras
seleccionados siguen disponibles, y el total coincide con todas las selecciones
vigentes. Si cualquier condición cambió desde la búsqueda inicial, el motor MUST
bloquear el pago y notificar al huésped qué cambió, sin crear un cobro.

#### Scenario: Disponibilidad se agota mientras el huésped completa el flujo

- GIVEN un huésped seleccionó la última unidad Deluxe disponible
- WHEN otra reserva toma esa unidad antes de que el primer huésped llegue al paso de
  pago
- THEN el motor bloquea el avance al pago y muestra que la disponibilidad cambió, sin
  procesar ningún cobro

**RESUELTO 2026-08-22 — VERIFICADO, YA CUMPLÍA en el backend**: las 5 dimensiones
(inventario, tarifa, cantidad, ocupación, extras/total) ya se revalidan frescas al
crear la reserva, en una transacción con lock + re-lectura, todo-o-nada — nunca se
confía en lo que el cliente mandó. El escenario literal de este requirement
(disponibilidad se agota entre la búsqueda y el pago) tiene un test dedicado que lo
reproduce con dos llamadas concurrentes sincronizadas (`public-booking-race.test.ts`).
El gap real era que el FRONTEND (`useBooking.ts` `pay()`) nunca tuvo cobertura de que
el mensaje específico del backend (no uno genérico) efectivamente llega al huésped
cuando el pago se bloquea — cerrado con `useBooking.pay.test.ts` (7 tests, 2 branches
confirmados con revert manual). Ver Tarea 15/1.6 en `tasks.md` para el detalle.

## Database

Sin cambios de schema nuevos identificados para G1 más allá de lo ya existente en
`solmi-direct-booking` (`RoomRates`/`Seasons`, `bookingengine` availability, `Rooms`
capacity, `promo_codes`, `upsells`). Si la revalidación pre-pago requiere un endpoint
liviano nuevo, documentar aquí antes de implementar (no crear tabla nueva sin
necesidad).

## API

- Auditado `GET /api/public/hotels/:slug/rates` (F2 2.4): confirmado que ya filtra por
  disponibilidad real, capacidad y tarifa por ocupación combinadas — sin cambios
  pendientes para Tarea 1 (búsqueda) ni Tarea 12 (capacidad).
- **NUEVO — implementado 2026-08-20 (Tarea 2)**: `PricingQueries.listBaseRates()`
  (backend, `modules/pricing/usecases/pricing-queries.ts`) — devuelve `GET /api/rates`
  (sin `?channel=`) real o derivada de `Rooms` × `pricing_mode` si el hotel no guardó
  tarifas base todavía, mismo criterio "nunca vacío" que `listChannelRates`.
  `PricingService.listRates` delega ahí en vez de devolver `[]`. Sin endpoint nuevo —
  `GET /api/rates`, `GET/PUT /api/pricing-mode` ya existían (usados hasta ahora solo
  por `ChannelRatesEditor.vue`).
- **NUEVO — implementado 2026-08-20**: `GET /api/public/hotels/:slug/room-types`
  (catálogo de tipos SIN filtrar por disponibilidad; `{roomTypes: [{id, name,
  capacity, surfaceArea, basePrice, photoUrl}]}`). Sin auth, rate-limit 60/60s (mismo
  criterio que `/rates`). Agrupa `Rooms` directo por `type` — no mira reservas ni
  fechas. Usecase `bookingengine/usecases/public-room-types.ts`.
- Sin cambios de API para el requirement del calendario: `GET /calendar` NO se toca
  (decisión de alcance de arriba). El fix vive enteramente en el frontend, leyendo la
  respuesta ya existente de `GET /rates` (`roomTypes: []`).
- Nuevo o reforzado: endpoint de revalidación pre-pago (ej.
  `POST /api/public/booking/revalidate`) que reciba la selección completa (roomId,
  qty, fechas, ocupación, extras, promo) y devuelva `{valid: bool, changes?: [...]}`.
- `POST /api/public/booking` MUST aceptar `quantity` por tipo de habitación (Tarea 10).

## UI

- `RoomsStep.vue` (existente) MUST reflejar `availableCount` real por tipo y permitir
  seleccionar cantidad ≤ `availableCount`.
- `RoomsStep.vue`: el estado vacío existente (`v-if="availableRooms.length === 0"`,
  hoy con textos genéricos `rooms.empty`/`rooms.emptyHint`) MUST distinguir el caso
  "rango sin ningún tipo con disponibilidad continua" (llegó desde un calendario que
  permitió la selección) del caso "hotel sin nada para esas fechas en general", con
  copy que sugiera probar otro rango — sin tocar `RateCalendar.vue`, `CalendarView.vue`
  ni `GET /calendar`.
- `PayStep.vue` (existente) MUST disparar la revalidación antes de habilitar el botón
  "Reservar y Pagar", y MUST mostrar un mensaje claro si algo cambió (no un error
  genérico).
- **NUEVO — implementado 2026-08-20 (Tarea 2)**: `frontend/src/pages/tarifas/index.vue`
  ("Temporadas y Tarifas") MUST exponer el switch "Por habitación / Por huésped" (antes
  solo en `ChannelRatesEditor.vue`, inalcanzable sin un canal OTA conectado) — mismo
  patrón visual, llama a los mismos `HotelService.pricingMode()`/`setPricingMode()`.
  Al togglear, re-pide `GET /api/rates` para que la matriz se re-arme con la cantidad
  de filas por ocupación que corresponda.
