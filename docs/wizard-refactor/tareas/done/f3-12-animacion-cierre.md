# Tarea 3.12 — Animación de cierre al 100%

**Fase**: F3 — El Centro de configuración
**Depende de**: 3.5 a 3.11 (todos los pasos tienen que existir para poder llegar al 100%)
**Bloquea**: 3.16

## Qué hacer

Cuando `completed` (de los pasos requeridos, `kind: 'profile'`) pasa a
`true`, la cabecera del Centro de configuración cambia a un estado de cierre
("Tu hotel está listo" o el copy que resulte de la tarea 3.14/0.5) con una
transición notoria una sola vez (fade + scale del bloque de cabecera,
opcionalmente un ícono de check grande).

## Criterio de aceptación

Completar el último campo requerido dispara la animación una vez. Recargar la
página con todo ya completo **no repite** la animación — se muestra el estado
final directo, sin la transición. Respeta `prefers-reduced-motion`.

## Referencias

- `../05-ux-wizard-onboarding.md` (animaciones)
