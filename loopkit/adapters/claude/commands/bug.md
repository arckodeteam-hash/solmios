---
description: Causa raíz de un bug, corregido y verificado, con minions
argument-hint: <síntoma, error o stack trace>
---
# BUG: $ARGUMENTS

```bash
bash .loopkit/core/lk start BUG-<id> "$ARGUMENTS"
```

## Tu rol: orquestador. No escribas código.

Tu contexto es el recurso caro de esta sesión. Todo el trabajo pesado —leer archivos,
mirar diffs, escribir código, auditar— lo hacen **minions** en su propio contexto.

**Prohibido para vos en esta tarea:** `Read`, `Grep`, `Glob`, `Edit`, `Write`, mirar
`git diff`, abrir archivos del proyecto. Si necesitás saber algo del código, se lo
preguntás a un minion; no lo mirás vos.

**Lo único que ejecutás** son estos comandos, que devuelven pocas líneas:

```bash
bash .loopkit/core/lk start <id> "<tarea>"
bash .loopkit/core/lk brief                 # ≤5 líneas: fase, veredicto y motivos
bash .loopkit/core/lk card merge lk-qa
bash .loopkit/core/lk ship
```

Usá `lk brief`, no `lk gate` ni `lk card show`: te alcanza y ocupa menos.

## Ciclo

**1. Implementar.** Despachá **un** `lk-dev`:

> Implementá la tarea que está en `.loopkit/state/task.json`. Leé el repo por tu cuenta.
> Terminá corriendo `bash .loopkit/core/verify.sh` hasta que quede verde o 5 vueltas.
> Devolvé UNA línea en el formato de tu protocolo.

**2. Auditar en paralelo.** Despachá **cuatro** `lk-qa` en un solo mensaje, cuatro
llamadas a la vez:

| Carril | Dimensiones |
|---|---|
| `estructura` | D1 D2 D3 D12 |
| `correccion` | D4 D5 |
| `seguridad` | D6 D9 |
| `medidas` | D7 D8 D10 D11 |

A cada uno, cambiando `<carril>`:

> Auditá el diff actual, carril `<carril>`. Antepone `LOOPKIT_LANE=<carril>` a todos tus
> comandos `lk card`. Empezá por `LOOPKIT_LANE=<carril> bash .loopkit/core/lk card new`.
> No adelantes conclusiones favorables. No puntúes lo que no inspeccionaste.
> Devolvé UNA línea: `<carril>: N hallazgos, peor=<severidad>`.

No les cuentes nada del código ni tu opinión: tienen que llegar solos.

**3. Fusionar y mirar el veredicto.**

```bash
bash .loopkit/core/lk card merge lk-qa
bash .loopkit/core/lk brief
```

El merge **deriva** el veredicto de los hallazgos con las mismas reglas que el gate. No lo
fijás vos: no viste los hallazgos, y un veredicto puesto a ciegas no vale nada.

**4. Si dice BLOCK** — despachá **un** `lk-dev` para corregir:

> El gate bloqueó. Corré `bash .loopkit/core/lk gate` para ver los motivos completos,
> corregí todos, marcá cada hallazgo con `lk card fixed <ID> "<qué cambiaste>"` y dejá
> `verify.sh` en verde. Devolvé UNA línea.

Y volvé al paso 2. Máximo **3 rondas**.

**5. Cerrar.** `bash .loopkit/core/lk ship`.

## Qué le contás al humano

Cuatro líneas, crudas, con lo que te devolvieron los minions. Sin preámbulo, sin resumen
optimista. Si el gate nunca pasó, esa es la primera línea, con el motivo exacto.

## Instrucción extra para el `lk-dev` del paso 1

Pasale esto además:

> Es un bug, no una tarea nueva. Reproducí el fallo o construí la reproducción más
> cercana. Seguí el flujo hasta donde se rompe. Formulá tu hipótesis de causa e intentá
> **refutarla** antes de aceptarla. No confundas dónde explota con dónde se origina.
> Agregá un test que falle por el bug antes del fix, si es viable. Buscá el mismo patrón
> en el resto del repo — si estaba en un lugar, suele estar en dos — y arreglá los que
> encuentres dentro del alcance. Prohibido tapar la excepción, apagar la funcionalidad
> o aflojar un assert.

En tu reporte final, la primera línea es la **causa raíz** en una frase.
