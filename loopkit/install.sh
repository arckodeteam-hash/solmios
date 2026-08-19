#!/usr/bin/env bash
# LoopKit — instalador. Copiá la carpeta loopkit/ al repo destino y corré:
#   bash loopkit/install.sh [claude|opencode|both]     (default: both)
set -uo pipefail

MODE="${1:-both}"
SRC="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(git rev-parse --show-toplevel 2>/dev/null || pwd)"
DST="$ROOT/.loopkit"

echo "LoopKit → $ROOT   (modo: $MODE)"

# ---------- núcleo ----------
mkdir -p "$DST"
cp -r "$SRC/core" "$SRC/adapters" "$SRC/test" "$DST/"
cp "$SRC/install.sh" "$SRC/README.md" "$SRC/ACEPTACION.md" "$DST/" 2>/dev/null
chmod +x "$DST/core/lk" "$DST/core/verify.sh" "$DST/adapters/git/pre-push" \
         "$DST/test/smoke.sh" 2>/dev/null
mkdir -p "$DST/state/evidence"
for ig in '.loopkit/state/' '.loopkit/**/__pycache__/'; do
  grep -qsF "$ig" "$ROOT/.gitignore" 2>/dev/null || echo "$ig" >> "$ROOT/.gitignore"
done
find "$DST" -name __pycache__ -type d -exec rm -rf {} + 2>/dev/null || true

# comandos del proyecto: se completan una vez y mandan sobre la autodetección
if [ ! -f "$DST/commands.env" ]; then
  cat > "$DST/commands.env" <<'ENV'
# Comandos REALES de este proyecto. Dejá vacío lo que no exista — no inventes.
# Si este archivo existe, manda sobre la autodetección de verify.sh.
BUILD=""
TYPECHECK=""
LINT=""
TEST=""
# 0 = OBSERVACIÓN: el gate evalúa y reporta, pero no bloquea nada. Empezá acá.
# 1 = BLOQUEO: el fin de turno, el commit y el push se frenan si el gate no pasa.
LOOPKIT_ENFORCE=0

EXTRA=""            # p.ej. un analyzer de arquitectura
EXTRA_NAME="analyzer"   # no puede ser build/typecheck/lint/test/diff (reservados)

# Cada gate corre en su propia subshell desde la raíz del repo, con la entrada
# cerrada y con este límite de tiempo en segundos.
LOOPKIT_TIMEOUT=600
ENV
  echo "  → completá .loopkit/commands.env con los comandos reales"
  echo "  → arranca en LOOPKIT_ENFORCE=0 (observación): reporta pero NO bloquea"
fi

# ---------- que el kit no rompa el lint del proyecto ----------
# El kit deja archivos .js dentro del repo (el plugin de OpenCode y sus copias).
# Un linter configurado sobre todo el proyecto los toma y falla — no es un problema
# del proyecto, lo introduce la instalación. Los archivos de ignore por líneas se
# completan solos; las configs en JS sólo se avisan (editarlas a ciegas es peor).
KIT_PATHS=("loopkit/" ".loopkit/" ".opencode/")
append_ignore() { # append_ignore <archivo> <sufijo-glob>
  local f="$1" sfx="$2" p
  [ -f "$ROOT/$f" ] || return 0
  for p in "${KIT_PATHS[@]}"; do
    grep -qsF "$p" "$ROOT/$f" || printf '%s%s\n' "$p" "$sfx" >> "$ROOT/$f"
  done
  echo "  ✓ rutas del kit ignoradas en $f"
}
append_ignore .prettierignore ""
append_ignore .eslintignore "**"
append_ignore .stylelintignore "**"
append_ignore .npmignore ""

for cfg in eslint.config.js eslint.config.mjs eslint.config.cjs .eslintrc.json .eslintrc.js tsconfig.json; do
  if [ -f "$ROOT/$cfg" ] && ! grep -qsF ".loopkit" "$ROOT/$cfg"; then
    echo "  ! $cfg no ignora el kit — puede fallar al parsear .loopkit/…/loopkit.js" >&2
    echo "    agregá a sus ignores/exclude:  'loopkit/**', '.loopkit/**', '.opencode/**'" >&2
  fi
done

# ---------- red universal: git ----------
if [ -d "$ROOT/.git" ]; then
  cp "$DST/adapters/git/pre-push" "$ROOT/.git/hooks/pre-push"
  chmod +x "$ROOT/.git/hooks/pre-push"
  echo "  ✓ git pre-push instalado (bloquea push sin gate, con cualquier agente)"
fi

# ---------- adaptador Claude Code ----------
if [ "$MODE" = claude ] || [ "$MODE" = both ]; then
  mkdir -p "$ROOT/.claude/hooks" "$ROOT/.claude/agents" "$ROOT/.claude/commands"
  cp "$DST/adapters/claude/hooks/"*.sh "$ROOT/.claude/hooks/"
  chmod +x "$ROOT/.claude/hooks/"*.sh
  cp "$DST/adapters/claude/agents/"*.md "$ROOT/.claude/agents/"
  cp "$DST/adapters/claude/commands/"*.md  "$ROOT/.claude/commands/"
  echo "  ✓ comandos /tarea /bug /verificar disponibles"
  python3 - "$ROOT/.claude/settings.json" <<'PY'
import json, os, sys
p = sys.argv[1]
cfg = {}
if os.path.exists(p):
    try: cfg = json.load(open(p))
    except json.JSONDecodeError:
        print("  ! .claude/settings.json ilegible — no lo toco. Agregá los hooks a mano."); raise SystemExit
h = cfg.setdefault("hooks", {})
def add(evt, matcher, cmd):
    grp = h.setdefault(evt, [])
    for g in grp:
        if g.get("matcher", "") == matcher:
            for hk in g.setdefault("hooks", []):
                if hk.get("command") == cmd: return
            g["hooks"].append({"type": "command", "command": cmd, "timeout": 20}); return
    grp.append({"matcher": matcher, "hooks": [{"type": "command", "command": cmd, "timeout": 20}]})
add("PostToolUse", "Edit|Write|MultiEdit|NotebookEdit", "$CLAUDE_PROJECT_DIR/.claude/hooks/lk-build.sh")
add("SubagentStop", "", "$CLAUDE_PROJECT_DIR/.claude/hooks/lk-subagent.sh")
add("Stop", "", "$CLAUDE_PROJECT_DIR/.claude/hooks/lk-gate-stop.sh")
json.dump(cfg, open(p, "w"), indent=2)
print("  ✓ hooks registrados en .claude/settings.json (PostToolUse + SubagentStop + Stop)")
PY
  echo "  → pegá loopkit/adapters/claude/CLAUDE.snippet.md dentro de CLAUDE.md"
fi

# ---------- adaptador OpenCode ----------
if [ "$MODE" = opencode ] || [ "$MODE" = both ]; then
  mkdir -p "$ROOT/.opencode/plugins" "$ROOT/.opencode/commands" "$ROOT/.opencode/agents"
  cp "$DST/adapters/opencode/plugins/loopkit.js" "$ROOT/.opencode/plugins/"
  for f in "$DST/adapters/claude/commands/"*.md; do
    cp "$f" "$ROOT/.opencode/commands/lk-$(basename "$f")"
  done
  python3 "$DST/adapters/opencode/mkagent.py" \
    "$DST/adapters/claude/agents/lk-qa.md" "$ROOT/.opencode/agents/lk-qa.md" auditor
  python3 "$DST/adapters/opencode/mkagent.py" \
    "$DST/adapters/claude/agents/lk-dev.md" "$ROOT/.opencode/agents/lk-dev.md" dev
  echo "  ✓ plugin + comandos (/lk-tarea /lk-bug /lk-verificar) + agentes lk-qa y lk-dev"
  echo "  → pegá loopkit/adapters/opencode/AGENTS.snippet.md dentro de AGENTS.md"
fi

echo
"$DST/core/lk" status 2>/dev/null || true
echo
echo "Andamiaje puesto, en modo OBSERVACIÓN (no bloquea nada todavía)."
echo "  1. completá .loopkit/commands.env"
echo "  2. bash .loopkit/core/lk selftest        # 59 checks sobre esta instalación"
echo "  3. usá /tarea y /bug normalmente; mirá lo que reporta"
echo "  4. cuando confíes: LOOPKIT_ENFORCE=1 en .loopkit/commands.env"
