# Tarea 2.6 — Paso `politicas`

**Fase**: F2 — Backend: pasos de perfil dentro de `OnboardingStep[]`
**Depende de**: 2.1
**Bloquea**: 2.8, 3.9

## Qué hacer

Agregar el paso `politicas` (`kind: 'profile'`, `required: true`):

```ts
done: Boolean(hotel?.taxName && hotel?.taxRate)
```

**Mismo cuidado que en la tarea 2.3**: `taxName`/`taxRate` tienen default
`'ITBIS'`/`18.0` (sesgado a República Dominicana, ver riesgo R1 en
`../08-decisiones-abiertas-y-riesgos.md`). Documentar en el código si el
default cuenta como "hecho" o si se exige que el usuario lo haya confirmado
explícitamente — coherente con el aviso que `StepPoliticas.vue` (tarea 3.9)
va a mostrar cuando el país no sea RD.

## Criterio de aceptación

Test cubriendo el criterio elegido, con un comentario en el código explicando
la decisión y su relación con el riesgo R1.

## Referencias

- `../06-arquitectura-tecnica.md` sección 1 y 3
- `../02-clasificacion-de-campos.md` sección E
- `../08-decisiones-abiertas-y-riesgos.md` riesgo R1
