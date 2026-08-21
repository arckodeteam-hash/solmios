# Change Proposal: github-issues-pendientes

## Summary

Bajar a openspec **todo lo que quedó abierto** en GitHub (`arckodeteam-hash/solmios`) más los
hallazgos del gate de LoopKit que no tienen issue, para poder trabajarlos sin volver a consultar
la API de GitHub. Cada fila se verificó contra el código el **2026-08-20** — no se copió el título
del issue, se leyó el archivo y se anotó `archivo:línea`.

De los 30 issues abiertos: **3 se pueden cerrar ya** (uno resuelto en código, dos son ruido de
prueba), **2 son ambiguos**, **11 están bloqueados por terceros o son data de producción**, **2 ya
están trackeados en otro change**, **2 no se verificaron**, y **10 son trabajo real de código** que
entra acá.

Se suman **3 hallazgos HIGH** del gate `CHK-20260819` que están vivos en el working tree y **no
tienen issue en GitHub**. Son los de mayor prioridad: los tres tocan dinero o aislamiento entre
hoteles.

## Motivation

El usuario pidió no depender de la conexión a GitHub para saber qué falta. La lista de issues
tenía además tres problemas que este change resuelve de raíz:

1. **Títulos que no describen el estado real.** El issue #17 dice "32 campos sin name/id/label";
   el conteo real hoy es **296 de 317**. El #30 se lee como bug de front y es un `sortOrder` mal
   cargado en la base de producción.
2. **Trabajo sin issue.** Los 3 HIGH del gate de anoche no están en ningún lado.
3. **Doble tracking.** #15 y #16 ya viven en `deudas-tecnicas-pendientes` (DT-07 y DT-09). Acá se
   referencian, no se duplican.

## Verificación previa — qué se leyó antes de escribir cada tarea

| Issue | Verificado en | Estado real |
|---|---|---|
| #20 | `frontend/src/components/features/ReservationCalendar.vue:214-217` | **Ya resuelto.** El comentario cita el síntoma textual del reporte; handle de resize `w-4`→`w-2` + `pr-4` de colchón. Cerrar. |
| #25, #26 | — | Ruido de prueba declarado por el propio texto. Cerrar. |
| #23, #24 | `ReservationsGantt.vue:107` | Ambiguos. #24 apunta a un Gantt que ya tiene el handle `w-2` oculto hasta hover (el fix hermano de #20), pero el reporte no dice cuál era el problema. Pedir reconfirmación antes de cerrar. |
| #29 | `frontend/src/pages/suscripcion/index.vue:70` y `:89` | **Vivo.** El badge "Tu plan" sale con `p.id === sub?.planId`; el botón solo cambia si **además** `sub?.status === 'active'`. En `trialing` → badge "Tu plan" + botón "Suscribirse a Professional". |
| #30 | `backend/src/modules/subscriptions/service.ts:95`, `suscripcion/index.vue:64` | **No es código.** El backend ordena por `sortOrder` y el front respeta ese orden. Los `sortOrder` están mal cargados en la DB de prod. |
| #31 | `landing/index.vue:451,461`, `settings/index.vue:281,1187` | **Vivo.** Tres fuentes de verdad para el precio: landing hardcodea `USD 99`/`USD 349`, settings usa `'Professional'` como default literal, y `/panel/suscripcion` lee la API. |
| #32 | `frontend/src/pages/settings/index.vue:242` | **Vivo.** `<input type="password">` sin `autocomplete="new-password"` → Chrome lo autocompleta y el campo aparece lleno sin que nadie lo escriba. |
| #27 | `backend/src/modules/subscriptions/usecases/signup.ts:156-172` | **El código sí encola** verificación y bienvenida, pero ambos son best-effort con `catch { }` vacío. Si SMTP falla nadie se entera. El bug real es la falta de observabilidad, no el envío. |
| #17 | `rg -o '<input[^>]*>' frontend/src/pages/` | **Peor que lo reportado**: 296 de 317 inputs sin `name` ni `id`. |
| #18 | idem | 9 de 317 inputs con `required`. |
| #15, #16 | `openspec/changes/deudas-tecnicas-pendientes/` | Ya trackeados como DT-07 (bloqueada de framework) y DT-09 (bloqueada por negocio). No se duplican. |

## Scope

**Entra**: los 3 HIGH del gate, los fixes de suscripción/config (#29, #31, #32), la observabilidad
del correo de alta (#27), la accesibilidad de formularios (#17, #18), el `sortOrder` de planes en
prod (#30), y el cierre administrativo de #20/#25/#26.

**No entra**:
- Lo bloqueado por credenciales o decisión de negocio: #1, #9, #10, #11 (Meta/PayPal/Azul/CardNet),
  #2, #3, #5, #6 (Channex), #12 (Turnstile). Se listan en `tasks.md` como referencia, sin tareas.
- #28 (trial que exija tarjeta): es feature de producto, necesita decisión antes de spec.
- #4 (responsive 375px): ya está `workflow:en-proceso`.
- #13, #14 (Ventas y Web): no se verificaron, no se inventan tareas sobre ellos.
- #19: configuración de módulos vacía en prod — data, se resuelve junto con #30.

## Riesgo y rollback

Los 3 HIGH tocan el cobro por Stripe y el aislamiento entre hoteles. Cada uno exige un test que
falle antes del fix y pase después; sin ese par rojo/verde la tarea no se marca. El resto son
cambios acotados de frontend y de logging, revertibles por commit individual.
