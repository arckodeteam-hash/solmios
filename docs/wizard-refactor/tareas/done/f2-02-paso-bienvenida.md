# Tarea 2.2 — Paso `bienvenida`

**Fase**: F2 — Backend: pasos de perfil dentro de `OnboardingStep[]`
**Depende de**: 2.1, 0.2 (saber cómo se resuelve `ownerName`)
**Bloquea**: 2.8 (reordenar), 3.5 (`StepBienvenida.vue` consume este paso)

## Qué hacer

Agregar el paso `bienvenida` (`kind: 'profile'`, `required: true`) a
`onboarding.ts`. Este paso **reemplaza** al paso `hotel` actual, que está mal
calibrado (auditoría 01, sección 2: `hotelReady = Boolean(hotel?.phone ||
hotel?.address)`, ambos ya vienen del registro, así que nace "hecho" sin
serlo de verdad) — se elimina el paso viejo.

Criterio de `done`:
```ts
Boolean(hotel?.name && hotel?.country && hotel?.phone && hotel?.email && ownerNameResuelto)
```

`phone` es ahora requerido explícito (decisión del usuario, doc 08 D1) — antes
del registro ya lo trae, pero un hotel dado de alta manualmente por el
super-admin (sin pasar por `signup`) podría no tenerlo.

## Criterio de aceptación

Test con un hotel recién creado por `signup` (tiene `name`/`country`/`phone`,
pero `hotels.email` vacío — ver `../02-clasificacion-de-campos.md` sección B,
nota sobre `hotels.email`) → `bienvenida.done === false`. Test completando
`email` → `true`.

## Referencias

- `../06-arquitectura-tecnica.md` sección 1
- `../02-clasificacion-de-campos.md` sección B
- `../01-auditoria-estado-actual.md` sección 2
