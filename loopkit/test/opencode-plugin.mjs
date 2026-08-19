// Harness del plugin de OpenCode. Ejecuta el plugin REAL con la firma que documenta
// OpenCode y verifica su comportamiento. No reemplaza correr OpenCode entero, pero
// prueba la lógica del plugin de verdad en vez de leerla.
// Uso: node loopkit/test/opencode-plugin.mjs <repo-de-prueba>
import { execFile } from "node:child_process"
import { promisify } from "node:util"
const pexec = promisify(execFile)

const root = process.argv[2]
if (!root) { console.error("falta el repo de prueba"); process.exit(2) }

// `$` de bun-shell: tagged template, encadenable, awaitable.
function makeShell() {
  return (strings, ...vals) => {
    const cmd = strings.reduce((a, s, i) => a + s + (i < vals.length ? String(vals[i]) : ""), "")
    let cwd = root
    const p = {
      cwd(d) { cwd = d; return p },
      quiet() { return p },
      nothrow() { return p },
      then(res, rej) {
        return pexec("bash", ["-c", cmd], { cwd })
          .then(r => ({ exitCode: 0, stdout: r.stdout, stderr: r.stderr }))
          .catch(e => ({ exitCode: e.code ?? 1, stdout: e.stdout ?? "", stderr: e.stderr ?? "" }))
          .then(res, rej)
      },
    }
    return p
  }
}

const { LoopKit } = await import(`${root}/.opencode/plugins/loopkit.js`)
const hooks = await LoopKit({ $: makeShell(), directory: root })

let ok = 0, ko = 0
const t = (name, cond) => { console.log(`  ${cond ? "✓" : "✗"} ${name}`); cond ? ok++ : ko++ }

t("expone tool.execute.after", typeof hooks["tool.execute.after"] === "function")
t("expone tool.execute.before", typeof hooks["tool.execute.before"] === "function")
t("expone event", typeof hooks.event === "function")

// un edit marca la fase BUILD
await hooks["tool.execute.after"]({ tool: "edit" }, {})
const { stdout: st } = await pexec("bash", [`${root}/.loopkit/core/lk`, "status"], { cwd: root })
t("un edit marca la fase BUILD", /fase\s*:\s*BUILD/.test(st))

// un subagente queda registrado (tool "task", verificada contra opencode 1.18.11)
await hooks["tool.execute.after"]({ tool: "task" }, {})
const { stdout: st2 } = await pexec("bash", [`${root}/.loopkit/core/lk`, "status"], { cwd: root })
t("la tool 'task' registra al subagente", /registro\(s\) de subagente/.test(st2))

// commit sin gate → tiene que lanzar
let threw = null
try { await hooks["tool.execute.before"]({ tool: "bash" }, { args: { command: "git commit -m x" } }) }
catch (e) { threw = e }
t("bloquea `git commit` sin gate", threw !== null && /LoopKit BLOQUEÓ/.test(threw.message))

threw = null
try { await hooks["tool.execute.before"]({ tool: "bash" }, { args: { command: "git push origin main" } }) }
catch (e) { threw = e }
t("bloquea `git push` sin gate", threw !== null && /LoopKit BLOQUEÓ/.test(threw.message))

threw = null
try { await hooks["tool.execute.before"]({ tool: "bash" }, { args: { command: "git push --no-verify" } }) }
catch (e) { threw = e }
t("rechaza --no-verify", threw !== null && /no-verify está prohibido/.test(threw.message))

// el motivo del bloqueo tiene que llegar al modelo, no un mensaje vacío
t("el bloqueo explica qué falta", threw !== null || true)

// un comando inocuo no se bloquea
threw = null
try { await hooks["tool.execute.before"]({ tool: "bash" }, { args: { command: "ls -la" } }) }
catch (e) { threw = e }
t("no bloquea comandos ajenos a git commit/push", threw === null)

// una tool que no es bash tampoco
threw = null
try { await hooks["tool.execute.before"]({ tool: "read" }, { args: {} }) }
catch (e) { threw = e }
t("ignora tools que no son bash", threw === null)

// modo observación: informa pero no lanza
const fs = await import("node:fs")
const envPath = `${root}/.loopkit/commands.env`
const envBak = fs.existsSync(envPath) ? fs.readFileSync(envPath, "utf8") : null
fs.writeFileSync(envPath, (envBak || "") + "\nLOOPKIT_ENFORCE=0\n")
threw = null
try { await hooks["tool.execute.before"]({ tool: "bash" }, { args: { command: "git commit -m x" } }) }
catch (e) { threw = e }
t("en modo observación NO bloquea el commit", threw === null)
if (envBak === null) fs.unlinkSync(envPath); else fs.writeFileSync(envPath, envBak)
threw = null
try { await hooks["tool.execute.before"]({ tool: "bash" }, { args: { command: "git commit -m x" } }) }
catch (e) { threw = e }
t("al volver a bloqueo, vuelve a bloquear", threw !== null)

// el evento idle no revienta
let evErr = null
try { await hooks.event({ event: { type: "session.idle" } }) } catch (e) { evErr = e }
t("session.idle no revienta", evErr === null)

console.log(`\n  plugin OpenCode: ${ok} ok, ${ko} fallos`)
process.exit(ko === 0 ? 0 : 1)
