# Tarea 2.4 — Paso `contacto`

**Fase**: F2 — Backend: pasos de perfil dentro de `OnboardingStep[]`
**Depende de**: 2.1
**Bloquea**: 2.8, 3.7

## Qué hacer

Agregar el paso `contacto` (`kind: 'profile'`, `required: false`):

```ts
done: Boolean(hotel?.phone2 || hotel?.website || hotel?.ownerTaxId)
```

Este paso **nunca bloquea** `completed` — es 100% opcional (doc 02, sección B).

## Criterio de aceptación

Test confirmando que un hotel sin ninguno de estos 3 campos sigue teniendo
`completed: true` si el resto de los pasos requeridos están OK (este paso no
cuenta como bloqueante, solo aporta al `doneCount`/`totalCount` informativo).

## Referencias

- `../06-arquitectura-tecnica.md` sección 1
- `../02-clasificacion-de-campos.md` sección B
