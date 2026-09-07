# Tarea 1.10 — Gate de verificación F1

**Fase**: F1 — Mover Ubicación a Página pública
**Depende de**: todas las anteriores de F1 (1.1 a 1.9)
**Bloquea**: el arranque de F2 (por orden de fases, no por dependencia técnica dura)

## Qué hacer

Correr el gate completo:

```
cd backend && bun run typecheck
cd backend && bun run node_modules/arckode-framework/bin/arckode.js analyze
cd backend && bun test
cd frontend && bun run typecheck
cd frontend && bun run build
```

Más verificación manual en navegador: Página pública → Ubicación funciona de
punta a punta (cargar, mover pin, guardar, recargar y ver que persistió).

## Criterio de aceptación

- `arckode analyze` → 0 violaciones.
- Typecheck limpio en ambos paquetes.
- `bun test` verde.
- `vite build` termina en "✓ built".
- Verificación manual confirmada y documentada (captura o nota breve en el PR
  de esta fase).

## Referencias

- `../07-plan-fases-implementacion.md` Fase 1, criterio de aceptación
