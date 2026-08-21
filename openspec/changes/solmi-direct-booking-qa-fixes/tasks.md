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

- [ ] 1.3 Agregar validación de ocupación vs. capacidad configurada por tipo de
      habitación en la búsqueda (Tarea 12). **Acceptance**: habitación con capacidad
      máxima 2 NO aparece como resultado válido para una búsqueda de 4 adultos en 1
      habitación, aunque tenga inventario libre.

- [ ] 1.4 Soportar reserva de múltiples unidades del mismo tipo de habitación en una
      sola operación, validando contra inventario disponible (Tarea 10). **Acceptance**:
      con 3 Deluxe disponibles, seleccionar "Deluxe × 2" crea una única reserva con 2
      unidades; seleccionar "× 4" es rechazado y se informa el máximo real (3).

- [ ] 1.5 Cargar la política de cancelación/reembolso del widget desde la
      configuración del hotel en el PMS, eliminando cualquier texto fijo compartido
      entre hoteles (Tarea 6). **Acceptance**: dos hoteles con plazos de cancelación
      gratuita distintos (3 días vs. 7 días) muestran cada uno su propio texto en el
      resumen pre-pago.

- [ ] 1.6 Implementar revalidación completa (inventario, tarifa, cantidad, ocupación,
      extras, total) inmediatamente antes de habilitar el pago, bloqueando el cobro si
      algo cambió desde la búsqueda inicial (Tarea 15). **Acceptance**: si la última
      unidad disponible se vende a otro huésped mientras el primero completa el flujo,
      el segundo NO puede pagar y ve un mensaje explicando qué cambió.

### Gate G1

- [ ] 1.7 Gate de verificación (typecheck + analyze + test + build, backend y
      frontend) en verde antes de continuar a G3. **Acceptance**: los 5 comandos
      devuelven éxito.

---

## G2 — Requieren definición funcional antes de implementar

Specs: `specs/booking-availability-pricing/spec.md` (2.1),
`specs/booking-content-policies/spec.md` (2.2, 2.3, 2.4).

- [ ] 2.1 **Decisión de producto — bloqueante**: ¿se permite combinar tipos de
      habitación distintos en una misma reserva (Opción A) o cada reserva contiene un
      solo tipo (Opción B)? (Tarea 11). **Acceptance**: decisión documentada con fecha
      en `specs/booking-availability-pricing/spec.md`, sección "Combinar tipos de
      habitación distintos" — reemplaza el estado "DECISIÓN PENDIENTE". Sin esta
      decisión, no se implementa la variante multi-tipo de 1.4.

- [ ] 2.2 **Decisión de producto**: nomenclatura definitiva del catálogo de regímenes
      de alimentación (Tarea 3). Validar con el mercado objetivo entre "Solo
      alojamiento / Desayuno incluido / Desayuno y cena / Todo incluido" vs. términos
      actuales ("Media pensión" / "Pensión completa"). **Acceptance**: catálogo
      definitivo documentado en `specs/booking-content-policies/spec.md`; diseño de
      tabla `meal_plans` (o equivalente) confirmado antes de migrar.

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

### Gate G2

- [ ] 2.5 Las 4 decisiones (2.1–2.4) están documentadas por escrito en sus specs
      correspondientes antes de tocar código de implementación asociado. **Acceptance**:
      ningún PR de G1 extendido (multi-tipo) ni de G3 relacionado a regímenes/extras/
      reembolsos se mergea sin la decisión escrita.

---

## G3 — UX y configuración

Specs: `specs/booking-checkout-ux/spec.md`, `specs/booking-content-policies/spec.md`.

- [ ] 3.1 Reducir el formulario de datos del huésped a nombre, apellido, email,
      teléfono y hora estimada de llegada; mover cualquier campo adicional existente
      al flujo de pre-check-in/checklist (Tarea 5). **Acceptance**:
      `GuestCheckoutStep.vue` no solicita ningún dato fuera de esos 5 campos.

- [ ] 3.2 Mejorar legibilidad del resumen de reserva (fecha, habitación, huéspedes,
      total): revisar peso de fuente, tamaño, contraste, jerarquía y espaciado de los
      datos principales (Tarea 8). **Acceptance**: revisión visual confirma que fecha/
      habitación/huéspedes/total tienen mayor peso o contraste que la información
      secundaria.

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
