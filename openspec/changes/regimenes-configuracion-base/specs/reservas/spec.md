# Reservas — delta #360 (regímenes desde Configuración base)

## MODIFIED Requirements

### Requirement: Régimen reservable y cobrado por persona y noche desde la web (MR-03, #268)

El hotel mantiene un catálogo ABIERTO de regímenes en `meal_plans` desde **Configuración →
Regímenes** (#360): cada fila tiene `name` (obligatorio, max 80), `description` (max 500,
default `''`), `code` (identificador estable: slug `a-z0-9_` del nombre, max 40, único por
hotel, con sufijo numérico si choca; nunca se edita), `active`, `priceMode`
included|per_person_per_night, `price` (≥ 0) y `sortOrder`. La API admin expone
`GET /api/meal-plans` (ordenado por `sortOrder`, luego `createdAt`), `POST /api/meal-plans`
(201, genera `code`), `PUT /api/meal-plans/:id` (parcial) y `DELETE /api/meal-plans/:id`
(204), con permisos `mealplans` view/edit y ownership por hotel (una fila de otro hotel → 404).
"Solo alojamiento" (`room_only`) YA NO es una base implícita: es una fila normal (`included`,
0) que el hotel edita, desactiva o borra. La primera lectura del admin siembra UNA sola vez
las 4 filas históricas que falten (`room_only` activa; `breakfast`, `half_board`,
`all_inclusive` inactivas, `included`, 0, `sortOrder` 0..3) y marca
`booking_config.mealPlansSeeded = true`; borrarlas después no las re-crea. Filas legacy sin
`name` se leen con el nombre histórico de su código.

`booking_config.showMealPlans` (boolean, default `true`, editable desde Página pública →
Motor de reservas) decide si el motor los ofrece: apagado, `GET /public/hotels/:slug/meal-plans`
y `GET /rates.mealPlans` devuelven `[]` y `POST /booking` / `/booking-group` rechazan cualquier
`mealPlan` con 400 `meal_plan_unavailable` (el catálogo se trata como vacío; `room_only`/vacío
siguen pasando como "sin régimen").

El motor público MUST aceptar `mealPlan` por habitación (`mealPlan` en el body single y en
cada `rooms[i]` del grupo) y resolverlo SIEMPRE contra el catálogo activo del hotel
(`public-meal-plan-lines.ts`): nombre, precio y modo se releen de `meal_plans`, nunca del body.
Cualquier `code` activo del hotel es válido (custom incluidos); `room_only` con fila activa
produce una línea real (`included`, total 0, con su `name`); `mealPlan` vacío — o `room_only`
cuando el hotel NO tiene esa fila — es "sin régimen" (`mealPlan = 'room_only'`,
`mealPlanName = null`, compat con reservas anteriores). Un código inexistente, inactivo, de
otro hotel o con el catálogo oculto MUST rechazar con 400 `meal_plan_unavailable` ANTES de
escribir nada. El importe es `price × persons × nights` con `persons = adultos efectivos +
niños con plaza` (bebés y niños libres no pagan) e `included` → 0. Entra en `subtotal` ANTES
de promo e impuestos, se desglosa en `priceBreakdown.mealPlanTotal` y se resume en `notes`
con el nombre del catálogo ("Régimen: Brunch premium (2 pers × 3 noches = 150.00)"). Cada
fila `reservations` persiste el snapshot congelado `mealPlan` (code), `mealPlanName`,
`mealPlanPriceMode`, `mealPlanUnitPrice`, `mealPlanTotal` y escribe `regime` con el mismo
código para el panel; renombrar, reconfigurar o borrar el régimen después NO altera reservas
existentes, y el email de pago, el recibo y la confirmación pública etiquetan con
`mealPlanName` (fallback: etiqueta histórica del código, y si no, el código).

`GET /public/hotels/:slug/meal-plans` devuelve SOLO los activos, en el orden del hotel, como
`{code, name, description, priceMode, price}`; `GET /rates.mealPlans` lo mismo más
`perNight`/`totalForStay`/`persons`/`nights` resueltos para `guests + children` (en
`chargeCurrency`, sin conversión). El widget y la landing ofrecen el régimen como radio por
habitación con EXACTAMENTE ese catálogo (etiqueta = `name`; sin códigos hardcodeados, sin
anteponer "Solo alojamiento", sin opciones deshabilitadas): la primera opción queda elegida
por defecto; con catálogo vacío el bloque de régimen no se renderiza y la línea va sin
régimen. El carrito, el desglose ("Régimen: … · N pers × M noches") y el paso de pago muestran
el `name` congelado en la línea; el panel lo muestra en el modal, filtra por él en el listado
y lo ve recepción en las llegadas del día.

#### Scenario: Crear un régimen propio y reservarlo desde la web

- GIVEN el hotel crea "Brunch premium" (`per_person_per_night`, 25, activo) desde Configuración → Regímenes
- WHEN el huésped busca 2 adultos × 3 noches y reserva con `mealPlan: 'brunch_premium'`
- THEN el radio mostraba "Brunch premium · 150.00", `mealPlanTotal = 150`, `subtotal = habitación + 150`
- AND `Reservations.mealPlan = 'brunch_premium'`, `mealPlanName = 'Brunch premium'`, `regime = 'brunch_premium'`
- AND la confirmación pública, el email y el recibo dicen "Brunch premium"

#### Scenario: Desayuno por persona y noche con niño con plaza y bebé

- GIVEN breakfast `per_person_per_night` 10 activo, 2 adultos + 1 niño con plaza + 1 bebé, 3 noches
- WHEN se reserva con `mealPlan: 'breakfast'`
- THEN `mealPlanTotal = 90`, impuestos sobre `(subtotal − promo)`, `mealPlanUnitPrice = 10`
- AND `GET /rates?guests=2&children=1` devolvió `mealPlans[breakfast].totalForStay = 90`

#### Scenario: Semilla única de los 4 regímenes históricos

- GIVEN un hotel sin filas en `meal_plans` y `booking_config.mealPlansSeeded` ausente
- WHEN el admin lista `GET /api/meal-plans` por primera vez
- THEN existen `room_only` (activo), `breakfast`, `half_board`, `all_inclusive` (inactivos), `included`, 0
- AND `mealPlansSeeded = true`; si borra `half_board` y vuelve a listar, no reaparece

#### Scenario: "Solo alojamiento" como fila real del catálogo

- GIVEN `room_only` activo con `name: 'Solo alojamiento'`
- WHEN el huésped no cambia el radio y reserva
- THEN el body lleva `mealPlan: 'room_only'`, la reserva guarda `mealPlanName = 'Solo alojamiento'`, `mealPlanTotal = 0`
- AND la confirmación muestra "Solo alojamiento · incluido" sin sumar nada

#### Scenario: Hotel sin regímenes activos

- GIVEN el hotel desactivó o borró todas las filas de `meal_plans`
- WHEN el huésped abre el motor y reserva
- THEN `GET /meal-plans` devuelve `[]`, la tarjeta no muestra bloque de régimen, el body no lleva `mealPlan`
- AND la reserva queda `mealPlan = 'room_only'`, `mealPlanName = null`, `mealPlanTotal = 0`

#### Scenario: Toggle "Mostrar regímenes en el motor de reservas" apagado

- GIVEN regímenes activos y `booking_config.showMealPlans = false`
- WHEN se pide `GET /meal-plans` y `GET /rates`, y se reserva con `mealPlan: 'breakfast'`
- THEN ambos endpoints devuelven `mealPlans` vacío y `POST /booking` responde 400 `meal_plan_unavailable` sin crear nada
- AND una reserva sin `mealPlan` sigue pasando

#### Scenario: Régimen inactivo, inexistente o de otro hotel

- GIVEN `half_board` inactivo (o inexistente) para el hotel
- WHEN se reserva con `mealPlan: 'half_board'`
- THEN 400 `meal_plan_unavailable` y ninguna reserva ni huésped creados

#### Scenario: Snapshot congelado ante cambios del catálogo

- GIVEN una reserva con `mealPlan: 'breakfast'`, `mealPlanName: 'Desayuno incluido'`, `mealPlanTotal: 90`
- WHEN el hotel renombra el régimen a "Desayuno buffet", cambia el precio o lo borra
- THEN la reserva conserva `mealPlanName = 'Desayuno incluido'` y `mealPlanTotal = 90`; una reserva nueva usa el catálogo nuevo

#### Scenario: Grupo con regímenes distintos por línea

- GIVEN 2 líneas, una con breakfast y otra con un régimen custom
- WHEN se reserva el grupo
- THEN cada fila `reservations` lleva su propio `mealPlan`/`mealPlanName`/`mealPlanTotal` y
  `priceBreakdown.mealPlanTotal` es la suma

#### Scenario: Ownership del CRUD admin

- GIVEN un régimen del hotel B
- WHEN el admin del hotel A hace `PUT` o `DELETE /api/meal-plans/:id` con ese id
- THEN 404 y la fila del hotel B queda intacta
