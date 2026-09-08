# Tarea 2.9 — Tests backend de los pasos nuevos

**Fase**: F2 — Backend: pasos de perfil dentro de `OnboardingStep[]`
**Depende de**: 2.8
**Bloquea**: 2.10

## Qué hacer

Completar la suite de tests de `onboarding.test.ts` con casos combinados:

- Perfil 0% (hotel recién creado por `signup`, sin tocar nada más).
- Perfil parcial, con distintas combinaciones de campos faltantes (al menos
  un caso por cada uno de los 6 pasos nuevos).
- Perfil 100% requerido con opcionales pendientes (`contacto`/`amenities` sin
  completar, pero `completed: true` igual).
- Perfil + operativo 100% (los 10 pasos hechos).

## Criterio de aceptación

Cobertura de los 6 pasos nuevos + `completed`/`doneCount`/`totalCount`
correctos en cada combinación probada. `cd backend && bun test` verde.

## Referencias

- `backend/src/modules/subscriptions/tests/onboarding.test.ts`
- `../06-arquitectura-tecnica.md` sección 8
