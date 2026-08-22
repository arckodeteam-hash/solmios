# Booking Content, Policies & Configuration Specification

## Purpose

Cerrar los gaps de configuración dinámica del motor: regímenes de alimentación,
servicios/extras, políticas de cancelación y reembolso, y personalización visual
(incluida galería) deben provenir de lo que el hotel configura en el PMS, no de texto o
lógica fija en el frontend. Cubre las Tareas 3, 4, 6, 7, 13 y 14 del documento de
hallazgos de QA (2026-08-20).

## Requirements

### Requirement: Regímenes de alimentación configurables por hotel — NOMENCLATURA PENDIENTE

El catálogo de regímenes de alimentación (qué incluye la tarifa en materia de comidas)
MUST provenir de una configuración por hotel, NOT estar escrito de forma rígida en el
frontend. La nomenclatura definitiva MUST validarse con producto antes de implementar
el catálogo final; alternativas propuestas a evaluar:

- "Solo alojamiento"
- "Desayuno incluido"
- "Desayuno y cena"
- "Todo incluido"

vs. la terminología actual ("Media pensión" / "Pensión completa"), señalada como poco
natural para el mercado objetivo.

#### Scenario: Hotel configura su propio catálogo de regímenes

- GIVEN un hotel define 2 regímenes propios con nombre y descripción configurables
- WHEN el widget muestra las opciones de una habitación
- THEN se listan exactamente los regímenes configurados por ese hotel, no un enum fijo
  del código

### Requirement: Servicios y extras clasificados correctamente

El motor MUST distinguir y renderizar de forma diferenciada, según la configuración del
hotel, extras que son: incluidos en la tarifa, meramente informativos, adicionales con
costo, o seleccionables durante la reserva. La fuente de esta clasificación MUST ser la
configuración del hotel (tabla `upsells` u homóloga), no una suposición del frontend.

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

- Regímenes de alimentación: probable tabla nueva `meal_plans` (`id, hotelId, name,
  description, sortOrder, active`) o extensión de `RoomRates`/`Seasons` existente con
  referencia a régimen — decidir junto con la nomenclatura antes de migrar.
- Extras/servicios: reusar `upsells` (ya existe desde F2 de `solmi-direct-booking`);
  auditar si necesita un campo de clasificación explícito (`visibility:
  'included'|'informational'|'paid_selectable'`) si hoy se infiere solo de `price`.
- Políticas: ya existen en `Hotels` (`cancellationType`, `freeCancellation`,
  `depositRequired`, `depositPercent`, `releaseHours` — expuestos desde F0). Sin
  cambios de schema esperados; el gap es de renderizado en el frontend, no de datos.
- Reembolsos: sin cambio de schema hasta cerrar la auditoría (Tarea 7); puede requerir
  un campo de tracking de comisión retenida si la auditoría lo determina.

## API

- Nuevo o extendido: endpoint público que devuelva el catálogo de regímenes de
  alimentación por hotel, consumido por `RoomsStep.vue`.
- Auditar `GET /api/public/hotels/:slug/upsells` (F2 2.6) para exponer la
  clasificación de extras si se agrega el campo `visibility`.
- Confirmar que el DTO público de `GET /api/public/hotels/:slug` (F0 0.4) ya expone
  las políticas de cancelación — si el frontend no las está consumiendo, el fix es en
  UI, no en API.

## UI

- `RoomsStep.vue` MUST listar regímenes configurados por hotel y extras clasificados
  correctamente.
- Resumen pre-pago MUST renderizar la política de cancelación específica del hotel
  (texto dinámico, no estático).
- Builder de settings (landing) MUST exponer toggles de mensajes comerciales y gestión
  completa de galería (agregar/eliminar/reordenar/ocultar/asociar a habitación).
