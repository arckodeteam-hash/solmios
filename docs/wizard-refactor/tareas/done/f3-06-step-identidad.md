# Tarea 3.6 — `StepIdentidad.vue`

**Fase**: F3 — El Centro de configuración
**Depende de**: 3.1, 3.4
**Bloquea**: 3.16

## Qué hacer

Campos: `accommodationType`, `starRating`, logo (drag & drop, reusar el mismo
bloque que hoy tiene `settings/index.vue` antes de moverse en F1.7),
`currency`, `timezone` (sugerido según el país elegido en `StepBienvenida`,
tarea 3.5 — usar la fuente de país→timezone que corresponda, ver
`data/intl-catalogs.ts` si ya existe algo reusable), check-in/check-out
colapsados bajo un toggle "usar horarios estándar (15:00/12:00)".

## Criterio de aceptación

Cambiar de país en Bienvenida y abrir Identidad después sugiere una zona
horaria coherente con ese país (no forzada, editable). El logo se puede
saltear sin bloquear el guardado del resto del paso (es opcional dentro de un
paso requerido).

## Referencias

- `../05-ux-wizard-onboarding.md` paso 2 — Identidad
- `../02-clasificacion-de-campos.md` secciones A y D
