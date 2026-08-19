#!/usr/bin/env bash
# Stop — impide terminar el turno si se escribió código y la tarea no pasó el gate.
# Devuelve {"decision":"block","reason":...} para que el modelo lea el motivo y siga.
ROOT="$(git rev-parse --show-toplevel 2>/dev/null || pwd)"
LK="$ROOT/.loopkit"
[ -x "$LK/core/lk" ] || exit 0

payload="$(cat)"
# si ya estamos dentro de un bloqueo, no reentrar: evita loop infinito
echo "$payload" | grep -q '"stop_hook_active"[[:space:]]*:[[:space:]]*true' && exit 0

phase="$(python3 -c "
import json,os
p=os.path.join('$LK','state','task.json')
print(json.load(open(p)).get('phase','') if os.path.exists(p) else '')
" 2>/dev/null)"

# solo aplica si realmente se tocó código en esta tarea
case "$phase" in BUILD|VERIFY) ;; *) exit 0 ;; esac

if out="$(cd "$ROOT" && LOOPKIT_STATE="$LK/state" python3 "$LK/core/gate.py" 2>&1)"; then
  exit 0
fi

# modo observación: se informa, no se traba
ENFORCE=1; [ -f "$LK/commands.env" ] && . "$LK/commands.env" 2>/dev/null
if [ "${LOOPKIT_ENFORCE:-1}" = "0" ]; then
  echo "[LoopKit · observación] la tarea no pasaría el gate:" >&2
  echo "$out" >&2
  echo "(modo observación: no se bloquea. LOOPKIT_ENFORCE=1 en .loopkit/commands.env para activar)" >&2
  exit 0
fi

python3 - "$out" <<'PY'
import json,sys
print(json.dumps({
 "decision":"block",
 "reason":("LOOPKIT — la tarea no puede cerrarse todavía.\n\n"+sys.argv[1]+
  "\n\nNO me devuelvas esto como reporte: resolvelo vos ahora, en esta misma corrida.\n\n"
  "1. `bash .loopkit/core/verify.sh` → lo que salga en rojo, arreglalo y volvé a correr.\n"
  "   Repetí hasta verde o hasta 5 vueltas.\n"
  "2. Lanzá el agente `lk-qa` (contexto limpio, read-only) para que audite y cargue el\n"
  "   scorecard con `lk card`. Vos NO podés aprobar tu propio código.\n"
  "3. Cada BLOCKER o HIGH que traiga: corregilo, `lk card fixed <ID> \"qué cambiaste\"`,\n"
  "   `verify.sh` de nuevo y `lk-qa` de nuevo. Máximo 3 rondas.\n"
  "4. `bash .loopkit/core/lk gate` hasta PASS, después `lk ship`.\n\n"
  "Si después de los reintentos sigue bloqueado, decílo derecho con el motivo exacto.\n"
  "No afirmes que la tarea está terminada mientras este gate bloquee.")}))
PY
exit 0
