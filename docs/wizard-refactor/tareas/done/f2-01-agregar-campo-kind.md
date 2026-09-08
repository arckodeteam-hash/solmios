# Tarea 2.1 — Agregar el campo `kind` a `OnboardingStep`

**Fase**: F2 — Backend: pasos de perfil dentro de `OnboardingStep[]`
**Depende de**: ninguna (F2 puede arrancar en paralelo con F1, son áreas de código distintas)
**Bloquea**: 2.2 a 2.8

## Qué hacer

En `backend/src/modules/subscriptions/usecases/onboarding.ts`, agregar el
campo `kind: 'profile' | 'external'` a la interface `OnboardingStep`, y marcar
los 4 pasos existentes (`rooms`, `rates`, `channels`, `team`) como
`kind: 'external'` — **sin tocar su lógica de `done`**, que ya está bien
calibrada (auditoría 01, sección 2).

```ts
export interface OnboardingStep {
  // ...campos existentes...
  kind: 'profile' | 'external'
}
```

## Criterio de aceptación

`GET /api/onboarding/status` sigue devolviendo los mismos 4 pasos con el
mismo comportamiento de antes, cada uno con `kind: 'external'` agregado.
Tests existentes de `onboarding.test.ts` siguen verdes sin modificarlos.

## Referencias

- `../06-arquitectura-tecnica.md` sección 1
- `backend/src/modules/subscriptions/usecases/onboarding.ts`
