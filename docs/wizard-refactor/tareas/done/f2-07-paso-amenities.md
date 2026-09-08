# Tarea 2.7 — Paso `amenities`

**Fase**: F2 — Backend: pasos de perfil dentro de `OnboardingStep[]`
**Depende de**: 2.1, 0.4 (resolución del duplicado de amenities)
**Bloquea**: 2.8, 3.10

## Qué hacer

Agregar el paso `amenities` (`kind: 'profile'`, `required: false`):

```ts
done: Boolean((hotel?.amenities?.length ?? 0) > 0 || childPolicyTocada)
```

Usar la fuente de amenities que haya quedado confirmada en la tarea 0.4 (D3).

## Criterio de aceptación

Test confirmando que este paso **nunca bloquea** `completed`, y que su
`done` refleja correctamente al menos una amenity cargada o la política de
niños tocada.

## Referencias

- `../06-arquitectura-tecnica.md` sección 1
- `../02-clasificacion-de-campos.md` secciones F y G
