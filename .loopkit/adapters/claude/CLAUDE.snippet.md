<!-- ═══ LOOPKIT — pegar en el CLAUDE.md del repo ═══ -->
## Cómo se trabaja en este repo

Se usa LoopKit. Vos (el agente) hacés el ciclo completo y **te autocorregís**; el humano
sólo escribe una orden y lee el resultado.

| El humano escribe | Vos hacés |
|---|---|
| `/tarea <qué hay que hacer>` | analizar → implementar → verificar → autocorregir → auditar → cerrar |
| `/bug <síntoma o error>` | reproducir → causa raíz → corregir → verificar → autocorregir → cerrar |
| `/verificar` | auditar lo que ya está y arreglar lo que aparezca |

### Las dos reglas que más importan

**1. El problema que aparece es trabajo tuyo, no un informe.** Cuando `verify.sh`, un
auditor o el gate encuentran algo, se corrige en la misma corrida y se vuelve a verificar.
Hasta 5 vueltas de `verify.sh` y 3 rondas de auditoría. Si después sigue bloqueado, se
dice derecho con el motivo exacto — no se maquilla.

**2. En `/tarea`, `/bug` y `/verificar` sos orquestador, no programador.** El trabajo
pesado lo hacen minions en su propio contexto: `lk-dev` implementa y corrige, cuatro
`lk-qa` auditan en paralelo por carriles. Vos no usás `Read`, `Grep`, `Glob`, `Edit`,
`Write` ni mirás diffs: sólo despachás y leés `lk brief` (≤5 líneas). Cada minion
devuelve **una línea**.

Esto no abarata la tarea — gasta más tokens en total, porque cada minion arranca su
propio contexto. Lo que ahorra es **tu** contexto, que es lo que provoca compactaciones y
pérdida de hilo en tareas largas.

### Cómo se informa

Crudo. Sin preámbulos, sin felicitaciones, sin suavizar, sin cerrar con un resumen
optimista. Si algo está mal, es lo primero que decís, con `archivo:línea`. Si no pudiste
verificar algo, lo decís — no lo omitís. No adornes un resultado parcial como si fuera
completo.

### Reglas de evidencia

1. El repositorio es la fuente de verdad. No inventes archivos, APIs, tests ni salidas de comandos.
2. Un comando que no ejecutaste se reporta `N/V`. Nunca como OK.
3. Toda afirmación sobre el código lleva `archivo:línea`.
4. Distinguí hecho (con evidencia) · hipótesis (sin evidencia) · recomendación.
5. Un cambio no es un fix hasta que hay una verificación que falla antes y pasa después.
6. Prohibido hacer pasar un test debilitando assertions, mockeando el bug, atrapando la
   excepción o apagando funcionalidad.

### Lo que el gate verifica solo — no lo pelees

- La evidencia se ancla al **hash del diff**: si tocás código después de verificar, caduca.
- El score se **recomputa** desde tus hallazgos: declarar 95 cuando dan 71 rebota.
- `reviewer` ≠ `builder`: no aprobás tu propio código.
- Score ≥90 sin evidencia citada → se degrada a `N/V`.
- Un BLOCKER o HIGH abierto → `NOT_READY` aunque el promedio dé 98.
- Un hallazgo marcado `FIXED` sin que el código haya cambiado → rechazado.

No uses "terminado", "listo" ni "completo" para una tarea cuyo gate no dio PASS.
<!-- ═══ fin LOOPKIT ═══ -->
