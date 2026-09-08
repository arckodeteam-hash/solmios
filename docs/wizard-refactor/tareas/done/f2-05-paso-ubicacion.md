# Tarea 2.5 — Paso `ubicacion`

**Fase**: F2 — Backend: pasos de perfil dentro de `OnboardingStep[]`
**Depende de**: 2.1
**Bloquea**: 2.8, 3.8

## Qué hacer

Agregar el paso `ubicacion` (`kind: 'profile'`, `required: true`):

```ts
done: Boolean(hotel?.address && hotel?.latitude && hotel?.longitude)
```

Ojo: `latitude`/`longitude` tienen default `0` en el modelo (`hoteles/model.ts`)
— `0` no es una coordenada real, así que el chequeo `Boolean(hotel?.latitude)`
sobre el número `0` da `false` de por sí en JS (falsy), lo cual es
justo el comportamiento correcto acá, pero vale dejarlo explícito en un test
para que no se rompa sin querer si alguien "simplifica" la condición más
adelante.

## Criterio de aceptación

Test con hotel recién creado por `signup` (tiene `address` del registro, pero
`latitude`/`longitude` en `0`, el default) → `ubicacion.done === false`. Test
completando lat/lng reales (ej. `18.4861` / `-69.9312`) → `true`.

## Referencias

- `../06-arquitectura-tecnica.md` sección 1
- `../02-clasificacion-de-campos.md` sección C
