# Rúbrica de Score — cómo se calcula (no se opina)

Este archivo define un score **reproducible**: dos revisores distintos, con el mismo
ledger de hallazgos, obtienen el mismo número. Si el score no se puede recomputar
desde los hallazgos, es una opinión, no un score.

## Regla madre

> Ninguna dimensión puntúa por impresión. Puntúa por **violaciones contadas**, cada una
> con `archivo:línea` o comando+salida. Sin evidencia inspeccionada, la dimensión es
> `N/V` (no verificada) — **nunca 100**.

## Fuente de cada dimensión

- `MEDIDA` = sale de un comando con exit code / conteo de `rg` / `git diff`. No discutible.
- `JUZGADA` = la evalúa el agente, pero solo puede bajar puntos citando `archivo:línea`.

| # | Dimensión | Peso | Fuente | Qué mide exactamente |
|---|---|---|---|---|
| D1 | Estructura y ubicación | 10 | MEDIDA+JUZGADA | Cada archivo nuevo/movido está en la carpeta y capa que manda la arquitectura del proyecto. Namespace/import path coherente. |
| D2 | Patrones del proyecto | 10 | JUZGADA | Usa los patrones vigentes del repo (inyección, repos, servicios, stores, connectors) en vez de inventar una vía nueva. |
| D3 | Consistencia con código actual | 8 | JUZGADA | El código nuevo se parece a su vecino: naming, orden de imports, manejo de errores, estilo de tests. Comparado contra un archivo hermano concreto. |
| D4 | Clean code | 8 | MEDIDA+JUZGADA | Umbrales objetivos (abajo). No "se lee lindo". |
| D5 | Corrección y edge cases | 15 | JUZGADA | Nulos, vacíos, límites, orden, fallo parcial, doble ejecución, camino de error. |
| D6 | Seguridad | 12 | MEDIDA+JUZGADA | Authn/authz por endpoint, validación de input, aislamiento multi-tenant, SQL parametrizado, secretos fuera del código. |
| D7 | Tests | 12 | MEDIDA | Suite corre y pasa; hay test que falla sin el fix; assertions no triviales. |
| D8 | Gates ejecutables | 10 | MEDIDA | build / typecheck / lint / analyzer. Binaria: 100 o 0. |
| D9 | Config y anti-hardcode | 5 | MEDIDA+JUZGADA | URLs, credenciales, IDs, límites y flags fuera del código. |
| D10 | Alcance del diff | 4 | MEDIDA | Solo tocó lo que la tarea pide. Sin refactors colados. |
| D11 | Deuda introducida | 3 | MEDIDA | TODO/FIXME/HACK nuevos, `any` nuevo, logs de debug, catch vacío, código comentado. |
| D12 | Contratos y documentación | 3 | JUZGADA | Contrato público estable o versionado; migración reversible; doc mínima donde el repo ya la exige. |

## Fórmula (idéntica para toda dimensión)

```
score_dimension = max(0, 100 - (30×BLOCKER + 15×HIGH + 7×MEDIUM + 2×LOW))
score_global    = Σ(score_dimension × peso) / Σ(peso de dimensiones VERIFICADAS)
```

Las dimensiones `N/V` **no promedian**: se listan aparte y se cuentan como riesgo abierto.
Sacarlas del promedio evita el truco de "no lo miré, le pongo 100".

## Anti-inflación

1. Dimensión con score ≥ 90 debe citar **al menos una evidencia** de que se inspeccionó
   (archivo:línea leído, o comando + exit code). Sin eso → se degrada a `N/V`.
2. Está prohibido inventar violaciones para "parecer riguroso". Un hallazgo sin
   `archivo:línea` no entra al conteo: va como HIPÓTESIS, y las hipótesis no restan puntos.
3. D8 no admite intermedios. Si un gate no se pudo ejecutar → `N/V`, jamás 100.

## Umbrales objetivos de D4 (Clean code)

| Condición | Severidad |
|---|---|
| Función > 50 líneas | MEDIUM (por función) |
| Anidamiento > 4 niveles | MEDIUM |
| Bloque duplicado ≥ 10 líneas | MEDIUM |
| Función con > 5 parámetros posicionales | LOW |
| Archivo > 400 líneas | LOW |
| Nombre no descriptivo fuera de índice de loop | LOW |
| Flag booleano que parte la función en dos comportamientos | LOW |

Estilo/formato que el formatter del repo ya resuelve **no puntúa**. No es hallazgo, es ruido.

## Señales de D11 (deuda)

`TODO` · `FIXME` · `HACK` · `XXX` · `any` sin justificación · `console.log` / `dd()` /
`var_dump` / `print()` de debug · `catch {}` vacío · bloque de código comentado ·
`@ts-ignore` / `eslint-disable` sin motivo escrito.
Se cuentan **solo los introducidos por el diff**, no los preexistentes.

## Veredicto (reglas duras, ganan al promedio)

| Veredicto | Condiciones (todas) |
|---|---|
| `READY` | global ≥ 90 · cero BLOCKER · cero HIGH abiertos · D7 y D8 verificados · ninguna dimensión < 70 |
| `READY WITH RISKS` | cero BLOCKER · cero HIGH abiertos · global 75–89 · riesgos listados con dueño y siguiente acción |
| `NOT READY` | ≥1 BLOCKER · o ≥1 HIGH sin fix · o D8 ≠ 100 · o D7 en `N/V` · o global < 75 |

Un promedio alto **no** tapa un crítico. Si aparece un BLOCKER en la última pasada, el
veredicto es `NOT READY` aunque el resto dé 98.

## Estados y IDs

Los mismos del vault: `DISCOVERED → CONFIRMED → FIXING → FIXED → VERIFIED`
(+ `REJECTED`, `DUPLICATE`, `DEFERRED`), IDs `BUG-`, `SEC-`, `DATA-`, `API-`, `PERF-`,
`TEST-`, `ARCH-`, `DEBT-`, `REG-`.
