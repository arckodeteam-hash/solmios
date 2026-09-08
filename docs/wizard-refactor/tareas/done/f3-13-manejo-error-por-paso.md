# Tarea 3.13 — Manejo de error por paso

**Fase**: F3 — El Centro de configuración
**Depende de**: 3.1 (el composable ya expone `error`)
**Bloquea**: 3.16

## Qué hacer

Si el `PUT` de un paso falla (red, 500, 403), mostrar el error inline dentro
de ESE paso puntual, sin colapsarlo, sin perder lo tipeado, con opción de
reintentar sin recargar la página.

## Criterio de aceptación

Simular un 500 (mock del service, o apagar el backend un momento) al guardar
un paso → error visible en ese paso, el resto de la pantalla sigue
funcionando normalmente, reintentar guardar funciona sin recargar.

## Referencias

- `../05-ux-wizard-onboarding.md` (manejo de errores)
- `../06-arquitectura-tecnica.md` sección 5 (por qué el guardado aislado por paso resuelve el bug 3.1)
