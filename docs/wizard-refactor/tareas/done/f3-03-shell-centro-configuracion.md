# Tarea 3.3 — Shell del Centro de configuración

**Fase**: F3 — El Centro de configuración
**Depende de**: 3.2
**Bloquea**: 3.4

## Qué hacer

Crear `frontend/src/pages/configuracion-inicial/index.vue` (shell): cabecera
con el progreso combinado (mismo dato que consumirá `ProfileProgressBar.vue`
en F4), un `onMounted` que pide `GET /api/onboarding/status`, y la lista de
los 10 pasos **colapsados** (título + check/badge, sin contenido expandido
todavía — eso es la tarea 3.4 en adelante).

## Criterio de aceptación

La pantalla muestra los 10 pasos en el orden que devuelve el backend (F2.8),
cada uno con su estado hecho/pendiente y badge requerido/opcional visible sin
necesidad de expandir (ver el mockup en `../05-ux-wizard-onboarding.md`).

## Referencias

- `../05-ux-wizard-onboarding.md` (diseño visual)
- `../06-arquitectura-tecnica.md` sección 4
