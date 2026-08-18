# CRM Coupons Consolidation Specification

## Purpose

Un solo sistema de descuentos. Hoy coexisten **dos** tablas de "códigos de descuento":
`promo_codes` (conectada al motor: validación pública + `totalBreakdown.promoDiscount` +
vista `/panel/config/promociones`) y `coupons` del CRM (huérfana: 0 filas en prod,
validación solo dentro del panel CRM, NADIE puede aplicar un cupón al reservar). Este spec
consolida: el CRM gestiona promo codes, la tabla `coupons` se deprecia.

Equivalente MisterPlan: cupones aplicables en el booking engine — `promo_codes` ya lo
cumple; este spec solo deja de duplicarlo.

## Requirements

### Requirement: La sección Cupones del CRM opera sobre promo_codes

La vista `/panel/crm` MUST listar y crear **promo codes** (vía `/api/promo-codes`
existente) en su sección "Cupones", NO la tabla `coupons`. El validador manual de la vista
CRM (chequear un código contra un monto) pasa a usar `POST /api/promo-codes/preview`
(existente).

#### Scenario: crear cupón desde el CRM

- GIVEN hotel_admin en /panel/crm, sección Cupones
- WHEN crea un cupón 10% con código VERANO10
- THEN el promo code aparece en `/panel/config/promociones` Y es aplicable en el motor
  de reservas público (mismo registro, una sola fuente)

#### Scenario: validar un código desde el CRM muestra el descuento real

- GIVEN código VERANO10 existente
- WHEN el admin lo valida en el CRM contra una estadía de $200
- THEN la preview usa la misma lógica del motor (`promo-codes/preview`): muestra
  descuento y total final — no una segunda implementación

### Requirement: Deprecación de la tabla coupons

El sistema MUST dejar de leer/escribir `coupons` del CRM: endpoints `POST/GET/DELETE
/api/crm/coupons` responden 410 con `{ error: 'Usá /api/promo-codes' }` (append-only del
index.ts: se agregan, no se modifican consumers viejos). La tabla NO se dropea (0 filas,
rollback gratis). `Crm.service.ts` pierde los métodos de coupons; los tests de coupons
del módulo se actualizan al contrato nuevo.

#### Scenario: consumer viejo de la API coupons

- GIVEN cualquier cliente llamando `GET /api/crm/coupons`
- THEN recibe 410 con puntero al endpoint correcto (no 500 silencioso)

## API

- `/api/crm/coupons*` → 410 (deprecación explícita).
- CRM UI consume `/api/promo-codes` (sin endpoints nuevos).

## DB

- Sin cambios. Tabla `coupons` queda sin writers (deprecada, no dropeada).

## UI

- `/panel/crm` sección Cupones: tabla + alta contra promo codes (reutiliza
  `PromoCode.service.ts`), con link "gestión completa" a `/panel/config/promociones`.
