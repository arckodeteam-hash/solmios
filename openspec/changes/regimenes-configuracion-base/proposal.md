# regimenes-configuracion-base

## Why

Los regímenes del motor de reservas (MR-03, #268) eran un catálogo FIJO de 3 códigos
(`breakfast` / `half_board` / `all_inclusive`) con "Solo alojamiento" como base implícita
sin fila, y se administraban desde **Página pública → Motor de reservas**. El dueño pidió
(#360) que cada hotel pueda **crear los regímenes que quiera** (nombre, descripción, precio o
suplemento, activo), que vivan en **Configuración → Regímenes** como el resto de la
configuración base, y que Página pública conserve únicamente el interruptor de si el motor
los muestra o no.

## What changes

- `meal_plans` pasa a catálogo ABIERTO por hotel: `name` (obligatorio), `description`,
  `sortOrder`; `code` sigue siendo el identificador estable (slug del nombre, único por hotel)
  porque `reservations.mealPlan`/`regime`, emails y widget keyean por código. Filas legacy sin
  `name` se leen con el nombre histórico del código.
- "Solo alojamiento" (`room_only`) deja de ser implícito: es una fila normal (`included`, 0)
  que el hotel edita, desactiva o borra. Sin ninguna fila activa, el widget no muestra
  selector y la reserva va sin régimen.
- Semilla única: la primera lectura del admin crea las 4 filas históricas (`room_only` activa;
  las otras 3 inactivas) y marca `booking_config.mealPlansSeeded`; nunca se re-siembra.
- API admin CRUD: `GET/POST /api/meal-plans`, `PUT/DELETE /api/meal-plans/:id` (permisos
  `mealplans` view/edit, ownership por hotel).
- `booking_config.showMealPlans` (default `true`): apagado, `/meal-plans` y `/rates.mealPlans`
  devuelven `[]` y `POST /booking(-group)` rechaza cualquier `mealPlan` con
  `meal_plan_unavailable`.
- Snapshot del nombre: `reservations.mealPlanName`; notas, email de pago, recibo y confirmación
  pública muestran el nombre congelado al reservar.
- Widget: las opciones del radio son el catálogo activo tal cual (con `name`, códigos custom
  incluidos), primera opción por defecto, sin códigos hardcodeados; desglose, pago y
  confirmación muestran el `name`.
- Panel: pestaña **Configuración → Regímenes** con la lista CRUD; Página pública → Motor de
  reservas queda con el checkbox "Mostrar regímenes en el motor de reservas".

## Impact

- Specs: `reservas` — requirement MR-03 reescrito (ver `specs/reservas/spec.md`).
- Backend: `bookingengine` (model, schema, `meal-plans-crud`, `public-meal-plans`,
  `public-meal-plan-lines`, `public-rates`, `public-booking(-group)`, `public-reservation`),
  `reservas/model.ts` (`mealPlanName`), `shared/usecases/meal-plan-labels`,
  `booking-paid-email`, `payment-receipt`.
- Frontend: `MealPlans.service`, `MealPlansEditor.vue` (lista CRUD), `settings/index.vue`,
  `booking-engine/index.vue`, tipos y composables del widget (`useBooking`,
  `useGuestComposer`), `RoomsStep`, `EstimatedTotals`, `PayStep`, `booking-confirmation`,
  `utils/meal-plans`.
- Compatibilidad: reservas existentes conservan su snapshot; `room_only` sin fila sigue
  significando "sin régimen"; los 4 códigos legacy conservan etiqueta i18n como fallback
  cuando no hay `name`.
