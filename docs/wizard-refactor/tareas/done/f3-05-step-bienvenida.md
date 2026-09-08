# Tarea 3.5 — `StepBienvenida.vue`

**Fase**: F3 — El Centro de configuración
**Depende de**: 3.1, 3.4, 0.2 (endpoint de perfil de usuario confirmado)
**Bloquea**: 3.16 (gate de la fase)

## Qué hacer

Mini-formulario inline con `name`, `country`, `phone` (marcado requerido,
validación visible si se deja vacío), `email`, `ownerName` (usando el
endpoint confirmado en la tarea 0.2). Todos pre-cargados desde
`GET /api/settings`. Guarda con `useOnboardingStep` (tarea 3.1).

## Criterio de aceptación

Los 5 campos aparecen pre-cargados con los valores del registro. Guardar sin
`phone` muestra error de campo requerido y no persiste. Guardar con todo
completo marca el paso como hecho en la lista al colapsarse (check verde).

## Referencias

- `../05-ux-wizard-onboarding.md` paso 1 — Bienvenida
- `../02-clasificacion-de-campos.md` secciones A y B
