# Tarea 4.3 — Retirar `OnboardingGuide.vue`

**Fase**: F4 — Reemplazar el widget del dashboard
**Depende de**: 4.2
**Bloquea**: 4.5

## Qué hacer

`OnboardingGuide.vue` ya no se usa en el dashboard (su lógica de acordeón vive
ahora en `pages/configuracion-inicial/index.vue`, tareas 3.3/3.4). Confirmar
que no queda importado en ningún otro lado antes de borrarlo:

```
rg "OnboardingGuide" frontend/src
```

## Criterio de aceptación

El `rg` de arriba no devuelve resultados fuera del propio archivo (si se
decide borrar), o el archivo queda claramente marcado como no usado en un
comentario (si se prefiere dejarlo por las dudas en vez de borrarlo).

## Referencias

- `frontend/src/components/features/OnboardingGuide.vue`
