#!/usr/bin/env bash
# Suite de humo del LoopKit. Crea un repo desechable, instala y verifica los mecanismos.
# Uso: bash loopkit/test/smoke.sh
set -uo pipefail
SRC="$(cd "$(dirname "$0")/.." && pwd)"
T="$(mktemp -d)"; trap 'rm -rf "$T"' EXIT
cd "$T"; git init -q .; git config user.email t@t; git config user.name t
echo '{"name":"a","scripts":{"typecheck":"true","lint":"true","test":"true"}}' > package.json
echo v1 > app.js; git add -A; git commit -qm base
if [ ! -f "$SRC/install.sh" ]; then
  echo "smoke: no encuentro $SRC/install.sh — el kit está incompleto" >&2; exit 2
fi
mkdir -p loopkit
# sin state/: arrastrar el estado de otra tarea daría resultados falsos
( cd "$SRC" && tar cf - --exclude=state --exclude=__pycache__ . ) | ( cd loopkit && tar xf - )
bash loopkit/install.sh both >/dev/null 2>&1
if [ ! -x .loopkit/core/lk ]; then echo "smoke: la instalación falló" >&2; exit 2; fi
LK=.loopkit/core; ok=0; ko=0
t(){ if [ "$2" = "$3" ]; then echo "  ✓ $1"; ok=$((ok+1)); else echo "  ✗ $1 (esperado '$3', dio '$2')"; ko=$((ko+1)); fi; }

g(){ bash .loopkit/core/lk gate 2>&1; }          # sin pipe: pipefail no interfiere
blocks(){ case "$(g)" in *"$1"*) return 0;; *) return 1;; esac; }

sa(){ echo "{\"hook_event_name\":\"SubagentStop\",\"agent_type\":\"$1\"}" | bash .claude/hooks/lk-subagent.sh; }

card(){ python3 - "$1" "$2" "$3" <<'PY'
import json,subprocess,sys
verdict,state,reviewer=sys.argv[1],sys.argv[2],sys.argv[3]
h=subprocess.run(["python3",".loopkit/core/gate.py","--hash"],capture_output=True,text=True).stdout.strip()
dims={f"D{i}":{"score":100,"source":"JUDGED","evidence":"app.js:1"} for i in range(1,13)}
f=[] if state=="NONE" else [{"id":"SEC-001","dim":"D6","sev":"BLOCKER","state":state,
   "loc":"app.js:2","evidence":"e","summary":"eval sobre input"}]
json.dump({"task":"T-1","diff_hash":h,"builder":"main","reviewer":reviewer,"verdict":verdict,
 "dimensions":dims,"findings":f,"hypotheses":[],"not_verified":[],"next_action":""},
 open(".loopkit/state/scorecard.json","w"),indent=1)
PY
}

bash $LK/lk start T-1 x >/dev/null
t "start → PLAN"  "$(python3 -c "import json;print(json.load(open('.loopkit/state/task.json'))['phase'])")" PLAN
printf 'const x = eval(i);\nconst k="sk-abcdefghij1234567890";\n' >> app.js
bash .claude/hooks/lk-build.sh
t "hook → BUILD"  "$(python3 -c "import json;print(json.load(open('.loopkit/state/task.json'))['phase'])")" BUILD
bash $LK/verify.sh >/dev/null 2>&1
t "detecta secreto en el diff" "$(python3 -c "import json;print(json.load(open('.loopkit/state/measured.json'))['secret_hits'])")" 1
bash $LK/lk gate >/dev/null 2>&1; t "bloquea sin scorecard" "$?" 1
sa lk-qa
card READY NONE main;    blocks "auto-aprobación"; t "bloquea auto-aprobación" "$?" 0
card NOT_READY CONFIRMED lk-qa; blocks "BLOCKER abierto"; t "bloquea BLOCKER abierto" "$?" 0
card READY FIXED lk-qa;  blocks "no cambió desde que se confirmó"; t "bloquea fix sin diff" "$?" 0
python3 -c "
import json;d=json.load(open('.loopkit/state/scorecard.json'));d['dimensions']['D6']={'score':100,'source':'JUDGED','evidence':''}
json.dump(d,open('.loopkit/state/scorecard.json','w'))"
blocks "sin evidencia citada"; t "bloquea score alto sin evidencia" "$?" 0
python3 -c "
import re;s=open('app.js').read().replace('eval(i)','JSON.parse(i)').replace('sk-abcdefghij1234567890','')
open('app.js','w').write(s)"
bash .claude/hooks/lk-build.sh; bash $LK/verify.sh >/dev/null 2>&1; card READY FIXED lk-qa
sa lk-qa
bash $LK/lk ship >/dev/null 2>&1; t "cierra con fix real y reviewer distinto" "$?" 0
card READY NONE lk-qa; echo 'nuevo();' >> app.js
blocks "quedó viejo"; t "caduca si el código cambia tras aprobar" "$?" 0

# ---- hueco del subagente ----
rm -f .loopkit/state/subagents.jsonl
bash $LK/lk start T-2 x >/dev/null; echo 'const q=1;' >> app.js
bash $LK/verify.sh >/dev/null 2>&1
bash $LK/lk card new >/dev/null; bash $LK/lk card reviewer lk-qa >/dev/null
for d in D1 D2 D4 D5 D6 D9 D12 D7 D8 D10 D11; do bash $LK/lk card dim $d 100 "app.js:1" >/dev/null; done
bash $LK/lk card dim D3 NV "sin hermano" >/dev/null; bash $LK/lk card verdict READY >/dev/null
blocks "ningún subagente corrió"; t "bloquea reviewer nombrado que nunca corrió" "$?" 0
sa lk-qa
case "$(g)" in *"nombrado-por-el-runtime"*) r=0;; *) r=1;; esac
t "reconoce al auditor nombrado por el runtime" "$r" 0
bash $LK/lk gate >/dev/null 2>&1; t "cierra con auditor ejecutado" "$?" 0
rm -f .loopkit/state/subagents.jsonl
LOOPKIT_REQUIRE_SUBAGENT=0 LOOPKIT_STATE=.loopkit/state python3 $LK/gate.py >/dev/null 2>&1
t "escape hatch LOOPKIT_REQUIRE_SUBAGENT=0" "$?" 0

# ---- auditoría paralela ----
for l in estructura correccion seguridad medidas; do ( LOOPKIT_LANE=$l bash $LK/lk card new >/dev/null ) & done; wait
t "4 carriles concurrentes sin pisarse" "$(ls .loopkit/state/audit/*.json | wc -l)" 4
LOOPKIT_LANE=estructura bash $LK/lk card dim D6 100 "x" >/dev/null 2>&1
t "un carril no puede puntuar dimensión ajena" "$?" 2
LOOPKIT_LANE=seguridad bash $LK/lk card dim D6 40 "app.js:1 eval" >/dev/null
LOOPKIT_LANE=seguridad bash $LK/lk card find S-1 D6 BLOCKER CONFIRMED app.js:1 "eval" >/dev/null
LOOPKIT_LANE=estructura bash $LK/lk card dim D1 100 "app.js:1 ok" >/dev/null
bash $LK/lk card merge lk-qa >/dev/null 2>&1; t "merge fusiona los carriles" "$?" 0
t "merge conserva el score bajo" "$(python3 -c "import json;print(json.load(open('.loopkit/state/scorecard.json'))['dimensions']['D6']['score'])")" 40
t "merge conserva el hallazgo" "$(python3 -c "import json;print(len(json.load(open('.loopkit/state/scorecard.json'))['findings']))")" 1
echo 'tarde();' >> app.js
LOOPKIT_LANE=medidas bash $LK/lk card new >/dev/null
bash $LK/lk card merge lk-qa >/dev/null 2>&1; t "merge rechaza carriles desactualizados" "$?" 2

# ---- regresiones de bugs corregidos ----
mkdir -p sub/dir; echo 'x' > sub/dir/f.js
H_ROOT="$(python3 $LK/gate.py --hash)"
H_SUB="$(cd sub/dir && python3 ../../.loopkit/core/gate.py --hash)"
t "hash invariante al directorio (BUG-A)" "$H_SUB" "$H_ROOT"

LOOPKIT_LANE=seguridad bash $LK/lk card new >/dev/null
echo 'toque' >> app.js; bash $LK/lk build
t "build caduca los carriles (BUG-C)" "$(ls .loopkit/state/audit 2>/dev/null | wc -l)" 0

bash $LK/verify.sh >/dev/null 2>&1
LOOPKIT_LANE=seguridad bash $LK/lk card new >/dev/null
python3 -c "
import json;p='.loopkit/state/audit/seguridad.json';d=json.load(open(p))
d['findings']=[{'id':'Z','dim':'D6','sev':'CRITICO','state':'CONFIRMED','loc':'app.js:1','summary':'x'}]
json.dump(d,open(p,'w'))"
bash $LK/lk card merge lk-qa >/dev/null 2>&1
t "merge rechaza severidad inválida (BUG-H2)" "$?" 2

rm -rf .loopkit/state/audit
bash $LK/lk card new >/dev/null
python3 -c "
import json;p='.loopkit/state/scorecard.json';d=json.load(open(p))
d['reviewer']='lk-qa';d['verdict']='READY'
d['dimensions']={'D%d'%i:{'score':100,'source':'JUDGED','evidence':'app.js:1'} for i in range(1,13)}
d['findings']=[{'id':'Z','dim':'D6','sev':'CRITICO','state':'CONFIRMED','loc':'app.js:1','summary':'x'}]
json.dump(d,open(p,'w'))"
sa lk-qa
blocks "severidad 'CRITICO' desconocida"; t "gate reporta severidad desconocida (BUG-H1)" "$?" 0
case "$(g)" in *"D6: score declarado 100 pero sus hallazgos dan 70"*) r=0;; *) r=1;; esac
t "severidad desconocida penaliza como BLOCKER, no como LOW" "$r" 0

python3 -c "open('big.bin','wb').write(b'A'*400000)"
HB1="$(python3 $LK/gate.py --hash)"
python3 -c "
import os
st=os.stat('big.bin'); d=bytearray(b'A'*400000); d[10]=66
open('big.bin','wb').write(bytes(d)); os.utime('big.bin',ns=(st.st_atime_ns,st.st_mtime_ns))"
case "$(python3 $LK/gate.py --hash)" in "$HB1") r=1;; *) r=0;; esac
t "detecta cambio en untracked grande con mismo tamaño y mtime" "$r" 0
rm -f big.bin

# ---- regresiones de verify.sh y del instalador ----
t "install copia test/ ejecutable (BUG-M)" "$([ -x .loopkit/test/smoke.sh ] && echo si)" si

mkdir -p sub_a sub_b; echo m > sub_a/m; echo m > sub_b/m
printf 'BUILD=""\nTYPECHECK="cd sub_a && pwd"\nLINT="cd sub_b && pwd"\nTEST="pwd"\nEXTRA=""\nEXTRA_NAME="analyzer"\n' > .loopkit/commands.env
bash $LK/verify.sh >/dev/null 2>&1
t "el cd de un gate no contamina al siguiente (BUG-I)" \
  "$(basename "$(sed -n '2p' .loopkit/state/evidence/lint.txt)")" sub_b
t "el gate siguiente vuelve a la raíz (BUG-I)" \
  "$(sed -n '2p' .loopkit/state/evidence/test.txt)" "$(pwd -P)"

printf 'BUILD=""\nTYPECHECK=""\nLINT=""\nTEST="false"\nEXTRA="true"\nEXTRA_NAME="test"\n' > .loopkit/commands.env
bash $LK/verify.sh >/dev/null 2>&1
t "EXTRA_NAME reservado no pisa el estado de tests (BUG-J)" \
  "$(python3 -c "import json;print(json.load(open('.loopkit/state/measured.json'))['test_state'])")" FAIL

if command -v timeout >/dev/null 2>&1; then
  printf 'BUILD=""\nTYPECHECK=""\nLINT=""\nTEST="sleep 30"\nEXTRA=""\nEXTRA_NAME="analyzer"\n' > .loopkit/commands.env
  LOOPKIT_TIMEOUT=2 timeout 25 bash $LK/verify.sh >/dev/null 2>&1
  t "un gate colgado se corta por timeout (BUG-L)" \
    "$(python3 -c "import json;print(json.load(open('.loopkit/state/measured.json'))['test_state'])")" FAIL
fi

printf 'BUILD=""\nTYPECHECK=""\nLINT=""\nTEST="cat"\nEXTRA=""\nEXTRA_NAME="analyzer"\n' > .loopkit/commands.env
timeout 15 bash $LK/verify.sh >/dev/null 2>&1
t "un gate que espera entrada no cuelga (BUG-K)" "$?" 0
rm -f .loopkit/commands.env

# ---- modo orquestador: salida acotada y dos minions ----
t "instala los dos minions en Claude Code" \
  "$(ls .claude/agents/lk-dev.md .claude/agents/lk-qa.md 2>/dev/null | wc -l)" 2
t "instala los dos minions en OpenCode" \
  "$(ls .opencode/agents/lk-dev.md .opencode/agents/lk-qa.md 2>/dev/null | wc -l)" 2
t "el auditor de OpenCode no puede escribir" \
  "$(grep -c 'write: false' .opencode/agents/lk-qa.md)" 1
t "el auditor de OpenCode no puede delegar" \
  "$(grep -c 'task: false' .opencode/agents/lk-qa.md)" 1
t "el implementador de OpenCode sí puede escribir" \
  "$(grep -c 'write: true' .opencode/agents/lk-dev.md)" 1
python3 .loopkit/adapters/opencode/mkagent.py .claude/agents/lk-qa.md /tmp/x.md perfil-inventado >/dev/null 2>&1
t "mkagent rechaza un perfil desconocido" "$?" 2

BR="$(bash $LK/lk brief 2>&1)"
t "lk brief no pasa de 5 líneas" "$([ "$(printf '%s\n' "$BR" | wc -l)" -le 5 ] && echo si)" si
case "$BR" in *"BLOCK"*|*"PASS"*) r=0;; *) r=1;; esac
t "lk brief dice BLOCK o PASS" "$r" 0
t "lk brief usa rutas relativas" "$(printf '%s' "$BR" | grep -c '/tmp/')" 0

# ---- veredicto derivado y estado de una sola tarea ----
rm -rf .loopkit/state/audit
for l in estructura correccion seguridad medidas; do LOOPKIT_LANE=$l bash $LK/lk card new >/dev/null; done
for d in D1 D2 D3 D12; do LOOPKIT_LANE=estructura bash $LK/lk card dim $d 100 "app.js:1" >/dev/null; done
for d in D4 D5;         do LOOPKIT_LANE=correccion bash $LK/lk card dim $d 100 "app.js:1" >/dev/null; done
for d in D6 D9;         do LOOPKIT_LANE=seguridad  bash $LK/lk card dim $d 100 "app.js:1" >/dev/null; done
for d in D7 D8 D10 D11; do LOOPKIT_LANE=medidas    bash $LK/lk card dim $d 100 "evidence/" >/dev/null; done
bash $LK/lk card merge lk-qa >/dev/null
t "el merge deriva READY cuando está limpio" \
  "$(python3 -c "import json;print(json.load(open('.loopkit/state/scorecard.json'))['verdict'])")" READY
LOOPKIT_LANE=seguridad bash $LK/lk card find G D6 BLOCKER CONFIRMED app.js:1 "grave" >/dev/null
bash $LK/lk card merge lk-qa >/dev/null
t "el merge deriva NOT_READY con un BLOCKER abierto" \
  "$(python3 -c "import json;print(json.load(open('.loopkit/state/scorecard.json'))['verdict'])")" NOT_READY
t "el veredicto queda marcado como derivado" \
  "$(python3 -c "import json;print(json.load(open('.loopkit/state/scorecard.json')).get('verdict_source',''))")" "derivado del merge"
t "card.py y gate.py comparten pesos" \
  "$(python3 -c "
import sys; sys.path.insert(0,'.loopkit/core')
import gate, card
print('ok' if card.WEIGHTS is gate.WEIGHTS else 'DIVERGEN')")" ok

bash $LK/lk build
bash $LK/lk start T-OTRA otra >/dev/null 2>&1
t "no pisa una tarea en curso" "$?" 2
LOOPKIT_FORCE=1 bash $LK/lk start T-OTRA otra >/dev/null 2>&1
t "LOOPKIT_FORCE=1 sí la descarta" "$?" 0

# ---- score del sistema: lk audit ----
AUD="$(mktemp -d)"; ( cd "$AUD" && git init -q . && git config user.email t@t && git config user.name t
  echo '{"name":"a","scripts":{"test":"true"}}' > package.json && echo v1 > a.js
  git add -A && git commit -qm c1 >/dev/null && echo v2 > b.js && git add -A && git commit -qm c2 >/dev/null
  cp -r "$SRC" ./loopkit && bash loopkit/install.sh claude >/dev/null 2>&1
  bash .loopkit/core/lk audit >/dev/null 2>&1
  python3 -c "import json;print(json.load(open('.loopkit/state/task.json'))['base'])" > /tmp/lk_ab
  bash .loopkit/core/verify.sh 2>/dev/null | grep 'D10 alcance' | sed 's/.*: \([0-9]*\) archivos.*/\1/' > /tmp/lk_an
  bash .loopkit/core/lk audit HEAD~1 >/dev/null 2>&1
  bash .loopkit/core/verify.sh 2>/dev/null | grep 'D10 alcance' | sed 's/.*: \([0-9]*\) archivos.*/\1/' > /tmp/lk_an1
  bash .loopkit/core/lk start T-B x --base HEAD >/dev/null 2>&1
  python3 -c "import json;print(json.load(open('.loopkit/state/task.json'))['base'])" > /tmp/lk_bh
  bash .loopkit/core/lk start T-Z z --base no-existe >/dev/null 2>&1; echo $? > /tmp/lk_bad )
t "lk audit sin ref usa el árbol vacío" "$(cut -c1-8 /tmp/lk_ab)" 4b825dc6
t "lk audit sin ref cubre todo el repo" "$(cat /tmp/lk_an)" 3
t "lk audit <ref> acota al rango pedido" "$(cat /tmp/lk_an1)" 1
t "--base <ref> no se pisa con HEAD" "$(cut -c1-8 /tmp/lk_bh)" "$( cd "$AUD" && git rev-parse HEAD | cut -c1-8 )"
t "--base con ref inválida falla claro" "$(cat /tmp/lk_bad)" 2
rm -rf "$AUD" /tmp/lk_ab /tmp/lk_an /tmp/lk_an1 /tmp/lk_bh /tmp/lk_bad

# ---- el kit no se cuenta a sí mismo en el diff ----
bash $LK/verify.sh >/dev/null 2>&1
t "el detector de secretos no se dispara con los patrones del propio kit" \
  "$(python3 -c "import json;print(json.load(open('.loopkit/state/measured.json'))['secret_hits'])")" 0
t "el andamiaje no cuenta como archivos de la tarea" \
  "$(grep -c '^+++ b/\.loopkit/\|^+++ b/loopkit/' .loopkit/state/evidence/diff.txt || true)" 0

# ---- el kit no rompe el lint del proyecto ----
LINTED="$(mktemp -d)"; ( cd "$LINTED" && git init -q . && git config user.email t@t && git config user.name t
  echo '{}' > package.json && printf 'dist/\n' > .prettierignore && printf 'dist/**\n' > .eslintignore
  printf 'export default [{ ignores: ["dist/**"] }]\n' > eslint.config.js
  echo v1 > app.js && git add -A && git commit -qm base >/dev/null
  cp -r "$SRC" ./loopkit && bash loopkit/install.sh both > /tmp/lk_inst.txt 2>&1 )
t "completa .prettierignore con las rutas del kit" "$(grep -c '.loopkit/' "$LINTED/.prettierignore")" 1
t "completa .eslintignore con las rutas del kit" "$(grep -c '.loopkit/\*\*' "$LINTED/.eslintignore")" 1
t "avisa sobre eslint.config.js (no lo edita a ciegas)" \
  "$(grep -c 'no ignora el kit' /tmp/lk_inst.txt)" 1
t "no duplica si se reinstala" \
  "$( cd "$LINTED" && bash loopkit/install.sh both >/dev/null 2>&1; grep -c '^loopkit/$' .prettierignore )" 1
rm -rf "$LINTED" /tmp/lk_inst.txt

# ---- convivencia con repos reales ----
mkdir -p sub/dir                       # precondición: el subdirectorio y un scorecard
bash $LK/lk card new >/dev/null
( cd sub/dir && LOOPKIT_STATE=.loopkit/state python3 ../../.loopkit/core/card.py show >/dev/null 2>&1 )
t "card.py encuentra el estado desde un subdirectorio" "$?" 0

t "el hook de build cubre MultiEdit" \
  "$(python3 -c "
import json;h=json.load(open('.claude/settings.json'))['hooks']['PostToolUse']
print('si' if any('MultiEdit' in g.get('matcher','') for g in h) else 'no')")" si

DIRTY="$(mktemp -d)"; ( cd "$DIRTY" && git init -q . && git config user.email t@t && git config user.name t
  mkdir -p backend frontend && echo '{}' > backend/package.json && echo '{}' > frontend/package.json
  echo v1 > app.js && git add -A && git commit -qm base >/dev/null
  cp -r "$SRC" ./loopkit && bash loopkit/install.sh claude >/dev/null 2>&1
  for i in 1 2 3 4 5; do echo "sucio $i" >> app.js; done          # árbol sucio previo
  bash .loopkit/core/lk start T-D x >/dev/null 2>&1
  B="$(python3 -c "import json;print(json.load(open('.loopkit/state/task.json'))['base'])")"
  git diff --name-only "$B" | wc -l > /tmp/lk_dirty_before
  echo 'de la tarea' >> frontend/package.json
  git diff --name-only "$B" | wc -l > /tmp/lk_dirty_after
  bash .loopkit/core/verify.sh 2>&1 >/dev/null | grep -c 'monorepo' > /tmp/lk_mono )
t "una tarea nueva no arrastra los cambios previos del árbol" "$(cat /tmp/lk_dirty_before)" 0
t "sí registra el cambio propio de la tarea" "$(cat /tmp/lk_dirty_after)" 1
t "avisa cuando es un monorepo sin manifiesto en la raíz" "$(cat /tmp/lk_mono)" 1
rm -rf "$DIRTY" /tmp/lk_dirty_before /tmp/lk_dirty_after /tmp/lk_mono

# ---- modo observación ----
# precondición: el hook Stop sólo actúa en fase BUILD/VERIFY. Sin esto los checks
# pasarían porque el hook sale temprano, no por el modo.
echo 'obs();' >> app.js; bash $LK/lk build
t "precondición: fase BUILD" \
  "$(python3 -c "import json;print(json.load(open('.loopkit/state/task.json'))['phase'])")" BUILD
printf 'LOOPKIT_ENFORCE=0\n' >> .loopkit/commands.env
case "$(bash $LK/lk status)" in *OBSERVACIÓN*) r=0;; *) r=1;; esac
t "status avisa que está en observación" "$r" 0
case "$(bash $LK/lk brief)" in *"modo=observacion"*) r=0;; *) r=1;; esac
t "brief avisa el modo" "$r" 0
OBS="$(echo '{"stop_hook_active":false}' | bash .claude/hooks/lk-gate-stop.sh 2>/dev/null)"
t "el hook Stop no bloquea en observación" "$([ -z "$OBS" ] && echo si)" si
bash .git/hooks/pre-push >/dev/null 2>&1
t "el pre-push no bloquea en observación" "$?" 0
sed -i 's/LOOPKIT_ENFORCE=0/LOOPKIT_ENFORCE=1/' .loopkit/commands.env
BLK="$(echo '{"stop_hook_active":false}' | bash .claude/hooks/lk-gate-stop.sh 2>/dev/null)"
case "$BLK" in *'"decision": "block"'*) r=0;; *) r=1;; esac
t "al activar bloqueo, el hook vuelve a bloquear" "$r" 0
bash .git/hooks/pre-push >/dev/null 2>&1
t "y el pre-push también" "$?" 1
sed -i '/LOOPKIT_ENFORCE/d' .loopkit/commands.env

# ---- red de git: sobrevive a un clone ----
git add -A >/dev/null 2>&1; git commit -qm kit >/dev/null 2>&1
CLONE="$(mktemp -d)"; git clone -q . "$CLONE" 2>/dev/null
t "un clon no trae el hook (git nunca clona hooks)" "$([ -f "$CLONE/.git/hooks/pre-push" ] && echo si || echo no)" no
( cd "$CLONE" && bash .loopkit/core/lk start T-C x >/dev/null 2>&1 )
t "lk reinstala el hook en el clon" "$([ -x "$CLONE/.git/hooks/pre-push" ] && echo si)" si
printf '#!/bin/sh\necho ajeno\n' > "$CLONE/.git/hooks/pre-push"; chmod +x "$CLONE/.git/hooks/pre-push"
AJENO="$( cd "$CLONE" && bash .loopkit/core/lk gate 2>&1 )"
case "$AJENO" in *"pre-push ajeno"*) r=0;; *) r=1;; esac
t "avisa si hay un pre-push ajeno en vez de pisarlo" "$r" 0
t "no pisa el hook ajeno" "$(grep -c ajeno "$CLONE/.git/hooks/pre-push")" 1
rm -rf "$CLONE"

# ---- plugin de OpenCode: se ejecuta de verdad ----
if command -v node >/dev/null 2>&1 && [ -f .loopkit/test/opencode-plugin.mjs ]; then
  node .loopkit/test/opencode-plugin.mjs "$PWD" >/dev/null 2>&1
  t "plugin de OpenCode: 14 checks de comportamiento" "$?" 0
else
  echo "  · plugin de OpenCode: omitido (node no disponible)"
fi

echo; echo "RESULTADO: $ok ok, $ko fallos"; [ "$ko" -eq 0 ]
