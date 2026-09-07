# Tarea 3.2 — Ruta `/panel/configuracion-inicial`

**Fase**: F3 — El Centro de configuración
**Depende de**: ninguna (puede ir en paralelo con 3.1)
**Bloquea**: 3.3

## Qué hacer

Agregar la ruta nueva `/panel/configuracion-inicial` al router
(`frontend/src/router/index.ts`), protegida igual que el resto de `/panel/*`
(requiere sesión, `userType: 'merchant'`).

Si la tarea 0.5 (D6) cambió el nombre final de la pantalla, usar ese nombre
para la ruta en vez de `configuracion-inicial`.

## Criterio de aceptación

Navegar a la ruta logueado carga la página (aunque esté vacía todavía, antes
de 3.3). Sin sesión, redirige a login — igual comportamiento que cualquier
otra ruta de `/panel`.

## Referencias

- `frontend/src/router/index.ts`
- `../06-arquitectura-tecnica.md` sección 4
