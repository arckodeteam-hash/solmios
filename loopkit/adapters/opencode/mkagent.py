#!/usr/bin/env python3
"""Genera .opencode/agents/<name>.md desde el agente de Claude Code.
El prompt es uno solo; sólo cambia el frontmatter de cada runtime.

VERIFICADO contra opencode 1.18.11 con `opencode debug agent`:
el bloque `permissions: [{action,resource,effect}]` es IGNORADO — no genera ninguna
regla. El control real es la clave `tools:`.
Catálogo de tools de esa versión: bash, council_review, edit, glob, grep, invalid,
question, read, skill, task, todowrite, webfetch, write.

Uso: mkagent.py <origen.md> <destino.md> <perfil>     perfil = auditor | dev
"""
import sys

# El auditor no escribe (edit/write), no delega (task — si no, le pediría a otro
# agente que escriba por él) y no sale a internet con el código del repo (webfetch).
PERFILES = {
    "auditor": {
        "desc": ("Auditor read-only del LoopKit. Verifica con evidencia real (comandos "
                 "ejecutados, no promesas) y carga el scorecard con `lk card`. Es el "
                 "unico que puede aprobar: quien escribio el codigo no vota."),
        "tools": {"write": False, "edit": False, "task": False, "webfetch": False,
                  "bash": True, "read": True, "grep": True, "glob": True},
    },
    "dev": {
        "desc": ("Minion implementador del LoopKit. Escribe el codigo de una tarea o "
                 "corrige lo que el gate reporta, y devuelve UNA linea. Existe para que "
                 "el orquestador no gaste su contexto leyendo archivos ni diffs."),
        "tools": {"write": True, "edit": True, "task": False, "webfetch": False,
                  "bash": True, "read": True, "grep": True, "glob": True},
    },
}


def main():
    if len(sys.argv) < 4:
        print("uso: mkagent.py <origen.md> <destino.md> <auditor|dev>", file=sys.stderr)
        return 2
    src, dst, perfil = sys.argv[1], sys.argv[2], sys.argv[3]
    if perfil not in PERFILES:
        print(f"perfil desconocido '{perfil}' — {'/'.join(PERFILES)}", file=sys.stderr)
        return 2
    cfg = PERFILES[perfil]
    raw = open(src).read()
    body = raw.split("---", 2)[2].lstrip("\n") if raw.startswith("---") else raw
    tools = "\n".join(f"  {k}: {str(v).lower()}" for k, v in cfg["tools"].items())
    front = f"---\ndescription: >\n  {cfg['desc']}\nmode: subagent\ntools:\n{tools}\n---\n\n"
    open(dst, "w").write(front + body)
    print(f"  ✓ {dst}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
