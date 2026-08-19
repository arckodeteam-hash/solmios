# Scorecard portable — pegar en cualquier agente

Bloque autocontenido. Funciona en Claude Code, OpenCode, Cursor, ChatGPT, Gemini.
No requiere el resto del vault. Copiá desde la línea de abajo.

---

Antes de decir que un cambio está terminado, devolvé este scorecard.

REGLAS
1. Primero ejecutá los comandos de verificación del proyecto (build, typecheck, lint, test)
   y usá su salida real. Un comando que no ejecutaste se reporta como N/V, nunca como OK.
2. Bajar puntos exige `archivo:línea`. Sin ubicación no es hallazgo: es hipótesis y no resta.
3. Subir una dimensión a 90 o más exige citar qué inspeccionaste para afirmarlo.
   Si no la miraste, es N/V — no 100.
4. Nunca reportes como ejecutado algo que no ejecutaste, ni inventes salidas de comandos.
5. No inventes problemas para llenar la tabla. Calidad sobre cantidad.
6. Solo contás la deuda que introduce este cambio, no la que ya estaba.
7. Estilo que el formatter del repo arregla solo no es hallazgo.

FÓRMULA (no ajustes el número a mano)
score_dimension = max(0, 100 - (30×BLOCKER + 15×HIGH + 7×MEDIUM + 2×LOW))
global = suma(score × peso) / suma(pesos de dimensiones verificadas)

TABLA

| # | Dimensión | Peso | Score | Fuente | B/H/M/L | Evidencia |
|---|---|---|---|---|---|---|
| D1 | Estructura y ubicación de archivos | 10 | | | | |
| D2 | Patrones del proyecto | 10 | | | | |
| D3 | Consistencia con el código actual | 8 | | | | |
| D4 | Clean code | 8 | | | | |
| D5 | Corrección y edge cases | 15 | | | | |
| D6 | Seguridad | 12 | | | | |
| D7 | Tests | 12 | | | | |
| D8 | Gates ejecutables (build/typecheck/lint) | 10 | | | | |
| D9 | Config y anti-hardcode | 5 | | | | |
| D10 | Alcance del diff | 4 | | | | |
| D11 | Deuda introducida | 3 | | | | |
| D12 | Contratos y documentación | 3 | | | | |

Fuente = MEDIDA (comando/conteo) o JUZGADA (con archivo:línea).

QUÉ MIDE CADA UNA
D1 cada archivo está en la capa/carpeta que manda la arquitectura del repo.
D2 usa los patrones vigentes del repo en vez de inventar una vía nueva.
D3 se parece a su archivo hermano: naming, imports, manejo de errores, estilo de tests.
   Citá contra cuál comparaste.
D4 función >50 líneas = MEDIUM · anidamiento >4 = MEDIUM · bloque duplicado ≥10 líneas =
   MEDIUM · >5 parámetros = LOW · archivo >400 líneas = LOW.
D5 nulos, vacíos, límites, orden, fallo parcial, doble ejecución, camino de error.
D6 authn/authz por endpoint, validación de input, aislamiento por tenant, SQL parametrizado,
   secretos fuera del código.
D7 la suite corre y pasa; hay un test que falla sin el fix; assertions no triviales.
D8 binaria: 100 o 0. Si no se pudo ejecutar → N/V.
D9 URLs, credenciales, IDs, límites y flags fuera del código.
D10 tocó solo lo que la tarea pide, sin refactors colados.
D11 TODO/FIXME/HACK nuevos, `any` nuevo, logs de debug, catch vacío, código comentado.
D12 contrato público estable o versionado, migración reversible, doc donde el repo la exige.

VEREDICTO (las reglas duras ganan al promedio)
READY .............. global ≥90 · 0 BLOCKER · 0 HIGH abiertos · D7 y D8 verificados ·
                     ninguna dimensión <70
READY WITH RISKS ... 0 BLOCKER · 0 HIGH abiertos · global 75–89 · riesgos listados
NOT READY .......... ≥1 BLOCKER · o ≥1 HIGH sin fix · o D8≠100 · o D7 en N/V · o global <75

Un promedio alto no tapa un crítico.

CERRÁ CON
- Gates ejecutados: comando | exit code | resultado
- Hallazgos: ID | sev | estado | archivo:línea | evidencia | impacto | fix
- No verificado: dimensión | por qué | cómo verificarlo
- Hipótesis (sin evidencia, no puntúan)
- Siguiente acción exacta si no es READY
