# Tarea 2.10 — Gate de verificación F2

**Fase**: F2 — Backend: pasos de perfil dentro de `OnboardingStep[]`
**Depende de**: todas las anteriores de F2 (2.1 a 2.9)
**Bloquea**: el arranque de F3 (por orden de fases)

## Qué hacer

Correr el gate completo:

```
cd backend && bun run typecheck
cd backend && bun run node_modules/arckode-framework/bin/arckode.js analyze
cd backend && bun test
cd frontend && bun run typecheck
cd frontend && bun run build
```

Sin cambios de frontend todavía en esta fase — el endpoint nuevo no se
consume hasta F3/F4, así que el gate de frontend debería pasar sin tocar
nada.

## Criterio de aceptación

Gate completo en verde. `GET /api/onboarding/status` probado manualmente
(curl o Postman) contra un hotel de prueba, confirmando el shape nuevo con
`kind` por paso.

## Referencias

- `../07-plan-fases-implementacion.md` Fase 2, criterio de aceptación
