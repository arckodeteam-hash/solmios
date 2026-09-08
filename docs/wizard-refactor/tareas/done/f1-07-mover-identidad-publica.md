# Tarea 1.7 — Mover tipo/estrellas/logo/website a Página pública

**Fase**: F1 — Mover Ubicación a Página pública
**Depende de**: ninguna (independiente de la cadena de Ubicación, se puede hacer en paralelo)
**Bloquea**: 1.8

## Qué hacer

Mover `accommodationType`, `starRating`, `logo`, `website` de la pestaña Hotel
de Configuración a `frontend/src/pages/pagina-publica/general.vue` (nueva
`SectionCard` "Identidad pública" o similar, con su propio guardado dentro del
`save()` que ya tiene `general.vue`).

Ver `../02-clasificacion-de-campos.md` sección A y B para la justificación de
por qué estos 4 campos son públicos (confirmado contra el allow-list real de
`getPublicHotelInfo`).

## Criterio de aceptación

Los 4 campos ya no aparecen en Configuración → Hotel; aparecen en Página
pública → General, pre-cargados con el valor actual del hotel, y guardan
correctamente ahí (verificar recargando y viendo que persistió).

## Referencias

- `../02-clasificacion-de-campos.md` secciones A y B
- `backend/src/modules/bookingengine/usecases/public-hotel-info.ts` (allow-list real)
