# Tarea 3.1 — Composable `useOnboardingStep`

**Fase**: F3 — El Centro de configuración
**Depende de**: F2 completa (necesita el shape nuevo de `OnboardingStep`)
**Bloquea**: 3.5 a 3.11 (todos los steps lo usan)

## Qué hacer

Crear `frontend/src/composables/useOnboardingStep.ts`: recibe la key del paso
y el patch a guardar, expone `{ saving, error, save() }` que llama
`SettingsService.patchHotel(patch)` (u otro endpoint según el paso — ver la
tabla de `../06-arquitectura-tecnica.md` sección 2) y refresca
`GET /api/onboarding/status` al terminar.

Manejar explícitamente:
- Estado `saving` mientras el request está en curso (deshabilita el botón).
- `error` si el `PUT` falla (mensaje del `ApiError`, no un genérico).
- Protección contra doble submit (llamar `save()` dos veces seguidas no
  dispara dos requests).

## Criterio de aceptación

Test unitario del composable: guarda correctamente, refleja `saving` durante
el request, expone `error` ante un fallo simulado, no dispara doble request
en doble click.

## Referencias

- `../06-arquitectura-tecnica.md` secciones 2 y 4
- `../05-ux-wizard-onboarding.md` (manejo de errores por paso)
