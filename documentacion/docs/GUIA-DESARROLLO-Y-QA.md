# Guía de Desarrollo y QA — Kaptas ERP

> **Objetivo:** que todos los programadores escriban el código siguiendo **la misma línea**.
> Un módulo escrito por Luis y uno escrito por Joel deben verse y comportarse igual.
> Este documento es la referencia única. Si hay duda, gana lo que dice acá.

**Stack:** .NET 7 · ASP.NET Core Web API · EF Core · SQL Server (multi-tenant: 1 BD por suscripción) · xUnit + Moq · BCrypt.

---

## 1. Reglas de código para TODOS los programadores

Estas reglas no se negocian. Aplican a cualquier código que se escriba.

### ✅ SIEMPRE
| # | Regla | Por qué |
|---|-------|---------|
| 1 | Controller ~30 líneas — solo recibe y delega | La lógica va en el Service, no en el controller |
| 2 | Interfaz `I[X]Service` **antes** que la implementación | Se programa contra el contrato, no contra la clase |
| 3 | **Filtro tenant en TODAS las queries** | Sin él, un cliente ve datos de otro (IDOR) |
| 4 | Al menos **1 test** antes de dar por terminado | Sin test, no está hecho |
| 5 | `AsNoTracking()` en toda lectura | Rendimiento: no trackear entidades que solo se leen |
| 6 | `DateTime.UtcNow` en fechas | Nunca `AddHours(-4)` — la zona horaria se maneja en presentación |
| 7 | Cabecera de estado en el archivo + estado del módulo en el tracking **fuera del repo** (openspec) | Trazabilidad de qué zona está cada módulo, sin archivos de estado dentro del código |

### ❌ NUNCA
| # | Prohibido | Por qué |
|---|-----------|---------|
| 1 | Importar `Kaptas.Services` desde `Features/` | Acopla lo nuevo al legado |
| 2 | Heredar de `BaseService` / usar `IBaseService` | Arrastra dependencias del legado |
| 3 | Lógica de negocio en el controller | El controller solo orquesta |
| 4 | `DateTime.UtcNow.AddHours(-4)` | Fecha con offset hardcodeado |
| 5 | Código muerto comentado | Código anulado con `//`. Git ya lo recuerda → se borra, no se comenta |
| 6 | `SaveChanges` dentro de un loop | Un round-trip a BD por iteración; se acumula y se guarda una vez |
| 7 | Tragar excepciones: `catch(Exception){}` | El error desaparece sin dejar rastro |
| 8 | Borrar o desactivar un test para avanzar | Un test que estorba se arregla, no se apaga |
| 9 | Devolver `200` para ocultar un `500` | Mentirle al cliente sobre un error |
| 10 | "Ya que estoy, refactorizo" en un hotfix a LEGADO | Un hotfix toca lo mínimo. El refactor es otro trabajo |
| 11 | Arreglar un bug sin poder reproducirlo primero | Sin repro no sabés si lo arreglaste |

> **Nota sobre comentarios:** prohibido el *código muerto comentado*. Los comentarios que explican el **por qué** de una decisión son bienvenidos.

---

## 2. Convenciones de nombres y estilo (C# / .NET)

Esto es lo que hace que el código de Luis se vea igual que el de Joel. **No es opcional.**

### Idioma de los identificadores
- **Todo identificador en inglés**: clases, métodos, variables, propiedades, parámetros.
  `CustomerService`, no `ClienteServicio`. `totalAmount`, no `montoTotal`.
- **Comentarios en español** → está bien.
- Excepción: términos de dominio del negocio ya establecidos (nombres de tablas/entidades heredadas). Ante la duda, consistencia con lo que ya existe.

### Casing (mayúsculas/minúsculas)
| Elemento | Convención | Ejemplo |
|----------|-----------|---------|
| Clase / Enum | PascalCase | `InvoiceService`, `PaymentStatus` |
| Interfaz | `I` + PascalCase | `IInvoiceService` |
| Método | PascalCase + verbo | `GetById`, `CreateInvoice` |
| Método asíncrono | sufijo `Async` | `GetByIdAsync` |
| Propiedad pública | PascalCase | `TotalAmount` |
| Variable local / parámetro | camelCase | `customerId`, `totalAmount` |
| Campo privado | `_camelCase` | `_dbContext`, `_logger` |
| Constante | PascalCase | `MaxRetries` |
| DTO | sufijo `Dto` / `Request` | `InvoiceDetailDto`, `InvoiceCreateRequest` |

### Reglas de estilo
- **Nombres descriptivos**, no abreviaturas crípticas: `customerCount`, nunca `cc`.
- **Un archivo = una clase pública.** El nombre del archivo = nombre de la clase.
- **Booleanos con prefijo** `is` / `has` / `can`: `isActive`, `hasPermission`, `canDelete`.
- **Colecciones en plural**: `invoices`, no `invoiceList`.
- `var` cuando el tipo es obvio del lado derecho; tipo explícito cuando no lo es.
- **4 espacios** de indentación, no tabs.
- **Llaves en línea nueva** (estilo Allman — el estándar de C#).
- Un solo `return` claro por camino; evitar returns anidados innecesarios.

### Nombres de tests
Patrón fijo: **`Metodo_Escenario_ResultadoEsperado`**

```csharp
GetById_WhenNotFound_ReturnsNull()
Create_WithoutTenant_ThrowsException()
CalculateTotal_WithDiscount_SubtractsAmount()
```

Así, con solo leer el nombre del test se sabe qué prueba y qué espera.

---

## 3. Cómo se organiza el código — dónde va cada cosa

Hay **solo dos conceptos**. No hay un tercero.

1. **Módulo** — una funcionalidad del sistema, con su pantalla/endpoint. Vive en `Features/<Modulo>/`. Ej: `RepairShop`. **Un módulo es un módulo.**
2. **Share** — la carpeta `_Shared/`. Todo lo que comparten los módulos. **No son módulos**: es lo compartido (infraestructura y servicios que los módulos reutilizan).

> **No existe el "módulo compartido".** Si algo lo usan varios módulos, no es un módulo: es algo que va a **share** (`_Shared/`). Módulo o share, y ya — no se inventan más categorías ni nombres (nada de "Domain").

### Cómo agregar cada cosa

| Lo que vas a agregar | ¿Es un módulo? | Dónde va |
|----------------------|----------------|----------|
| Funcionalidad con pantalla/endpoint (Taller, Ventas…) | **Sí** | `Features/<Modulo>/` |
| Lógica/servicio que usan **varios** módulos (operaciones, NCF, stock…) | No | `_Shared/<Nombre>/` (share) |
| Plomería: conexión, usuario, reloj | No | `_Shared/` (infra, en su subcarpeta) |

**Reglas (no negociables):**
- Lo compartido va a **share una sola vez**. No se duplica en cada módulo (DRY).
- El módulo usa lo de share **por su interfaz**, nunca por la implementación (SOLID). Se inyecta `IOperationWriter`, no `OperationWriter`.
- **Nada suelto** en la raíz de `_Shared/`: cada cosa en su subcarpeta por responsabilidad.

### Estructura de un módulo (`Features/<Modulo>/`)
Todos los módulos siguen esta forma. Sin excepciones.

```
Features/[Modulo]/
├── DTOs/
│   ├── [X]DetailDto.cs
│   ├── [X]ListDto.cs
│   ├── [X]CreateRequest.cs
│   ├── [X]UpdateRequest.cs
│   └── [X]ListRequest.cs
├── I[X]Service.cs        ← la interfaz primero
├── [X]Service.cs         ← la lógica
└── [X]Controller.cs      ← ~30 líneas máximo
```

### Estructura de share (`_Shared/`)
No son módulos: son infraestructura y servicios compartidos, agrupados por responsabilidad.

```
Features/_Shared/
├── Tenancy/      ← infra: conexión tenant, scope, filtro tenant
├── Identity/     ← infra: usuario actual, sucursales
├── Data/         ← infra: ejecutor de SP, reloj de BD
├── Operations/   ← servicio compartido: Operacion + Operacion_Det
├── Fiscal/       ← servicio compartido: NCF
├── Stock/        ← servicio compartido: movimientos de stock
├── Sequences/    ← servicio compartido: numeración
├── Dictionaries/ ← servicio compartido: catálogos
├── Payments/     ← servicio compartido: aplicar pago
└── FeaturesServiceCollectionExtensions.cs   ← registro DI
```

**Namespace:** la infra de `_Shared/` mantiene el namespace `Kaptas.API.Features._Shared` aunque esté en subcarpetas (un solo `using`; C# no exige namespace = carpeta). Cada servicio compartido tiene su propio namespace `Kaptas.API.Features._Shared.<Nombre>`.

**Estado / tracking de un módulo:** NO va en el código. El estado (zona, tests, deuda) se lleva **fuera del repo** — en el tracking del cambio (openspec / tablero). No se crea un archivo de estado dentro de `Features/`.

### DTOs y contratos — el módulo es dueño de los suyos
Un módulo **aislado** trae **su propio DTO**. No comparte tipos con otros módulos ni depende del legado para sus contratos.

- **DTOs de un módulo** → `Features/<Modulo>/DTOs/`. Son suyos. Punto.
- **`Kaptas.DTO`** (proyecto aparte) → es **superficie legada**. Está **congelado**: se usa solo para interoperar con el sistema viejo mientras conviven. Un módulo v2 **no crea** contratos nuevos ahí.
- Si el v2 necesita un tipo que el legado ya tiene (ej. un enum de estados), el módulo declara **el suyo propio** en su carpeta. Es duplicación **transicional y deliberada** — el precio del aislamiento. Desaparece cuando muere el legado. Se declara como **deuda** en el tracking del cambio, no se esconde.
  - Caso vivo: `RepairShopCaseStatus` (v2, en `Features/RepairShop/DTOs/`) coexiste a propósito con `RepairShopCasesEstatusTypeEnum` (legado, en `Kaptas.DTO`). Mismos valores, dueños distintos. No se unifican: unificar acoplaría el v2 al legado.

### Registro en DI — cada módulo registra lo suyo
- Cada módulo trae su **propia** extensión: `Features/<Modulo>/<Modulo>ServiceCollectionExtensions.cs` con `Add<Modulo>()`.
- `_Shared/` registra **solo share** (`AddSharedServices()`). **Share no conoce a los módulos.**
- `Program.cs` es el único que los compone: `AddSharedServices().AddRepairShop().Add…()`. La dependencia siempre va **módulo → share**, nunca al revés.

### Dependencias
| ✅ PERMITIDO | ❌ PROHIBIDO |
|-------------|-------------|
| `ICurrentUserProvider` (Features/_Shared/) | `IBaseService` / `BaseService` |
| Servicio de share vía su interfaz (`IOperationWriter`, `INcfProvider`…) | `Kaptas.Services` (cualquier namespace) |
| `KaptasCoreContext` / `KaptaswebContext` | `ISpExecute` / `IDbService` |
| `Kaptas.DTO` (DTOs compartidos) · `Kaptas.Helpers` (crypto, settings) | Heredar de cualquier clase de `Services/` |

---

## 4. Estándares por zona

El código vive en una de 4 zonas. Las reglas de qué se puede tocar cambian según la zona.

| Zona | Dónde | ¿Se puede tocar? |
|------|-------|------------------|
| **LEGADO** | `Kaptas.Services/` + `Controllers/` | NO, hasta tener tests. Solo hotfix mínimo |
| **PUENTE** | `Features/[Modulo]/` + viejo vivo | Solo el Feature nuevo |
| **NUEVO** | `Features/[Modulo]/` | Es lo que estás creando |
| **LIMPIO** | `Features/[Modulo]/` + viejo eliminado | Refactor libre con tests |

**Movimiento:** LEGADO → PUENTE → LIMPIO. Nunca vuelve atrás.

- En **LEGADO**: hotfix mínimo, registrar la deuda, **sin "ya que estoy, refactorizo"**.
- En **NUEVO/LIMPIO**: TDD, refactor libre.

---

## 5. Antes de pedir revisión — checklist del DEV

El DEV se auto-certifica esto **antes** de abrir el PR:

- [ ] Build: **0 errores + 0 warnings nuevos**
- [ ] Tests **verdes** + al menos **1 test nuevo** (si hay lógica o bug)
- [ ] Interfaz antes que implementación (si es Feature)
- [ ] Controller ~30 líneas
- [ ] **Filtro tenant** en todas las queries
- [ ] `AsNoTracking()` en lecturas
- [ ] `UtcNow` en fechas
- [ ] Sin código muerto comentado
- [ ] No importa `Kaptas.Services`, no hereda de `BaseService`
- [ ] Estado del módulo actualizado en el tracking **fuera del repo** (openspec), no en el código

### Lo que el DEV debe DECIRLE al QA-DEV (5 líneas que ahorran media revisión)
1. **Qué zona** toqué (LEGADO/PUENTE/NUEVO/LIMPIO)
2. **Qué tests** agregué y qué cubren
3. Si toqué queries → **confirmo filtro tenant**
4. Si es fix → **root cause** + **test de reproducción**
5. Si es LEGADO → **deuda técnica registrada**

---

## 6. Qué hace el QA-DEV

El QA-DEV es la puerta técnica. **No confía en el checklist del DEV — reproduce todo de cero.**

### 6.1 Qué NECESITA para trabajar
| Necesita | Por qué |
|----------|---------|
| PR con la plantilla completa | Tipo, zona, descripción, cómo probar |
| Diff **acotado** (no PR gigante) | Un PR enorme no se revisa, se sella |
| Ticket Azure DevOps vinculado | El qué y el por qué |
| Build corriendo local (0 err/warn) | Verifica él mismo |
| Tests corriendo (acceso a BDs `_test`) | Reproduce verde, no cree en capturas |
| Cómo probar (pasos concretos) | Para reproducir el comportamiento |
| Scripts SQL (si hay cambio de schema) | No hay migraciones EF, viajan en el PR |
| Si es PARCHE: test que reproduce el bug | Sin repro no hay fix válido |

### 6.2 Qué VALIDA (en orden de gravedad)

**🔒 A. Seguridad multi-tenant** — lo #1 en Kaptas
- Filtro tenant en **todas** las queries → si falta, es IDOR. **Rechazo inmediato.**

**✔️ B. Correctitud**
- Build 0 errores + 0 warnings nuevos
- Tests verdes reproducidos localmente
- Al menos 1 test nuevo si hay lógica o bug
- Root cause atacado, **no el síntoma**
- HTTP correctos (**no 200 ocultando un 500**)

**🏛️ C. Arquitectura / acoplamiento**
- No importa `Kaptas.Services`
- No hereda de `BaseService`, no usa `IBaseService` / `IDbService` / `ISpExecute`
- Controller ~30 líneas, sin lógica de negocio
- Interfaz antes que implementación

**🧹 D. Clean code**
- Sin código muerto comentado
- Sin `catch(Exception){}` vacío
- Sin `SaveChanges` en loop
- `AsNoTracking()` en lecturas
- `UtcNow` (no `AddHours(-4)`)
- No se borró ni desactivó ningún test

**🗺️ E. Respeto de zona**
- LEGADO: hotfix mínimo, deuda registrada, sin refactor "de paso"
- NUEVO/LIMPIO: TDD

### 6.3 Veredicto
- **Aprueba ✅** → pasa a Pre-implementación
- **Rechaza ❌**
  - **Menor** → el DEV corrige en la **misma rama**
  - **Grave** → **nueva rama** desde `pre-produccion`

---

## 7. Ciclo especial — PARCHE (bug fix)

Un bug no se arregla sin poder reproducirlo primero.

```
B1  Detectar el bug (log, reporte, error 500)
B2  Escribir el test que lo reproduce (ROJO) — OBLIGATORIO, antes del fix
B3  Localizar la zona (LEGADO / PUENTE / NUEVO)
B4  Root cause (la causa, no el síntoma)
B5  Fix según la zona
B6  Regression test (VERDE) — queda para siempre
B7  Postmortem (por qué pasó, por qué no se detectó)
```

> **Regla de memoria:** cada bug = 1 test nuevo. Reproduce (rojo) → fix → verde → queda para siempre.

---

_Última actualización: 2026-07-16 · Referencia única de estándares. Cualquier cambio se discute con el Arquitecto._
