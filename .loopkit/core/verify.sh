#!/usr/bin/env bash
# verify.sh — mide lo que un LLM no puede alucinar: gates, deuda, alcance y secretos.
# Escribe .loopkit/state/measured.json + evidencia cruda en .loopkit/state/evidence/
# Uso: bash .loopkit/core/verify.sh [base-git]     (default: HEAD)
set -uo pipefail

BASE="${1:-}"
if [ -z "$BASE" ]; then
  BASE="$(python3 -c "
import json,os
p=os.path.join('$(git rev-parse --show-toplevel 2>/dev/null || pwd)','.loopkit','state','task.json')
print((json.load(open(p)).get('base') or 'HEAD') if os.path.exists(p) else 'HEAD')
" 2>/dev/null || echo HEAD)"
fi
ROOT="$(git rev-parse --show-toplevel 2>/dev/null || pwd)"
cd "$ROOT" || exit 1
ST="$ROOT/.loopkit/state"; EV="$ST/evidence"
mkdir -p "$EV"

pass=0; fail=0; skip=0; TEST_STATE="N/V"
declare -a ROWS

# Segundos máximos por gate. Un test colgado bloqueaba el turno entero sin límite.
LK_TIMEOUT="${LOOPKIT_TIMEOUT:-600}"   # commands.env puede definirlo
# `timeout` es de coreutils: puede faltar (macOS sin gcoreutils). Sin él se corre
# igual, pero se avisa — nunca fingir una protección que no está activa.
if command -v timeout >/dev/null 2>&1; then LK_TO="timeout $LK_TIMEOUT"
else LK_TO=""; echo "verify.sh: 'timeout' no disponible — los gates corren sin límite de tiempo" >&2; fi

run() { # run <slug> <comando>
  local slug="$1" cmd="$2" out="$EV/$1.txt" rc
  if [ -z "$cmd" ]; then
    ROWS+=("$slug|N/V|comando no detectado"); skip=$((skip+1))
    [ "$slug" = test ] && TEST_STATE="N/V"; return
  fi
  # Subshell + cd explícito: un comando como "cd backend && bun test" dejaba el cd
  # pegado y los gates siguientes corrían en el directorio equivocado.
  # </dev/null: un comando que espere entrada no puede colgar la verificación.
  # timeout: un comando que no termina tampoco.
  {
    echo "\$ $cmd"
    ( cd "$ROOT" && $LK_TO bash -c "$cmd" ) </dev/null
    rc=$?
    [ "$rc" -eq 124 ] && echo "--- LOOPKIT: cortado por timeout de ${LK_TIMEOUT}s ---"
    echo "EXIT=$rc"
  } >"$out" 2>&1
  rc="$(sed -n 's/^EXIT=//p' "$out" | tail -1)"
  if [ "$rc" = "0" ]; then ROWS+=("$slug|PASS|$out"); pass=$((pass+1)); st=PASS
  elif [ "$rc" = "124" ]; then ROWS+=("$slug|TIMEOUT|$out"); fail=$((fail+1)); st=FAIL
  else ROWS+=("$slug|FAIL|$out (exit $rc)"); fail=$((fail+1)); st=FAIL; fi
  [ "$slug" = test ] && TEST_STATE="$st"
}

has_script() { [ -f package.json ] && grep -q "\"$1\"[[:space:]]*:" package.json; }
have() { command -v "$1" >/dev/null 2>&1; }

# ---------- STACK: autodetección. Editá este bloque si tu proyecto no encaja ----------
BUILD=""; TYPECHECK=""; LINT=""; TEST=""; EXTRA=""; EXTRA_NAME="analyzer"
if [ -f "$ROOT/.loopkit/commands.env" ]; then
  # override explícito del proyecto: BUILD=... TYPECHECK=... LINT=... TEST=... EXTRA=...
  . "$ROOT/.loopkit/commands.env"
fi
if [ -n "${BUILD}${TYPECHECK}${LINT}${TEST}${EXTRA}" ]; then
  :   # el proyecto ya declaró sus comandos: no autodetectar
elif [ -f package.json ]; then
  if have bun && { [ -f bun.lockb ] || [ -f bun.lock ]; }; then PM="bun run"
  elif [ -f pnpm-lock.yaml ]; then PM="pnpm"
  elif [ -f yarn.lock ]; then PM="yarn"
  else PM="npm run"; fi
  has_script build     && BUILD="$PM build"
  has_script typecheck && TYPECHECK="$PM typecheck"
  has_script lint      && LINT="$PM lint"
  has_script test      && TEST="$PM test"
elif [ -f composer.json ]; then
  [ -x vendor/bin/phpstan ] && TYPECHECK="vendor/bin/phpstan analyse --no-progress"
  [ -x vendor/bin/pint ]    && LINT="vendor/bin/pint --test"
  if [ -x vendor/bin/pest ]; then TEST="vendor/bin/pest"
  elif [ -x vendor/bin/phpunit ]; then TEST="vendor/bin/phpunit"; fi
elif [ -f go.mod ]; then
  BUILD="go build ./..."; TYPECHECK="go vet ./..."; TEST="go test ./..."
elif [ -f Cargo.toml ]; then
  BUILD="cargo build"; TYPECHECK="cargo check"; LINT="cargo clippy -- -D warnings"; TEST="cargo test"
elif [ -f pyproject.toml ] || [ -f setup.py ]; then
  have ruff && LINT="ruff check ."; have mypy && TYPECHECK="mypy ."; have pytest && TEST="pytest -q"
fi

# Monorepo: sin manifiesto en la raíz no hay nada que autodetectar. En vez de dejar
# todo en N/V sin explicar, se dice dónde están los manifiestos para completar
# commands.env a mano — el kit no adivina comandos que no vio.
if [ -z "${BUILD}${TYPECHECK}${LINT}${TEST}${EXTRA}" ]; then
  subs="$(find . -mindepth 2 -maxdepth 2 \( -name package.json -o -name composer.json \
          -o -name go.mod -o -name Cargo.toml -o -name pyproject.toml \) \
          -not -path './.loopkit/*' -not -path './node_modules/*' 2>/dev/null | head -6)"
  if [ -n "$subs" ]; then
    echo "verify.sh: sin manifiesto en la raíz. Parece un monorepo:" >&2
    printf '%s\n' "$subs" | sed 's|^|  |' >&2
    echo "  → completá .loopkit/commands.env, p.ej. TEST=\"cd backend && bun test\"" >&2
  fi
fi
# -------------------------------------------------------------------------------------

run build     "$BUILD"
run typecheck "$TYPECHECK"
run lint      "$LINT"
run test      "$TEST"
if [ -n "$EXTRA" ]; then
  # EXTRA_NAME no puede llamarse igual que un gate reservado: con EXTRA_NAME="test"
  # un EXTRA en verde sobrescribía el estado de unos tests en rojo.
  case "$EXTRA_NAME" in
    build|typecheck|lint|test|diff)
      echo "verify.sh: EXTRA_NAME='$EXTRA_NAME' está reservado; usá otro nombre" >&2
      EXTRA_NAME="extra" ;;
  esac
  run "$EXTRA_NAME" "$EXTRA"
fi

# ---------- D10 alcance · D11 deuda · secretos (solo líneas AGREGADAS) ----------
DIFF="$EV/diff.txt"
if git rev-parse --git-dir >/dev/null 2>&1; then
  # Mismo criterio que el hash de gate.py: el andamiaje NO es código del proyecto.
  # Sin esto, D10 contaba los archivos del kit y el detector de secretos encontraba
  # sus propios patrones de ejemplo (sk-…, ghp_, AKIA) en el README y en los tests.
  EXCL=(":(exclude,top).loopkit" ":(exclude,top)loopkit"
        ":(exclude,top).claude/hooks/lk-*" ":(exclude,top).claude/agents/lk-*"
        ":(exclude,top).claude/commands/tarea.md" ":(exclude,top).claude/commands/bug.md"
        ":(exclude,top).claude/commands/verificar.md" ":(exclude,top).opencode")
  { git diff --stat "$BASE" -- ":/" "${EXCL[@]}"; echo
    git diff "$BASE" -- ":/" "${EXCL[@]}"; } >"$DIFF" 2>&1
  FILES=$(git diff --name-only "$BASE" -- ":/" "${EXCL[@]}" 2>/dev/null | grep -c . || true)
  ADDED=$(grep -c '^+[^+]' "$DIFF" || true)
  DEBT=$(grep '^+[^+]' "$DIFF" | grep -Ec 'TODO|FIXME|HACK|XXX|console\.log|var_dump|\bdd\(|@ts-ignore|eslint-disable|: *any\b' || true)
  SECRET=$(grep '^+[^+]' "$DIFF" | grep -Eic '(api[_-]?key|access[_-]?key|private[_-]?key|secret|passwd|password|token)[[:space:]]*[:=][[:space:]]*["'"'"'][^"'"'"']{8,}|sk-[A-Za-z0-9]{16,}|ghp_[A-Za-z0-9]{20,}|AKIA[0-9A-Z]{12,}|-----BEGIN [A-Z ]*PRIVATE KEY' || true)
else
  FILES=0; ADDED=0; DEBT=0; SECRET=0; echo "sin repo git" >"$DIFF"
fi
HASH="$(python3 "$ROOT/.loopkit/core/gate.py" --hash 2>/dev/null || echo "")"

D8=$( [ "$pass" -eq 0 ] && echo '"N/V"' || { [ "$fail" -eq 0 ] && echo 100 || echo 0; } )

cat >"$ST/measured.json" <<JSON
{
  "diff_hash": "$HASH",
  "gates_pass": $pass, "gates_fail": $fail, "gates_nv": $skip,
  "d8": $D8, "test_state": "$TEST_STATE",
  "files_changed": ${FILES:-0}, "lines_added": ${ADDED:-0},
  "debt_markers": ${DEBT:-0}, "secret_hits": ${SECRET:-0},
  "evidence_dir": "$EV"
}
JSON

printf '\n%-12s %-6s %s\n' "GATE" "ESTADO" "EVIDENCIA"
printf '%s\n' "------------------------------------------------------------"
for r in "${ROWS[@]}"; do IFS='|' read -r a b c <<<"$r"; printf '%-12s %-6s %s\n' "$a" "$b" "$c"; done
printf '%s\n' "------------------------------------------------------------"
printf 'D8 gates       : %s   (pass=%s fail=%s n/v=%s)\n' "$(echo "$D8" | tr -d '"')" "$pass" "$fail" "$skip"
printf 'D7 tests       : %s\n' "$TEST_STATE"
printf 'D10 alcance    : %s archivos, %s líneas agregadas\n' "${FILES:-0}" "${ADDED:-0}"
printf 'D11 deuda      : %s marcas   |   posibles secretos: %s\n' "${DEBT:-0}" "${SECRET:-0}"
printf 'diff_hash      : %s\n\n' "$HASH"

[ "$fail" -eq 0 ] || echo "FAIL: gates en rojo → D8=0 → NOT READY."
exit "$([ "$fail" -eq 0 ] && echo 0 || echo 1)"
