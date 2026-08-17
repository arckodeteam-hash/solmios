# Design: Refactorizar modulo RepairShop (Taller)

Todo lo de este documento salio de leer el codigo y de consultar el servidor de pruebas. Cada afirmacion tiene archivo y linea, o el query que la respalda.

---

## 0. Query del gate — verificar uso en produccion (R0.1)

Correr contra la base de **produccion**, tenant por tenant. Es solo lectura. Devuelve cuantos casos de taller hay y la fecha del mas reciente. La relacion entre la tabla de taller y la cabecera de la operacion es por la columna `idOper` (no por `id`).

```sql
-- Por cada tenant (base kwNN), correr:
USE [kwNN];
SELECT
  COUNT(*)                         AS casos,
  MIN(o.Fecha_Oper)                AS primer_caso,
  MAX(o.Fecha_Oper)                AS ultimo_caso
FROM Operacion_taller t
JOIN Operacion o ON o.id = t.idOper;
```

Interpretacion: si el ultimo caso es de hace meses en todos los tenants, el modulo esta muerto y no se migra. Si hay casos recientes en tenants reales, se continua. En el servidor de pruebas este query dio casi todo vacio (data sembrada); produccion es la que decide.

---

## 1. Mapa del sistema — estado ACTUAL (LEGADO)

```
                        HTTP  api/RepairShop/*
                               │
                               │  ⚠ SIN [Authorize] en ningun endpoint
                               ▼
              ┌────────────────────────────────────┐
              │ RepairShopController.cs (55 LOC)   │
              │ 9 endpoints, delega 1:1            │
              │ ⚠ campo muerto: private int numer  │
              └────────────────┬───────────────────┘
                               │ IRepairShopService
                               ▼
        ┌──────────────────────────────────────────────┐
        │ RepairShopService.cs  (346 LOC, 9 metodos)   │
        └───┬────────┬────────┬────────┬────────┬──────┘
            │        │        │        │        │
   ┌────────┘   ┌────┘   ┌────┘   ┌────┘   ┌────┘
   ▼            ▼        ▼        ▼        ▼
┌────────┐ ┌─────────┐ ┌───────┐ ┌────────┐ ┌──────────────┐
│Kaptas  │ │IBase    │ │IMapper│ │IDbSvc  │ │IBranchService│
│Core    │ │Service  │ │       │ │ISpExec │ │(svc LEGADO)  │
│Context │ │   ❌    │ │  ✅   │ │   ❌   │ │      ❌      │
└───┬────┘ └────┬────┘ └───────┘ └───┬────┘ └──────┬───────┘
    │           │                    │             │
    │           │ Headers HTTP:      │ claim       │ ListUserBranches()
    │           │ company/branch/    │ NameId      │
    │           │ store  ⚠⚠⚠         │ → conn str  │
    ▼           ▼                    ▼             ▼
┌──────────────────────────────────────────────────────────┐
│              SQL Server — BD del tenant (kw21)            │
│                                                           │
│  TABLA (EF):  TipoImpuestos   ← unica lectura via EF Core │
│                                                           │
│  9 STORED PROCEDURES  ← AQUI VIVE TODA LA LOGICA          │
│    P_Taller_Casos_Paging            (All)                 │
│    P_Taller_Get_By_id               (GetById)             │
│    p_Taller_datos_iniciales         (InitialData)         │
│    p_taller_product_insert_upd_grabar (AddRepairShopCase) │
│    p_Taller_Generar_grabar          (GenerateRepairShop)  │
│    P_Taller_Finalizar_Grabar        (CompleteRepairShop)  │
│    P_Taller_Actualiza_Estado_Grabar (ChangeStatus)        │
│    p_taller_upd_grabar              (UpdateHeading)       │
│    P_Taller_Print                   (Print)               │
│                                                           │
│  2 TABLE-VALUED PARAMETERS                                │
│    dbo.Taller_Det_Type    (AddRepairShopCase)             │
│    dbo.DocumentosPago     (Generate / Complete)           │
└───────────────────────────────────────────────────────────┘
```

**Hallazgo estructural:** el servicio no tiene logica de negocio. Es un envoltorio de Dapper sobre 9 SPs. Lo que se migra es el **borde** (resolucion de tenant, mapeo, manejo de errores, HTTP), no las reglas. Esto acota la ambicion del refactor y hay que decirlo de entrada: **los tests unitarios con mocks van a probar poco**; el valor esta en los tests de integracion contra los SPs reales.

---

## 2. Contrato actual — metodo por metodo

| # | Metodo | HTTP | SP invocado | TVP | Filtra tenant? |
|---|---|---|---|---|---|
| 1 | `All` | `GET /All` | `P_Taller_Casos_Paging` | — | Si (header) |
| 2 | `GetById` | `GET /GetById?id` | `P_Taller_Get_By_id` | — | **No** ⚠ |
| 3 | `InitialData` | `GET /InitialData` | `p_Taller_datos_iniciales` | — | Si (header) |
| 4 | `AddRepairShopCase` | `POST` | `p_taller_product_insert_upd_grabar` | `Taller_Det_Type` | Si (header) |
| 5 | `GenerateRepairShopCase` | `POST` | `p_Taller_Generar_grabar` | `DocumentosPago` | **Del body** ⚠⚠ |
| 6 | `CompleteRepairShopCase` | `POST` | `P_Taller_Finalizar_Grabar` | `DocumentosPago` | Si (header) |
| 7 | `ChangeRepairShopStatus` | `PUT` | `P_Taller_Actualiza_Estado_Grabar` | — | **No** ⚠ |
| 8 | `UpdateRepairShopHeading` | `PUT` | `p_taller_upd_grabar` | — | Si (header) |
| 9 | `Print` | `GET /Print?idOper` | `P_Taller_Print` | — | **No** ⚠ |

"Filtra tenant = No" significa que el metodo no pasa `IdCompany`/`IdBranch`/`IdStore` al SP. Si el SP filtra internamente, no lo se: **los SPs no estan versionados en el repo.** Verificar contra la BD antes de cerrar R1.

---

## 3. Hallazgos (defectos encontrados durante el analisis)

### Seguridad

**D1 — `RepairShopController` no tiene un solo `[Authorize]`.**
`RepairShopController.cs` — cero ocurrencias. Y `Program.cs:186-188` solo llama `UseAuthentication()` / `UseAuthorization()`, **sin `FallbackPolicy` ni `AuthorizeFilter` global**. Sin atributo, el endpoint es anonimo.
Comparar: `SalesController` tiene 21 ocurrencias de `Authorize`, `KProductsController` 25. `ExpensesController` y `PurchaseController` tampoco tienen ninguna.
*Atenuante a verificar:* sin token, `DbService.GetConnStringCurrentUser()` (`DbService.cs:30`) encuentra `Claims.Count() == 0` y deja `idUser = Guid.Empty`. Probablemente termina en 500 y no en fuga de datos. **Hay que confirmarlo empiricamente, no asumirlo.**

**D2 — El tenant se define con un header HTTP, sin validar pertenencia.**
`BaseService.cs:141-143`:
```csharp
Company = _httpContextAccessor.HttpContext.Request.Headers["company"].FirstOrDefault(),
Branch  = _httpContextAccessor.HttpContext.Request.Headers["branch"].FirstOrDefault(),
Store   = _httpContextAccessor.HttpContext.Request.Headers["store"].FirstOrDefault()
```
La **base de datos** del tenant si sale del claim `NameId` (seguro). Pero `Company`/`Branch`/`Store` **dentro** de esa base salen de un header que manda el cliente. Nadie valida que el usuario pertenezca a esa compania. Escalada horizontal entre companias de la misma suscripcion.
Alcance: **todo el sistema**, no solo Taller. Cualquier servicio que llame `GetCurrentSpaceWork()`.

**D3 — `GenerateRepairShopCase` acepta el `IdCompany` desde el body.**
`RepairShopService.cs:223-225`:
```csharp
dynamicParameters.Add("IdCompany", generateRepairShopCaseReqDTO.IdCompany ?? int.Parse(currentWorkSpace.Company));
dynamicParameters.Add("IdBranch",  generateRepairShopCaseReqDTO.IdBranch  ?? int.Parse(currentWorkSpace.Branch));
dynamicParameters.Add("IdStore",   generateRepairShopCaseReqDTO.IdStore   ?? int.Parse(currentWorkSpace.Store));
```
Es el **unico** de los 9 metodos que hace esto; los otros ocho usan `int.Parse(currentWorkSpace.Company)` sin alternativa. Y `Generate` es el que graba documentos de pago. Un cliente que mande `IdCompany` en el JSON escribe en la compania que quiera.

### Robustez

**D4 — `GetById` revienta con 500 si el caso no existe.**
`RepairShopService.cs:101-102`: `caseDet = result.Read<...>().FirstOrDefault();` seguido de `caseDet.Details = ...`. Si `FirstOrDefault()` devuelve `null` → `NullReferenceException`. Deberia ser 404. Mismo patron en `InitialData` (`:135-137`) y `AddRepairShopCase` (`:203-204`).

**D5 — `GetById` es `async` y no tiene un solo `await`.**
`RepairShopService.cs:90-117` usa `db.QueryMultiple` (sincrono) dentro de `async Task`. Genera warning CS1998 y bloquea un hilo del pool. Igual en `InitialData:133`.

**D6 — Resultset leido y descartado.**
`RepairShopService.cs:136`: `results.Read<BranchResponseDTO>().ToList();` — el resultado se tira. Parece intencional (avanzar el cursor del `QueryMultiple` para llegar al siguiente resultset), pero no hay ni un comentario que lo diga. El proximo que lo lea lo va a borrar y va a romper `Technicians`.

**D7 — Campo muerto en el controller.**
`RepairShopController.cs:14`: `private int numer = 0;` — nunca se usa. Es uno de los 652 warnings del build (CS0414).

---

## 4. Diseno objetivo (NUEVO/LIMPIO)

```
Kaptas.API/Features/
├── _Shared/                          ← nace con este cambio
│   ├── ICurrentUserProvider.cs       ← reemplaza IBaseService
│   │     Guid UserId  ·  int UserIdInt
│   │     TenantScope Scope { Company, Branch, Store }   ← VALIDADO, no header crudo
│   │     bool IsInRole(string role)
│   ├── ITenantConnectionFactory.cs   ← reemplaza IDbService
│   │     string GetConnectionString()
│   ├── ISpRunner.cs                  ← reemplaza ISpExecute
│   │     Task<IEnumerable<T>> Query<T>(...)
│   │     Task QuerySp(...)  ·  Task<GridReader> QueryMultiple(...)
│   └── IUserBranchesQuery.cs         ← reemplaza IBranchService.ListUserBranches()
│
└── RepairShop/
    ├── DTOs/                         ← movidos de Kaptas.DTO/KaptasCore/RepairShop/
    ├── Persistence/
    │   ├── IRepairShopRepository.cs  ← puerto: los 9 SPs, uno por metodo
    │   └── RepairShopSpRepository.cs ← adapter Dapper. Unico que sabe de SQL.
    ├── IRepairShopFeatureService.cs
    ├── RepairShopFeatureService.cs   ← orquesta: valida tenant, llama repo, mapea
    └── RepairShopController.cs       ← ~30 lineas, con [Authorize]
```

**Decision D-1 — Se conserva el nombre `RepairShop`, no `Taller`.**
Los 14 DTOs, la interfaz y la ruta `api/RepairShop` ya lo usan. Renombrar rompe el front sin ganancia. Los SPs seguiran llamandose `P_Taller_*`. Asimetria heredada, documentada, no arreglada aca.

**Decision D-2 — Los SPs no se tocan.**
No estan versionados y contienen toda la logica. `IRepairShopRepository` los envuelve como caja negra. Deuda registrada: *"la logica de negocio de Taller vive en 9 SPs no versionados"*.

**Decision D-3 — `ISpRunner` en `_Shared` y no un `ISpExecute` importado.**
La regla prohibe importar `Kaptas.Services`. `ISpRunner` es una interfaz nueva en `Features/_Shared/` con su propio adapter Dapper. No hereda ni referencia el viejo.

**Decision D-4 — `IUserBranchesQuery` en vez de llamar a `IBranchService`.**
`InitialData` necesita `_branchService.ListUserBranches()` (`RepairShopService.cs:140`). `IBranchService` es LEGADO y esta prohibido. Dos opciones:

| Opcion | Costo | Riesgo |
|---|---|---|
| **A. Puerto + adapter que reimplementa la query** (recomendada) | Duplica una query | Si `BranchService` cambia, divergen |
| B. Adapter que delega en `IBranchService` (anti-corruption temporal) | Casi cero | Viola la regla de acoplamiento; hay que borrarlo despues |

Recomendacion: **A**, y anotar la duplicacion como deuda hasta que se recicle Branch.

**Decision D-5 — `ICurrentUserProvider` valida la pertenencia del `Company`.**
Aca esta la unica mejora de comportamiento que este cambio SI introduce, y hay que decidirla explicitamente con QA-DEV: el `TenantScope` deja de ser "lo que diga el header" y pasa a ser "el header, verificado contra las companias del usuario". **Eso cambia el comportamiento** y por lo tanto rompe la caracterizacion de R1 a proposito. Si se prefiere no cambiar nada en R2, se difiere a un PARCHE posterior.

---

## 5. El seam (R2)

```
                    IRepairShopService  (contrato, sin cambios)
                              ▲
              ┌───────────────┴───────────────┐
              │   RepairShopServiceRouter     │  ← decide por tenant
              └───────┬───────────────┬───────┘
       flag OFF       │               │      flag ON
                      ▼               ▼
        ┌──────────────────┐  ┌──────────────────────┐
        │ LegacyAdapter    │  │ FeatureAdapter       │
        │  → RepairShop    │  │  → RepairShopFeature │
        │    Service (old) │  │    Service (new)     │
        └──────────────────┘  └──────────────────────┘
```

El flag es **por tenant** (suscripcion). El `RepairShopController` sigue inyectando `IRepairShopService` y no se entera de nada. Ese es el punto: **R3 no toca el controller**.

Fan-in real de `IRepairShopService`, verificado:
```
Kaptas.API/Extension/DependencyInjectionExtender.cs   ← registro DI
Kaptas.API/Controllers/KaptasCore/RepairShopController.cs  ← unico consumidor
Kaptas.Services/Interfaces/IRepairShopService.cs
Kaptas.Services/Implementations/KaptasCore/RepairShopService.cs
```
**Un solo cliente.** R3 es casi trivial en este modulo — que es exactamente por lo que se eligio.

---

## 6. Verificacion de las reglas (C1/C2)

| Regla | Como se cumple |
|---|---|
| Controller ~30 lineas | 9 endpoints, delegacion 1:1. Entra. |
| Interfaz antes que implementacion | `IRepairShopFeatureService` + `IRepairShopRepository` primero |
| `AsNoTracking()` en toda lectura | La unica query EF es `TipoImpuestos` (`:125`). Hoy **no** lo tiene → se agrega |
| Filtro tenant en todas las queries | `TipoImpuestos` ya filtra por `IdCompany`. Los SPs: ver tabla §2 |
| `UtcNow` | El servicio no maneja fechas en C#. Las pone el SP. N/A |
| No importa `Kaptas.Services` | `_Shared/` reemplaza `IBaseService`, `IDbService`, `ISpExecute`, `IBranchService` |
| No hereda `BaseService` | `RepairShopFeatureService` no hereda de nada |
| Sin codigo comentado | Se borra `private int numer` (D7) |
