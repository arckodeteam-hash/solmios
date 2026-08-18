# Sistema de agentes de revisión — Kaptas

> **Esto no se commitea.** `.claude/` está fuera de ambos repos git por construcción
> (`Kaptas-Epinosa/` no es un repo) y además ignorado en `kaptas-web-api/.gitignore` y
> `RefactorKaptasWeb/.gitignore` como red de seguridad.

---

## Qué es

Ocho agentes especialistas + dos skills preexistentes, coordinados por un gate único.
Cada tipo de hallazgo tiene **un solo dueño**: eso es lo que evita que ocho revisores
opinen del mismo `Service.cs` y ninguno firme.

```
Kaptas-Epinosa/
├── .claude/
│   ├── README.md                      ← este archivo
│   ├── agents/                        ← 8 agentes
│   └── skills/
│       └── kaptas-review-protocol/    ← CONTRATO ÚNICO (severidades, veredicto, fronteras)
└── (skills globales en ~/.claude/skills/)
    ├── kaptas-clean-arch              ← arquitectura, zonas, ciclos  [reutilizada]
    └── kaptas-security-gate           ← seguridad completa           [reutilizada]
```

---

## Los agentes

| Agente | Dominio exclusivo | Absorbe |
|---|---|---|
| `kaptas-principal-reviewer` | Coordina, resuelve conflictos, firma el veredicto final | — |
| `kaptas-backend` | .NET/EF/CQRS, DI, contrato HTTP, `ResponseVM`, filtros, versionado | API Architect |
| `kaptas-database` | Plan SQL, índices, N+1, transacciones, deadlocks, ORM | Performance Engineer |
| `kaptas-qa-tests` | Cobertura, diseño de test, tests que mienten | — |
| `kaptas-code-reviewer` | SOLID/Clean Code **dentro** de una clase, complejidad, duplicación | AI Code Reviewer |
| `kaptas-docs` | `REGISTRO-MODULOS.md`, ADR, cabeceras §9, changelog, API docs | — |
| `kaptas-frontend-angular` | Angular 20.3, RxJS/signals, estado, bundle, a11y | — |
| `kaptas-observability` | Logging, correlación, PII en logs, métricas | — |

### Skills reutilizadas, no duplicadas

| Skill | Cubre el rol de | Por qué no se reescribió |
|---|---|---|
| `kaptas-clean-arch` | Software Architect + Refactoring Specialist | 264 líneas + templates de módulo ya probados. El ciclo RECICLADO **es** el Refactoring Specialist |
| `kaptas-security-gate` | Security Engineer | 458 líneas + `security-gate.sh` ejecutable, con cada regla anclada a un bug real del legado |

---

## Roles que se descartaron, y por qué

No es un recorte por pereza: es la misma regla YAGNI que los agentes van a exigirle al código.

| Rol pedido | Veredicto | Evidencia |
|---|---|---|
| DevOps Engineer | Sin superficie | 0 `Dockerfile`, 0 pipelines en `kaptas-web-api/` |
| Cloud Architect | Sin superficie | 0 `*.tf`, 0 `*.bicep` en todo el proyecto |
| Infrastructure Engineer | Sin superficie | Ídem. No hay infraestructura como código |
| Product Analyst | Fuera de mandato | CLAUDE.md §11: *"no editar el board ni tasks.md sin orden explícita — es responsabilidad de QA-DEV"* |
| API Architect | Fusionado en `backend` | El contrato de respuesta **es** backend acá: `ResponseVM`, filtros y rutas v2 viven en el mismo diff |
| Performance Engineer | Fusionado en `database` | El grueso del perf de este ERP es de consulta |
| Software Architect | Ya existe | `kaptas-clean-arch` |
| Security Engineer | Ya existe | `kaptas-security-gate` |
| Refactoring Specialist | Ya existe | Es el ciclo RECICLADO de `kaptas-clean-arch` |
| AI Code Reviewer | Fusionado en `code-reviewer` | Dos revisores del mismo territorio = ninguno responsable |

**Cuándo reactivar los descartados:** en cuanto aparezca la superficie. Un `Dockerfile` o un
`*.tf` en el repo justifica DevOps/Infra el mismo día.

---

## Cómo se usa

### Revisión completa (lo normal al cerrar un módulo)
```
> Usá kaptas-principal-reviewer para cerrar RepairShop
```
Corre build+test como precondición, reparte en tres olas, consolida y firma.

### Revisión de un solo dominio
```
> Usá kaptas-database para revisar Features/RepairShop/Queries/
```
Más rápido y más profundo cuando ya sabés dónde está el problema.

### Las tres olas

```
Precondición:  dotnet build && dotnet test        ← si falla, no se revisa nada

OLA 1  (paralelo, independientes)
  clean-arch · security-gate · backend · database · frontend-angular
       │
       └─ ¿algún BLOCKER? → CORTA. No se gastan las olas 2 y 3

OLA 2  (necesitan el diseño firme)
  code-reviewer · observability

OLA 3  (necesitan el código final)
  qa-tests → docs

  → principal-reviewer firma
```

---

## Las tres reglas que sostienen todo

**1. Evidencia ejecutable o no es un hallazgo.**
Comando + salida, test que falla, o `archivo.cs:línea`. "Podría fallar" no cuenta.

**2. Un tipo de hallazgo, un dueño.**
Varios agentes leen el mismo archivo; solo uno reporta cada clase de problema. Lo de afuera
se traspasa, no se arregla ni se ignora.

**3. Ningún agente commitea. Nunca.**
Ni con veredicto APROBADO. El humano decide qué y cuándo. Está escrito en los ocho.

---

## El caso que originó el protocolo

`ValidateModelFilter` pasó **7 tests unitarios en verde mientras estaba roto**.

`[ServiceFilter]` implementa `IOrderedFilter` con su propio `Order = 0` e ignora el de la clase
envuelta, así que el filtro corría *después* del `ModelStateInvalidFilter` de `[ApiController]`
(`Order = -2000`) y nunca llegaba a actuar. Lo detectó un test HTTP contra la app levantada.

De ahí sale la regla más importante del protocolo: **cuando el comportamiento depende de orden,
wiring, DI o configuración, un test unitario no es evidencia.** Prueba que la unidad hace lo
suyo, no que gane la carrera en el pipeline real.

---

## Datos verificados (2026-07-18)

Los agentes deben **re-medirlos**, no citarlos de memoria — el proyecto se mueve.

| Dato | Valor | Comando |
|---|---|---|
| Módulos en `Features/` | 1 (`RepairShop`) + `_Shared` | `ls Kaptas.API/Features/` |
| Áreas de `_Shared/` | 10 | `ls Kaptas.API/Features/_Shared/` |
| Controllers legado | **81** (no 12 — el glob ignora 4 subcarpetas) | `grep -rl ": Controller\b\|: ControllerBase" --include=*.cs Kaptas.API/Controllers/ \| wc -l` |
| Archivos en `Kaptas.Services/` | 194 | `find Kaptas.Services -name "*.cs" \| wc -l` |
| **Tests ejecutados** (el número que vale) | **121**, 0 fallados | `dotnet test --nologo` |
| Atributos `[Fact]`/`[Theory]` | 104 en 27 archivos | `grep -rl "\[Fact\]\|\[Theory\]" --include=*.cs Kaptas.Tests/ \| wc -l` |
| Target framework | `net7.0` en los 7 `.csproj` | `grep -h "TargetFramework" */*.csproj \| sort \| uniq -c` |
| Tests según CLAUDE.md §2 | 239 — **desactualizado** | hallazgo abierto de `kaptas-docs` |
| Angular | 20.3 · RxJS 7.8 · TS 5.8 | `grep '"@angular/core"' RefactorKaptasWeb/package.json` |
| Archivos con `signal()` | 1 | `grep -rl "signal(" RefactorKaptasWeb/src/ \| wc -l` |

---

## Mantenimiento

- **Severidades, formato de veredicto o fronteras** → se cambian en `kaptas-review-protocol`,
  una sola vez. Nunca en los agentes.
- **Regla de un dominio** → en el agente dueño.
- **Agente nuevo** → primero agregalo a la matriz de fronteras del protocolo §3. Un agente sin
  territorio asignado genera exactamente el solapamiento que este diseño evita.
