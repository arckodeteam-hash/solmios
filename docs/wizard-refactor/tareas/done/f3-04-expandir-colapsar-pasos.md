# Tarea 3.4 — Expandir/colapsar pasos

**Fase**: F3 — El Centro de configuración
**Depende de**: 3.3
**Bloquea**: 3.5 a 3.11 (necesitan el mecanismo de expandir para montar su contenido)

## Qué hacer

Implementar la lógica de expandir/colapsar: **un solo paso abierto a la vez**
(`open` como valor único, no un `Set` — mismo patrón que
`OnboardingGuide.vue` usa hoy), con transición de alto + fade al abrir/cerrar
(~200ms, mismo espíritu que el `rotate-180` del chevron que ya existe).

## Criterio de aceptación

Click en un paso colapsado lo expande y colapsa cualquier otro que estuviera
abierto. Click en el mismo paso ya abierto lo cierra. La transición respeta
`prefers-reduced-motion`.

## Referencias

- `../04-ux-widget-dashboard.md` (componente original a refactorizar: `OnboardingGuide.vue`)
- `../05-ux-wizard-onboarding.md` (animaciones)
