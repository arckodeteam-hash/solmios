# Kaptas ERP — CLAUDE.md

> ERP multi-tenant (.NET 7 / EF Core). Estamos refactorizando un legado grande
> hacia una arquitectura modular por features. **Este archivo define la
> arquitectura que usamos y las reglas de un módulo. Es la fuente de verdad.**

---

## 1. Principios de un módulo (LEY — se verifican en cada cierre)

Todo módulo en `Features/` debe cumplir estos 8 principios. No son teoría: cada
uno se traduce en una regla concreta y verificable sobre este código.

| # | Principio | Qué significa aquí | Cómo se cumple en Kaptas |
|---|-----------|--------------------|--------------------------|
| 1 | **Responsabilidad única** | Un módulo = un área de negocio. | `Features/RepairShop/` solo taller. Nunca mezclar dominios en una carpeta. |
| 2 | **Alta cohesión** | Todo lo relacionado vive junto. | DTOs, Commands, Queries, Service e Internal del módulo bajo `Features/[Modulo]/`. Lo transversal a `_Shared/[Area]/`. |
| 3 | **Bajo acoplamiento** | Depende lo mínimo de otros módulos. | Se depende de **interfaces** (`I...`), nunca de implementaciones ni de `Kaptas.Services`. Cruce entre módulos solo por contrato en `_Shared/` (ej: `Payments` es adaptador aislado). |
| 4 | **Encapsulamiento** | Oculta su implementación interna. | Detalle no público va en `Internal/`. El Controller no conoce EF, SQL ni SPs. |
| 5 | **Interfaz pública clara** | Expone solo lo necesario. | Superficie pública = `I[Modulo]Service` + DTOs `Request`/`Response`. Nada más se expone. |
| 6 | **Reemplazable** | Cambiar la implementación sin afectar al que lo usa. | Seam con adaptadores (Legacy/Feature) y feature flag por tenant. Se puede pasar de SP a EF sin tocar al consumidor. |
| 7 | **Testeable** | Se prueba aislado. | Depende de abstracciones mockeables (`ICurrentUserProvider`, `ISpRunner`, `IDatabaseClock`). `AsNoTracking()` en lecturas. Sin estáticos ocultos ni `DateTime.Now`. |
| 8 | **Evolucionable** | Crece con impacto mínimo. | CQRS: un `Command`/`Query` por caso de uso. Agregar uno nuevo no toca los demás. |

**Regla de oro:** si un cambio en tu módulo obliga a tocar otro módulo, violaste
bajo acoplamiento. Frená y revisá el contrato en `_Shared/`.

---

## 2. Stack
- .NET 7 — ASP.NET Core Web API
- Entity Framework Core — SQL Server (multi-tenant: 1 BD por suscripción)
- xUnit + Moq — tests (43 unit + 196 integración)
- BCrypt — password hashing · Scrutor (Scan) — registro automático de servicios · NLog — logging
- sqlcmd nativo (NO Docker) — tests contra BDs `_test` aisladas
- Azure DevOps — gestión de work items

---

## 3. Estructura del proyecto
```
kaptas-web-api/
  Kaptas.API/
    Controllers/       ← LEGADO (no tocar sin tests)
    Features/          ← NUEVO + LIMPIO
      _Shared/         ← contratos e infra transversal (por área)
      [Modulo]/        ← un módulo de negocio por carpeta
    Program.cs         ← registro por convención (Scan)
  Kaptas.Services/     ← LEGADO (NO importar desde Features/)
  Kaptas.Context/      ← DbContext (se consume, no se toca)
  Kaptas.Tests/        ← tests
```

### Anatomía de un módulo (`Features/[Modulo]/`)
Patrón real, tal como está en `RepairShop`:
```
Features/[Modulo]/
├── DTOs/                          ← contratos públicos: [X]Request.cs / [X]Response.cs
├── Commands/                      ← casos de uso de escritura (CQRS)
│   └── [Accion][X]Command.cs
├── Queries/                       ← casos de uso de lectura (CQRS)
│   └── [X]ListQuery.cs
├── Internal/                      ← detalle NO público (encapsulamiento)
├── I[X]Service.cs                 ← interfaz pública (única superficie)
├── [X]Service.cs                  ← orquesta Commands/Queries
├── [X]Controller.cs              ← ~30 líneas: recibe y delega
└── [X]ServiceCollectionExtensions.cs  ← registro DI del módulo
```

### `_Shared/` — infra transversal, organizada por área
No hay archivos sueltos "porque sí": todo lo compartido va a `_Shared/<Area>/`.
```
_Shared/
├── Data/         ← ISpRunner/SpRunner, IDatabaseClock/DatabaseClock
├── Identity/     ← ICurrentUserProvider, IUserBranchesQuery
├── Tenancy/      ← ITenantConnectionFactory, TenantScope, ValidateTenantFilter
├── Operations/   ← IOperation{Writer,DetailWriter,Recalculator,Validator}
├── Payments/     ← IPaymentApplier (adaptador aislado — límite de módulo)
├── Stock/        ← IStockMovementWriter (movimientos de inventario en EF)
├── Sequences/    ← ISequenceNumberProvider
├── Dictionaries/ ← IDictionaryResolver
└── Fiscal/       ← INcfProvider (NCF)
```
**Criterio de ubicación:** infra técnica → `_Shared/<Area>/`. Contrato entre dos
módulos de negocio → `_Shared/<Area>/` como adaptador. Lógica de un solo módulo →
dentro del módulo. Nunca al revés.

---

## 4. Arquitectura de migración — estrategia híbrida

Convivimos legado + nuevo. Cada pieza se mueve **LEGADO → PUENTE → LIMPIO** y
nunca vuelve atrás.

### 4 zonas
| Zona | Dónde | ¿Se puede tocar? |
|------|-------|------------------|
| LEGADO | `Kaptas.Services/` + `Controllers/` | NO, hasta tener tests |
| PUENTE | `Features/[Modulo]/` + viejo aún vivo | Solo el Feature nuevo |
| NUEVO | `Features/[Modulo]/` | Es lo que creás |
| LIMPIO | `Features/[Modulo]/` + viejo eliminado | Refactor libre (hay tests) |

### 3 ciclos
**RECICLADO** (refactor LEGADO → LIMPIO)
```
R1 — Tests de caracterización del viejo (lo que HOY hace, no lo que debería)
R2 — Crear Feature + Seam (interfaz con adaptadores Legacy/Feature, flag por tenant)
R3 — Migrar clientes uno por uno (feature flag por tenant)
R4 — Marcar viejo [Obsolete("Reemplazado por Features/X")]
R5 — Desmontar viejo con 0 tráfico confirmado
```
**VERDE** (módulo nuevo)
```
A — Análisis: tablas que escribe/lee, módulos dependientes, permisos, endpoints
B — Estructura: carpeta Features/, DTOs primero, interfaz I[X]Service
C — Implementación: Service (lógica) + Controller (~30 líneas)
D — Tests + build + commit feat:
```
**PARCHE** (bug fix)
```
B1 Detectar → B2 Test que lo reproduce (rojo, OBLIGATORIO) → B3 Localizar zona
→ B4 Root cause (no el síntoma) → B5 Fix según zona → B6 Regression test (verde) → B7 Postmortem
```

### Fix según zona
| Zona del bug | Fix | Test |
|---|---|---|
| LEGADO | Hotfix mínimo, sin refactor. Registrar deuda. | Characterization test |
| PUENTE | Lógica compartida → fix en Feature. Cliente no migrado → fix en viejo. | Regresión en Feature |
| NUEVO/LIMPIO | Fix libre + TDD: repro rojo → fix → verde | Obligatorio |

> 3 bugs en el mismo LEGADO (o 1 crítico de seguridad/IDOR) → ese módulo sube al tope de RECICLADO.

---

## 5. Dependencias — permitido vs prohibido
| ✅ PERMITIDO | ❌ PROHIBIDO |
|---|---|
| `ICurrentUserProvider` y demás contratos de `_Shared/` | `IBaseService` / `BaseService` |
| `KaptasCoreContext` / `KaptaswebContext` | `Kaptas.Services` (cualquier namespace) |
| `Kaptas.DTO` (DTOs compartidos) | `ISpExecute` / `IDbService` |
| `Kaptas.Helpers` (crypto, settings) | Heredar de cualquier clase de `Services/` |

Namespaces: `Kaptas.API.Features.*` = nuevo/limpio · `Kaptas.Services.Implementations.*` = legado.

---

## 6. Reglas NO negociables

**SIEMPRE**
- Controller ~30 líneas — solo recibe y delega
- Interfaz antes que implementación
- Filtro tenant en TODAS las queries
- Al menos 1 test antes de terminar · tests ANTES de tocar código
- `AsNoTracking()` en toda lectura
- `UtcNow` para fechas
- Cabecera de estado + entrada en el registro (§8) + commit tagueado

**NUNCA**
- Importar `Kaptas.Services` desde `Features/` · heredar de `BaseService` · usar `IBaseService`
- Lógica de negocio en el Controller
- `DateTime.UtcNow.AddHours(-4)`
- Código comentado · `SaveChanges` en loop · `catch(Exception){}` (tragar excepción)
- Desactivar/borrar tests para avanzar · devolver 200 para ocultar un 500
- "Ya que estoy, refactorizo" en un hotfix a LEGADO · tocar `BaseService` "de paso"
- Arreglar un bug sin poder reproducirlo primero

### Cierre de turno (C1–C4)
- **C1 Verificar**: build 0 errores/warnings · tests verdes · controller ~30 líneas · `AsNoTracking()` · filtro tenant · HTTP correctos · 0 código comentado · `UtcNow`
- **C2 Acoplamiento**: NO importa `Kaptas.Services` · NO hereda de `BaseService` · NO llama a servicios viejos · NO usa `IBaseService` · **cumple los 8 principios de §1**
- **C3**: actualizar el registro de módulos (§8)
- **C4**: extraer patrón reutilizable a `Features/_Shared/<Area>/`

---

## 7. Tests

**Infra (sin Docker)**: BDs `_test` aisladas (`kaptaswebdev_test` + `kw21_test`), copiadas por BACKUP/RESTORE, reset pre-test desde snapshot (~9s). `KAPTAS_SQL_HOST`: `localhost` o `173.249.31.75`. Credenciales solo por env/secrets, nunca en repo.

| Tipo | Dónde | BD | Cantidad |
|------|-------|----|----------|
| Unitarios | `Features/` | Mocks | 43 |
| Integración | `Legacy/` | `_test` | 196 |

```bash
dotnet test                                            # todos
dotnet test --filter "Category=Unit"                   # unitarios
dotnet test --filter "Category=Integration"            # integración
dotnet test --filter "FullyQualifiedName~LoginTests"   # uno
bash Kaptas.Tests/scripts/setup-test-db.sh --reset-only # reset pre-test
```

**Naming de tests:** `Method_Scenario_ExpectedResult`. **Regla:** bug nuevo = 1 test nuevo (rojo → fix → verde → queda para siempre).

---

## 8. Dónde va cada cosa (mapa de ubicación)

La refactorización es *mover cada pieza a su lugar correcto*. Antes de crear un
archivo, ubicalo con esta tabla:

| Qué es | Dónde va | Ejemplo |
|--------|----------|---------|
| Endpoint HTTP | `Features/[Modulo]/[X]Controller.cs` (~30 líneas) | `RepairShopController` |
| Contrato público del módulo | `Features/[Modulo]/I[X]Service.cs` + `DTOs/` | `IRepairShopService` |
| Caso de uso escritura/lectura | `Features/[Modulo]/Commands/` · `Queries/` | `CreateRepairShopCaseCommand` |
| Detalle interno de UN módulo | `Features/[Modulo]/Internal/` | `LegacySqlFormat` |
| Colaborador con deps (toca BD/tenant, se mockea) | `Features/_Shared/<Area>/` con interfaz | `ISpRunner`, `IOperationWriter` |
| **Helper puro estático** (sin BD, sin tenant, sin estado) | `Kaptas.Helpers/` (o `Internal/` si es de un módulo) | `Encryption.SHA256`, `HelpersJson` |
| DTO compartido entre proyectos | `Kaptas.DTO/` | — |

**Helper vs servicio `_Shared` — la distinción que más se confunde:**
- **Helper** (`Kaptas.Helpers`): función pura, estática, **no se inyecta ni se mockea**. Maneja: `Encryption` (SHA256), `HelpersJson` (JSON), `HttpHelper` (HTTP genérico), `DbHelper` (params/DataTable para SPs — sabor legado), `ObjectExtensions`, `Extensions/`, `Settings/` (POCOs de config).
- **Servicio `_Shared/<Area>/`**: tiene dependencias, toca BD/tenant/dominio, **se inyecta por interfaz y se mockea**. NO es un helper. Ej: `SpRunner`, `CurrentUserProvider`, `OperationWriter`, `StockMovementWriter`.
- Al migrar un módulo a EF, deja de usar `DbHelper`/`SpRunner`; `Encryption`/`HelpersJson`/`HttpHelper` se quedan.

## 9. Registro de módulos

El tablero vivo de **toda la refactorización** está en un archivo aparte, junto a
este: **`REGISTRO-MODULOS.md`**. Ahí está la lista completa (negocio + infra
`_Shared` + legado pendiente) con zona, tests y deuda.

**Actualizar en cada cierre (C3).** Cabecera obligatoria en cada archivo nuevo/limpio:
`// LIMPIO Features/Reportes — nuevo — tests: 8 — 2026-06-28`

---

## 10. Git workflow

Ramas (sin push directo a `main`):
```
main                  ← producción
  └── release/vX.X.X  ← temporal por deploy
        └── pre-produccion   ← entorno de pruebas (deploy automático)
              ├── feature/*  ← nueva funcionalidad  (desde pre-produccion)
              ├── fix/*      ← bug no urgente        (desde pre-produccion)
              ├── refactor/* ← reestructurar         (desde pre-produccion)
              ├── hotfix/*   ← urgente producción    (desde main)
              └── qa         ← validación técnica (PR va aquí primero)
```
```bash
git checkout pre-produccion && git pull
git checkout -b <tipo>/<modulo>-<descripcion>   # feature|fix|refactor|hotfix
git add . && git commit -m "tipo: descripción"  # conventional commits, mensaje corto
git push origin <rama>                           # luego PR → rama qa
```

**Flujo:** rama → implementa → PR a `qa` (revisión técnica) → `pre-produccion` (deploy pruebas) → validación funcional → `release/vX.X.X` → `main`.

---

## 11. Azure DevOps (work items)

Org `esptechnology`, proyecto `KaptasWeb`. Se crean vía API REST + curl con el
token de `~/.azure-env`. **Regla:** no editar el board ni `tasks.md` sin orden
explícita (es responsabilidad de QA-DEV).

Title: `[nombre-cambio] X.Y Descripción corta` · Type: PBI · State: New.
Description HTML con 4 secciones: Objetivo · Criterios de aceptación · Checklist DEV · Definición de Done.

---

## 12. Agentes y Skills de revisión

> **Ya están activos** por existir en disco (no hay que "activarlos"). Esta sección
> es el **mapa de invocación**: qué usar para cada caso, para delegar al correcto en
> vez de opinar de todo desde el main loop. Definición completa en
> `.claude/skills/kaptas-review-protocol/SKILL.md` (contrato único: severidades,
> veredicto, fronteras). `.claude/` no se commitea; este sí.

### Cómo se invocan
| Mecanismo | Quién | Cómo |
|---|---|---|
| Automático | Claude | Si el task matchea el `description`/trigger del agente o skill → delega con tool `Agent`/`Skill` |
| Explícito | Vos | Lo pedís por nombre (*"usá `kaptas-backend`"*, *"pasá el gate de seguridad"*) o skill vía `/kaptas-clean-arch` |

No existe syntax `@agente` en Claude Code: se invoca por nombre natural.

### Los 8 agentes (viven en `.claude/agents/`)
| Agente | Dueño único de… | Cuándo invocarlo |
|---|---|---|
| `kaptas-principal-reviewer` | coordinar, repartir en olas, firmar veredicto final | cambio completo, "revisá esto entero", cierre C1-C4, conflicto de frontera |
| `kaptas-backend` | .NET/EF/CQRS, DI, contrato HTTP, `ResponseVM<T>`, filtros, versionado rutas | algo bajo `Kaptas.API/Features/`, endpoint nuevo, DTO, `Program.cs`, `*ServiceCollectionExtensions` |
| `kaptas-database` | plan SQL, índices, N+1, transacciones, deadlocks, ORM | Query/Command lento, timeout/deadlock, numeración de docs, `SpRunner`/`StockMovementWriter`/`PaymentApplierSqlAdapter` |
| `kaptas-code-reviewer` | SOLID/Clean Code **dentro** de una clase, complejidad, duplicación | "está bien escrita esta clase?", "es SOLID?", code review del diff (OLA 2, diseño firme) |
| `kaptas-qa-tests` | cobertura, diseño de test, tests que mienten | "faltan tests", cobertura, repro rojo (PARCHE B2/B6), VERDE paso D |
| `kaptas-docs` | `REGISTRO-MODULOS.md`, ADRs, cabeceras §9, changelog, API docs | cierre C3, "escribí un ADR", "falta la cabecera §9", doc vs código |
| `kaptas-frontend-angular` | Angular 20.3, RxJS/signals, bundle, a11y (RefactorKaptasWeb) | tocar `RefactorKaptasWeb/src/`, migrar pantalla a `api/v2` |
| `kaptas-observability` | logging, correlación traceId+tenant, PII en logs, métricas | diff que toca `_logger.Log*`, `catch` nuevo, `nlog.config`/`ExceptionMiddleware` |

### Skills que aplican
| Skill | Cubre | Origen |
|---|---|---|
| `kaptas-review-protocol` | contrato único entre los 8 agentes (severidades, veredicto, fronteras, olas) | proyecto (`.claude/skills/`) |
| `kaptas-clean-arch` | arquitectura, zonas LEGADO/PUENTE/NUEVO/LIMPIO, ciclos RECICLADO/VERDE/PARCHE, §1-§4 | global |
| `kaptas-security-gate` | seguridad: aislamiento tenant, IDOR, SQLi, autorización, secretos | global |

### Gate por olas (orden NO negociable)
```
            principal-reviewer  ← recibe el diff, reparte
                    │
OLA 1 (paralelo): clean-arch · security-gate · backend · database · frontend-angular
                    │  (BLOCKER en OLA 1 → CORTA, no se corren 2 y 3)
OLA 2 (diseño firme): code-reviewer · observability
                    │
OLA 3 (código final): qa-tests → docs
                    │
            principal-reviewer  ← veredicto final
```
**Por qué el orden:** tests sobre código que va a cambiar = trabajo tirado; docs antes del final documenta algo inexistente.

### Reglas del gate
- **Un hallazgo = un solo dueño.** Dos agentes no firman el mismo `Service.cs`; la frontera la decide `principal-reviewer`.
- **Precondición:** `dotnet build` verde + tests verdes. No se revisa sobre base rota.
- **Fail fast:** BLOCKER corta las olas siguientes; LEGADO tocado sin characterization test = rechazo inmediato.
- **Severidades:** `BLOCKER` bloquea sin excepción · `MAJOR` bloquea salvo waiver escrito del principal-reviewer (con vencimiento + entrada en `REGISTRO-MODULOS.md`).
- Para revisión de **un solo dominio** → llamá al especialista directo (no al coordinador).
