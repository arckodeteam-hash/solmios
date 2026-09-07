# Tarea 3.9 — `StepPoliticas.vue`

**Fase**: F3 — El Centro de configuración
**Depende de**: 3.1, 3.4
**Bloquea**: 3.16

## Qué hacer

Envuelve `<CancellationPolicyEditor>` tal cual existe (sin reinventarlo), más
`taxName`/`taxRate` con el aviso explícito de no dejar pasar el default en
silencio — ligado al riesgo R1 de `../08-decisiones-abiertas-y-riesgos.md`.

## Criterio de aceptación

Si el país del hotel (cargado en `StepBienvenida`) no es República
Dominicana, el campo de impuestos muestra un aviso pidiendo confirmar o
cambiar el default `ITBIS 18%` en vez de dejarlo pasar silencioso. Si el país
sí es RD, no hace falta el aviso (el default es coherente).

## Referencias

- `../05-ux-wizard-onboarding.md` paso 5 — Políticas de reserva
- `../02-clasificacion-de-campos.md` sección E
- `../08-decisiones-abiertas-y-riesgos.md` riesgo R1
- `frontend/src/components/booking/CancellationPolicyEditor.vue` (componente a reusar)
