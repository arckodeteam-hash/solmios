# Booking Content, Policies & Configuration Specification

## Purpose

Cerrar los gaps de configuración dinámica del motor: regímenes de alimentación,
servicios/extras, políticas de cancelación y reembolso, y personalización visual
(incluida galería) deben provenir de lo que el hotel configura en el PMS, no de texto o
lógica fija en el frontend. Cubre las Tareas 3, 4, 6, 7, 13 y 14 del documento de
hallazgos de QA (2026-08-20).

## Requirements

### Requirement: Regímenes de alimentación configurables por hotel — RESUELTO 2026-08-21/22

El catálogo de regímenes de alimentación (qué incluye la tarifa en materia de comidas)
MUST provenir de una configuración por hotel, NOT estar escrito de forma rígida en el
frontend.

**Nomenclatura definitiva** (confirmada por el dueño, reemplaza "Media pensión"/"Pensión
completa" — poco natural para el mercado objetivo): "Solo alojamiento" / "Desayuno
incluido" / "Desayuno y cena" / "Todo incluido".

**Decisión de catálogo — enum FIJO, no abierto**: a diferencia del planteo original
("un hotel define 2 regímenes propios con nombre y descripción configurables"), el
catálogo implementado es de **3 códigos fijos** (`breakfast|half_board|all_inclusive`,
más "Solo alojamiento" como base implícita sin fila propia) — el hotel activa/desactiva
cada uno y define si viene incluido en la tarifa o tiene costo aparte, pero NO inventa
nombres nuevos. Motivo: la industria (GuestCentric, Bookassist) usa un catálogo estándar
acotado, y un enum fijo es más simple de mantener consistente en 3 idiomas (es/en/pt)
que texto libre por hotel.

#### Scenario: Hotel activa un régimen y define si tiene costo — RESUELTO

- GIVEN un hotel activa "Desayuno incluido" con `priceMode: 'included'`
- WHEN el widget muestra las opciones de una habitación
- THEN aparece junto a "Solo alojamiento" como pill activo/informativo, sin afectar el
  precio de la habitación

#### Scenario: Régimen con costo aparte se muestra informativo, no seleccionable — RESUELTO

- GIVEN un hotel activa "Todo incluido" con `priceMode: 'per_person_per_night'` y un precio
- WHEN el widget muestra las opciones de una habitación
- THEN aparece con el precio y la etiqueta "Próximamente", pero NO es clickeable ni suma
  al carrito — integrarlo al cobro real es una fase aparte (mismo rigor que la
  revalidación server-side de 1.6, evita prometer un cobro que el sistema no ejecuta)

#### Scenario: Régimen no activado se muestra deshabilitado con motivo — RESUELTO

- GIVEN un hotel no activó "Desayuno y cena"
- WHEN el widget muestra las opciones de una habitación
- THEN "Desayuno y cena" sigue apareciendo (nunca se oculta), deshabilitado, con el
  motivo "Este hotel no ofrece este régimen" — mismo criterio ya aplicado a la matriz de
  ocupación

### Requirement: Servicios y extras clasificados correctamente

El motor MUST distinguir y renderizar de forma diferenciada, según la configuración del
hotel, extras que son: incluidos en la tarifa, meramente informativos, adicionales con
costo, o seleccionables durante la reserva. La fuente de esta clasificación MUST ser la
configuración del hotel (tabla `upsells` u homóloga), no una suposición del frontend.

**Análisis arquitectónico resuelto 2026-08-21**: el régimen de alimentación NO se
modela dentro de `upsells` — queda en tabla separada `meal_plans` (ver requirement
anterior), mismo patrón de sub-dominio de `bookingengine` pero catálogo fijo en vez de
abierto, porque el régimen es una elección ÚNICA por habitación mientras los extras son
selección MÚLTIPLE. `upsells` en sí sigue sin panel de admin y sin campo `visibility`
explícito — la clasificación extra-por-extra del catálogo demo sigue pendiente (el
dueño la revisa junto con el equipo, no es una decisión unilateral de este spec).

#### Scenario: Extra con costo seleccionable

- GIVEN el hotel configuró "Traslado aeropuerto" como extra con costo, seleccionable
- WHEN el huésped llega al paso de extras
- THEN puede agregarlo con su precio visible y su costo se suma al total

#### Scenario: Extra informativo sin costo

- GIVEN el hotel configuró "Wifi gratuito" como informativo (no seleccionable, no
  cobra)
- WHEN el huésped ve la lista de extras
- THEN aparece como beneficio informativo, sin checkbox de selección ni precio

### Requirement: Políticas del hotel cargadas dinámicamente

Las condiciones y políticas mostradas durante la reserva (cancelación, plazo de
cancelación gratuita, reembolso, penalizaciones) MUST provenir de la configuración del
hotel en el PMS. El motor MUST NOT aplicar una política fija idéntica a todos los
hoteles cuando el PMS permite configurarla.

#### Scenario: Política de cancelación específica del hotel

- GIVEN un hotel configuró "cancelación sin cargo hasta 7 días antes del check-in"
- WHEN el huésped ve el resumen antes de pagar
- THEN el texto mostrado refleja exactamente esos 7 días, no un plazo genérico

#### Scenario: Dos hoteles con políticas distintas

- GIVEN Hotel A permite cancelación gratuita hasta 3 días antes y Hotel B hasta 7 días
- WHEN un huésped busca en cada uno
- THEN cada widget muestra la política correspondiente a ESE hotel

**RESUELTO 2026-08-21 — VERIFICADO, YA CUMPLÍA**: auditado `public-rates.ts` +
`shared/usecases/cancellation-math.ts` (`resolvePolicy`, precedencia canal > política
base propia del hotel > preset de `hotels.cancellationType` > default flexible) — el
motor YA resuelve `cancellationSummary` 100% por `hotelId`, sin ningún default
compartido. El gap real era de COBERTURA (nada probaba el escenario "dos hoteles"), no
de implementación — cerrado con 3 tests en `public-rates.test.ts` + el primer archivo
de tests de `PayStep.vue` (`PayStep.test.ts`, no existía ninguno).

**FIX adicional 2026-08-21 (misma auditoría, iteración posterior)**: `PayStep.vue`
(widget) consumía `cancellationSummary` pero, a diferencia de `BookingModal.vue`
(landing), todavía caía al texto libre `cancellationPolicy` (que el admin escribe a
mano) cuando no había política estructurada — el mismo patrón que causó un incidente
real documentado en `BookingModal.vue` (texto libre "flexible" mientras la política
real aplicada al cancelar era estricta). Portado el mismo sistema de tono de riesgo
(danger/neutral) de la landing al widget. Ver Tarea 6/1.5 en `tasks.md` para el
detalle completo y los 3 branches verificados con revert manual.

**FIX adicional 2026-08-22 (decisión del usuario)**: `PayStep.vue` tampoco exigía
aceptación explícita (checkbox) antes de pagar, a diferencia de `BookingModal.vue`
(`termsAccepted`, guard en el handler). Portado el mismo patrón — ver Tarea 6/1.5 en
`tasks.md`, "Cuarta pasada".

### Requirement: Comportamiento de reembolso auditado antes de prometerse — AUDITORÍA PENDIENTE

El motor MUST NOT mostrar al cliente la promesa de "reembolso completo" hasta que se
confirme técnicamente el comportamiento real del procesador de pago y de la plataforma.
La auditoría MUST cubrir explícitamente:

- Comisiones del procesador de pago (Stripe) sobre el monto reembolsado.
- Comisiones propias de la plataforma, si existen.
- Monto realmente reembolsable vs. monto cobrado originalmente.
- Quién asume comisiones no reembolsables (hotel, plataforma, o huésped).
- Diferencia funcional entre "cancelar" una reserva y "reembolsar" un cobro.

El texto definitivo mostrado al huésped MUST NOT fijarse hasta cerrar esta auditoría.

#### Scenario: Reembolso dentro del período permitido

- GIVEN una reserva cancelada dentro del plazo de cancelación gratuita configurado
- WHEN se dispara el reembolso
- THEN el monto acreditado al huésped y cualquier comisión no reembolsable retenida
  coinciden exactamente con lo auditado y documentado (no con una suposición de "100%
  de vuelta")

### Requirement: Configuración visual del motor por hotel

Colores, galería, contenido, mensajes comerciales (pago seguro, reserva directa, sin
comisión, beneficios de reservar directo), y visibilidad de bloques MUST administrarse
desde configuración del hotel (ver `landing_blocks` / tema de `solmi-direct-booking`
F1), sin requerir cambios de código por hotel.

#### Scenario: Hotel oculta un bloque de mensajes comerciales

- GIVEN un hotel desactiva el bloque de "beneficios de reservar directo"
- WHEN se carga su landing/widget
- THEN ese bloque no se renderiza, sin tocar código

### Requirement: Gestión de galería por hotel

El hotel MUST poder agregar, eliminar, reordenar y ocultar imágenes de la galería desde
su panel de administración, y MUST poder asociar imágenes al hotel en general o a un
tipo de habitación específico (ver `hotel_media` de `solmi-direct-booking` F0).

#### Scenario: Reordenar galería persiste

- GIVEN un hotel reordena sus fotos de galería en el panel
- WHEN un huésped visita la landing
- THEN el orden mostrado coincide con el configurado

## Database

- Regímenes de alimentación — RESUELTO: tabla `meal_plans` (`id, hotelId, code
  ('breakfast'|'half_board'|'all_inclusive'), active, priceMode
  ('included'|'per_person_per_night'), price, createdAt, updatedAt`), catálogo fijo de
  3 códigos por hotel (find-or-create por `hotelId+code`, no altas/bajas libres).
  "Solo alojamiento" es la base implícita, sin fila propia. Ver
  `backend/src/modules/bookingengine/model.ts`.
- Extras/servicios: reusar `upsells` (ya existe desde F2 de `solmi-direct-booking`);
  auditar si necesita un campo de clasificación explícito (`visibility:
  'included'|'informational'|'paid_selectable'`) si hoy se infiere solo de `price`.
- Políticas: ya existen en `Hotels` (`cancellationType`, `freeCancellation`,
  `depositRequired`, `depositPercent`, `releaseHours` — expuestos desde F0). Sin
  cambios de schema esperados; el gap es de renderizado en el frontend, no de datos.
- Reembolsos: sin cambio de schema hasta cerrar la auditoría (Tarea 7); puede requerir
  un campo de tracking de comisión retenida si la auditoría lo determina.

## API

- Regímenes de alimentación — RESUELTO: `GET /api/public/hotels/:slug/meal-plans`
  (público, rate-limited 60/60s, solo devuelve los `active` en orden fijo
  breakfast→half_board→all_inclusive) + admin `GET/PUT /api/meal-plans` (`mealplans:
  view/edit`). Consumido por `RoomsStep.vue` y `BookingModal.vue` vía
  `BookingService.getMealPlans()` / `useBooking.ts` (`store.mealPlans`, cargado en
  `search()`).
- Auditar `GET /api/public/hotels/:slug/upsells` (F2 2.6) para exponer la
  clasificación de extras si se agrega el campo `visibility`.
- Confirmar que el DTO público de `GET /api/public/hotels/:slug` (F0 0.4) ya expone
  las políticas de cancelación — si el frontend no las está consumiendo, el fix es en
  UI, no en API.

## UI

- `RoomsStep.vue` y `BookingModal.vue` MUST listar regímenes configurados por hotel
  (RESUELTO: ambas superficies leen `store.mealPlans`) y extras clasificados
  correctamente (PENDIENTE — ver requirement de extras arriba).
- Resumen pre-pago MUST renderizar la política de cancelación específica del hotel
  (texto dinámico, no estático).
- Builder de settings (landing) MUST exponer toggles de mensajes comerciales y gestión
  completa de galería (agregar/eliminar/reordenar/ocultar/asociar a habitación).
