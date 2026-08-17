# Sistema de Itinerarios de Test por Módulo — Kaptas API

**Regla de oro:** nada acá está inventado. Cada tier, cada orden y cada test sale de una métrica medida en el código (`kaptas-web-api/Kaptas.Services/Implementations/`). Alcance: SOLO tests. SOLO este repo.
**Verificado:** 2026-07-07, rama `iniciar-entorno`.

---

## 0. Cómo se mide la testeabilidad (la fórmula, no la opinión)

Por cada service se miden 4 cosas del código, porque son las que determinan cuánto andamiaje pide su test:

| Métrica | Cómo se mide | Por qué importa |
|---|---|---|
| **deps** | `grep -c "private readonly"` | Cada dep hay que satisfacerla para instanciar el service |
| **BaseService** | `grep "BaseService"` | Arrastra `IHttpContextAccessor` (tenant/usuario) → no se instancia solo |
| **SP** | `grep "_spExecute\|QueryWeb\|QueryCore"` | Abre **otra conexión** → rompe el rollback por transacción |
| **HttpContext** | `grep "IHttpContextAccessor"` | Exige levantar la API (`WebApplicationFactory`) para tener request real |

Con eso, cada uno de los **90 services** cae en un tier:

```
TIER 3  usa HttpContext              → WebApplicationFactory (HTTP)      [5]   ← lo más caro
TIER 2  usa BaseService y/o SP       → integración con BD _test (reset) [64]
TIER 1  deps≤2, sin BS, sin SP, sin HTTP → new Service(ctx) + rollback  [21]  ← por acá se empieza
```

**Orden de ataque:** TIER 1 completo → TIER 2 → TIER 3. Gradual de verdad: de menos andamiaje a más. Auth es TIER 3 → **va al final**, no al principio (corrige lo que decían `plan-tests.md` y la primera versión de este doc).

### TIER 1 — los 21 primeros (medidos, con # de deps)

```
ContactAddressesService(1)      CatalogoCuentasService(1)     OperacionesContablesService(1)
PeriodosContablesService(1)     CamionesService(1)            ChoferesService(1)
ParadasService(1)               PreciosRutasService(1)        EnviosRutasParadasService(1)
UnidadesVehiculosService(1)     UnidadesVehiculosAsientosService(1)  ZonasService(1)
GeografiaService(1)             ProductsService(1)            InvoiceService(1)
UploadImageService(1)           PlanificacionesSemanalesService(2)   PlansService(2)
MailSendGridService(2)          PonchadorEventMediator(0)     QzSigningService(0)
```

### TIER 3 — los 5 últimos (medidos)
`AuthService`, `KProductsService`, `PayrollService`, `NotificationsService`, `LanguageService`.

> El detalle de los 64 de TIER 2 se genera con el mismo escaneo cuando lleguemos ahí; hoy no hace falta ordenarlos.

---

## 1. Modelo de aislamiento de BD dedicada (tu tercera pregunta)

Medido en `Fixtures/DatabaseReset.cs`: hoy el reset corre **una vez por colección**, no por test. Eso sirve para leer, pero el primer test que **escribe** contamina al siguiente. Solución medida según lo que hace cada test:

| El test… | Aislamiento | Costo | Aplica a |
|---|---|---|---|
| **Lee** (SELECT / listado / GetById) | Ninguno — comparten BD, reset 1× | ~0 | la mayoría de TIER 1 y 2 |
| **Escribe con 1 solo DbContext** | **Transacción + rollback por test** (nunca commit) | ms | TIER 1 (ej. ContactAddresses Create/Update/Delete) |
| **Cruza conexiones / usa SP que commitea** | Reset por clase (snapshot ~9s) | 9s | TIER 2/3 con `_spExecute` |

El nivel del medio —**tx + rollback**— es el que falta construir. Se estrena en el primer módulo TIER 1 (ContactAddresses usa **solo** `_context`, sin SP, sin segunda conexión → es el caso limpio ideal) y queda de plantilla.

---

## 2. Las 3 plantillas de itinerario (una por tier)

Un itinerario de módulo son siempre los mismos pasos; lo que cambia es el andamiaje según el tier.

### Plantilla TIER 1 (2-3 días)
```
P0  Leer el service entero → listar comportamientos reales (1 test = 1 comportamiento)
P1  Fixture de escritura: TxTestBase (abre tx sobre el ctx, rollback en Dispose)
P2  Tests de LECTURA   (sin tx)         → verde
P3  Tests de ESCRITURA (con TxTestBase) → verde
P4  Documentar deuda encontrada (DateTime.Now, catch genérico) SIN arreglarla (es char.test)
P5  Cierre: filtro dotnet test verde 2× seguidas + fila en REGISTRO-MODULOS.md
```

### Plantilla TIER 2 (3-5 días)
```
Igual que TIER 1, pero:
- No se puede `new Service()` fácil → instanciar con ctx real + mocks de lo periférico
  (IMailService, IConfigurationService) según lo que pida su constructor
- Los tests que llaman SP → reset por clase, no tx
- SPs a verificar se leen del código (usp_*)
```

### Plantilla TIER 3 (5-6 días)
```
P0  Harness HTTP: `public partial class Program {}` en Program.cs (Program.cs:39,201 son top-level)
    + paquete Microsoft.AspNetCore.Mvc.Testing + ApiFactory : WebApplicationFactory<Program>
    apuntando ConnectionStrings:SqlKaptas a las BDs _test
P1  Seed determinista del escenario (usuario/tenant/permisos)
P2  Tests golpeando el endpoint real con HttpClient
P3-P5  igual que TIER 1
```

### Plantilla VERDE (módulo/sistema NUEVO — "creación de sistema")
```
TDD invertido: test PRIMERO (rojo), después el código. No es char.test.
Vive en Features/ (unit con mocks), no en Legacy/. Sigue el TemplateUnitTests.cs.
```

---

## 3. ITINERARIO #1 — ContactAddresses (TIER 1) · instanciado y verificado

Módulo elegido: `ContactAddressesService` — 1 dep (`KaptasCoreContext`), sin BaseService, sin SP, sin HttpContext. Se instancia con `new ContactAddressesService(TestDbFixture.CreateCoreContext())` (fixture ya existe). Ubicación de los tests: `Legacy/ContactAddresses/`.

**Cada test mapea a un comportamiento leído en `ContactAddressesService.cs` (no inventado):**

### Día 1 — Fixture de escritura + Lectura (9 tests, sin tx)
`P1` Crear `Fixtures/TxTestBase.cs`: `IDisposable` que abre `_context.Database.BeginTransaction()` y hace `Rollback()` en `Dispose`.

| Test | Comportamiento real | Evidencia |
|---|---|---|
| `All_SinFiltros_DevuelvePaginado` | retorna `PaginatedItems`, `Pages` mínimo 1 | `AllContactAddresses`, `pagesCount==0?1` |
| `All_PageSizeMayor100_LimitaA100` | `PageSize=500` → `ItemsPerPage=100` | `request.PageSize > 100 ? 100` |
| `All_PageIndexCero_NormalizaA1` | `PageIndex=0` → `1` | `request.PageIndex <= 0 ? 1` |
| `All_FiltraPorContactId` | solo direcciones de ese contacto | `if (request.ContactId.HasValue)` |
| `All_ExcluyeEliminadas` | `IsDeleted=true` no aparece | `.Where(ca => !ca.IsDeleted)` |
| `All_OrdenadasPorAddress` | orden alfabético por Address | `.OrderBy(ca => ca.Address)` |
| `GetById_Existente_DevuelveDto` | trae Dto con `ZonaNombre` | `ca.Zona != null ? ca.Zona.Nombre` |
| `GetById_Inexistente_DevuelveCustomError` | id inválido → CUSTOM_ERROR | `entity != null ? ... : CUSTOM_ERROR` |
| `GetById_Eliminada_DevuelveCustomError` | `IsDeleted` → no la encuentra | `.Where(... && !ca.IsDeleted)` |

### Día 2 — Escritura (7 tests, con `TxTestBase`)

| Test | Comportamiento real | Evidencia |
|---|---|---|
| `Create_ContactoInexistente_Error` | valida FK Contacto | `if (!await _context.Contactos.AnyAsync...)` |
| `Create_Duplicado_Error` | mismo ContactId+Address+!IsDeleted → error | `AnyAsync(ca => ca.ContactId==... && ca.Address==...)` |
| `Create_Valido_InsertaYDevuelve` | inserta y devuelve por `GetById` | `_context.ContactAddresses.Add + SaveChanges` |
| `Update_Inexistente_Error` | id no existe/eliminado → CUSTOM_ERROR | `if (entity == null || entity.IsDeleted)` |
| `Update_ContactoInexistente_Error` | valida FK en update | `if (!await _context.Contactos.AnyAsync...)` |
| `Update_Valido_ActualizaCampos` | persiste cambios | asigna campos + `SaveChanges` |
| `Delete_Existente_MarcaIsDeleted` | **soft delete** (no borra fila) | `entity.IsDeleted = true` |

### Día 3 — Deuda + cierre
`P4` Documentar como char.test (NO arreglar, es LEGADO):
- `CreatedAt/UpdatedAt = DateTime.Now` → viola la regla "solo UtcNow" del proyecto. Deuda registrada.
- `catch { return mensaje genérico }` → traga la excepción real. Deuda registrada.

`P5` Cierre:
- `dotnet test --filter "FullyQualifiedName~ContactAddresses"` → verde, **corrido 2× seguidas** (sin dependencia de orden).
- Crear `Features/REGISTRO-MODULOS.md`, fila: `ContactAddresses · LEGADO · tests: 16 · deuda: [DateTime.Now, catch-genérico]`.
- Commits `test: [contactaddresses] lectura (9)` / `escritura (7)`.

**Salida del itinerario:** 16 char.tests reales, el patrón `TxTestBase` reutilizable, y el modelo de aislamiento probado en el caso limpio.

---

## 4. Cómo se genera el itinerario de CADA módulo siguiente

No se inventa: se deriva de las mismas 4 métricas.

```
1. Escanear el módulo:  deps, BaseService, SP, HttpContext  (script de la sección 0)
2. Tier → plantilla:    TIER1 / TIER2 / TIER3  (sección 2)
3. Leer el service:     1 comportamiento = 1 test  (como en la sección 3)
4. Aislamiento:         lee→nada · escribe-1-ctx→tx · SP→reset  (sección 1)
5. Días:                TIER1≈2-3 · TIER2≈3-5 · TIER3≈5-6
```

Roadmap de TIER 1 (21 módulos ≈ 6-8 semanas a 2-3 días c/u): ContactAddresses → Zonas → Paradas → PreciosRutas → Camiones/Choferes → Contables (CatalogoCuentas, OperacionesContables, PeriodosContables) → resto. Todos comparten `KaptasCoreContext` y el patrón `TxTestBase`.

---

## Definition of Done (por itinerario)
- Tests del módulo verdes, corridos **2× seguidas** sin fallo de orden.
- Nombre `Metodo_Escenario_Resultado`, `[Trait("Category","Integration")]`, aislamiento correcto según tier.
- Cada test rastrea a una línea del service (char.test = documenta lo que HOY hace).
- Deuda encontrada registrada, **no arreglada** (eso es ciclo PARCHE/RECICLADO aparte).
- Fila en `REGISTRO-MODULOS.md` + commits `test: [modulo] ...`.
- Sin credenciales en repo (todo por `TestDbFixture`).

---

## Resumen
`plan-tests.md` decía **qué** (con errores). Esto es el **sistema**: medí 90 services → 3 tiers → 4 plantillas → itinerario por módulo derivado del código. Se empieza por **ContactAddresses** (TIER 1, 16 tests derivados de sus 5 métodos reales), se estrena ahí el aislamiento **tx+rollback** para la BD dedicada, y se sube tier por tier hasta Auth al final.
