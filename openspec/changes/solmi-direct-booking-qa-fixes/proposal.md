# Proposal: Motor de Reservas Directas — hallazgos de QA (post go-live)

## Intent

`solmi-direct-booking` (F0→F4, ver `changes/solmi-direct-booking/`) ya está implementado,
verificado (gates typecheck/analyze/test/build en verde) y desplegado — es el equivalente
MisterPlan de este change y la fuente de verdad arquitectónica: este proposal NO reabre
esas decisiones (rutas `/h/:slug`, widget SPA único, tablas `promo_codes`/`upsells`/
`landing_blocks`/`hotel_media`, allow-list del endpoint público, etc.).

Una revisión funcional posterior (reunión de producto, 2026-08-20) sobre el motor YA
desplegado encontró **15 gaps** entre lo que el código hace hoy y lo que un motor de
reservas directo necesita para no perder ni una reserva por inconsistencia. No son bugs
de arquitectura — son huecos de validación end-to-end, configuración rígida donde debería
ser dinámica, y UX de baja legibilidad en el paso más crítico (antes de pagar).

Distinción clave que motiva el alcance: esta es la interfaz del **motor de reservas /
landing pública** (huésped final, sin login), no el PMS. El PMS (`/panel/*`) es la
**única fuente de configuración e inventario**; el motor debe consultarlo y validarlo,
nunca duplicar o hardcodear la regla de negocio.

## Scope

### In Scope

- **G1 — Integridad de la reserva** (prioridad alta, bloquea sobreventa/inconsistencia):
  disponibilidad real en la búsqueda, ocupación vs capacidad, precio por cantidad de
  huéspedes, múltiples habitaciones del mismo tipo, revalidación completa pre-pago,
  políticas de cancelación cargadas dinámicamente desde el PMS.
- **G2 — Definición funcional requerida antes de implementar**: combinar tipos de
  habitación distintos en una misma reserva (Sí/No — decisión de producto), nomenclatura
  y modelo de regímenes de alimentación, comportamiento real de reembolsos (comisiones,
  quién las asume), modelo de servicios/extras (incluidos vs. con costo vs. informativos).
- **G3 — UX y configuración**: legibilidad de resumen de reserva y políticas, datos
  mínimos solicitados al huésped, personalización visual del motor por hotel, gestión de
  galería.

### Out of Scope

- Todo lo que `solmi-direct-booking` F0-F4 ya cubre y funciona correctamente (schema
  público, Stripe Checkout, wallet pass, tracking, reviews) — no se re-implementa.
- Cambios de arquitectura del widget (SPA único, rutas, stack de reseñas externas) — ya
  decididos, no se reabren.
- App móvil (`solmios-mobile`) — fuera de scope, no tocar (regla CLAUDE.md).

## Approach

Los 15 hallazgos originales se agrupan en 3 specs por dominio (no 1:1 con las fases F0-F4
de `solmi-direct-booking`, porque estos son gaps transversales, no una fase nueva):

1. **`specs/booking-availability-pricing/spec.md`** — Tareas 1, 2, 10, 11, 12, 15
   (disponibilidad, precio por ocupación, multi-habitación, capacidad, revalidación).
2. **`specs/booking-content-policies/spec.md`** — Tareas 3, 4, 6, 7, 13, 14 (regímenes,
   extras, políticas dinámicas, reembolsos, configuración visual, galería).
3. **`specs/booking-checkout-ux/spec.md`** — Tareas 5, 8, 9 (datos mínimos del huésped,
   legibilidad de información y políticas antes de pagar).

Principio rector (dado por el propio hallazgo de producto): **el PMS configura → el
motor consulta → el motor valida → el cliente selecciona → el sistema revalida → el
cliente paga → se confirma la reserva.** Ningún dato de precio, capacidad, inventario,
política o servicio se duplica manualmente en el motor si ya vive en el PMS.

Tareas 11 (combinar tipos de habitación) y 3/4/7 (nomenclatura de regímenes, modelo de
extras, mecánica de reembolso) son de **definición funcional primero** — no deben
implementarse sin que el dueño de producto fije el comportamiento esperado (ver spec
para las 2 opciones documentadas en cada caso).

## Affected Areas

| Area | Impact | Description |
|------|--------|--------------|
| `backend/src/modules/bookingengine/` | Modified | Revalidación de disponibilidad/ocupación/tarifa en cada paso (search, pre-pago), no solo al crear |
| `backend/src/modules/bookingengine/` (rates) | Modified | Precio derivado por cantidad de huéspedes (hoy solo por fechas) |
| `backend/src/modules/hoteles/model.ts` | Modified | Exponer políticas de cancelación configuradas por el hotel en el DTO público consumido por el widget (campos ya existen desde F0 — auditar que el frontend los renderiza) |
| Regímenes de alimentación | New (config) | Catálogo configurable por hotel, no hardcodeado en frontend |
| `backend/src/modules/booking-engine` (`upsells`) | Modified/Audit | Confirmar clasificación incluido/informativo/con costo/seleccionable |
| `frontend/src/pages/public/booking-widget.vue` + steps | Modified | Multi-room del mismo tipo, revalidación pre-pago, legibilidad, formulario mínimo |
| `frontend/src/components/landing/` | Modified/Audit | Configuración visual y de galería expuesta completamente desde settings |
| Reembolsos (Stripe) | Audit | Comportamiento real de comisiones vs. promesa mostrada al cliente |

## Risks

| Risk | Likelihood | Mitigation |
|------|------------|------------|
| Revalidar disponibilidad/tarifa en cada paso agrega latencia al flujo | Medium | Revalidación liviana (solo counts + precio, no full search) justo antes de Pay; cache corto |
| Definir "combinar tipos de habitación" sin decisión de producto bloquea Tarea 10/11 | High | Tarea 11 queda explícitamente como decisión previa bloqueante en tasks.md — no se implementa 10 en su forma completa sin resolver 11 |
| Prometer "reembolso completo" sin confirmar comisiones reales de Stripe | High | Tarea 7 es auditoría financiera primero; el texto al cliente no cambia hasta confirmar el comportamiento real |
| Cambiar la nomenclatura de regímenes rompe reservas/tarifas ya configuradas con el término viejo | Medium | Migración aditiva: nuevo catálogo configurable con defaults = términos actuales, no un rename destructivo |

## Rollback Plan

Todas las tareas de G1 son correcciones de validación (más estrictas, nunca menos) —
revertir es dejar de aplicar la validación nueva, no requiere migración de datos. G2 no
se implementa hasta tener la decisión funcional documentada en su spec correspondiente.
G3 es UI/configuración aditiva — revertir es CSS/props, sin riesgo de datos.

## Success Criteria

- [ ] El motor nunca ofrece un tipo de habitación sin disponibilidad real para las
      fechas buscadas.
- [ ] El precio mostrado respeta la configuración de tarifa por ocupación del hotel
      (no una regla fija del motor).
- [ ] Un mismo tipo de habitación se puede reservar en cantidad ×N respetando inventario.
- [ ] Ninguna habitación se ofrece a una búsqueda cuya ocupación exceda su capacidad.
- [ ] Las políticas de cancelación mostradas en el widget son las configuradas por el
      hotel en el PMS, no un texto fijo.
- [ ] El flujo revalida disponibilidad/tarifa/ocupación/extras inmediatamente antes de
      pagar, no solo en la búsqueda inicial.
- [ ] Decisión de producto tomada y documentada para: combinar tipos de habitación en
      una reserva, nomenclatura de regímenes, modelo de reembolsos, modelo de extras.
- [ ] Resumen de reserva y políticas cumplen contraste/legibilidad mínimos antes de pagar.
- [ ] El formulario de datos del huésped pide solo lo mínimo (nombre, apellido, email,
      teléfono, hora estimada de llegada).
- [ ] El motor es personalizable por hotel (colores, galería, mensajes) sin tocar código.
