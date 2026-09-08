# Tarea 3.11 — `StepExternal.vue`

**Fase**: F3 — El Centro de configuración
**Depende de**: 3.4, F2 completa (necesita el campo `kind` del backend)
**Bloquea**: 3.16

## Qué hacer

Componente genérico para los 4 pasos operativos (`rooms`, `rates`, `channels`,
`team`): recibe `title`/`description`/`how`/`impact`/`route`/`cta` del
`OnboardingStep` y muestra la explicación + un botón que navega a la pantalla
real, sin formulario propio — mismo contenido que ya renderiza
`OnboardingGuide.vue` hoy para estos 4 pasos (reusar el copy existente en
`backend/src/modules/subscriptions/usecases/onboarding.ts`, no reescribirlo).

## Criterio de aceptación

Los pasos Habitaciones/Tarifas/Canales/Equipo se ven con este componente
único (no 4 componentes separados). El botón de cada uno navega
correctamente a su pantalla real (`/panel/config/habitaciones`,
`/panel/config/tarifas`, `/panel/channel-manager`, `/panel/rrhh/team`).

## Referencias

- `../05-ux-wizard-onboarding.md` (pasos operativos)
- `frontend/src/components/features/OnboardingGuide.vue` (contenido a reusar)
