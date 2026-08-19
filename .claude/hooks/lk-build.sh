#!/usr/bin/env bash
# PostToolUse (Edit|Write) — marca que se tocó código y CADUCA cualquier aprobación previa.
# Nunca bloquea: solo registra. Silencioso por diseño.
ROOT="$(git rev-parse --show-toplevel 2>/dev/null || pwd)"
[ -x "$ROOT/.loopkit/core/lk" ] || exit 0
"$ROOT/.loopkit/core/lk" build >/dev/null 2>&1
exit 0
