# Tarea 2.3 — Paso `identidad`

**Fase**: F2 — Backend: pasos de perfil dentro de `OnboardingStep[]`
**Depende de**: 2.1
**Bloquea**: 2.8, 3.6

## Qué hacer

Agregar el paso `identidad` (`kind: 'profile'`, `required: true`):

```ts
done: Boolean(hotel?.accommodationType && hotel?.currency)
```

**Decisión menor a tomar acá**: `accommodationType` default es `'hotel'` y
`currency` default es `'USD'` (ambos son defaults del modelo, `hoteles/model.ts`).
¿Cuentan como "hecho" aunque el usuario nunca los haya tocado explícitamente,
o hace falta que haya un cambio real? Documentar la decisión elegida con un
comentario corto en el código — no dejarla implícita.

## Criterio de aceptación

Test con hotel en estado default (`accommodationType: 'hotel'`, `currency:
'USD'`, sin editar) confirmando el comportamiento elegido (`done: true` o
`false`, según lo decidido). Comentario en el código explicando el criterio.

## Referencias

- `../06-arquitectura-tecnica.md` sección 1
- `../02-clasificacion-de-campos.md` sección A y D
