# Booking Checkout UX Specification

## Purpose

Reducir fricción y errores en el tramo final del motor de reservas: datos solicitados
al huésped y legibilidad de la información crítica (fechas, habitación, huéspedes,
resumen, políticas) antes de pagar. Cubre las Tareas 5, 8 y 9 del documento de
hallazgos de QA (2026-08-20).

## Requirements

### Requirement: Datos mínimos solicitados al huésped

El formulario de datos del huésped durante la reserva MUST limitarse a: nombre,
apellido, correo electrónico, teléfono, hora estimada de llegada, pedidos especiales
en texto libre. El motor MUST NOT solicitar datos adicionales del huésped en esta etapa
si existe un proceso posterior (pre-check-in / checklist) donde esos datos se completan.

**Corrección 2026-08-22**: la primera versión de este requirement (cerrada el mismo día)
listaba 5 campos sin "pedidos especiales", reemplazando el textarea de notas original por
solo `estimatedArrival`. El dueño del producto pidió explícitamente recibir peticiones del
huésped (cuna, piso alto, alergias…) — no es opcional para el negocio. El requirement queda
en 6 campos: los 5 originales + un textarea de texto libre. Los pedidos especiales MUST
llegar al recepcionista en la información de la reserva (no alcanza con que el campo exista
en el formulario si no se persiste — ver la sección API, el bug real que motivó todo esto).

#### Scenario: Formulario de checkout pide lo esencial + espacio para pedidos del huésped

- GIVEN un huésped llega al paso de datos personales (`GuestCheckoutStep.vue`)
- WHEN completa el formulario
- THEN los únicos campos son nombre, apellido, email, teléfono, hora estimada de
  llegada y pedidos especiales (texto libre) — ningún campo de pre-check-in aparece ahí

#### Scenario: Un pedido especial escrito por el huésped llega al anfitrión

- GIVEN un huésped escribe "cuna y piso alto" en el campo de pedidos especiales y
  completa la reserva
- WHEN el anfitrión del hotel abre el detalle de esa reserva en el panel
  (`ReservationModal.vue`, sección "Datos de la Reserva")
- THEN ve el texto "Pedido especial: cuna y piso alto" dentro de "Notas", visible sin
  tener que expandir nada adicional (`<details open>`)

### Requirement: Legibilidad de información crítica de la reserva

Fecha, habitación, huéspedes y resumen de reserva MUST tener contraste, peso de fuente
y jerarquía visual suficientes para leerse sin esfuerzo. Los datos principales del
resumen (fechas, total, tipo de habitación) MUST usar mayor peso de fuente o contraste
que la información secundaria.

#### Scenario: Resumen de reserva legible antes de pagar

- GIVEN un huésped llega al paso de pago
- WHEN revisa el resumen (fechas, habitación, huéspedes, total)
- THEN los datos principales son distinguibles a simple vista, sin requerir zoom o
  esfuerzo de lectura

**Implementado 2026-08-22 (Tarea 8)**: jerarquía de 3 niveles en `PayStep.vue` (widget) y
`BookingModal.vue` (landing) — label `text-xs uppercase` < valor principal `text-base
font-black` < Total `text-xl font-black` (sin cambios, ya era el elemento más grande).
Antes, fecha/habitación/huéspedes compartían el mismo `text-sm` que el desglose de precio
de abajo (Alojamiento/Impuestos/Descuento) — nada los distinguía salvo el Total. Detalle en
`tasks.md` 3.2. **Acceptance pendiente de confirmar**: esta sesión no tuvo navegador/
Playwright disponible para la revisión visual que este scenario pide — el cambio está
verificado por código y build, no por inspección visual real.

### Requirement: Legibilidad de políticas y condiciones

Las políticas de cancelación y condiciones de reserva MUST tener un tamaño de fuente
legible cómodamente, manteniendo su jerarquía visual como información secundaria al
resumen de compra (no MUST convertirse en el elemento principal de la pantalla), pero
MUST ser claramente visibles antes de confirmar o pagar.

#### Scenario: Política de cancelación visible sin esfuerzo

- GIVEN el resumen antes del pago incluye la política de cancelación
- WHEN el huésped la lee
- THEN el texto es legible sin necesitar zoom, aunque visualmente no compita con el
  precio total como elemento dominante

**Implementado 2026-08-22 (Tarea 9)**: `BookingModal.vue` ya tenía la jerarquía correcta
(headline `text-sm font-bold`, detalle `text-xs leading-relaxed`) desde F5 #627 — solo
`PayStep.vue` (widget) se había quedado en `text-xs` para título/headline/detalle por
igual. Alineado: título = label (`text-[11px] uppercase`), headline sube a `text-sm
font-bold`, detalle en párrafo propio (`text-xs leading-relaxed`). Detalle en `tasks.md`
3.3. **Acceptance pendiente de confirmar visualmente** — mismo motivo que 3.2 (sin
navegador disponible en esta sesión).

## Database

Sin cambios — este spec es puramente de UI/formulario.

## API

`POST /api/public/booking` y `POST /api/public/booking/group` agregan `estimatedArrival`
(string, opcional, max 100) y `specialRequests` (string, opcional, max 500) a
`CreatePublicBookingSchema`/`CreatePublicBookingGroupSchema`
(`bookingengine/validators/schema.ts`). Ambos usecases los escriben en
`Reservations.notes` para el recepcionista (mismo campo donde ya viajan promo/upsells/
total), cada uno con su propia etiqueta ("Llegada estimada: …" / "Pedido especial: …").

**Hallazgo de la auditoría (2026-08-22)**: el textarea de "notas" que este formulario tenía
antes (pedidos especiales, hora de llegada, todo junto en texto libre) mandaba `notes` en
el body, pero ni `CreatePublicBookingSchema` ni `ExtendedPublicBookingSchema` lo declaraban
— `validateSchema` lo descartaba en el controller (`createPublicBookingDirect`/
`createPublicBookingGroup`) antes de que el usecase lo viera. El `notes` que sí queda en la
reserva es 100% generado por el servidor (resumen de promo/upsells/total); cualquier pedido
que el huésped escribiera en ese campo se perdía sin error ni aviso, para ambas superficies
(`GuestCheckoutStep.vue` del widget y `BookingModal.vue` de la landing). Mismo patrón que el
anti-patrón ORM documentado en CLAUDE.md, un nivel más arriba (validator, no ORM).

**Corrección 2026-08-22**: la primera pasada cerró el bug reemplazando el textarea por
`estimatedArrival` únicamente — perdía la capacidad de recibir pedidos libres, que el dueño
del producto marcó como requisito duro. Se agregó `specialRequests` como campo hermano,
declarado en el schema con el mismo criterio (así no vuelve a pasar lo de `notes`), sin tocar
`estimatedArrival`. Verificado extremo a extremo contra el server real + SQLite de dev (no
solo tests): `POST /api/public/booking` con ambos campos → `GET /api/reservas/:id`
(autenticado, mismo endpoint que consume el panel) devuelve `notes` con las dos etiquetas.

## UI

- `GuestCheckoutStep.vue` / `BookingModal.vue`: nombre, apellido (un campo combinado
  "Nombre y apellido"), email, teléfono, hora estimada de llegada (input corto) y pedidos
  especiales (textarea). Ningún campo de pre-check-in en este paso.
- `ReservationModal.vue` (panel del hotel): sin cambios — ya renderizaba `d.notes` con
  label "Notas" en la sección "Datos de la Reserva" (`<details open>` por defecto), así
  que el pedido especial se ve sin acción adicional del anfitrión.
- `pages/checkin/index.vue` (2026-08-22, a pedido explícito del usuario): `Reservations.
  notes` agregado en 3 lugares — fila "Llegadas Hoy" (ícono + tooltip), modal de Check-in
  (bloque destacado antes de confirmar), popover de detalle de habitación. Backend sin
  cambios — `GET /api/planning` ya lo exponía, el gap era 100% frontend
  (`CheckinGuest.notes` no existía). Detalle en `tasks.md` 3.1, "5ª pasada".
- `PayStep.vue` / `BookingModal.vue` — resumen de reserva (2026-08-22, Tarea 8): jerarquía
  de 3 niveles aplicada (ver requirement de arriba). Fila "Huéspedes" agregada a
  `PayStep.vue` (no existía como fila propia, a diferencia de `BookingModal.vue`) y quitada
  la línea `rooms.cartSummary` redundante del mismo resumen.
  **Pendiente**: aumentar tamaño de fuente de políticas y condiciones (Tarea 9, requirement
  "Legibilidad de políticas y condiciones" de arriba) — no tocado en esta pasada, es la
  tarea 3.3 del change, todavía sin empezar.
