# Auditoría del flujo de reserva pública — hallazgos y decisiones

Auditoría del 2026-09-11 del flujo **página pública → reserva → pago → aviso → seguimiento**
(epic #265). El documento original con `archivo:línea` de cada afirmación no llegó a este
repositorio; este archivo recoge los hallazgos a medida que cada MR los cierra, con la decisión
tomada y dónde vive en el código. Se agregan secciones por hallazgo (`F-nn`), no se reescriben.

## F-11 — Precio de niños distinto según la puerta de entrada

**Hallazgo.** Con `childrenAges` (widget nuevo, modal de landing) los niños con plaza cotizaban
según la política del hotel; con `children` como contador plano (integradores, `BookingModal`
viejo, API pública) los niños **no cotizaban nunca**. Mismo hotel, mismo pedido, dos totales.

**MR-10 (#275) — decisión: Opción A.** Cuando el body trae `children > 0` sin `childrenAges`,
el backend sintetiza `childrenAges = Array(children).fill(childPolicy.maxChildAge)` y sigue el
mismo camino que un caller con edades (`resolveChildPolicy` → `resolveChildComposition` →
capacidad/`maxChildren`/`maxFreeChildrenPerRoom` → `% niños` → persistencia de `childrenAges` y
`childrenAgesAsOf`). Es el caso **más caro** de la política: niño con plaza (nunca bebé ni
libre), así que quien no declara edades no obtiene descuento por edad, pero **sí** el
`childrenRatePercent` si el hotel habilitó `childrenDiscountEnabled` (esa regla depende de
consumir plaza, no de la edad exacta). Consecuencias deliberadas:

- `children: 2` sin edades da el **mismo** `totalAmount` que `childrenAges: [maxChildAge, maxChildAge]`.
- Un caller con `children` plano en un hotel con `acceptChildren: false` recibe `400` (antes
  pasaba en silencio cotizando por adultos).
- Las edades sintetizadas **se persisten** (con `childrenAgesAsOf`), porque son la base del
  precio cobrado: un reagendado/repricing vuelve a cotizar con ellas y no por adultos.
- Se descartó la Opción B (`400 children_ages_required`) para no romper integradores ni el
  modal legacy.

Código: `backend/src/modules/bookingengine/usecases/public-booking.ts` (bloque "Opción A").
Tests: `tests/public-booking-promo-upsells.test.ts` (describe MR-10),
`tests/public-booking-composition.test.ts` (casos legacy ajustados a Opción A).
`POST /booking/group` recibe el mismo tratamiento en `public-booking-group.ts`.

## F-12 — Upsells: sin "por noche" y cantidad sin tope

**Hallazgo.** `UpsellKind = per_room | per_person | per_stay`: un "desayuno" `per_person`
cobraba `price × qty` **una sola vez** por estadía. El stepper del widget dejaba pedir hasta 20 y
el backend aceptaba cualquier `qty ≥ 1` ("desayuno para 1" con 4 huéspedes, "late checkout ×20").

**MR-10 (#275) — decisión.** La matemática vive en un solo helper puro,
`bookingengine/usecases/upsell-pricing.ts#resolveUpsellLines`, compartido por `POST /booking` y
`POST /booking/group`, con dos kinds nuevos y tope por kind:

| kind | fórmula | `quantity` | tope |
|---|---|---|---|
| `per_room` | `price × qty` | la pedida | ≤ habitaciones de la reserva |
| `per_person` | `price × qty` | la pedida | ≤ adultos + niños con plaza + niños libres (bebés **no**) |
| `per_stay` | `price × 1` | 1 | qty > 1 es error |
| `per_night` (nuevo) | `price × noches` | forzada a 1 | qty del body se ignora |
| `per_person_per_night` (nuevo) | `price × personas × noches` | forzada a 1 | qty del body se ignora |

Fuera de rango → `400 { error: 'upsell_quantity_out_of_range', upsellId, name, kind, quantity,
max, message }` (no se silencia clampeando: es dinero que el huésped vio en pantalla; `max` le
dice al widget cuánto puede pedir). Ids inexistentes/inactivos/de otro hotel se siguen ignorando.

`priceBreakdown.upsells[]` guarda por línea `{ id, name, kind, unitPrice, quantity, nights,
persons?, total }` (además de `upsellsTotal`); sale en la confirmación pública
(`public-reservation.ts` → `totalBreakdown`) y en el modal del panel. Para el folio (#269,
`ReservationAddons`) la fila lleva `quantity = quantity × nights × persons` y `unitPrice` del
catálogo, así `amount × quantity` cuadra con lo cobrado sin tocar `booking-engine-addons.ts`.

**Nota de alcance.** No existe editor de upsells en el panel: sólo el CRUD backend
(`upsells-crud.ts`, que acepta los 5 kinds). MR-10 no lo crea; el hotel carga los upsells por API.

Tests: `tests/upsell-pricing.test.ts`, `tests/upsells-crud.test.ts`,
`tests/public-booking-promo-upsells.test.ts` (describe MR-10).
