# Guest Triggers Specification (birthday + win-back)

## Purpose

Los auto-messages existentes reaccionan a la RESERVA (pre_checkin, checkin_day, checkout_day,
post_checkout). Este spec agrega dos triggers que dependen del HUÉSPED y no de ninguna
reserva en curso: cumpleaños y win-back por inactividad. Reusa el cron, el enum y la UI de
marketing — el hotel los activa creando el AutoMessage, igual que los que ya usa.

Equivalente MisterPlan: birthday + win-back están en su módulo de campañas — empareja.

## Requirements

### Requirement: Trigger `birthday`

El cron diario MUST, para cada auto-message activo con `triggerEvent='birthday'` del hotel,
seleccionar huéspedes activos cuyo `birthDate` coincida en mes y día con HOY (sin año —
nacimiento, no edad) y encolar el email con las variables estándar. Idempotente: un huésped
no recibe el mismo auto-message dos veces el mismo día.

#### Scenario: cumpleaños hoy

- GIVEN auto-message birthday activo y huésped con birthDate 1990-08-18, isActive=1
- WHEN corre el cron del 18/8
- THEN se encola 1 email para ese huésped con la plantilla del auto-message

#### Scenario: ya enviado hoy

- GIVEN el cron ya corrió hoy y encoló el email de cumpleaños de Carlos
- WHEN el cron corre de nuevo (reintento/doble deploy)
- THEN no se encola otro email para Carlos ese día

#### Scenario: birthDate nulo o año bisiesto 29/2 fuera de bisiesto

- GIVEN huésped sin birthDate, o nacido 29/2 en año no bisiesto
- WHEN corre el cron
- THEN el primero nunca selecciona; el 29/2 solo coincide el 29/2 (sin regla especial v1)

### Requirement: Trigger `inactive_guests` (win-back)

El cron semanal MUST, para cada auto-message con `triggerEvent='inactive_guests'`,
interpretar `triggerOffset` como DÍAS DE INACTIVIDAD y seleccionar huéspedes activos cuya
última estadía (máx checkoutDate de sus reservas) sea exactamente hace ≥ offset días y sin
reserva futura. Idempotencia diaria igual que birthday.

#### Scenario: inactivo justo

- GIVEN auto-message inactive_guests offset=180 y huésped cuya última estadía terminó hace 190
  días, sin reservas futuras
- WHEN corre el cron
- THEN se encola el win-back

#### Scenario: tiene reserva futura

- GIVEN mismo huésped pero CON reserva con checkIn futuro
- WHEN corre el cron
- THEN NO se le envía (ya volvió — el win-back sería ruido)

## API

Sin endpoints nuevos: extiende el enum de `triggerEvent` en marketing/validators y los
handlers en el cron existente. La UI de marketing lista los nuevos valores solos.

## DB

Sin tablas nuevas. Dedupe de birthday/inactive: query contra la tabla de log de envíos que
marketing ya usa para auto-messages (misma fuente de verdad, no un log paralelo).

## UI

- El select de trigger en la vista de auto-messages muestra `birthday` e `inactive_guests`
  con offset rotulado "días de inactividad" para el segundo.
