#!/usr/bin/env python3
"""gate.py — decide si una tarea puede cerrarse. Mecánico, no opinable.

Lee   .loopkit/state/{task,measured,scorecard}.json
Sale  exit 0 = PASS · exit 1 = BLOCK (razones a stdout, una por línea)

Regla central: el score NO se acepta como viene. Se RECOMPUTA desde los hallazgos.
Si el agente declaró 95 y sus propios hallazgos dan 71, el gate lo rechaza por
inconsistente. Eso convierte "inflar el score" en un fallo detectable, no en una
opinión discutible.
"""
import json, os, subprocess, sys

ST = os.environ.get("LOOPKIT_STATE", ".loopkit/state")


# Archivos untracked por encima de este tamaño no se leen enteros: se hashean por
# tamaño + mtime + los primeros y últimos SAMPLE bytes. gate.py corre en el hook Stop
# de CADA turno; leer cientos de MB de untracked (node_modules sin ignorar) costaba
# segundos por turno. El muestreo mantiene el costo acotado y aun así detecta un
# cambio de contenido que conserve tamaño y mtime.
BIG_FILE = 256 * 1024
SAMPLE = 64 * 1024

_ROOT = None


def repo_root():
    """Raíz del repo. TODO comando git se ejecuta desde acá: si se corriera desde el
    CWD, el pathspec y las rutas de untracked serían relativas y el hash cambiaría
    según el directorio desde el que se invoque."""
    global _ROOT
    if _ROOT is None:
        r = subprocess.run(["git", "rev-parse", "--show-toplevel"],
                           capture_output=True, text=True)
        _ROOT = r.stdout.strip() if r.returncode == 0 and r.stdout.strip() else os.getcwd()
    return _ROOT

WEIGHTS = {"D1":10,"D2":10,"D3":8,"D4":8,"D5":15,"D6":12,
           "D7":12,"D8":10,"D9":5,"D10":4,"D11":3,"D12":3}
PENALTY = {"BLOCKER":30,"HIGH":15,"MEDIUM":7,"LOW":2}
OPEN_STATES  = {"DISCOVERED","CONFIRMED","FIXING","DEFERRED"}
CLOSED_STATES= {"FIXED","VERIFIED","REJECTED","DUPLICATE"}
TOLERANCE = 5          # margen permitido entre score declarado y recomputado


def load(name):
    # ST puede venir relativo: resolverlo contra la raíz del repo, no contra el CWD.
    # Si no, `lk` invocado desde un subdirectorio no encontraba el estado y caía a
    # valores por defecto — el hash dejaba de ser invariante al directorio.
    base = ST if os.path.isabs(ST) else os.path.join(repo_root(), ST)
    p = os.path.join(base, name)
    if not os.path.exists(p):
        return None
    try:
        with open(p) as f:
            return json.load(f)
    except (json.JSONDecodeError, OSError) as e:
        return {"__error__": str(e)}


def task_base():
    """Commit desde el que arrancó la tarea. Anclar a HEAD sería un error: al
    commitear, el diff se vacía y el hash se congelaría para siempre."""
    t = load("task.json") or {}
    base = t.get("base")
    if base:
        ok = subprocess.run(["git", "cat-file", "-e", base + "^{commit}"],
                            capture_output=True, cwd=repo_root())
        if ok.returncode == 0:
            return base
    return "HEAD"


def current_diff_hash():
    """Hash del código de la tarea. Si el código cambia, toda evidencia previa caduca."""
    root = repo_root()
    try:
        # ':(exclude).loopkit' se resuelve desde la raíz gracias a cwd=root, no desde
        # el CWD del invocante. Representa el CÓDIGO del proyecto, no el andamiaje.
        d = subprocess.run(["git", "diff", task_base(), "--", ":/", ":(exclude,top).loopkit"],
                           capture_output=True, timeout=30, cwd=root)
        u = subprocess.run(["git", "ls-files", "-o", "--exclude-standard", "--full-name", ":/"],
                           capture_output=True, text=True, timeout=30, cwd=root)
        blob = d.stdout
        for f in sorted(x for x in u.stdout.splitlines() if x and not x.startswith(".loopkit/")):
            full = os.path.join(root, f)
            try:
                st = os.stat(full)
                if st.st_size > BIG_FILE:
                    blob += f"{f}\0{st.st_size}\0{st.st_mtime_ns}".encode()
                    with open(full, "rb") as fh:
                        blob += fh.read(SAMPLE)
                        fh.seek(-SAMPLE, os.SEEK_END)
                        blob += fh.read(SAMPLE)
                    continue
                with open(full, "rb") as fh:
                    blob += f.encode() + b"\0" + fh.read()
            except OSError:
                pass
        import hashlib
        return hashlib.sha256(blob).hexdigest()[:16]
    except Exception:
        return None


def recompute(findings):
    """score por dimensión desde los hallazgos ABIERTOS. Idéntico a RUBRICA.md."""
    dims = {d: 100 for d in WEIGHTS}
    for f in findings:
        if f.get("state", "DISCOVERED").upper() in CLOSED_STATES:
            continue
        d = f.get("dim")
        if d not in dims:
            continue
        # una severidad desconocida NO se degrada a LOW: se trata como lo peor.
        # Degradarla en silencio hacía desaparecer hallazgos graves mal etiquetados.
        sev = f.get("sev", "LOW").upper()
        dims[d] = max(0, dims[d] - PENALTY.get(sev, PENALTY["BLOCKER"]))
    return dims


def main():
    brief = "--brief" in sys.argv
    reasons = []
    task = load("task.json")
    meas = load("measured.json")
    card = load("scorecard.json")

    # rutas relativas: en modo brief las absolutas se comen la línea entera
    stat_dir = os.path.relpath(ST, repo_root()) if os.path.isabs(ST) else ST
    for name, obj in (("task.json", task), ("measured.json", meas), ("scorecard.json", card)):
        if obj is None:
            reasons.append(f"falta {stat_dir}/{name} — corré `lk verify` y que el auditor cargue el scorecard")
        elif "__error__" in obj:
            reasons.append(f"{name} ilegible: {obj['__error__']}")
    if reasons:
        if brief:
            print(f"BLOCK motivos={len(reasons)}")
            for r in reasons[:3]:
                print("- " + (r[:90] + "…" if len(r) > 90 else r))
        else:
            print("\n".join(reasons))
        return 1

    # --- 1. la evidencia tiene que corresponder al código de AHORA -------------
    now = current_diff_hash()
    if now is None:
        reasons.append("no se pudo calcular el hash del diff (¿repo git?) — evidencia no anclable")
    else:
        for n, o in (("measured", meas), ("scorecard", card)):
            h = o.get("diff_hash")
            if h != now:
                reasons.append(
                    f"{n}.json quedó viejo: fue hecho sobre el diff {h or '?'} y el actual es {now}. "
                    "El código cambió después de verificar → re-verificá.")

    # --- 2. gates ejecutables --------------------------------------------------
    if meas.get("gates_fail", 1) != 0:
        reasons.append(f"{meas.get('gates_fail')} gate(s) en rojo — ver {meas.get('evidence_dir','.loopkit/state/evidence')}")
    if meas.get("gates_pass", 0) == 0:
        reasons.append("no se ejecutó ningún gate: D8 es N/V, no 100")
    if meas.get("test_state") not in ("PASS",):
        reasons.append(f"tests en estado '{meas.get('test_state','N/V')}' — D7 debe estar verificado")
    if meas.get("secret_hits", 0) > 0:
        reasons.append(f"{meas['secret_hits']} posible(s) secreto(s) en el diff — revisá antes de cerrar")

    # --- 3. quien escribió no aprueba -----------------------------------------
    builder, reviewer = card.get("builder"), card.get("reviewer")
    if not builder or not reviewer:
        reasons.append("scorecard sin 'builder'/'reviewer': no se puede saber quién aprobó")
    elif builder == reviewer:
        reasons.append(f"auto-aprobación: builder y reviewer son el mismo ('{builder}'). "
                       "El veredicto lo emite un contexto limpio.")

    # --- 3b. el auditor tiene que haber CORRIDO, no sólo estar nombrado -------
    # subagents.jsonl lo escribe el hook SubagentStop con el payload del runtime.
    # El modelo no lo emite: si el archivo no tiene un registro sobre este diff,
    # nadie lanzó un auditor.
    sa_path = os.path.join(ST, "subagents.jsonl")
    runs = []
    if os.path.exists(sa_path):
        with open(sa_path) as fh:
            for line in fh:
                line = line.strip()
                if not line:
                    continue
                try:
                    runs.append(json.loads(line))
                except json.JSONDecodeError:
                    pass
    fresh = [r for r in runs if r.get("hash") == now]
    require_sa = os.environ.get("LOOPKIT_REQUIRE_SUBAGENT", "1") != "0"
    sa_evidence = "sin-registro" if require_sa else "no-exigido"
    if not require_sa:
        fresh = fresh or [None]
    if require_sa and not fresh:
        reasons.append(
            "ningún subagente corrió sobre este diff (.loopkit/state/subagents.jsonl sin "
            f"registro para {now}). El reviewer declarado no fue ejecutado — lanzá lk-qa. "
            "Si tu runtime no emite SubagentStop, poné LOOPKIT_REQUIRE_SUBAGENT=0.")
    elif reviewer and require_sa:
        # si el payload del runtime nombra al agente, la evidencia es fuerte;
        # si no, sólo consta que corrió UN subagente. El gate lo dice, no lo disimula.
        named = any(reviewer in json.dumps(r.get("payload", {}), ensure_ascii=False)
                    for r in fresh if r)
        sa_evidence = "nombrado-por-el-runtime" if named else "corrio-un-subagente-sin-nombre"

    # --- 4. hallazgos abiertos -------------------------------------------------
    findings = card.get("findings", [])
    for f in findings:
        sev, st = str(f.get("sev", "")).upper(), str(f.get("state", "")).upper()
        if sev not in PENALTY:
            reasons.append(f"hallazgo {f.get('id','?')}: severidad '{f.get('sev')}' "
                           f"desconocida — usá {'/'.join(PENALTY)}")
        if st not in OPEN_STATES | CLOSED_STATES:
            reasons.append(f"hallazgo {f.get('id','?')}: estado '{f.get('state')}' desconocido")
    blockers = [f for f in findings
                if f.get("sev", "").upper() not in ("MEDIUM", "LOW")
                and f.get("state", "DISCOVERED").upper() in OPEN_STATES]
    for f in blockers:
        reasons.append(f"{f.get('sev')} abierto {f.get('id','?')} en {f.get('loc','?')}: {f.get('summary','')}")

    # --- 4b. un fix exige que el código haya cambiado --------------------------
    # Historial append-only: un hallazgo grave visto abierto sobre el diff H no
    # puede declararse FIXED sobre el MISMO diff H. Sin cambio de código no hay fix.
    hist_path = os.path.join(ST, "findings.jsonl")
    hist = {}
    if os.path.exists(hist_path):
        with open(hist_path) as fh:
            for line in fh:
                line = line.strip()
                if not line:
                    continue
                try:
                    e = json.loads(line)
                except json.JSONDecodeError:
                    continue
                hist.setdefault(e["id"], []).append(e)

    for f in findings:
        fid, st = f.get("id"), f.get("state", "DISCOVERED").upper()
        if not fid or st not in ("FIXED", "VERIFIED"):
            continue
        if f.get("sev", "").upper() not in ("BLOCKER", "HIGH"):
            continue
        opened = [e for e in hist.get(fid, []) if e["state"] in OPEN_STATES]
        if opened and all(e["hash"] == now for e in opened):
            reasons.append(
                f"{fid} figura como {st} pero el código no cambió desde que se confirmó "
                f"(diff sigue en {now}). Un fix sin diff no es un fix.")

    # se registra DESPUÉS de evaluar, para que el historial no se pise a sí mismo
    try:
        with open(hist_path, "a") as fh:
            for f in findings:
                if f.get("id"):
                    fh.write(json.dumps({"id": f["id"], "state": f.get("state", "DISCOVERED").upper(),
                                         "sev": f.get("sev", "LOW").upper(), "hash": now}) + "\n")
    except OSError:
        pass

    # --- 5. evidencia obligatoria por hallazgo ---------------------------------
    for f in findings:
        if f.get("state", "").upper() in ("CONFIRMED", "FIXED", "VERIFIED") and not f.get("loc"):
            reasons.append(f"hallazgo {f.get('id','?')} sin archivo:línea — sin ubicación es hipótesis, no hecho")

    # --- 6. el score se recomputa, no se cree ----------------------------------
    dims_claim = card.get("dimensions", {})
    dims_real = recompute(findings)
    verified_w = 0; acc = 0
    for d, w in WEIGHTS.items():
        claim = dims_claim.get(d)
        if claim is None or str(claim.get("score", "")).upper() in ("N/V", "NV", ""):
            continue                              # N/V no promedia
        try:
            sc = float(claim["score"])
        except (TypeError, ValueError):
            reasons.append(f"{d}: score no numérico ni N/V"); continue
        if sc - dims_real[d] > TOLERANCE:
            reasons.append(
                f"{d}: score declarado {sc:g} pero sus hallazgos dan {dims_real[d]} "
                "→ score inflado respecto de la evidencia")
        if sc >= 90 and not claim.get("evidence"):
            reasons.append(f"{d}: score {sc:g} sin evidencia citada → debe ser N/V")
        # el global sale del RECOMPUTADO, nunca del declarado: el declarado solo
        # sirve para detectar inflado y para saber qué dimensión es N/V.
        verified_w += w; acc += min(sc, dims_real[d]) * w
    glob = round(acc / verified_w, 1) if verified_w else 0.0

    if verified_w < 60:
        reasons.append(f"solo {verified_w}/100 de peso fue verificado — demasiadas dimensiones en N/V")
    if glob < 75:
        reasons.append(f"score global {glob} < 75")

    verdict = str(card.get("verdict", "")).upper().replace(" ", "_")
    if verdict not in ("READY", "READY_WITH_RISKS"):
        reasons.append(f"veredicto '{card.get('verdict','?')}' no permite cierre")
    if verdict == "READY" and (glob < 90 or blockers):
        reasons.append(f"veredicto READY no se sostiene (global {glob}, {len(blockers)} hallazgo(s) grave(s) abierto(s))")

    if reasons:
        if brief:
            # Salida para un orquestador que NO debe gastar contexto: el veredicto y
            # hasta 3 motivos recortados. El detalle lo lee el minion que corrige.
            print(f"BLOCK score={glob} peso={verified_w}/100 auditor={sa_evidence} "
                  f"motivos={len(reasons)}")
            for r in reasons[:2]:
                print("- " + (r[:90] + "…" if len(r) > 90 else r))
            if len(reasons) > 2:
                print(f"- (+{len(reasons)-2} más — el minion los lee con `lk gate`)")
            return 1
        print(f"GATE BLOCK — tarea {task.get('id','?')} · global recomputado {glob} · "
              f"peso verificado {verified_w}/100 · auditor: {sa_evidence}")
        for r in reasons:
            print(f"  - {r}")
        return 1

    if brief:
        print(f"PASS score={glob} peso={verified_w}/100 veredicto={verdict}")
        return 0
    print(f"GATE PASS — tarea {task.get('id','?')} · global {glob} · "
          f"peso verificado {verified_w}/100 · veredicto {verdict} · "
          f"auditor: {sa_evidence}")
    return 0


if __name__ == "__main__":
    # --hash: única implementación del hash del diff, compartida con verify.sh.
    # Si hubiera dos, divergirían y el gate bloquearía para siempre.
    if len(sys.argv) > 1 and sys.argv[1] == "--hash":
        print(current_diff_hash() or "")
        sys.exit(0)
    sys.exit(main())
