# crm-integracion-real

## Intent

Conectar el CRM de punta a punta. Hoy el módulo `crm` está **técnicamente sano pero funcionalmente huérfano** (verificado 2026-08-18): dashboard con datos reales, pero cupones/segmentos sin salida, otorgar puntos sin UI ni automatismo, y el canje sin propósito (descuenta puntos que no se ganaron por ningún lado). Este change cierra cada grieta usando las piezas que YA existen antes que construir nuevas.

## Contexto (estado actual, verificado 2026-08-18)

- `modules/crm/index.ts` — 14 endpoints, 3 tablas, registrado en `composition-root.ts:248`. Corre en prod.
- **Data prod**: `loyalty_transactions` = 4 filas, `coupons` = **0**, `guest_segments` = **0**. Nadie usa cupones ni segmentos.
- **Duplicación**: el sistema YA tiene descuentos funcionando de punta a punta en `modules/promo-codes` (CRUD `/api/promo-codes` + vista `/panel/config/promociones` + validación pública `/api/public/hotels/:slug/promo/validate` + descuento en `totalBreakdown.promoDiscount` dentro de la transacción de `public-booking.ts`). La tabla `coupons` del CRM duplica eso **sin conectarse a nada**: `validateCoupon` solo se llama desde la propia vista CRM.
- **Puntos**: `awardPoints` existe en backend y en `Crm.service.ts` pero **ninguna pantalla lo llama**; solo el canje tiene UI (`guests/index.vue:1148`). No hay otorgamiento automático (0 connectors crm).
- **Tiers**: `guests.tier` existe ('bronze' default) pero nunca se recalcula.
- **Segmentos**: se crean y solo se ven adentro del panel CRM. No exportan, no filtran, no alimentan marketing.
- Equivalente MisterPlan: "CRM & Fidelización" — points redeem + coupons aplicables en el motor. Hoy estamos por debajo del benchmark en TODO menos el dashboard LTV.

## Decisión (2026-08-18)

**Consolidar, no duplicar** (la mejor decisión, no la fácil):

1. **Cupones del CRM → `promo_codes`**: la sección Cupones del panel CRM pasa a listar/crear **promo codes reales** (API existente). La tabla `coupons` se deprecia (no se borra data). Alternativa descartada: mantener dos sistemas de códigos — el huésped y el recepcionista terminarían con dos lugares que hacen "lo mismo" y solo uno funcionaría.
2. **Canje de puntos → promo code**: canjear puntos GENERA un código de descuento real (piezas existentes: `redeemPoints` + `promo-codes.store`). Cierra el círculo: estadías → puntos → descuento en la próxima reserva.
3. **Otorgamiento**: manual (ficha del huésped) + automático al checkout (connector `reservas→crm`, ratio configurable).
4. **Tiers**: recálculo automático por noches acumuladas, thresholds configurables.
5. **Segmentos**: export CSV + filtro en Huéspedes (`/panel/guests?segment=`). Campañas de marketing queda FUERA de scope (SHOULD futuro).

## Scope

- `configuration('crm_loyalty')` = `{ enabled, pointsPerNight, pointValue, tiers: { silver, gold } }` (defaults sanos).
- Connector `reservas-crm.ts`: award al checkout + recompute de tier.
- `redeemPoints` extendido: crea promo code por el valor canjeado.
- Ficha de huésped: botón "Otorgar puntos".
- Panel CRM: cupones = promo codes; segmentos con export + link a huéspedes.
- **NO**: campañas marketing, integración OTAs de fidelización, migrar data de `coupons` (0 filas).

## Rollback plan (regla de cambios riesgosos)

- `crm_loyalty.enabled=false` apaga el award automático y el canje→promo sin deploy (configuration KV).
- El connector es fire-and-forget: si falla, el checkout NO se rompe (patrón `pricing-canales`).
- Promo codes generados por canje son filas normales de `promo_codes`: borrables con el CRUD existente.
