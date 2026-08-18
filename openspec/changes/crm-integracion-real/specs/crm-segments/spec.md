# CRM Segments Output Specification

## Purpose

Los segmentos hoy son un callejón: se crean (rules JSON: tier/minStays) y solo se pueden
mirar adentro del panel CRM — 0 creados en prod. Este spec les da salida real sin construir
el machine de campañas: **filtrar Huéspedes por segmento** y **exportar CSV**. Campañas de
marketing queda como SHOULD futuro explícito.

Equivalente MisterPlan: segmentación con export. Empareja el benchmark.

## Requirements

### Requirement: Ver los huéspedes de un segmento en Huéspedes

Desde un segmento en `/panel/crm` MUST haber acción "Ver en Huéspedes" que navega a
`/panel/guests?segment=<id>`. La vista Huéspedes al recibir ese query param MUST mostrar
el chip del segmento activo y filtrar el listado con la MISMA evaluación de rules que usa
`getGuestsInSegment` (backend, no re-implementar en el front).

#### Scenario: segmento de huéspedes gold

- GIVEN segmento "VIP" con rule `{ tier: 'gold' }` y 3 huéspedes gold
- WHEN el admin clickea "Ver en Huéspedes"
- THEN `/panel/guests?segment=<id>` lista exactamente esos 3 con chip "VIP" y botón
  para limpiar el filtro

### Requirement: Export CSV de un segmento

Cada segmento MUST tener "Exportar CSV" que descarga nombre, email, teléfono, tier,
noches acumuladas y balance de puntos de sus miembros. Generación server-side
(`GET /api/crm/segments/:id/export` → JSON `{filename, csv}`; el front arma el blob:
el wrapper http siempre hace `res.json()` y text/csv crudo rompería el parseo),
permiso `guests:view`. Sin datos
personales más allá de los listados (nada de IDs internos ni notas).

#### Scenario: export con permiso

- GIVEN hotel_admin y segmento con 12 miembros
- WHEN exporta
- THEN descarga CSV con 12 filas + header, Content-Type text/csv, filename
  `segmento-<slug>-<fecha>.csv`

#### Scenario: export vacío

- GIVEN segmento sin miembros
- WHEN exporta
- THEN CSV con solo el header (no 404, no error)

## API

- `GET /api/crm/segments/:id/export` — NUEVO, text/csv, `guests:view`.

## DB

- Sin cambios (rules ya viven en `guest_segments`).

## UI

- `/panel/crm`: por segmento, botones "Ver en Huéspedes" + "Exportar CSV".
- `/panel/guests`: soporta `?segment=` con chip de filtro activo.

## Out of scope (SHOULD futuro, explícito)

- Campañas email/WhatsApp desde un segmento (módulo marketing).
- Segmentos automáticos recalculados por cron (hoy se evalúan on-demand).
