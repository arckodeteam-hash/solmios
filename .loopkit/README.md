# LoopKit

Hacés que el agente trabaje siempre igual: **una orden tuya, él hace todo y se autocorrige.**

## Instalar (una vez por repo)

```bash
cp -r loopkit <tu-repo>/
cd <tu-repo>
bash loopkit/install.sh both        # o: claude | opencode
```

Después:
1. Abrí `.loopkit/commands.env` y poné los comandos reales del proyecto
   (`TEST="npm test"`, etc.). Lo que no exista, dejalo vacío — no inventes.
2. Pegá el snippet en tu archivo de instrucciones:
   - Claude Code → `loopkit/adapters/claude/CLAUDE.snippet.md` dentro de `CLAUDE.md`
   - OpenCode → `loopkit/adapters/opencode/AGENTS.snippet.md` dentro de `AGENTS.md`

**Arranca en modo observación**: evalúa y reporta, pero no bloquea nada. El plan para
estrenarlo con evidencia está en `ACEPTACION.md`. Cuando confíes, `LOOPKIT_ENFORCE=1`.

## Usar (esto es todo)

| Claude Code | OpenCode | Qué pasa |
|---|---|---|
| `/tarea agregar filtro por fecha` | `/lk-tarea …` | analiza, implementa, verifica, **corrige lo que falle**, audita y cierra |
| `/bug el login tira 500 con email vacío` | `/lk-bug …` | reproduce, busca causa raíz, corrige, verifica que no vuelve |
| `/verificar` | `/lk-verificar` | audita lo que ya está y arregla lo que aparezca |

No tenés que correr nada más ni tocar ningún archivo de configuración. Si el agente
encuentra un problema, **lo arregla en la misma corrida** y vuelve a verificar; sólo te
consulta si hay una decisión que sólo vos podés tomar.

## Qué te devuelve

Al final te cuenta, en cuatro líneas: qué hizo, qué se rompió y cómo lo arregló, el score
con su veredicto, y qué quedó pendiente. El score sale de una fórmula sobre hallazgos con
`archivo:línea`, no de una impresión del modelo.

## Por qué el agente no puede mentir

Cinco mecanismos, ninguno depende de que obedezca una instrucción:

### Auditor read-only, verificado

En Claude Code el agente `lk-qa` se restringe con `tools: Bash, Read, Grep, Glob`.
En OpenCode se restringe con la clave `tools:` del frontmatter — **no con `permissions:`,
que esa versión ignora en silencio**. Comprobado con `opencode debug agent lk-qa`:
`edit=False write=False task=False webfetch=False`. `task=False` importa: sin eso el
auditor podría delegar en otro agente para que escriba por él.

| Mecanismo | Fraude que corta |
|---|---|
| Evidencia anclada al **hash del diff** | verificar, después tocar código y decir que sigue verificado |
| El gate **recomputa** el score | declarar 95 cuando sus propios hallazgos dan 71 |
| `reviewer` ≠ `builder` | aprobarse a sí mismo |
| Historial de hallazgos | marcar un BLOCKER como arreglado sin cambiar una línea |
| Registro de `SubagentStop` | declarar `reviewer: lk-qa` sin haber lanzado nunca al auditor |

El último usa `.loopkit/state/subagents.jsonl`, que escribe el hook con el payload del
runtime — un dato que el modelo no emite. El gate informa en cada corrida qué evidencia
consiguió: `nombrado-por-el-runtime` (el payload identifica al agente),
`corrio-un-subagente-sin-nombre` (consta que corrió uno, pero el payload no lo nombra) o
`sin-registro` (bloqueo). Si tu runtime no emite `SubagentStop`, se desactiva con
`LOOPKIT_REQUIRE_SUBAGENT=0` y el gate lo reporta como `no-exigido`.

En OpenCode no hay un hook `SubagentStop`: el plugin detecta el lanzamiento por nombre
de herramienta. **Verificado contra opencode 1.18.11** (`opencode debug agent`): la
herramienta se llama `task`. Los otros nombres del patrón quedan como red por si cambia.
Diagnóstico: `lk status` muestra la línea `auditor`; si dice "sin registros" después de
lanzar un auditor, agregá el nombre a `SUBAGENT_TOOLS` en el plugin o poné
`LOOPKIT_REQUIRE_SUBAGENT=0`.

## Modo orquestador: el contexto del principal no se gasta

En `/tarea`, `/bug` y `/verificar` el agente principal **no escribe código**. Despacha
minions que trabajan en su propio contexto y devuelven **una línea** cada uno:

| Quién | Qué hace | Qué devuelve |
|---|---|---|
| orquestador | despacha y lee `lk brief` | — |
| `lk-dev` | implementa y corrige | 1 línea |
| `lk-qa` ×4 | auditan en paralelo por carriles | 1 línea c/u |

El orquestador tiene prohibido `Read`, `Grep`, `Glob`, `Edit`, `Write` y mirar diffs.
Sólo corre `lk start`, `lk brief`, `lk card merge` y `lk ship`. `lk brief` nunca pasa de
5 líneas; el detalle completo lo lee el minion que corrige, no el principal.

**Esto no abarata la tarea: gasta más tokens en total**, porque cada minion arranca su
propio contexto y vuelve a leer lo que necesita. Lo que ahorra es el contexto del agente
principal, que es lo que provoca compactaciones y pérdida de hilo en tareas largas.

Los dos minions están verificados contra opencode 1.18.11:
`lk-qa` → `edit=False write=False task=False webfetch=False`;
`lk-dev` → `edit=True write=True task=False webfetch=False`.
`task=False` en ambos: ningún minion delega en otro para saltarse su propio límite.

## Auditoría en paralelo

Las 12 dimensiones se reparten en cuatro carriles que corren concurrentes:

| Carril | Dimensiones |
|---|---|
| `estructura` | D1 D2 D3 D12 |
| `correccion` | D4 D5 |
| `seguridad` | D6 D9 |
| `medidas` | D7 D8 D10 D11 |

Cada auditor escribe su propio archivo en `.loopkit/state/audit/` — no hay escritura
concurrente al mismo JSON. El comando rechaza si un carril intenta puntuar una dimensión
ajena. `lk card merge <reviewer>` fusiona: gana el score **más bajo** de cada dimensión y
la severidad **más alta** de cada hallazgo repetido. Si un carril auditó sobre un diff
viejo, el merge falla — el código cambió durante la auditoría y hay que rehacerla.

Esto acorta la auditoría, no el trabajo total: el ciclo sigue teniendo implementación,
verificación, corrección y re-auditoría.

Y tres capas donde se bloquea: fin de turno (Claude Code), `git commit`/`push` (OpenCode),
y `git push` (hook de git, funciona con cualquier agente y también con vos a mano).

## Si querés meter mano

```bash
bash .loopkit/core/lk status      # en qué anda
bash .loopkit/core/lk card show   # el score con sus hallazgos
bash .loopkit/core/verify.sh      # correr los gates vos mismo
bash .loopkit/core/lk brief       # veredicto en <=5 líneas (lo que usa el orquestador)
bash .loopkit/core/lk gate        # el detalle completo, con todos los motivos
bash .loopkit/core/lk card lanes  # qué dimensión audita cada carril
bash .loopkit/core/lk selftest    # probar que el kit funciona (59 checks)
node .loopkit/test/opencode-plugin.mjs "$PWD"   # el plugin de OpenCode, 12 checks
```

Las 12 dimensiones del score están en `.loopkit/core/RUBRICA.md`.
Para pegar el scorecard en otra IA (ChatGPT, Cursor): `.loopkit/core/SCORECARD.md`.

## Detalles de implementación que conviene saber

- El hash del diff se calcula **siempre desde la raíz del repo**, así que da igual desde
  qué subdirectorio se invoque el kit.
- Los archivos **untracked de más de 256 KB** se hashean por `ruta + tamaño + mtime +
  los primeros y últimos 64 KB`, no leyéndolos enteros. `gate.py` corre en cada fin de
  turno; con 287 MB de untracked eso costaba 2.6 s por turno contra 0.10 s ahora.
  **Residuo:** un cambio en el medio de un archivo grande que además conserve tamaño y
  mtime exactos no se detecta. Ningún archivo de código llega a ese umbral.
- Una severidad o un estado desconocido en un hallazgo **no se degrada en silencio**:
  `card merge` lo rechaza y `gate.py` lo penaliza como BLOCKER y lo reporta.
- `lk build` y `lk start` borran los carriles de auditoría: si el código cambió, la
  auditoría en curso ya no vale.
- Cada gate corre en **su propia subshell desde la raíz del repo**, con la entrada
  cerrada y con un límite de tiempo (`LOOPKIT_TIMEOUT`, 600 s por defecto). Sin esto, un
  `TEST="cd backend && bun test"` dejaba el `cd` pegado y los gates siguientes corrían en
  el directorio equivocado, y un test colgado bloqueaba el turno sin límite. Si falta el
  comando `timeout` (macOS sin coreutils), se avisa por stderr en vez de fingir la protección.
- `EXTRA_NAME` no puede llamarse `build`, `typecheck`, `lint`, `test` ni `diff`: con
  `EXTRA_NAME="test"` un extra en verde sobrescribía unos tests en rojo.
- El hook `pre-push` **no viaja con un `git clone`** — git nunca clona hooks. `lk` lo
  detecta y lo **reinstala solo** en cada `start`, `build` y `gate`. Si ya hay un
  `pre-push` ajeno (husky u otro), no lo pisa: avisa y te da la línea a agregar.

## Límites del modo orquestador

- **Los minions no anidan.** Ni en Claude Code ni en OpenCode un subagente puede lanzar
  otro (por eso además ambos llevan `task: false`). El despacho lo hace siempre el
  orquestador. Es barato: el prompt de despacho son 3-5 líneas.
- **Los cuatro auditores leen el mismo diff.** El costo de lectura se multiplica por
  cuatro. En un diff grande eso pesa en tokens, aunque no en el contexto del principal.
- **Los carriles no se hablan.** Un problema que cruza dimensiones (algo que es de
  seguridad *y* de arquitectura a la vez) puede que ningún carril lo vea entero. El merge
  une hallazgos, no razonamientos.
- **El merge conserva el score más bajo y pierde el desacuerdo.** Si dos carriles puntúan
  distinto la misma dimensión, gana el menor, pero no queda registro de que discreparon.
- **Un minion colgado no tiene timeout.** `verify.sh` acota sus gates; el despacho de un
  minion no. Si no vuelve, el orquestador espera.
- **El estado es de una tarea por vez.** `.loopkit/state/` no está namespaceado por
  tarea, así que no se pueden llevar dos en paralelo en el mismo repo. `lk start` lo
  detecta y **se niega** en vez de pisar la anterior (`LOOPKIT_FORCE=1` para descartarla
  a propósito).

## Límites honestos

- Cuatro dimensiones (patrones, consistencia, corrección, documentación) siguen siendo
  juicio del modelo. La rúbrica las hace auditables — exige `archivo:línea` para bajar
  puntos y evidencia citada para subir a ≥90 — pero no infalibles.
- El plugin de OpenCode está probado con un harness que ejecuta su código real
  (`test/opencode-plugin.mjs`, 12 checks) y el agente está verificado contra el binario
  de opencode. **No se corrió una sesión completa de OpenCode de punta a punta.**
- Si el agente simplemente **no reporta** un problema que existe, ningún script lo detecta.
  Eso lo mitiga el auditor independiente (`lk-qa`), no el código.
- `git push --no-verify` y editar a mano `.loopkit/state/` saltean el sistema. El kit
  apunta a la alucinación, no al sabotaje deliberado.
