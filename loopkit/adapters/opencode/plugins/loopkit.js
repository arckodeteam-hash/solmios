// LoopKit — plugin de OpenCode.  Copiar a  <repo>/.opencode/plugins/loopkit.js
//
// API usado (docs oficiales de OpenCode):
//   export const X = async ({ project, client, $, directory, worktree }) => ({ hooks })
//   "tool.execute.before" (input, output)  → lanzar Error aborta la herramienta
//   "tool.execute.after"  (input, output)
//   "event" ({ event })                    → session.idle, file.edited, ...
//
// Qué hace:
//  1. cada edit/write marca la fase BUILD y caduca la aprobación anterior
//  2. bloquea `git commit` y `git push` si el gate no pasó  ← el enforcement real
//  3. al quedar la sesión idle, deja el veredicto del gate en el log

// VERIFICADO contra opencode 1.18.11: `opencode debug agent` lista la herramienta
// de subagente como "task". Los otros nombres quedan como red por si cambia.
const SUBAGENT_TOOLS = /^(task|agent|subagent|delegate|spawn)$/i

export const LoopKit = async ({ $, directory }) => {
  const root = directory
  const lk = `${root}/.loopkit/core`

  const gate = async () => {
    try {
      const r = await $`python3 ${lk}/gate.py`.cwd(root).quiet().nothrow()
      const out = (r.stdout?.toString() || "") + (r.stderr?.toString() || "")
      return { ok: r.exitCode === 0, out }
    } catch (e) {
      return { ok: true, out: `LoopKit no pudo correr el gate: ${e.message}` } // no romper la sesión
    }
  }

  return {
    "tool.execute.after": async (input) => {
      const t = String(input.tool || "")
      if (t === "edit" || t === "write" || t === "patch") {
        await $`bash ${lk}/lk build`.cwd(root).quiet().nothrow()
        return
      }
      // "task" está verificado en 1.18.11. Si tu versión usa otro nombre, agregalo a
      // SUBAGENT_TOOLS; `lk status` muestra si se están registrando los auditores.
      if (SUBAGENT_TOOLS.test(t)) {
        await $`bash ${lk}/lk subagent-seen opencode ${t}`.cwd(root).quiet().nothrow()
      }
    },

    "tool.execute.before": async (input, output) => {
      if (input.tool !== "bash") return
      const cmd = String(output?.args?.command || "")
      if (!/\bgit\s+(commit|push)\b/.test(cmd)) return
      if (/--no-verify/.test(cmd)) {
        throw new Error("LoopKit: --no-verify está prohibido. El gate existe para esto.")
      }
      const { ok, out } = await gate()
      if (!ok) {
        const env = await $`sh -c 'set -a; . .loopkit/commands.env 2>/dev/null; echo "\${LOOPKIT_ENFORCE:-1}"'`
          .cwd(root).quiet().nothrow()
        if ((env.stdout?.toString() || "1").trim() === "0") {
          console.log("[LoopKit · observación] este commit/push no pasaría el gate:\n" + out)
          return
        }
        throw new Error(
          "LoopKit BLOQUEÓ este commit/push: la tarea no pasó el gate.\n\n" + out +
          "\n\nPasos: 1) bash .loopkit/core/verify.sh  2) que el agente lk-qa audite y escriba " +
          ".loopkit/state/scorecard.json (vos no aprobás tu propio código)  3) bash .loopkit/core/lk gate"
        )
      }
    },

    event: async ({ event }) => {
      if (event.type !== "session.idle") return
      const { ok, out } = await gate()
      if (!ok) console.log("\n[LoopKit] la tarea NO está verificada:\n" + out + "\n")
    },
  }
}
