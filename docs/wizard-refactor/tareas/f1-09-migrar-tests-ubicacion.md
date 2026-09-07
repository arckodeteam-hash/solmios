# Tarea 1.9 — Migrar tests de ubicación

**Fase**: F1 — Mover Ubicación a Página pública
**Depende de**: 1.8
**Bloquea**: 1.10

## Qué hacer

Mover los casos de `frontend/src/pages/settings/settings-location-fields.test.ts`
y `settings-geocoding.test.ts` a tests nuevos apuntando a `ubicacion.vue` /
`useHotelLocationMap.ts` (mismos casos, nuevo target — no se descartan, se
migran).

Revisar si `settings-plan-pin.test.ts` u otro test de `settings/index.vue`
rompe por los campos que se movieron en 1.7/1.8.

## Criterio de aceptación

`cd frontend && bun run typecheck` limpio. Todos los tests de ubicación pasan
apuntando a los archivos nuevos. Ningún test de `settings/index.vue` queda
roto por los campos que se fueron.

## Referencias

- `frontend/src/pages/settings/settings-location-fields.test.ts`
- `frontend/src/pages/settings/settings-geocoding.test.ts`
- `../06-arquitectura-tecnica.md` sección 8
