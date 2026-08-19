#!/usr/bin/env bash
# SubagentStop — registra que el runtime terminó un subagente.
# El payload lo emite el runtime, no el modelo: es la única señal de que un auditor
# realmente corrió. Se guarda CRUDO; el gate decide qué puede afirmar con él.
ROOT="$(git rev-parse --show-toplevel 2>/dev/null || pwd)"
LK="$ROOT/.loopkit"
[ -d "$LK/state" ] || exit 0
payload="$(cat)"
python3 - "$LK" "$payload" <<'PY'
import json, os, subprocess, sys
lk, payload = sys.argv[1], sys.argv[2]
h = subprocess.run([sys.executable, os.path.join(lk, "core", "gate.py"), "--hash"],
                   capture_output=True, text=True, cwd=os.path.dirname(lk)).stdout.strip()
try:
    raw = json.loads(payload)
except Exception:
    raw = {"unparsed": payload[:2000]}
with open(os.path.join(lk, "state", "subagents.jsonl"), "a") as f:
    f.write(json.dumps({"hash": h, "payload": raw}) + "\n")
PY
exit 0
