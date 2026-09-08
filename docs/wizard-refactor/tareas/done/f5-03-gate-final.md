# Tarea 5.3 — Gate final completo

**Fase**: F5 — Limpieza y documentación
**Depende de**: 5.1, 5.2
**Bloquea**: merge a `main`

## Qué hacer

Gate final completo antes de mergear todo el refactor a `main`:

```
cd backend && bun run typecheck
cd backend && bun run node_modules/arckode-framework/bin/arckode.js analyze
cd backend && bun test
cd frontend && bun run typecheck
cd frontend && bun run build
```

## Criterio de aceptación

`arckode analyze` 0 violaciones, `typecheck` limpio en ambos paquetes,
`bun test` (backend) verde, `bun run build` (frontend) termina en "✓ built".

## Referencias

- `../07-plan-fases-implementacion.md` Fase 5
