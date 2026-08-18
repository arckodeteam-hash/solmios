# CRM Loyalty Specification

## Purpose

Ciclo completo de fidelización: **ganar → acumular → canjear**, con tiers automáticos y
configuración por hotel. Hoy el canje existe sin otorgamiento (nadie gana puntos) y los
puntos no sirven para nada al canjearse. Este spec cierra el ciclo con las piezas
existentes: `loyalty_transactions` + `guests.tier` + `promo-codes`.

Equivalente MisterPlan: "Loyalty points" — award en estadía + redeem en descuento. El
canje→promo code empareja; los tiers automáticos con thresholds configurables superan el
benchmark (MisterPlan los fija).

## Requirements

### Requirement: Configuración de fidelización por hotel

El sistema MUST leer la configuración desde `configuration(key='crm_loyalty')` con shape:
`{ enabled: boolean, pointsPerNight: number, pointValue: number, tiers: { silver: number, gold: number } }`
(noches acumuladas por tier; `pointValue` = valor monetario de 1 punto al canjear).
Defaults si la key no existe: `{ enabled: true, pointsPerNight: 10, pointValue: 1, tiers: { silver: 5, gold: 15 } }`.

#### Scenario: hotel sin configurar usa defaults

- GIVEN hotel sin `crm_loyalty` en configuration
- WHEN se otorgan puntos en un checkout
- THEN el award usa `pointsPerNight: 10` y no falla

#### Scenario: feature flag apagado

- GIVEN hotel con `crm_loyalty.enabled = false`
- WHEN se hace checkout de una reserva con noches
- THEN NO se otorgan puntos (el connector no actúa) y el checkout completes normal

### Requirement: Otorgamiento automático al checkout

El sistema MUST otorgar `nights × pointsPerNight` puntos al huésped cuando una reserva
llega a estado checked-out. Implementación: connector `reservas-crm.ts` (fire-and-forget,
patrón `pricing-canales` — un fallo del award NO puede romper el checkout).

#### Scenario: checkout exitoso otorga puntos

- GIVEN reserva de 3 noches de un huésped con email válido y `pointsPerNight: 10`
- WHEN la reserva pasa a checked-out
- THEN se crea 1 fila `loyalty_transactions { type: 'earn', points: 30 }` y el balance sube 30

#### Scenario: award duplicado bloqueado

- GIVEN reserva ya award-eada (o re-checkout/reintento del connector)
- WHEN el connector corre de nuevo para la misma reserva
- THEN NO se crean puntos duplicados (idempotencia por referencia a reservationId)

### Requirement: Otorgamiento manual desde la ficha del huésped

La ficha del huésped (`/panel/guests`) MUST tener botón "Otorgar puntos" (puntos +
descripción) junto al canje existente. Requiere permiso `guests:edit`.

#### Scenario: recepcionista compensa con puntos

- GIVEN recepcionista viendo la ficha de un huésped
- WHEN otorga 200 puntos con descripción "compensación demora limpieza"
- THEN el balance sube 200 y la transacción queda con la descripción

### Requirement: Canje genera promo code real

`redeemPoints` MUST, al canjear N puntos: validar balance suficiente → debitar → crear
un `promo_codes` de descuento por `N × pointValue` (código autogenerado `POINTS-XXXX`,
single-use, con vencimiento configurable) → devolver el código al usuario. Sin balance o
flag apagado → error de validación SIN efectos parciales.

#### Scenario: canje completo

- GIVEN huésped con 500 puntos y `pointValue: 1`
- WHEN canjea 300 puntos
- THEN balance queda 200, se crea transacción `{ type: 'redeem', points: -300 }` y un
  promo code de $300 utilizable en el motor de reservas

#### Scenario: canje sin balance no deja effects

- GIVEN huésped con 100 puntos
- WHEN intenta canjear 300
- THEN 422 con error claro, SIN transacción ni promo code creado

### Requirement: Tiers automáticos por noches

El sistema MUST recalcular `guests.tier` al otorgar puntos (y endpoint de recompute
masivo): noches acumuladas ≥ `tiers.gold` → 'gold'; ≥ `tiers.silver` → 'silver'; si no
'bronze'. El tier NUNCA baja en el recálculo (ratchet).

#### Scenario: huésped cruza a silver

- GIVEN huésped 'bronze' con 4 noches acumuladas y `tiers.silver: 5`
- WHEN el checkout de 1 noche otorga puntos y recalcula
- THEN `guests.tier` pasa a 'silver'

## API

- `POST /api/crm/points/award` (existe) — agrega idempotencia por reservationId opcional.
- `POST /api/crm/points/redeem` (existe) — respuesta extendida con `{ code, discountValue }`.
- `POST /api/crm/tiers/recompute` — NUEVO, `guests:edit`, recalcula todo el hotel.

## DB

- Sin tablas nuevas. `loyalty_transactions` agrega columna `reservationId` (idempotencia)
  vía `orm.define` (ADD COLUMN automático de ormMigrate).
- `configuration` key `crm_loyalty` (UNIQUE index ya existe por hotelId+key).

## UI

- Ficha huésped: formulario "Otorgar puntos" (puntos + nota) espejando el de canje.
- Ficha huésped: al canjear, mostrar el código generado con botón copiar.
- Panel CRM: banner de config (ratio vigente + link a Configuración).
