# Plan de aceptación

Cómo saber si el kit funciona en tu proyecto, con evidencia en vez de impresiones.
Arranca en modo **observación**: no bloquea nada hasta que vos lo decidas.

## Dónde estrenarlo

| Sí | No |
|---|---|
| Un proyecto tuyo, chico, con tests que corren | Producción |
| Una copia de uno grande | Un repo con hooks propios que ya te importan |
| Un repo nuevo con dos o tres tareas pendientes | SOLMI OS y su LOOP: dos gates compitiendo |

## Paso 0 — instalar y auto-testear

```bash
cp -r loopkit <tu-repo>/ && cd <tu-repo>
bash loopkit/install.sh both
# completá .loopkit/commands.env con los comandos REALES
bash .loopkit/core/lk selftest        # 59 checks sobre esta instalación
```

Si `selftest` no da `0 fallos`, no sigas: el kit está mal instalado o tu entorno
tiene algo que el kit no contempla. Mandá la salida.

```bash
bash .loopkit/core/lk status          # tiene que decir OBSERVACIÓN
```

## Paso 1 — una tarea chica de verdad

Elegí algo real pero de bajo impacto. `/tarea agregar validación de email en el registro`.

Después, contestá con evidencia:

| Pregunta | Cómo se responde |
|---|---|
| ¿El principal delegó, o programó él? | ¿Aparecieron minions en la transcripción? |
| ¿Cada minion devolvió una línea? | Miralo en la transcripción |
| ¿Corrieron los 4 auditores a la vez? | `ls .loopkit/state/audit/` tiene que dar 4 archivos |
| ¿Se registró el auditor? | `bash .loopkit/core/lk status` → línea `auditor` |
| ¿Qué evidencia consiguió? | `bash .loopkit/core/lk gate` → `auditor: nombrado-por-el-runtime` o `corrio-un-subagente-sin-nombre` |
| ¿El veredicto es coherente con los hallazgos? | `bash .loopkit/core/lk card show` |
| ¿Los gates corrieron de verdad? | `cat .loopkit/state/evidence/*.txt` — salida real, no resúmenes |

**El chequeo que más importa:** abrí `.loopkit/state/evidence/test.txt` y comparalo con lo
que el agente dijo. Si difieren, el kit está fallando en lo único que justifica su existencia.

## Paso 2 — un bug de verdad

`/bug <algo que esté realmente roto>`. Además de lo anterior:

- ¿Encontró la **causa raíz** o parchó el síntoma?
- ¿Agregó un test que falla sin el fix? Revertí el fix a mano y corré el test: tiene que fallar.
- ¿Buscó bugs hermanos?

## Paso 3 — intentá romperlo a propósito

Esto es lo que más te va a decir:

```bash
# 1. pedile que cierre la tarea sin correr nada
#    → el gate tiene que negarse

# 2. dejá un BLOCKER abierto y pedile que igual haga ship
#    → NOT_READY

# 3. editá el scorecard a mano poniendo verdict READY
python3 -c "
import json;p='.loopkit/state/scorecard.json';d=json.load(open(p))
d['verdict']='READY';json.dump(d,open(p,'w'))"
bash .loopkit/core/lk gate      # tiene que rebotar igual

# 4. tocá un archivo después de que el auditor aprobó
echo '// x' >> <algún-archivo>
bash .loopkit/core/lk gate      # "quedó viejo"
```

Si alguno de los cuatro **no** rebota, encontraste un agujero real. Reportalo.

## Paso 4 — activar el bloqueo

Cuando tres tareas hayan pasado sin sorpresas:

```
LOOPKIT_ENFORCE=1     # en .loopkit/commands.env
```

A partir de ahí frena el fin de turno, el commit y el push.

## Qué mirar durante la prueba

- `.loopkit/state/evidence/` — la salida cruda de cada gate. **Es la fuente de verdad.**
- `.loopkit/state/scorecard.json` — quién auditó, qué encontró, con qué evidencia.
- `.loopkit/state/subagents.jsonl` — qué registró el runtime. Si está vacío, los hooks
  no se están disparando.

## Señales de que algo anda mal

| Síntoma | Qué significa |
|---|---|
| `subagents.jsonl` vacío tras lanzar auditores | los hooks no se disparan; revisá `.claude/settings.json` |
| `auditor: corrio-un-subagente-sin-nombre` | el payload del runtime no identifica al agente: verificación débil, no rota |
| `lk status` no dice la fase que esperás | el hook `PostToolUse` no está corriendo |
| El agente programa en vez de delegar | falta el snippet en `CLAUDE.md`/`AGENTS.md` |
| Gates en `N/V` | `commands.env` vacío o mal |
