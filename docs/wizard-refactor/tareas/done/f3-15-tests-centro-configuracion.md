# Tarea 3.15 — Tests del Centro de configuración

**Fase**: F3 — El Centro de configuración
**Depende de**: 3.3 a 3.13
**Bloquea**: 3.16

## Qué hacer

Tests de `pages/configuracion-inicial/index.vue`: expandir/colapsar,
guardado aislado por paso (**verificación explícita** de que un error en un
paso no afecta a otro — es el fix del bug 3.1), navegación de los pasos
`external`.

## Criterio de aceptación

Suite de tests nueva en verde, cubre al menos un caso de error de guardado y
uno de guardado exitoso por cada tipo de paso (`profile` y `external`).

## Referencias

- `../06-arquitectura-tecnica.md` sección 8
