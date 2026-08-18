# Auditoría de arquitectura — Kaptas ERP

> Verificada contra el código real el 2026-07-18, rama `refactor/repair-shop`.
> Alcance: `Kaptas.API/Features/` (63 archivos, 4.358 LOC) + `Kaptas.Tests/` (28 archivos, 105 casos).
> Cada hallazgo lleva `ruta:línea`. Lo que no pudo verificarse está marcado como tal.

---

## 1. Criterio de ubicación (la regla que faltaba)

La pregunta "¿esto va en `_Shared/` o en el módulo?" se responde con **dos preguntas en orden**,
no con "¿se usa en varios lados?".

| Pregunta | Sí | No |
|----------|-----|-----|
| **1. ¿Pertenece a un dominio ajeno al módulo?** | `_Shared/<Area>/` — aunque hoy lo use un solo módulo | seguir a la 2 |
| **2. ¿Tiene dependencias inyectables / hay que mockearlo para testear?** | Servicio `_Shared/` con interfaz | Helper — vive donde se usa |

**Regla dura:** nada entra a `_Shared/` sin (a) pertenecer a un dominio ajeno, o (b) tener ≥2 módulos
consumidores. Sin dependencias inyectables no es servicio: es helper, y va con quien lo usa.

**Por qué el conteo de consumidores solo no alcanza:** hoy hay un único módulo de negocio
(`RepairShop`), así que *todo* `_Shared/` tiene "un solo módulo consumidor". Aplicar el conteo
literal mudaría `INcfProvider` (fiscal), `IPaymentApplier` (pagos) e `IStockMovementWriter`
(inventario) dentro de taller — violando el principio 1. La pertenencia de dominio manda sobre
el conteo.

### Puerto vs implementación

Las interfaces de `_Shared/` son **puertos de 1 método**, no módulos:

```
INcfProvider          13 LOC · 1 método   │  NcfProvider          84 LOC
IStockMovementWriter  10 LOC · 1 método   │  StockMovementWriter 207 LOC
ISequenceNumberProv   19 LOC · 1 método   │  SequenceNumberProv  122 LOC
IDictionaryResolver   17 LOC · 1 método   │  DictionaryResolver   67 LOC
IPaymentApplier       29 LOC · 1 método   │  PaymentApplierSql    88 LOC
```

Cuando exista `Features/Fiscal/`: **el puerto se queda** en `_Shared/` (es lo que impide que taller
dependa del módulo fiscal), **la implementación migra**. No se mueve todo.

**Por qué no crear `Features/Fiscal/` por adelantado:** hoy solo se conoce *lo que taller le pide*.
Crear la carpeta ahora deja que taller le dicte la forma a fiscal; cuando se haga el análisis real
(ciclo VERDE paso A) esa forma estará mal y se rehace igual. Mover 84 líneas después: 10 minutos.
Diseñar mal un módulo por adelantado: semanas.

### Clasificación del `_Shared/` actual

| Área | LOC impl | Qué es | Destino |
|------|----------|--------|---------|
| `Data/` | 68 | Infra pura (`ISpRunner`, `IDatabaseClock`) | `_Shared/` **permanente** |
| `Identity/` | 119 | Infra pura | `_Shared/` **permanente** |
| `Tenancy/` | 99 | Infra pura | `_Shared/` **permanente** |
| `Fiscal/` | 84 | Puerto de dominio | Contrato se queda · impl migra a `Features/Fiscal/` |
| `Payments/` | 88 | Puerto de dominio (adaptador SP aislado) | Contrato se queda · impl migra |
| `Sequences/` | 122 | Puerto de dominio | Contrato se queda · impl migra |
| `Dictionaries/` | 67 | Puerto de dominio | Contrato se queda · impl migra |
| **`Operations/`** | **561** (4 interfaces) | **Módulo disfrazado de infra** | **Candidato a `Features/Operations/`** |
| `Stock/` | 207 (1 método) | Zona gris | A evaluar |
| ~~`Validation/`~~ | — | Helpers sin deps, 1 consumidor | ✅ **Movido** a `RepairShop/DTOs/Validation/` |

---

## 2. Los 8 principios — estado verificado

| # | Principio | RepairShop | `_Shared` | Qué falta |
|---|-----------|-----------|-----------|-----------|
| 1 | Responsabilidad única | ✅ | ✅ | — |
| 2 | Alta cohesión | ✅ | ⚠️ | namespace plano en `_Shared/` |
| 3 | Bajo acoplamiento | ⚠️ | ✅ | SP de otro dominio en `RepairShopService.cs:224` |
| 4 | Encapsulamiento | ✅ | ✅ | — |
| 5 | Interfaz pública clara | ✅ | ✅ | — |
| 6 | Reemplazable | ❌ | n/a | **no hay seam ni feature flag — decisión pendiente** |
| 7 | Testeable | ✅ (diseño) | ✅ | las lecturas no están testeadas |
| 8 | Evolucionable | ⚠️ | n/a | `InitialData()` fuera de CQRS |

### Lo que está limpio (verificado, 0 matches en 63 archivos)

`using Kaptas.Services` · herencia de `BaseService` · `IBaseService` / `ISpExecute` / `IDbService` ·
EF/SQL dentro de un Controller · `DateTime.Now` / `Today` / `AddHours(-4)` · código comentado ·
`catch(Exception){}` vacío · Commands/Queries sin interfaz.
`AsNoTracking()` presente en las 18 clases con lecturas. Todo el tiempo pasa por `IDatabaseClock`.

---

## 3. Hallazgos — ordenados por prioridad

### 🔴 Críticos

| # | Hallazgo | Ubicación | Por qué |
|---|----------|-----------|---------|
| C1 | **Fix de fuga entre empresas sin test.** Si alguien borra el filtro por empresa, la suite queda verde y se reintroduce el leak | `Queries/RepairShopCaseListQuery.cs:12-14` + ausencia en `RepairShopTenantIsolationTests.cs` (7 tests, **los 7 de escritura**) | Protege un fix de seguridad hoy desprotegido |
| C2 | **IDOR latente**: `ExecuteAsync(int caseId)` sin `companyId` en la firma | `Queries/IRepairShopCaseLinesQuery.cs:11` | No explotable hoy (los 2 llamadores pre-validan en `RepairShopCaseDetailQuery.cs:31-46`), pero la firma no lo impide |

### 🟠 Altos

| # | Hallazgo | Ubicación | Por qué |
|---|----------|-----------|---------|
| A1 | `Internal/` con 142 LOC de contrato legacy byte-a-byte y **cero tests**, siendo 100% unit-testeable sin BD | `Internal/LegacySqlFormat.cs` (94) · `Internal/LegacyJsonDetail.cs` (48) | Mejor ratio esfuerzo/valor de toda la auditoría |
| A2 | `SaveChangesAsync` dentro de un loop (indirecto) | `_Shared/Stock/StockMovementWriter.cs:120` → `:200` | 20 piezas = 40+ round-trips dentro de la transacción |
| A3 | 3 Queries (551 LOC) sin test directo; `Print` cubierto por 1 null-check | `CaseListQuery`(216) · `CaseLinesQuery`(192) · `CasePrintQuery`(143) | Las escrituras están blindadas; las lecturas no |
| A4 | Fuga de dominio: único SP ajeno invocado desde el módulo | `RepairShopService.cs:224-231` (`P_Branch_Company_Info`) | Falta `_Shared/Branches/IBranchCompanyInfoProvider` — el patrón ya existe en `IPaymentApplier` |

### 🟡 Medios

| # | Hallazgo | Ubicación |
|---|----------|-----------|
| M1 | HTTP 200 ocultando fallo técnico (timeout SQL / NullReference llegan como 200 OK) | `CreateRepairShopCaseCommand.cs:227-233` · `CompleteRepairShopCaseCommand.cs:155-161` · `GenerateRepairShopCaseCommand.cs:132-138` + `RepairShopController.cs:40,43,46` |
| M2 | `InitialData()` — 67 líneas de consultas EF fuera de CQRS | `RepairShopService.cs:88-155` |
| M3 | Assert absoluto sobre entidad compartida mutable → falso rojo por orden | `RepairShopEquivalenceTests.cs:84-89` (caso 18508) |
| M4 | Test que toca BD sin `[Collection("DatabaseReset")]` → conexión fuera del applock | `SimpleConnectionTest.cs:14` |
| M5 | Filtro tenant ausente (mitigado aguas arriba por `:32-33`) | `UpdateRepairShopHeadingCommand.cs:44-45` |

### 🟢 Bajos

| # | Hallazgo | Ubicación |
|---|----------|-----------|
| B1 | Namespace plano: las 34 clases de `_Shared/` declaran `Features._Shared` sin importar su área → la carpeta no aísla nada | todo `_Shared/` |
| B2 | Cabecera de estado §9 ausente | 63 archivos (0 matches) |
| B3 | `CLAUDE.md` §2/§7 declara "43 unit + 196 integración"; real: **28 unit + 77 integración = 105 casos** | `CLAUDE.md` |
| B4 | `REGISTRO-MODULOS.md:17` declara Tests `—` para Taller; hay 15 archivos de test | `REGISTRO-MODULOS.md` |
| B5 | Volcado de diagnóstico dentro de la suite (sin regla verificable) | `CreateCaseLiveDemoTests.cs:56` |
| B6 | 8 de 91 métodos fuera de `Method_Scenario_ExpectedResult` | ver §5 |
| B7 | IDs de snapshot hardcodeados dispersos (`18508`, `22602`, `17134`) en 8 archivos | `Kaptas.Tests/` |
| B8 | `[Trait]` a nivel método en vez de clase | `SmokeTest.cs:11` |

---

## 4. Decisión pendiente — el seam (principio 6)

**No es deuda técnica: es una decisión de estrategia que no puede tomar el asistente.**

Estado real: `rg "featureflag|UseFeature|tenant.*flag"` sobre `Kaptas.API/` → **0 matches**.
El corte legado→nuevo es **por ruta**: `api/RepairShop` (legado) vs `api/v2/RepairShop`
(`RepairShopController.cs:20`), decidido por el frontend. `Program.cs:102` lo confirma.

Consecuencia: no hay migración cliente-por-cliente, no hay rollback por tenant, y no se puede saber
qué tenant corre qué implementación. **Los pasos R3 y R5 del ciclo RECICLADO no son ejecutables
con este diseño.**

| Opción | Costo | Implicancia |
|--------|-------|-------------|
| **A — Construir el seam** (flag por tenant) | Alto, y **antes del 2º módulo** | Habilita R3/R5 reales. Retrofitearlo sobre 2 módulos ya en `v2` cuesta mucho más |
| **B — Aceptar el corte por ruta** | Cero | Hay que **corregir `CLAUDE.md` §4-R2**, que hoy promete algo que el código no hace |

Dejar el documento prometiendo el flag mientras el código hace versionado de ruta es peor que
cualquiera de las dos: el próximo módulo copia la regla escrita y la incumple igual.

---

## 5. Suite de tests — inventario real

| Métrica | Valor |
|---------|-------|
| Clases de test | 24 |
| `[Fact]` 87 · `[Theory]` 4 · `[InlineData]` 18 | **105 casos** |
| Unit | 3 clases · 28 casos |
| Integration | 21 clases · 77 casos |
| Clases que tocan BD **con** `[Collection]` | 20 / 21 |

**Calidad:** 0 tests sin assert · 0 `Assert.True(true)` · 0 `Skip` · 0 tests comentados ·
91/91 métodos con `[Trait]` · 83/91 cumplen el naming. Credenciales por env/config gitignored.

**El patrón del hueco:** las **escrituras** están fuertemente cubiertas (SP-vs-EF sobre 8 tablas,
golden master, aislamiento de tenant). Las **lecturas** están cubiertas de forma superficial — y
justo ahí vive el fix de seguridad que el módulo introdujo (C1).

### Aislamiento de la suite (implementado 2026-07-17, commit `b0aa007c`)

1. `sp_getapplock` exclusivo sobre `master` sostenido toda la corrida → dos devs contra el mismo
   host se serializan en vez de pisarse (`Fixtures/DatabaseReset.cs:22`).
2. `parallelizeTestCollections: false` → ninguna colección corre mientras otra resetea.
3. `SqlConnection.ClearAllPools()` tras el `RESTORE` → evita el 500 por conexión muerta en el pool.

---

## 6. Orden de ataque sugerido

| Orden | Qué | Costo | Commit |
|-------|-----|-------|--------|
| 1 | C1 — test de aislamiento de empresa en lectura | 30 min | propio |
| 2 | C2 — `companyId` en `IRepairShopCaseLinesQuery` | 10 min | propio (cambia firma pública) |
| 3 | A1 — tests unitarios de `Internal/` (sin BD) | 1 h | propio |
| 4 | M4 — `[Collection]` en `SimpleConnectionTest` | 1 línea | junto a 3 |
| 5 | A4 — `_Shared/Branches/IBranchCompanyInfoProvider` | 1 h | propio |
| 6 | A2 — `SaveChanges` fuera del loop | 2 h | propio (toca camino transaccional) |
| 7 | B1 — namespace por área en `_Shared/` | 30 min | propio (34 archivos) |
| 8 | B3/B4 — corregir cifras de la doc | 15 min | junto a cualquiera |
| — | **Seam** | — | **bloqueado por decisión** |

**Regla de commits:** uno por hallazgo. Mezclar un cambio de firma con un movimiento de archivos
hace el diff irrevisable.

---

## 7. Cambio ya aplicado en esta sesión

| Qué | Estado |
|-----|--------|
| `_Shared/Validation/` (4 archivos) → `RepairShop/DTOs/Validation/` con `git mv` | Aplicado |
| Namespace → `Kaptas.API.Features.RepairShop.DTOs` | Aplicado |
| `using ..._Shared;` quitado de `RepairShopRequests.cs` (verificado: no usaba nada más) | Aplicado |
| Cabecera §9 en los 4 archivos | Aplicado |
| Build `Kaptas.API` | **0 errores** (43 warnings, todos preexistentes del legado) |
| Suite de tests | **pendiente de correr** |
| Commit | **pendiente** |

`_Shared/` quedó con sus 9 áreas reales: `Data`, `Dictionaries`, `Fiscal`, `Identity`, `Operations`,
`Payments`, `Sequences`, `Stock`, `Tenancy`.

> **Nota de método:** en el análisis inicial se reportó que `Positive`/`NonNegative`/`Percentage`
> tenían cero uso y se propuso borrarlos. Era **falso** — se buscó el nombre del archivo
> (`NumericValidationAttributes`) en vez del de las clases. Se usan 9 veces en
> `RepairShopRequests.cs`. No se borró nada. Al contar consumidores, buscar **nombres de tipo**.
