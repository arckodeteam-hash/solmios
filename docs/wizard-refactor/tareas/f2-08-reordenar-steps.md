# Tarea 2.8 — Reordenar `steps[]`

**Fase**: F2 — Backend: pasos de perfil dentro de `OnboardingStep[]`
**Depende de**: 2.2, 2.3, 2.4, 2.5, 2.6, 2.7 (los 6 pasos de perfil ya agregados)
**Bloquea**: 2.9, 2.10

## Qué hacer

Ordenar el array `steps[]` que devuelve `OnboardingUseCase.status()`: pasos de
perfil primero (`bienvenida` → `identidad` → `contacto` → `ubicacion` →
`politicas` → `amenities`), pasos operativos después (`rooms` → `rates` →
`channels` → `team`) — mismo orden que va a consumir el acordeón del frontend
(`../05-ux-wizard-onboarding.md`).

## Criterio de aceptación

`GET /api/onboarding/status` devuelve los 10 pasos en ese orden exacto.

## Referencias

- `../05-ux-wizard-onboarding.md`
- `../06-arquitectura-tecnica.md` sección 1
