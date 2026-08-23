# Tasks: Motor de Reservas Directas — hallazgos de QA

Fuente de verdad: `proposal.md` + `specs/*/spec.md` (3 specs). Este archivo descompone
los 15 hallazgos de la reunión de producto (2026-08-20) en tareas ejecutables, agrupadas
por la prioridad ya definida en esa revisión.

**Orden de implementación recomendado: G1 → G2 (definición) → G3.** G2 bloquea
parcialmente a G1 (ver 1.4/1.5) — la decisión de "combinar tipos de habitación" (2.1)
debe tomarse antes de dar por cerrada la Tarea 10 en su forma extendida.

Cada grupo termina con un **Gate de verificación obligatorio** (igual al resto del
repo):
- `cd backend && bun run typecheck` (0 errores)
- `cd backend && bun run node_modules/arckode-framework/bin/arckode.js analyze` (✅ VÁLIDO, 0 violaciones)
- `cd backend && bun test` (verde)
- `cd frontend && bun run typecheck` (vue-tsc -b)
- `cd frontend && bun run build` (termina en "✓ built")

---

## G1 — Integridad de la reserva (prioridad alta)

Specs: `specs/booking-availability-pricing/spec.md`, `specs/booking-content-policies/spec.md`.

- [x] 1.1a Auditar `GET /api/public/hotels/:slug/rates` (Tarea 1, literal original).
      **CERRADO 2026-08-20 — ya cumplía, sin cambios de código**: `AvailabilityUseCase.aggregate()`
      ya excluye del todo un tipo sin unidades libres; cubierto por
      `tests/public-rates-occupancy-integrity.test.ts`. Ver spec
      `booking-availability-pricing`, requirement "Disponibilidad real en el resultado
      de búsqueda — VERIFICADO, YA CUMPLE".

- [x] 1.1b Caso real encontrado durante la auditoría de 1.1a (no el literal original de
      Tarea 1): el calendario (`GET /calendar`, consumido por `RateCalendar.vue` en la
      landing y `CalendarView.vue` en el widget) valida disponibilidad por DÍA agregada
      entre TODOS los tipos, no por tipo continuo en el rango — puede dejar seleccionar
      un rango donde cada noche individual tiene stock de *algún* tipo, pero ningún
      tipo cubre el rango completo, y `GET /rates` devuelve `roomTypes: []` recién
      después de elegir fechas. **Decisión de alcance (2026-08-20)**: NO tocar
      `GET /calendar` ni su caché ni los 2 componentes de calendario (evita romper lo
      ya sólido y testeado) — el fix es mejorar el estado vacío de `RoomsStep.vue` para
      explicar el caso específico ("ese rango no tiene disponibilidad continua, probá
      otro") en vez de un "sin resultados" genérico. Ver spec
      `booking-availability-pricing`, requirement "El calendario no puede prometer un
      rango que la búsqueda no puede cumplir". **Acceptance**: con el escenario Tipo
      A/Tipo B del spec, el widget muestra el mensaje específico, no el genérico
      `rooms.empty`.
      **RESUELTO 2026-08-20**: mensaje del estado vacío actualizado en los 2 puntos
      donde se renderiza (`RoomsStep.vue` del widget `/book/:slug`, vía
      `useBookingI18n.ts` `rooms.emptyHint` en es/en/pt; y `BookingModal.vue` de la
      landing `/h/:slug`, texto directo) para explicar la causa probable ("ninguna
      habitación tiene lugar para TODAS esas noches seguidas") en vez del genérico
      "probá otras fechas". Sin cambios en `GET /calendar`, su caché, ni en
      `RateCalendar.vue`/`CalendarView.vue` — solo copy. Tests `BookingModal.test.ts` +
      `RoomsStep.test.ts` + `RoomsStep.occupancies.test.ts` (27/27) verdes, frontend
      `vue-tsc -b` limpio.

- [x] 1.1c Caso real reportado por el usuario probando la landing (2026-08-20, no una
      de las 15 tareas originales): la vitrina "Habitaciones" de la landing pública
      (`RoomsBlock.vue`, sección `/h/:slug`) reusaba `GET /rates` con una fecha
      indicativa fija ("mañana + N noches") para decidir QUÉ tipos mostrar como
      contenido comercial. Un tipo reservado justo esa ventana puntual (ej. Suite
      ocupada varios días que solapan con "mañana") desaparecía ENTERO de la vitrina,
      aunque fuera un producto real y vendible en cualquier otra fecha — la vitrina de
      marketing heredaba el filtro de disponibilidad de una búsqueda real, que no le
      corresponde.
      **RESUELTO 2026-08-20**: nuevo endpoint público
      `GET /api/public/hotels/:slug/room-types` (catálogo de tipos SIN filtrar por
      disponibilidad — agrupa `Rooms` directo, sin mirar reservas ni fechas) +
      `backend/src/modules/bookingengine/usecases/public-room-types.ts` + ruta
      registrada en `index.ts` (rate-limit 60/60s, mismo criterio que `/rates`) +
      `PublicHotelService.getRoomTypes()` (frontend) + merge en
      `hotel-landing.vue:mergeWithCatalog()`: completa lo que `/rates` trae con los
      tipos del catálogo que `/rates` excluyó, usando `basePrice × noches` como
      fallback de precio. El catálogo es un complemento tolerante a fallos — si
      `GET /room-types` falla, la vitrina sigue mostrando exactamente lo que `/rates`
      trajo (sin regresión). `RoomsBlock.vue` NO se tocó (sigue recibiendo el mismo
      shape `PublicLandingRoom[]`). Documentado como requirement nuevo en
      `booking-availability-pricing/spec.md`. **Acceptance**: tipo 100% ocupado en la
      ventana indicativa sigue apareciendo en la vitrina con precio base × noches.
      Test backend `public-room-types.test.ts` (10/10, incluye la regresión exacta del
      reporte) + `arckode analyze` 0 violaciones nuevas + `bun test` bookingengine
      339/339 + frontend `vue-tsc -b` + `vite build` (✓ built) + suite booking/landing
      167/167 (1 falla preexistente no relacionada, `FooterBlock.test.ts`, confirmada
      con `git stash` antes de este cambio).

- [x] 1.2 Corregir cálculo de tarifa para que derive de la configuración de precio por
      ocupación del hotel (no de una regla fija del motor) (Tarea 2). **Acceptance**:
      cambiar cantidad de huéspedes en el buscador actualiza el precio SOLO si el hotel
      configuró tarifa creciente; permanece igual si configuró tarifa plana.
      **AUDITADO 2026-08-20 — el motor ya cumplía; el gap real era de configurabilidad,
      no de cálculo**: `rate-resolution.ts` ya resuelve el precio por
      `room_rates.occupancy` correctamente. El problema era que la ÚNICA pantalla para
      activar/editar precio por ocupación (`ChannelRatesEditor.vue`, switch "por
      habitación/por persona" + grilla) vivía enterrada en Channel Manager → detalle de
      un canal OTA ya conectado — un hotel sin canales conectados no tenía forma
      descubrible de configurar la Configuración A del hallazgo.
      **RESUELTO 2026-08-20**: el switch y la grilla por ocupación se agregaron a
      `/panel/tarifas` (pantalla natural de configuración de precios, sin depender de
      Channel Manager). Backend: `PricingQueries.listBaseRates()` nueva (deriva la
      grilla de `Rooms` × `pricing_mode` cuando no hay tarifas base guardadas, mismo
      criterio "nunca vacío" que ya usaba `listChannelRates` para canales) +
      `PricingService.listRates` delega ahí. Frontend: `tarifas/index.vue` — botón
      toggle + re-fetch de la matriz al cambiar de modo. Ver spec
      `booking-availability-pricing`, requirement "Precio derivado de la configuración
      de ocupación del hotel". **Acceptance real verificado**: hotel sin tarifas base
      ni canales conectados → togglear "Por huésped" en `/tarifas` genera la grilla
      1..capacidad sin pasar por Channel Manager. Tests backend nuevos en
      `pricing/tests/service.test.ts` (3 casos: deriva sin tarifas guardadas, deriva
      por ocupación en modo per_person, NO pisa tarifas ya guardadas) — 51/51 verdes en
      el módulo pricing, 3199/3200 en la suite completa del backend (1 falla
      preexistente no relacionada, timeout de hook en
      `rate-limit-distributed.test.ts`, dependiente de Redis). `arckode analyze`: tuve
      que recortar un comentario en `service.ts` que lo llevó a 205 líneas (gate
      >200 = God Object) — trimeado a 197, 0 violaciones nuevas (queda la 1
      preexistente no relacionada en `admin/service.ts`). Frontend `vue-tsc -b` y
      `vite build` limpios. Sin test de frontend nuevo para `tarifas/index.vue` (no
      hay precedente de tests de componente en esta área — `ChannelRatesEditor.vue`
      tampoco tiene — la lógica de negocio real está cubierta del lado backend).
      **Bug real encontrado y corregido en la revisión posterior (2026-08-20)**:
      `getBasePrice(roomType)` buscaba SIEMPRE la fila de `occupancy === 1` para el
      input "Precio Base $" del header de cada tipo. En modo `per_room` (default),
      `roomTypesFor()` genera UNA fila por tipo en `occupancy = capacity`, no en 1 —
      con capacidad > 1 (el caso normal) el header mostraba $0 aunque la fila de
      abajo mostrara el precio real correcto; guardar sin tocar ese campo seguía
      persistiendo bien, pero un hotelero que "corrigiera" el $0 a mano hubiera
      pisado el precio real. Corregido: usa la fila de ocupación MÍNIMA del tipo en
      vez de asumir 1 — sin cambio de resultado en `per_person` (min=1 de por sí),
      arregla `per_room`. Verificado a mano con trace numérico (capacity=2/
      basePrice=100 → antes 0, ahora 100). `ChannelRatesEditor.vue` no tiene este
      bug (cada ocupación es su propio grupo con su propio input, no un header
      separado que asuma occupancy=1).
      **2ª ronda de revisión (2026-08-20)** — `roomTypesFor()` (backend, compartida
      con `listChannelRates`/`ChannelRatesEditor.vue`, código preexistente) se
      quedaba con la capacidad y el basePrice de la PRIMERA habitación de cada tipo
      que apareciera en la query (orden no garantizado), ignorando el resto — con
      capacidad, esto SUBGENERABA filas de ocupación (una suite de 2 y otra de 4 del
      mismo tipo derivaban solo occupancy 1-2, perdiendo la unidad de 4 entera).
      Corregido para usar capacidad MÁXIMA y precio MÍNIMO positivo entre las
      unidades del tipo — mismo criterio que ya usa el motor público
      (`bookingengine/usecases/availability.ts:aggregate`) para publicar "desde $X"
      y la capacidad del tipo, así que ahora la matriz de tarifas es consistente con
      lo que el huésped ve. Al ser función compartida, este fix también beneficia a
      `ChannelRatesEditor.vue` (no se tocó ese componente, solo la función que
      ambos usan). Test nuevo en `service.test.ts` (2 habitaciones mismo tipo,
      capacidad 2 y 4, basePrice 150 y 120 → genera occupancy 1-4, basePrice=120 en
      todas). 52/52 tests módulo pricing, 3200/3201 suite completa backend (misma 1
      falla preexistente de Redis, no relacionada), `arckode analyze` sin
      violaciones nuevas, `tsc --noEmit` limpio.
      **3ª ronda — test de independencia de orden** (mismas 2 habitaciones, orden
      invertido en la respuesta de la query) confirma que el resultado no depende
      de cuál habitación llega primero. 53/53 módulo pricing.
      **4ª ronda — E2E real cruzando `pricing` ↔ `bookingengine`** (nuevo archivo
      `bookingengine/tests/pricing-to-public-rates.e2e.test.ts`, con un ORM en
      memoria REAL compartido entre los 2 módulos, no fixtures estáticos por
      módulo): simula el flujo completo — hotelero abre "Tarifas" sin nada guardado
      → `PricingQueries.listBaseRates` genera el esqueleto (capacidad 4/precio 120)
      → guarda sin tocar nada (`PricingService.updateRates`, filas REALES en
      `room_rates`) → un huésped busca el motor público para el grupo completo (4
      personas) → `getPublicRates` + `AvailabilityUseCase` (que leen la MISMA tabla)
      resuelven `available:true, price:120`, no degradado. **Verificado que el test
      realmente detecta la regresión**: revertí temporalmente solo el cuerpo de
      `roomTypesFor` a la lógica vieja ("primer room gana") y el test FALLÓ como se
      esperaba (`skeleton.every(occupancy===4...)` → `false`); restauré el fix y
      volvió a pasar. 54/54 tests entre pricing+bookingengine juntos, 3202/3203
      suite completa backend (misma 1 falla preexistente de Redis), `arckode
      analyze` y `tsc --noEmit` limpios.

- [x] 1.3 Agregar validación de ocupación vs. capacidad configurada por tipo de
      habitación en la búsqueda (Tarea 12). **Acceptance**: habitación con capacidad
      máxima 2 NO aparece como resultado válido para una búsqueda de 4 adultos en 1
      habitación, aunque tenga inventario libre.
      **CERRADO 2026-08-21 — doble motivo, sin cambios de código**:
      1. El filtro YA existía antes de esta revisión: `AvailabilityUseCase.aggregate()`
         (`bookingengine/usecases/availability.ts:215`, `d.capacity >= adults`, donde
         `capacity` es la MÁXIMA entre las unidades físicas del tipo) descarta el tipo
         entero de `/rates` cuando la capacidad no alcanza — con test dedicado ya
         existente (`public-rates-occupancy-integrity.test.ts:441`, "un tipo donde el
         grupo NO ENTRA se sigue descartando").
      2. Además, el escenario literal del hallazgo ("búsqueda de 4 adultos") ya no
         puede construirse en el flujo principal: el buscador público YA NO PIDE
         huéspedes por adelantado (ver la tarea de quitar el selector de ocupación,
         2026-08-20) — `store.guests` default 1 en los 3 puntos de entrada
         (`HeroSearchBar.vue`/`BookingModal.vue`/`SearchStep.vue`). La ocupación real
         se elige recién por tipo, vía la matriz "para N" (`occupancy-matrix.ts`),
         que naturalmente nunca ofrece una fila más allá de la capacidad de ESE tipo
         (salvo `?guests=` por deep-link externo o una tarifa mal cargada — casos
         cubiertos aparte por `over_capacity`, comportamiento intencional documentado
         en el propio `occupancy-matrix.ts`, no un bug). Observación del usuario,
         confirmada antes de cerrar.

- [x] 1.4 Soportar reserva de múltiples unidades del mismo tipo de habitación (y, por
      decisión ampliada 2026-08-21, también tipos DISTINTOS combinados) en una sola
      operación, validando contra inventario disponible (Tarea 10, resuelve también
      2.1). **Acceptance**: con 3 Deluxe disponibles, seleccionar "Deluxe × 2" crea una
      única reserva con 2 unidades; seleccionar "× 4" es rechazado y se informa el
      máximo real (3).
      **BACKEND RESUELTO 2026-08-21**: nuevo endpoint `POST /api/public/booking/group`
      (`bookingengine/usecases/public-booking-group.ts`) — acepta `rooms:
      [{roomType, adults, children?, quantity}]`, cualquier combinación de tipos y
      cantidades, atómico (todo o nada). Reusa `Groups` (módulo `grupos`, ya existía)
      + `Reservations.groupId` (columna ya existía) — sin migración nueva, sin tocar
      folios/check-in/housekeeping/planning. 1 sola Checkout Session de Stripe sobre
      la reserva líder; `stripe.ts handleWebhook` cascada la confirmación a las
      hermanas del mismo grupo (fix necesario, ver abajo). Endpoint de 1 habitación
      (`POST /api/public/booking`) intacto, sin tocar. Ver spec
      `booking-availability-pricing`, requirement "Combinar tipos de habitación
      distintos en una reserva" para el detalle de arquitectura.
      **Verificado**: `public-booking-group.test.ts` (8 tests: tipos combinados,
      mismo tipo ×N, rechazo con máximo real informado, techo `MAX_GROUP_UNITS`,
      anti-doble-claim de la misma unidad física entre 2 líneas, promo aplicado una
      sola vez sobre el total combinado) + 3 tests nuevos en
      `stripe-reservations.test.ts` (cascada del webhook a hermanas del grupo,
      reserva sin grupo no cascadea, webhook duplicado no re-cascadea) — confirmado
      que 2 de los 3 detectan la regresión de verdad (revertí el cascade a mano,
      fallaron como se esperaba, restauré). 351/351 tests bookingengine, 3213/3214
      suite completa backend (1 falla preexistente de Redis, no relacionada),
      `arckode analyze` sin violaciones nuevas, `tsc --noEmit` limpio.
      **FRONTEND RESUELTO 2026-08-21**: `useBooking.ts` reemplazó el modelo de 1 sola
      habitación (`selectedRoom`/`selectedOccupancy`/`selectRoom()`) por un carrito
      (`cart: CartLine[]` + `addToCart()`/`removeCartLine()`/`setCartLineQuantity()`),
      con computeds `cartTotalRooms`/`cartTotalGuests`/`roomsSubtotal`. `pay()` sigue
      llamando `POST /api/public/booking` (endpoint de 1 habitación, sin tocar) cuando
      el carrito tiene exactamente 1 línea × cantidad 1 — la reserva de 1 habitación
      (caso dominante) no crea fila en `Groups` ni cambia de endpoint; con más de una
      línea/unidad llama al nuevo `POST /api/public/booking/group`
      (`BookingService.createBookingGroup`). `RoomsStep.vue` (widget embebible) y
      `BookingModal.vue` (landing) pasaron de "elegir y avanzar" a "agregar al
      carrito": cada fila de ocupación tiene un stepper +/− y hay un resumen de
      carrito visible (líneas, cantidades, quitar) antes de continuar. `PayStep.vue`
      y el resumen pre-pago de `BookingModal.vue` listan TODAS las líneas del
      carrito con el detalle pedido por el usuario (huéspedes totales, habitaciones a
      reservar, noches), no una sola habitación.
      Fix real encontrado en el camino: `addToCart()` sin fila de ocupación explícita
      (fallback sin matriz de ocupaciones) usaba un default fijo de 1 huésped en vez
      de la ocupación FÍSICA buscada (`physicalGuests` = adultos + niños) — una
      búsqueda "2 adultos, 2 niños" grababa la reserva para 1 sola persona. Detectado
      por un test existente que dejó de pasar (`BookingModal.test.ts`), no agregado
      ad-hoc.
      **Verificado**: `bun run typecheck` (vue-tsc -b) limpio, `bun run build` OK,
      suite completa de tests (`vitest run`) 358/358 tests pasan (2 archivos fallan
      en collection por un error de resolución de `favicon.svg` bajo Windows, no
      relacionado — confirmado que no referencian `useBooking`/`selectedRoom`).
      Tests actualizados a la API nueva: `RoomsStep.occupancies.test.ts`,
      `BookingModal.occupancies.test.ts`, `BookingModal.terms.test.ts`,
      `BookingModal.test.ts`.

      **HALLAZGO Y FIX 2026-08-21 — capacidad física no se revalidaba al crear la
      reserva**: el usuario preguntó explícitamente si el motor evita reservar una
      habitación cuya capacidad no alcanza para los huéspedes pedidos. Auditado el
      código de escritura (`public-booking.ts` de 1 habitación Y
      `public-booking-group.ts`): ninguno de los dos volvía a chequear
      `room.capacity >= huéspedes` al elegir la unidad física — la única barrera era
      la matriz de `/rates` (`occupancy-matrix.ts`, `over_capacity`), que la UI
      respeta pero que un POST directo a la API pública (sin auth) podía saltearse
      por completo, incluyendo el path de compat `roomId` explícito. Fix: ambos
      usecases ahora filtran las unidades candidatas por capacidad ANTES de elegir
      la más barata (prioriza capacidad sobre precio — un tipo puede tener unidades
      de capacidad distinta, cubierto por test) y `public-booking.ts` agrega una
      red de seguridad final que también cubre el path `roomId` directo. Mensajes
      409 informan la capacidad real cuando corresponde.
      **Verificado**: 8 tests nuevos (4 en `public-booking-room-resolution.test.ts`,
      4 en `public-booking-group.test.ts`) — confirmados con revert manual que 6 de
      los 8 detectan la regresión de verdad (fallan sin el fix, pasan con él; los
      otros 2 cubren el caso "sin `capacity` en la fila no bloquea", que no podían
      fallar antes). 3221/3222 suite completa backend (1 falla preexistente de
      Redis, no relacionada), `arckode analyze` sin violaciones nuevas (la única
      violación reportada es preexistente en `admin/service.ts`, ajena a este
      cambio), `tsc --noEmit` limpio.

- [x] 1.5 Cargar la política de cancelación/reembolso del widget desde la
      configuración del hotel en el PMS, eliminando cualquier texto fijo compartido
      entre hoteles (Tarea 6). **Acceptance**: dos hoteles con plazos de cancelación
      gratuita distintos (3 días vs. 7 días) muestran cada uno su propio texto en el
      resumen pre-pago.
      **CERRADO 2026-08-21 — ya cumplía (plomería F5 #627), sin cambios de código,
      solo cobertura**: auditado `public-rates.ts` (`buildCancellationSummary` →
      `shared/usecases/cancellation-math.ts` `resolvePolicy`, precedencia channel >
      base propia del hotel > preset de `hotels.cancellationType` > default
      flexible) y confirmado que YA es 100% por hotel — `cancellationSummary` se
      resuelve con `hotel.id`/`hotel.cancellationType`, sin ningún default
      compartido entre hoteles. `PayStep.vue` (widget) y `BookingModal.vue`
      (landing) ya consumen ese campo dinámicamente (la landing incluso evita
      caer al texto libre a propósito, "para que el widget nunca invente una
      promesa de reembolso"). El hotel edita su propia política en
      `/panel/booking-engine` (`CancellationPolicyEditor.vue`).
      **Gap real encontrado**: nada probaba el criterio de aceptación literal — 0
      tests de `cancellationSummary` en `public-rates.test.ts` (solo se testeaba
      el texto libre legacy) y 0 tests de `PayStep.vue` en todo el repo.
      **Cerrado con**: 3 tests nuevos en `public-rates.test.ts` (2 hoteles con
      preset distinto → `freeUntilHours` 72 vs 168; política custom pisa el
      preset; sin `policies` cableado → null, no revienta) + 4 tests nuevos en
      `PayStep.test.ts` (nuevo archivo — no existía ninguno para este componente):
      2 hoteles con texto distinto en el resumen, no-reembolsable no dice ningún
      plazo, fallback a texto libre, sin nada no inventa política.
      **Verificado**: los 3 tests de `/rates` y el test de "texto distinto" de
      `PayStep` confirmados con revert manual (fallan si se hardcodea el
      `cancellationType`/la ventana en horas, pasan con el código real). 3474/3475
      suite completa backend (1 falla preexistente de Redis, ajena), 778/778 tests
      reales frontend (2 archivos fallan en collection por `favicon.svg`, ajeno —
      confirmado sin relación a booking), `tsc --noEmit` limpio en los dos,
      `arckode analyze` ✅ 0 violaciones, `bun run build` frontend OK.
      **Segunda pasada (iteración, mismo día)**: `PayStep.vue` comparte el umbral
      `FLEXIBLE_ANYTIME_THRESHOLD` con `BookingModal.vue`, cuyo bug real ya
      documentado ("cancelación sin cargo hasta 4167 días antes" con el preset
      flexible de 99999h) nunca se probó en el widget — arreglarlo en una sola
      superficie deja vivo el mismo bug en la otra. Agregados 4 tests más a
      `PayStep.test.ts`: guard de regresión de los "4167 días" (confirmado con
      revert manual — reproduce el texto exacto del bug si se rompe el umbral),
      ventana <24h en horas no en "0 días", y 2 tests de locale (en/pt) — el
      widget tiene switcher de idioma y el resto de sus tests (`RoomsStep.test.ts`)
      ya cubre es/en/pt, `PayStep.test.ts` nuevo solo cubría español. 8/8 tests en
      el archivo, `tsc --noEmit` limpio.
      **Tercera pasada (iteración, mismo día) — FIX real, no solo cobertura**:
      `PayStep.vue` todavía caía al texto libre `store.cancellationPolicy` (lo
      que el admin escribe a mano en `/panel/booking-engine`) cuando no había
      `cancellationSummary` estructurado. `BookingModal.vue` (landing) YA había
      sacado ese fallback a propósito — su comentario documenta un incidente real
      de producción: el texto libre decía "flexible" mientras la política real
      que el backend aplica al cancelar era estricta, y mostrarlo prometía un
      reembolso que no existía. El widget tenía exactamente ese mismo patrón
      peligroso, sin corregir. Portado el mismo sistema de tono de riesgo
      (`bookingTerms` → `cancellationTerms`, 5 casos: sin política/`source:
      'default'` → danger "no publicó su política"; sin ventana gratuita →
      danger "Tarifa NO reembolsable"; estricta (100% penalización aunque
      `refundable:true`) → danger "Política estricta"; sin ninguna penalidad →
      neutral "cancelación gratuita siempre"; caso general → neutral con el
      plazo). Nuevas keys i18n en useBookingI18n.ts (es/en/pt): `pay.cancelNoPolicyHeadline/Detail`,
      `pay.cancelNonRefundableHeadline`, `pay.cancelStrictHeadline/Detail`.
      **Verificado**: 3 branches críticos (fallback a texto libre, detección de
      "estricta", `source:'default'`) confirmados con revert manual — cada uno
      reproduce el comportamiento incorrecto exacto si se deshace el fix, y las
      3 fallas correspondientes en `PayStep.test.ts` lo detectan. 9/9 tests en el
      archivo (2 nuevos: fallback ignorado con texto libre presente,
      `source:'default'` avisa aunque los tiers digan "gratis"). 783/783 tests
      reales frontend, `tsc --noEmit` limpio, `bun run build` OK.
      **Cuarta pasada (iteración, 2026-08-22) — decisión del usuario: SÍ agregar
      el checkbox**: `PayStep.vue` (widget) dejaba pagar sin exigir aceptación
      explícita de las condiciones, a diferencia de `BookingModal.vue` (landing).
      Confirmado con el usuario que el widget debe exigir el mismo tilde.
      Portado el patrón de `termsAccepted` de la landing: checkbox
      `data-testid="accept-terms"`, botón de pago `:disabled` sin tildar + guard
      adicional en `onPay()` (defensa en profundidad — un doble evento o un
      atajo de teclado no pueden cobrarle a alguien que nunca aceptó), hint
      "Aceptá las condiciones para poder pagar." mientras está sin tildar.
      Sin `watch` de reset (a diferencia del modal): `booking-widget.vue` monta
      cada step con `<component :is>` SIN `KeepAlive`, así que el ref local
      `termsAccepted` ya vuelve a `false` solo con re-entrar al step. Nuevas
      keys i18n es/en/pt: `pay.acceptTerms`, `pay.termsRequired`.
      **Verificado**: 2 tests nuevos en `PayStep.test.ts` (bloqueado sin
      aceptar + guard de `onPay()` probado con revert manual — sin el guard,
      llamar `onPay()` directo SÍ dispara el cobro; habilitado y dispara al
      tildar). 11/11 tests del archivo, 792/792 tests reales frontend (+2),
      `tsc --noEmit` limpio, `bun run build` OK. Verificado además visualmente
      en navegador real (Playwright contra el dev server, flujo completo
      fechas→habitación→huésped→pago): botón deshabilitado por default, se
      habilita al tildar, sin errores de consola.

- [x] 1.6 Implementar revalidación completa (inventario, tarifa, cantidad, ocupación,
      extras, total) inmediatamente antes de habilitar el pago, bloqueando el cobro si
      algo cambió desde la búsqueda inicial (Tarea 15). **Acceptance**: si la última
      unidad disponible se vende a otro huésped mientras el primero completa el flujo,
      el segundo NO puede pagar y ve un mensaje explicando qué cambió.
      **CERRADO 2026-08-22 — ya cumplía en el backend (mismo patrón que 1.5), sin
      cambios de código ahí; el gap real era cobertura del FRONTEND**: auditado el
      código de escritura de las 2 vías de creación de reserva
      (`public-booking.ts`/`public-booking-group.ts`) y confirmado que las 5
      dimensiones YA se revalidan frescas al crear la reserva, nunca confiando en
      lo que mandó el cliente:
      - **Inventario/cantidad**: lock + re-lectura DENTRO de la transacción,
        todo-o-nada. `public-booking-race.test.ts` reproduce LITERALMENTE el
        acceptance ("el comprador que chequeó primero pero insertó último recibe
        409, no una segunda reserva") con dos llamadas concurrentes sincronizadas
        por gate.
      - **Tarifa/total**: `sumStayPrice` se recalcula con `RoomRates`/
        `SeasonAssignments` ACTUALES en el momento de crear, nunca con el precio
        que el cliente mandó — no hay forma de que llegue stale.
      - **Ocupación/capacidad**: filtro de capacidad al asignar la unidad física
        (fix de esta misma sesión, Tarea 10).
      - **Extras/promo**: `public-booking-promo-upsells.test.ts` ya cubre upsell
        inactivo/inexistente (se ignora, no rompe), promo con `maxUses` agotado
        (upfront Y en race condition con optimistic lock — "B2 race condition:
        updateMany devuelve 0 → 409 max_uses_reached").
      **Gap real**: la otra mitad del acceptance ("el segundo NO puede pagar y VE
      UN MENSAJE explicando qué cambió") es comportamiento del FRONTEND
      (`useBooking.ts` `pay()`) y no tenía NINGÚN test — ni para el flujo de 1
      habitación ni el de grupo, compartido por las 2 superficies (widget y
      landing llaman al mismo `store.pay()`). Cerrado con 7 tests nuevos en
      `useBooking.pay.test.ts` (archivo nuevo): mensaje específico del backend
      llega intacto (no uno genérico) para 409 de disponibilidad/capacidad/promo,
      mismo comportamiento en el endpoint de grupo, `isSubmitting` se libera para
      poder reintentar, `idempotencyKey` se regenera tras un fallo (no reusa un
      intento que pudo haber llegado parcial al backend), y un error de red o un
      throw no-`Error` no dejan al huésped sin ningún mensaje.
      **Verificado**: 2 branches críticos confirmados con revert manual (mensaje
      genérico en vez del específico → 5 de 7 tests fallan; sin regenerar
      idempotencyKey → 1 test falla), ambos reproducidos EXACTO y luego
      restaurados. 790/790 tests reales frontend (+7), `tsc --noEmit` limpio,
      `bun run build` OK. Sin cambios en el backend (ya estaba correcto y
      probado).

### Gate G1

- [x] 1.7 Gate de verificación (typecheck + analyze + test + build, backend y
      frontend) en verde antes de continuar a G3. **Acceptance**: los 5 comandos
      devuelven éxito.
      **VERIFICADO 2026-08-22**: backend `tsc --noEmit` ✅, `arckode analyze` ✅
      (0 violaciones), backend `bun test` ✅ (3474/3475 — 1 falla preexistente de
      Redis, ajena a todo lo tocado en G1), frontend `vue-tsc -b` ✅, frontend
      `bun run build` ✅ ("✓ built"). G1 cerrado.

---

## G2 — Requieren definición funcional antes de implementar

Specs: `specs/booking-availability-pricing/spec.md` (2.1),
`specs/booking-content-policies/spec.md` (2.2, 2.3, 2.4).

- [x] 2.1 **Decisión de producto**: ¿se permite combinar tipos de habitación distintos
      en una misma reserva (Opción A) o cada reserva contiene un solo tipo (Opción B)?
      (Tarea 11). **Acceptance**: decisión documentada con fecha en
      `specs/booking-availability-pricing/spec.md`, sección "Combinar tipos de
      habitación distintos" — reemplaza el estado "DECISIÓN PENDIENTE". Sin esta
      decisión, no se implementa la variante multi-tipo de 1.4.
      **RESUELTO 2026-08-21 — Opción A** (combinar tipos distintos SÍ se permite).
      Ver 1.4 para la implementación backend ya hecha.

- [x] 2.2 **Decisión de producto**: nomenclatura definitiva del catálogo de regímenes
      de alimentación (Tarea 3). Validar con el mercado objetivo entre "Solo
      alojamiento / Desayuno incluido / Desayuno y cena / Todo incluido" vs. términos
      actuales ("Media pensión" / "Pensión completa"). **Acceptance**: catálogo
      definitivo documentado en `specs/booking-content-policies/spec.md`; diseño de
      tabla `meal_plans` (o equivalente) confirmado antes de migrar.
      **RESUELTO 2026-08-21/22 — nomenclatura confirmada por el dueño: "Solo
      alojamiento / Desayuno incluido / Desayuno y cena / Todo incluido"**. Implementado
      end-to-end (no solo la decisión, el catálogo completo):
      - Backend: tabla `meal_plans` (`hotelId, code, active, priceMode, price`) en
        `bookingengine/model.ts` — catálogo FIJO de 3 códigos (`breakfast|half_board|
        all_inclusive`, "Solo alojamiento" es la base implícita sin fila propia), no un
        catálogo abierto como `upsells`. Usecases `meal-plans-crud.ts` (admin,
        `list`/`upsert`, siempre devuelve los 3 códigos con defaults) y
        `public-meal-plans.ts` (`GET /api/public/hotels/:slug/meal-plans`, solo
        `active`, orden fijo). Rutas admin `GET/PUT /api/meal-plans` con permiso nuevo
        `mealplans:view/edit` (`shared/permissions.ts`, agregado a `hotel_admin`).
        Tests `meal-plans-crud.test.ts` + `public-meal-plans.test.ts` (16/16 ✅).
      - Admin: `MealPlansEditor.vue` (mirror de `CancellationPolicyEditor.vue`, mismo
        embed en `booking-engine/index.vue` junto a política de cancelación) — toggle
        activo + radio incluido/con-costo + precio por cada uno de los 3 códigos.
      - Widget público: `RoomsStep.vue` y `BookingModal.vue` reemplazan el placeholder
        `DISABLED_BOARD_PLANS` (siempre igual, decorativo) por render dinámico desde
        `store.mealPlans` (`useBooking.ts` lo carga en `search()`, mismo momento que
        `ratesResponse`). 3 estados: `active+included` → pill activo informativo (no
        cambia precio); `active+per_person_per_night` → pill con precio marcado
        "Próximamente" (informativo, **todavía NO seleccionable ni cobrable** — ver
        alcance abajo); sin fila / `!active` → deshabilitado con motivo (mismo criterio
        que la matriz de ocupación: nunca ocultar). i18n actualizado en
        `useBookingI18n.ts` (es/en/pt) + strings hardcodeadas equivalentes en
        `BookingModal.vue` (no usa el store de i18n).
      - **Alcance explícito — decisión de producto tomada junto con el dueño**: un
        régimen "con costo aparte" se muestra informativo con su precio pero NO suma al
        carrito/checkout todavía. Integrarlo al cobro real es una tarea aparte que exige
        el mismo rigor que 1.6 (revalidación server-side, todo-o-nada) — evita repetir
        el bug de "prometer algo que el sistema no cumple" que ya se cerró en la política
        de cancelación esta sesión.
      - Verificado E2E en navegador (Playwright, dev local): configurado desde el panel
        admin (`hotel-boutique-palma`) → `GET /api/public/hotels/hotel-boutique-palma/
        meal-plans` refleja el guardado → **ambas** superficies (`/book/:slug` widget y
        `/h/:slug` landing modal) muestran los 3 estados correctamente en una búsqueda
        real con habitaciones disponibles.
      - Verificación completa: backend `bun test` (16/16 nuevos + 379/379 suite
        `bookingengine`), `arckode analyze` (0 violaciones), `tsc --noEmit` limpio;
        frontend `vue-tsc -b` limpio, `vitest run` (800/800 — 2 suites fallan por un
        error de entorno preexistente y no relacionado, `file:///favicon.svg`), `vite
        build` ✓ built. Revert-test aplicado sobre el branch `included` de
        `boardPlanRows` en `RoomsStep.vue`: revertido → el test nuevo falla con el
        síntoma esperado (`bg-navy` ausente) → restaurado → vuelve a pasar.

      **Segunda pasada (iteración post-implementación, 2026-08-22)** — 2 bugs reales
      encontrados y corregidos antes de dar la tarea por cerrada:
      1. **Precio del régimen etiquetado con la moneda equivocada (D10)**: el precio de
         "con costo aparte" se formateaba con `store.displayCurrency` (la moneda que ve
         el huésped tras la conversión) en vez de `store.chargeCurrency` (la moneda real
         de cobro del hotel — igual que `upsells`, el precio del régimen NUNCA se
         convierte server-side). Si un huésped veía precios en EUR pero el hotel cobra en
         USD, el régimen mostraba "€25.00" cuando el cobro real sería $25.00 — mismo
         patrón de bug ya cerrado una vez este mismo día en el switcher de monedas.
         Corregido en `RoomsStep.vue` (usa `store.chargeCurrency`) y `BookingModal.vue`
         (nuevo helper `moneyCharge()`, separado de `money()` que sí usa displayCurrency
         para precios de habitación). Cubierto con 2 tests nuevos que fuerzan
         `currency:'EUR'` + `chargeCurrency:'USD'` y verifican "US$"/no "€" en el título
         — revert-testeado: revertido → ambos tests fallan con el símbolo de moneda
         incorrecto → restaurado → pasan.
      2. **Race condition — el eje de régimen parpadeaba como "no disponible"**:
         `getMealPlans` se pedía DESPUÉS de que `status` ya pasaba a `'selecting'` en
         `search()`, así que `RoomsStep` podía montar con `store.mealPlans` todavía vacío
         (los 3 códigos se ven un instante como "no ofrecido" antes de asentarse en su
         estado real). Corregido: `getMealPlans` ahora se pide en `Promise.all` junto con
         `getRates` — `search()` no resuelve (ni cambia `status`) hasta que ambas
         respuestas están listas. Al mover la llamada fuera de un `try/catch` directo,
         apareció un bug de robustez nuevo: un throw SÍNCRONO de `getMealPlans` (mock de
         test incompleto, o cualquier error antes del primer await) escapaba sin capturar
         porque `.catch()` nunca llegaba a adjuntarse — se resolvió envolviendo la
         llamada en una función `async` (que convierte cualquier throw síncrono en
         rechazo de promesa) antes de sumarla al `Promise.all`. Cubierto con
         `useBooking.mealplans.test.ts` (2 tests nuevos) — revert-testeado: revertido a
         secuencial → el test de la carrera falla (`status` ya es `'selecting'` con
         `mealPlans` todavía vacío) → restaurado → pasa.
      - Verificación final tras ambos fixes: frontend `vue-tsc -b` limpio, `vitest run`
        800/800 (mismas 2 suites preexistentes sin relación), `vite build` ✓ built.
        Verificado visualmente en navegador (Playwright) contra el backend local tras
        los fixes — el widget sigue mostrando los 3 estados correctamente.

- [ ] 2.3 **Auditoría financiera — bloqueante para el texto al cliente**: confirmar
      comportamiento real de reembolsos (comisiones Stripe, comisiones de plataforma,
      monto realmente reembolsable, quién asume comisiones no reembolsables,
      diferencia cancelación vs. reembolso) (Tarea 7). **Acceptance**: hallazgos
      documentados en `specs/booking-content-policies/spec.md`; el texto "reembolso
      completo" en el frontend NO cambia (ni se confirma ni se corrige) hasta cerrar
      esta auditoría.

- [ ] 2.4 Definir y documentar el modelo de clasificación de servicios/extras
      (incluido en tarifa / informativo / con costo / seleccionable) y confirmar si
      `upsells` necesita un campo `visibility` explícito o si ya alcanza con los
      campos existentes (Tarea 4). **Acceptance**: clasificación de cada extra actual
      del catálogo demo revisada y correcta en el widget.
      **Análisis arquitectónico resuelto 2026-08-21 (implementación de 2.2 lo confirma)**:
      régimen de alimentación **NO** se modela como parte de `upsells` — queda en tabla
      separada `meal_plans`, mismo patrón de sub-dominio de `bookingengine` pero
      catálogo FIJO en vez de abierto. Motivo: el régimen es una elección ÚNICA por
      habitación (reemplaza "solo alojamiento"), los extras son selección MÚLTIPLE —
      mezclarlos complicaría el widget sin necesidad. Investigación externa (GuestCentric,
      Bookassist) confirma que la industria separa board type de extras/upsells de la
      misma forma. `upsells` hoy NO tiene panel de admin (el backend existe, nadie lo
      llama desde el frontend) — sigue sin campo `visibility` explícito, sigue pendiente.
      **Pendiente real de 2.4** (no resuelto, es responsabilidad del dueño según lo
      acordado): revisar el catálogo demo de `upsells` extra por extra (desayuno,
      traslados, etc.) y decidir la categoría de cada uno — esta parte es la
      clasificación final que el dueño dijo que hace él mirando el catálogo junto con el
      asistente, no algo para resolver unilateralmente acá.

### Gate G2

- [ ] 2.5 Las 4 decisiones (2.1–2.4) están documentadas por escrito en sus specs
      correspondientes antes de tocar código de implementación asociado. **Acceptance**:
      ningún PR de G1 extendido (multi-tipo) ni de G3 relacionado a regímenes/extras/
      reembolsos se mergea sin la decisión escrita.

---

## G3 — UX y configuración

Specs: `specs/booking-checkout-ux/spec.md`, `specs/booking-content-policies/spec.md`.

- [x] 3.1 Reducir el formulario de datos del huésped a nombre, apellido, email,
      teléfono y hora estimada de llegada; mover cualquier campo adicional existente
      al flujo de pre-check-in/checklist (Tarea 5). **Acceptance**:
      `GuestCheckoutStep.vue` no solicita ningún dato fuera de esos 5 campos.

      **Hecho 2026-08-22.** El formulario YA pedía solo nombre+apellido (un campo
      combinado, "Nombre y apellido"), email y teléfono — no había campos de
      pre-check-in que mover. El campo que faltaba (hora estimada de llegada) SÍ
      existía, pero disfrazado de un textarea "Notas (opcional)" genérico
      ("pedidos especiales, hora de llegada…") en ambas superficies
      (`GuestCheckoutStep.vue` del widget, `BookingModal.vue` de la landing).

      **Bug real encontrado en la auditoría, no solo falta de campo**: ese textarea
      mandaba `notes` en el body de `POST /api/public/booking` (y `/booking/group`),
      pero ningún schema del backend lo declaraba (`CreatePublicBookingSchema`,
      `ExtendedPublicBookingSchema`, `CreatePublicBookingGroupSchema`) —
      `validateSchema` lo descartaba en el controller ANTES de que el usecase lo
      viera. El `Reservations.notes` que sí se guarda es 100% generado por el
      servidor (resumen de promo/upsells/total, ver `public-booking.ts:432-436`).
      Conclusión: todo lo que un huésped escribía en "Notas" — incluida la hora de
      llegada que el placeholder sugería — se perdía en silencio, sin error visible
      ni para el huésped ni para el hotel. Confirmado leyendo el controller
      (`createPublicBookingDirect`/`createPublicBookingGroup`): solo `upsells`,
      `rooms` e `idempotencyKey` se reincorporan crudos tras `validateSchema`;
      `notes` no estaba en esa lista.

      **Fix**: reemplazado el textarea genérico por un campo único y estructurado
      `estimatedArrival` (texto libre corto, ej. "15:00" o "después de las 8pm"),
      declarado en `CreatePublicBookingSchema`/`CreatePublicBookingGroupSchema`
      (`estimatedArrival: string, max 100, opcional`) y escrito por ambos usecases
      en `notesParts` → `Reservations.notes`, donde el recepcionista SÍ lo ve.
      Cambios: `bookingengine/validators/schema.ts`, `usecases/public-booking.ts`,
      `usecases/public-booking-group.ts` (backend); `useBooking.ts` (`BookingGuest.
      notes` → `estimatedArrival`), `Booking.service.ts`, `types/booking.ts`
      (`CreateBookingGuest`), `GuestCheckoutStep.vue`, `BookingModal.vue`,
      `useBookingI18n.ts` (es/en/pt) (frontend). Ningún otro campo de pre-check-in
      existía en este formulario para mover — el spec ya estaba satisfecho en
      nombre/email/teléfono, solo faltaba (y estaba roto) el quinto campo.

      Verificado: backend `bun test src/modules/bookingengine` 379/379,
      `arckode analyze` ✅ 0 violaciones (typecheck backend tiene 11 errores
      preexistentes en `admin/plans.ts`/`subscriptions/plan-gating.test.ts`/
      `subscriptions/resolve-plan.ts` — trabajo sin commitear de otra sesión en
      paralelo, no relacionado a este módulo, confirmado con `git status` al
      inicio). Frontend: `vitest run` sobre `components/booking`,
      `components/landing/BookingModal.test.ts`, `composables/useBooking*`,
      `services/Booking.service.test.ts` → 76/76 verde; `vite build` ✓ built
      (typecheck frontend también tiene errores preexistentes ajenos en
      `pages/super-admin/plan-modules.ts` — misma sesión paralela).
      Documentado en `specs/booking-checkout-ux/spec.md` (sección API, con el
      hallazgo completo).

      **Segunda pasada (2026-08-22, cierre del gap de tests)**: la primera pasada
      dejó anotado que no había ningún test de regresión que fijara el
      comportamiento. Cerrado con 7 tests nuevos, todos revert-testeados a mano
      (comentado el fix, confirmado rojo con el mensaje exacto, restaurado,
      confirmado verde de nuevo):
      - `public-booking-schema.test.ts` (4 casos): `estimatedArrival` sobrevive
        `validateSchema` en `ExtendedPublicBookingSchema` y en
        `CreatePublicBookingGroupSchema`; sin el campo no revienta (opcional); y
        el caso que documenta el bug cerrado — un `notes` suelto en el body se
        sigue descartando en silencio (si algún día alguien "arregla" el textarea
        agregando `notes` de vuelta al schema sin tocar este test, el test avisa).
      - `public-booking-checkout.test.ts` (2 casos): `estimatedArrival` en el body
        → `Reservations.notes` contiene `"Llegada estimada: 15:00"`; sin el campo,
        `notes` no menciona "Llegada estimada".
      - `public-booking-group.test.ts` (1 caso): mismo comportamiento para
        `createPublicBookingGroup`, verificado en las `notes` de TODAS las
        reservas del grupo (comparten `notesParts`).
      Suite completa `bookingengine` tras el cierre: 386/386 (379 + 7). Verificado
      además que ningún consumidor frontend lee `PublicReservation.notes` (tipo
      declarado en `types/booking.ts:450` pero sin ningún `.notes` leído sobre una
      reserva pública en todo `src/`) — no hay UI que dependiera del campo viejo.
      Confirmado con `git stash`/`stash pop` que las 5 suites que fallan en
      `vitest run` completo (`rooms.test.ts`, `modules.store.test.ts`,
      `AppHeader.channel-gate.test.ts`, `FooterBlock.test.ts`,
      `hotel-landing.test.ts`) fallan IGUAL sobre `HEAD` limpio, sin este cambio
      — deuda ajena (3 de otra sesión en paralelo sobre feature-gating por plan,
      2 ya documentadas en memoria como "favicon.svg" preexistente), no algo que
      esta tarea haya introducido.

      **Tercera pasada (2026-08-22, corrección de producto)**: el usuario (dueño del
      producto) pidió explícitamente asegurar que el textarea de pedidos especiales
      siguiera existiendo y funcionando — recibir peticiones del huésped es un
      requisito duro, no un nice-to-have que se pueda perder al reemplazarlo por
      `estimatedArrival`. La segunda pasada había cerrado el bug de persistencia
      pero angostó el alcance a un solo campo estructurado, sin restaurar el texto
      libre.
      **Fix**: agregado `specialRequests` (string, opcional, max 500) como campo
      HERMANO de `estimatedArrival` — no lo reemplaza, ninguno de los dos se sacó.
      Declarado en `CreatePublicBookingSchema`/`CreatePublicBookingGroupSchema`,
      escrito por ambos usecases en `notesParts` con su propia etiqueta ("Pedido
      especial: …", justo después de "Llegada estimada"). Textarea restaurado en
      `GuestCheckoutStep.vue` y `BookingModal.vue` (label "Pedidos especiales
      (opcional)", placeholder "Cuna, piso alto, alergias…"). `BookingGuest`/
      `CreateBookingGuest`/`Booking.service.ts` extendidos con el nuevo campo. i18n
      es/en/pt.
      Tests nuevos (mismo patrón, revert-testeados a mano): 2 en
      `public-booking-schema.test.ts` (sobrevive validateSchema / opcional no
      revienta), 2 en `public-booking-checkout.test.ts` (llega a `Reservations.notes`
      etiquetado; ambos campos juntos no se pisan), 1 en `public-booking-group.test.ts`
      (llega a las `notes` de todas las reservas del grupo). Suite `bookingengine`
      final: 391/391 (386 + 5). `arckode analyze` 0 violaciones.
      **Verificación extremo a extremo contra el servidor real** (no solo tests, ya
      que el pedido explícito era "asegurate de que esto funcione" para el negocio):
      levantado `bun run dev` (backend :3001) + `vite` (frontend :5173) sobre la
      SQLite de dev, `POST /api/public/booking` real contra `hotel-boutique-palma`
      con `estimatedArrival` y `specialRequests`, reserva creada (201). Logueado como
      `admin@caribeparadise.com` (dueño de ese hotel en la DB local) y consultado
      `GET /api/reservas/:id` — el MISMO endpoint que usa el panel — devolvió
      `notes: "Reserva desde widget público | Llegada estimada: 15:00 | Pedido
      especial: Cuna y piso alto, por favor (verificacion end-to-end) | Total:
      153.40 (subtotal 130.00 + tax 23.40)"`. Confirmado además (lectura de código)
      que `ReservationModal.vue:774-777` ya renderiza `d.notes` bajo el label
      "Notas", dentro de `<details open>` (expandido por defecto) — el anfitrión lo
      ve sin acción adicional, no hizo falta tocar el panel. Reserva y guest de
      prueba borrados de la DB de dev tras verificar. Servers de dev detenidos al
      terminar.
      Documentado en `specs/booking-checkout-ux/spec.md` (requirement ampliado a 6
      campos + 2 scenarios nuevos, sección API y UI actualizadas).

      **Cuarta pasada (2026-08-22, iteración de cierre)**: gap real encontrado —
      `estimatedArrival`/`specialRequests` tenían tope en el backend
      (`max: 100`/`max: 500`, confirmado leyendo `arckode-framework/kernel/
      validator.ts:55`: para `type:'string'` `max` es longitud, no valor) pero
      ningún `maxlength` en el HTML. No es pérdida de datos ni bug de persistencia
      (`validateSchema` responde 400 con mensaje claro y `http.ts:withFieldDetail`
      ya lo traduce a texto legible para el huésped) — es fricción evitable: sin el
      atributo, el huésped podía escribir de más y recién se enteraba al enviar. Fix:
      `maxlength="100"`/`maxlength="500"` en los 4 inputs (`GuestCheckoutStep.vue` +
      `BookingModal.vue`), espejando los límites del schema — el navegador corta
      antes de que se pueda mandar un valor inválido. Verificado: `vitest run`
      scoped 76/76 sin cambios, `vite build` ✓ built.

      **Hallazgo reportado en la pasada anterior — CERRADO en esta (2026-08-22,
      5ª pasada)**: el usuario confirmó "agregalo a la pantalla de check-in
      también, y si hay otro lugar donde debía estar, agregalo igualmente".
      `pages/checkin/index.vue` no mostraba `Reservations.notes` en ningún lado.
      Backend: **sin cambios** — `GET /api/planning`
      (`dashboard/usecases/dashboard-queries.ts:getPlanning` /
      `dashboard-data.ts:getPlanningData`) ya hace `{ ...r, guestName, ... }`
      sobre la fila cruda de `Reservations`, así que `notes` YA viajaba en la
      respuesta; el gap era 100% frontend (el campo nunca se leía ni se
      declaraba en el tipo).
      Cambios: `types/index.ts` (`CheckinGuest.notes: string | null` nuevo) +
      `mapGuest()` en `checkin/index.vue` ahora lo popula. Mostrado en 3 lugares:
      (1) fila de "Llegadas Hoy" — ícono con `title` (tooltip nativo) junto al
      nombre si `a.notes` tiene contenido, para que el recepcionista lo note sin
      abrir nada; (2) **modal de Check-in** (el pedido explícito del usuario) —
      bloque "Notas de la reserva" destacado en dorado, entre los datos de la
      reserva y el botón "Confirmar Check-in", visible sin acción extra; (3)
      **popover de detalle de habitación** (otro lugar donde correspondía,
      encontrado en esta pasada) — mismo bloque "Notas" bajo las fechas de
      check-in/check-out, para cuando el staff hace click en una habitación
      ocupada desde la grilla en vez de desde "Llegadas Hoy". Los tres reusan
      texto crudo (`whitespace-pre-wrap`, sin parsear) — mismo criterio que
      `ReservationModal.vue`, para no duplicar lógica de formato en 2 archivos.
      **Verificación extremo a extremo contra el servidor real** (mismo método
      que la 3ª pasada): reserva creada con `checkIn` = HOY vía
      `POST /api/public/booking` con `specialRequests`/`estimatedArrival`, y
      `GET /api/planning` (el endpoint EXACTO que consume esta pantalla,
      logueado como `admin@caribeparadise.com`) devolvió la fila con
      `notes: "... | Llegada estimada: 16:30 | Pedido especial: Pedido de
      verificacion: piso alto y cuna | ..."` — confirma que el dato llega
      completo hasta la puerta del componente. Datos de prueba borrados,
      servidor detenido al terminar.
      Verificado: `bun run typecheck` (backend y frontend, sin errores nuevos —
      los preexistentes son de `plan-modules`/`plan-gating`, sesión paralela
      ajena), `vite build` ✓ built, `vitest run` scoped 76/76 sin cambios (no se
      tocó ningún archivo con test dedicado — `checkin/index.vue` no tiene
      suite propia, igual que antes de este cambio; montarla exigiría mockear
      ~7 services + router + Pinia, desproporcionado para un bloque
      condicional sin lógica que revert-testear).
      No tocado (evaluado y descartado, fuera del alcance de "recibir y ver el
      pedido del huésped"): "En Casa" y "Salidas Hoy" — el pedido especial ya
      se atendió o quedó registrado al check-in, mostrarlo de nuevo en salida
      no aporta; housekeeping — su tarea nace recién al CHECK-OUT (limpieza
      post-estadía), no en la preparación pre-llegada.

- [ ] 3.2 Mejorar legibilidad del resumen de reserva (fecha, habitación, huéspedes,
      total): revisar peso de fuente, tamaño, contraste, jerarquía y espaciado de los
      datos principales (Tarea 8). **Acceptance**: revisión visual confirma que fecha/
      habitación/huéspedes/total tienen mayor peso o contraste que la información
      secundaria.

      **Implementado 2026-08-22, acceptance (revisión visual) sin confirmar — ver nota
      al final.** Antes, dentro del resumen previo al pago, labels y valores de
      fecha/habitación/huéspedes usaban el MISMO `text-sm` que el desglose de precio de
      abajo (Alojamiento/Impuestos/Descuento) — nada los distinguía salvo el Total
      (`text-xl font-black`, sin tocar). Jerarquía de 3 niveles aplicada en ambas
      superficies (`PayStep.vue` del widget, `BookingModal.vue` de la landing):
      label `text-xs font-bold uppercase tracking-wide` (más chico y en mayúscula, se
      lee como etiqueta, no como contenido) < valor `text-base font-black text-navy`
      (un escalón arriba del `text-sm` anterior) < Total `text-xl font-black` (sin
      cambios, sigue siendo lo más grande de la pantalla).
      **Gap real cerrado de paso**: `PayStep.vue` (widget) no tenía una fila propia de
      "Huéspedes" — el conteo vivía escondido en una línea `text-xs` de resumen del
      carrito ("2 habitaciones · 4 huéspedes · 3 noches"), mientras que
      `BookingModal.vue` (landing) sí lo mostraba como fila dedicada. Agregada la fila
      "Huéspedes" al widget (nueva key i18n `pay.guestsCount`, es/en/pt) y **quitada**
      la línea de resumen del carrito redundante (todo lo que decía — habitaciones,
      huéspedes, noches — ya está en las filas de arriba una vez agregada la fila de
      huéspedes; mantenerla las duplicaba, en contra del objetivo de legibilidad de
      esta misma tarea). `rooms.cartSummary` sigue existiendo y se sigue usando en
      `RoomsStep.vue` (paso de selección, contexto distinto) — no se tocó ahí.
      Verificado: `vue-tsc -b` limpio, `vitest run` sobre `components/booking` +
      `components/landing` → 127/127 (1 suite falla, `FooterBlock.test.ts`, error
      preexistente y ajeno de `favicon.svg` — no relacionado, ya documentado en
      sesiones anteriores), `vite build` ✓ built.
      **Nota de alcance — acceptance NO verificado visualmente**: esta sesión no tiene
      acceso a un navegador/Playwright para tomar capturas o inspeccionar el render
      real; el cambio se armó y verificó por código (clases Tailwind aplicadas,
      escala tipográfica deliberada 12px/16px/20px) y por los gates automáticos
      arriba, pero la aceptación tal como está escrita pide una revisión visual
      humana. Queda el checkbox sin marcar a propósito hasta que alguien lo confirme
      mirando el widget real (`/book/:slug`) y la landing (`/h/:slug`).

- [ ] 3.3 Aumentar legibilidad de políticas y condiciones sin convertirlas en el
      elemento dominante de la pantalla (Tarea 9). **Acceptance**: el texto de
      políticas es legible sin zoom, manteniéndose visualmente secundario al resumen
      de compra.

- [ ] 3.4 Completar y confirmar la configuración visual del motor por hotel (colores,
      contenido, mensajes comerciales, beneficios, bloques visibles/ocultos) sin
      requerir cambios de código (Tarea 13). **Acceptance**: activar/desactivar un
      bloque o mensaje desde settings se refleja en la landing/widget sin deploy.

- [ ] 3.5 Confirmar/completar la gestión de galería por hotel: agregar, eliminar,
      reordenar, ocultar, y asociar imágenes al hotel o a un tipo de habitación
      específico (Tarea 14). **Acceptance**: reordenar en el panel persiste el orden
      mostrado en la landing pública.

### Gate G3 (final)

- [ ] 3.6 Gate de verificación completo (typecheck + analyze + test + build, backend y
      frontend) + revisión visual manual del flujo completo (búsqueda → selección →
      extras → datos → políticas → pago) contra los 3 specs de este change.
      **Acceptance**: los 5 comandos en verde + flujo e2e verificado manualmente antes
      de dar el change por cerrado.
