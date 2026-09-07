# Tarea 3.8 — `StepUbicacion.vue`

**Fase**: F3 — El Centro de configuración
**Depende de**: 3.1, 3.4, F1 completa (composable de mapa con fix de país ya existe)
**Bloquea**: 3.16

## Qué hacer

Reusar `useHotelLocationMap` (de las tareas 1.1/1.2) dentro del Centro de
configuración — mismo mapa, mismo fix de país, dentro de un formulario más
chico que el de la pantalla completa de Página pública → Ubicación.

## Criterio de aceptación

Mover el pin acá y guardar deja el mismo resultado que hacerlo desde Página
pública → Ubicación (mismo endpoint, mismos campos) — verificar navegando a
Página pública después de guardar acá y confirmando que el valor persistió
ahí también.

## Referencias

- `../05-ux-wizard-onboarding.md` paso 4 — Ubicación
- `../06-arquitectura-tecnica.md` sección 6
