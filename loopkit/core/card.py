#!/usr/bin/env python3
"""card.py — el scorecard se llena con comandos, no escribiendo JSON a mano.

  lk card new                                  arranca uno limpio (hash + builder solos)
  lk card reviewer <nombre>                    quién audita
  lk card dim D5 85 "app.js:12 no valida null" puntuar una dimensión (o: D5 NV "motivo")
  lk card find SEC-1 D6 BLOCKER CONFIRMED app.js:2 "eval sobre input"
  lk card fixed SEC-1                          marcar un hallazgo como corregido
  lk card verdict READY|READY_WITH_RISKS|NOT_READY
  lk card show

Auditoría paralela — cada auditor corre con LOOPKIT_LANE=<carril> y escribe su
propio archivo; después se fusionan:
  LOOPKIT_LANE=seguridad lk card new
  LOOPKIT_LANE=seguridad lk card dim D6 70 "app.js:2 eval sobre input"
  lk card merge lk-qa                          fusiona todos los carriles
  lk card lanes                                qué dimensión audita cada carril
"""
import json, os, subprocess, sys

# Una sola fuente para pesos, estados y fórmula: si card.py los duplicara, el
# veredicto derivado acá y el que valida gate.py podrían discrepar en silencio.
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import gate  # noqa: E402
from gate import WEIGHTS, OPEN_STATES, CLOSED_STATES, PENALTY  # noqa: E402

ST = os.environ.get("LOOPKIT_STATE", ".loopkit/state")
LANE = os.environ.get("LOOPKIT_LANE", "").strip()
# mismo motivo que en gate.py: el estado vive en la raíz del repo, no en el CWD
if not os.path.isabs(ST):
    ST = os.path.join(gate.repo_root(), ST)
# Con LOOPKIT_LANE, cada auditor paralelo escribe su propio archivo. Sin lane se
# escribe el scorecard final. Así N auditores concurrentes no se pisan.
CARD = (os.path.join(ST, "audit", f"{LANE}.json") if LANE
        else os.path.join(ST, "scorecard.json"))
DIMS = [f"D{i}" for i in range(1, 13)]
SEVS = ("BLOCKER", "HIGH", "MEDIUM", "LOW")
STATES = ("DISCOVERED", "CONFIRMED", "FIXING", "FIXED", "VERIFIED",
          "REJECTED", "DUPLICATE", "DEFERRED")
VERDICTS = ("READY", "READY_WITH_RISKS", "NOT_READY")


# Carriles de auditoría paralela: qué dimensiones audita cada uno.
LANES = {
    "estructura": ["D1", "D2", "D3", "D12"],
    "correccion": ["D4", "D5"],
    "seguridad":  ["D6", "D9"],
    "medidas":    ["D7", "D8", "D10", "D11"],
}


def die(msg):
    print(f"error: {msg}", file=sys.stderr)
    sys.exit(2)


def here():
    return os.path.dirname(os.path.abspath(__file__))


def load():
    if not os.path.exists(CARD):
        die("no hay scorecard — corré primero: lk card new")
    with open(CARD) as f:
        return json.load(f)


def save(d):
    os.makedirs(os.path.dirname(CARD) or ST, exist_ok=True)
    with open(CARD, "w") as f:
        json.dump(d, f, indent=1, ensure_ascii=False)


def cmd_new():
    h = subprocess.run([sys.executable, os.path.join(here(), "gate.py"), "--hash"],
                       capture_output=True, text=True).stdout.strip()
    task = {}
    tp = os.path.join(ST, "task.json")
    if os.path.exists(tp):
        with open(tp) as f:
            task = json.load(f)
    save({"task": task.get("id", "adhoc"), "diff_hash": h,
          "builder": task.get("builder", "main"), "reviewer": "",
          "verdict": "NOT_READY",
          "dimensions": {d: {"score": "N/V", "source": "JUDGED", "evidence": ""} for d in DIMS},
          "findings": [], "hypotheses": [], "not_verified": [], "next_action": ""})
    if LANE:
        mine = " ".join(LANES.get(LANE, DIMS))
        print(f"carril '{LANE}' · diff {h} · te tocan: {mine}")
    else:
        print(f"scorecard nuevo · diff {h} · todas las dimensiones en N/V")
    print("puntuá solo las que inspeccionaste. Sin evidencia archivo:línea el comando rechaza.")


def cmd_reviewer(name):
    d = load()
    if name == d.get("builder"):
        die(f"'{name}' es el builder. El reviewer tiene que ser otro (usá lk-qa).")
    d["reviewer"] = name
    save(d)
    print(f"reviewer: {name}")


def cmd_dim(dim, score, evidence):
    dim = dim.upper()
    if dim not in DIMS:
        die(f"dimensión inválida '{dim}' — usá D1..D12")
    if LANE and LANE in LANES and dim not in LANES[LANE]:
        die(f"{dim} no es tuya: el carril '{LANE}' audita {' '.join(LANES[LANE])}")
    if score.upper() in ("NV", "N/V"):
        val = "N/V"
    else:
        try:
            val = float(score)
        except ValueError:
            die(f"score inválido '{score}' — un número 0-100 o NV")
        if not 0 <= val <= 100:
            die("el score va de 0 a 100")
        if val == int(val):
            val = int(val)
        if val >= 90 and not evidence.strip():
            die(f"{dim}={val} necesita evidencia citada (archivo:línea o comando). "
                "Sin evidencia va NV.")
    d = load()
    d["dimensions"][dim] = {"score": val, "source": d["dimensions"][dim].get("source", "JUDGED"),
                            "evidence": evidence}
    save(d)
    print(f"{dim} = {val}")


def cmd_find(fid, dim, sev, state, loc, summary):
    dim, sev, state = dim.upper(), sev.upper(), state.upper()
    if dim not in DIMS: die(f"dimensión inválida '{dim}'")
    if sev not in SEVS: die(f"severidad inválida '{sev}' — {'/'.join(SEVS)}")
    if state not in STATES: die(f"estado inválido '{state}'")
    if ":" not in loc:
        die(f"'{loc}' no es archivo:línea. Sin ubicación no es hallazgo — va en hypotheses.")
    d = load()
    d["findings"] = [f for f in d["findings"] if f.get("id") != fid]
    d["findings"].append({"id": fid, "dim": dim, "sev": sev, "state": state,
                          "loc": loc, "evidence": loc, "summary": summary, "fix": ""})
    save(d)
    print(f"{fid} · {sev} · {state} · {loc}")


def cmd_fixed(fid, fix):
    d = load()
    for f in d["findings"]:
        if f.get("id") == fid:
            f["state"] = "FIXED"
            f["fix"] = fix
            save(d)
            print(f"{fid} → FIXED")
            return
    die(f"no existe el hallazgo '{fid}'")


def cmd_verdict(v):
    v = v.upper().replace(" ", "_")
    if v not in VERDICTS:
        die(f"veredicto inválido '{v}' — {'/'.join(VERDICTS)}")
    d = load()
    d["verdict"] = v
    save(d)
    print(f"veredicto: {v}")


def derivar(dims_, finds_):
    """El veredicto se DERIVA de los hallazgos, no lo elige nadie. En modo orquestador
    el principal no ve los hallazgos (sólo `lk brief`), así que pedirle que lo fije
    sería pedirle un juicio a ciegas. Mismas reglas duras que el gate."""
    abiertos = [f for f in finds_
                if f["sev"] in ("BLOCKER", "HIGH") and f["state"] in OPEN_STATES]
    pw = sum(w for d, w in WEIGHTS.items() if dims_[d]["score"] != "N/V")
    gl = (sum(float(dims_[d]["score"]) * w for d, w in WEIGHTS.items()
              if dims_[d]["score"] != "N/V") / pw) if pw else 0.0
    bajas = [d for d in WEIGHTS if dims_[d]["score"] != "N/V" and float(dims_[d]["score"]) < 70]
    if abiertos or gl < 75 or pw < 60:
        return "NOT_READY", round(gl, 1), pw
    if gl >= 90 and not bajas:
        return "READY", round(gl, 1), pw
    return "READY_WITH_RISKS", round(gl, 1), pw


def _fold_lanes(adir, lanes, h):
    """Lee cada carril y fusiona: dimensión repetida → gana el score MENOR (conservador);
    hallazgo repetido → gana la severidad más alta. Devuelve (dims, findings, stale, bad)."""
    dims = {d: {"score": "N/V", "source": "JUDGED", "evidence": ""} for d in DIMS}
    findings, stale, bad = {}, [], []
    rank = {s: i for i, s in enumerate(SEVS)}   # 0 = BLOCKER = peor

    for fn in lanes:
        with open(os.path.join(adir, fn)) as f:
            lc = json.load(f)
        if lc.get("diff_hash") != h:
            stale.append(f"{fn} (diff {lc.get('diff_hash')})")
        for d, v in lc.get("dimensions", {}).items():
            if v.get("score") in (None, "", "N/V"):
                continue
            cur = dims[d]["score"]
            if cur == "N/V" or float(v["score"]) < float(cur):
                dims[d] = v
        for fd in lc.get("findings", []):
            # validar acá y no confiar: un archivo editado a mano con severidad
            # desconocida se degradaba a LOW en el gate, o hacía crashear el merge.
            sev, st = str(fd.get("sev", "")).upper(), str(fd.get("state", "")).upper()
            if sev not in SEVS or st not in STATES or fd.get("dim") not in DIMS:
                bad.append(f"{fn}:{fd.get('id','?')} (sev={fd.get('sev')} "
                           f"state={fd.get('state')} dim={fd.get('dim')})")
                continue
            fd["sev"], fd["state"] = sev, st
            prev = findings.get(fd["id"])
            if prev is None or rank[sev] < rank[prev["sev"]]:
                findings[fd["id"]] = fd
    return dims, findings, stale, bad


def cmd_merge(reviewer):
    """Fusiona los carriles paralelos en el scorecard final (el fold vive en _fold_lanes)."""
    adir = os.path.join(ST, "audit")
    if not os.path.isdir(adir):
        die("no hay carriles en .loopkit/state/audit/ — los auditores no escribieron nada")
    lanes = sorted(f for f in os.listdir(adir) if f.endswith(".json"))
    if not lanes:
        die("no hay carriles en .loopkit/state/audit/")

    h = subprocess.run([sys.executable, os.path.join(here(), "gate.py"), "--hash"],
                       capture_output=True, text=True).stdout.strip()
    task = {}
    tp = os.path.join(ST, "task.json")
    if os.path.exists(tp):
        with open(tp) as f:
            task = json.load(f)

    dims, findings, stale, bad = _fold_lanes(adir, lanes, h)
    if bad:
        die("hallazgos con datos inválidos (no se fusiona nada):\n  " + "\n  ".join(bad) +
            f"\nseveridad debe ser {'/'.join(SEVS)}; estado {'/'.join(STATES)}; dim D1..D12")
    if stale:
        die("carriles desactualizados: " + ", ".join(stale) +
            f" — el diff actual es {h}. Re-auditá: el código cambió durante la auditoría.")

    finds = list(findings.values())
    verdict, glob, pw = derivar(dims, finds)
    save({"task": task.get("id", "adhoc"), "diff_hash": h,
          "builder": task.get("builder", "main"), "reviewer": reviewer,
          "verdict": verdict, "dimensions": dims,
          "findings": finds, "hypotheses": [], "not_verified": [],
          "next_action": "", "lanes": lanes, "verdict_source": "derivado del merge"})
    print(f"fusionados {len(lanes)} carriles: {', '.join(x[:-5] for x in lanes)}")
    print(f"{len(finds)} hallazgo(s) · score {glob} · peso {pw}/100 · veredicto {verdict} (derivado)")


def cmd_show():
    d = load()
    print(f"tarea {d['task']} · builder {d['builder']} · reviewer {d['reviewer'] or '—'} "
          f"· veredicto {d['verdict']}")
    for k in DIMS:
        v = d["dimensions"][k]
        print(f"  {k:<4} {str(v['score']):>5}   {v['evidence'][:60]}")
    for f in d["findings"]:
        print(f"  {f['id']:<10} {f['sev']:<8} {f['state']:<10} {f['loc']}  {f['summary'][:40]}")


def main(argv):
    if not argv: die("falta subcomando — ver: lk card")
    c, a = argv[0], argv[1:]
    need = {"new": 0, "reviewer": 1, "dim": 3, "find": 6, "fixed": 1, "verdict": 1,
            "show": 0, "merge": 1, "lanes": 0}
    if c not in need: die(f"subcomando desconocido '{c}'")
    if len(a) < need[c]:
        die(f"faltan argumentos para '{c}' (necesita {need[c]})")
    {"new": lambda: cmd_new(),
     "reviewer": lambda: cmd_reviewer(a[0]),
     "dim": lambda: cmd_dim(a[0], a[1], a[2]),
     "find": lambda: cmd_find(a[0], a[1], a[2], a[3], a[4], a[5]),
     "fixed": lambda: cmd_fixed(a[0], a[1] if len(a) > 1 else ""),
     "verdict": lambda: cmd_verdict(a[0]),
     "show": lambda: cmd_show(),
     "merge": lambda: cmd_merge(a[0]),
     "lanes": lambda: [print(f"{k:<12} {' '.join(v)}") for k, v in LANES.items()]}[c]()


if __name__ == "__main__":
    main(sys.argv[1:])
