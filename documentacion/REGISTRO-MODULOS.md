# REGISTRO DE MÓDULOS — Tablero de la refactorización

> Estado vivo de la migración **LEGADO → PUENTE → LIMPIO**. Fuente de verdad del
> avance. **Se actualiza en cada cierre de turno (C3).** Reglas y arquitectura en
> `CLAUDE.md`.

**Leyenda de zona:** `LEGADO` (viejo, no tocar sin tests) · `PUENTE` (Feature nuevo
+ viejo aún vivo) · `LIMPIO` (viejo eliminado, refactor libre).
**Estado:** ✅ hecho · 🚧 en curso · ⏳ pendiente · ⚠️ deuda/adaptador.

---

## 1. Módulos de negocio (`Features/`)

| Módulo | Carpeta | Zona | Estado | Tests | Notas |
|--------|---------|------|--------|-------|-------|
| Taller | `Features/RepairShop/` | PUENTE → LIMPIO | 🚧 | — | CQRS (Commands/Queries). 8/9 dependencias migradas a EF; pagos/caja queda como adaptador aislado. |

---

## 2. Infra compartida (`Features/_Shared/<Area>/`)

Colaboradores con dependencias inyectadas (interfaz + mockeables). **No son helpers.**

| Área | Contrato(s) | Estado | Notas |
|------|-------------|--------|-------|
| Data | `ISpRunner`, `IDatabaseClock` | ✅ | Ejecuta SPs / reloj de BD |
| Identity | `ICurrentUserProvider`, `IUserBranchesQuery` | ✅ | Usuario y sucursales del request |
| Tenancy | `ITenantConnectionFactory`, `TenantScope`, `ValidateTenantFilter` | ✅ | Aislamiento multi-tenant |
| Operations | `IOperationWriter`, `IOperationDetailWriter`, `IOperationRecalculator`, `IOperationValidator` | ✅ | Escritura/recálculo de operaciones (EF) |
| Stock | `IStockMovementWriter` | ✅ | Movimientos de inventario en EF |
| Sequences | `ISequenceNumberProvider` | ✅ | Numeración correlativa |
| Dictionaries | `IDictionaryResolver` | ✅ | Resolución de catálogos |
| Fiscal | `INcfProvider` | ✅ | NCF (comprobante fiscal) |
| Payments | `IPaymentApplier` | ⚠️ | Adaptador SQL aislado — límite del dominio pagos/caja |

---

## 3. Helpers puros (`Kaptas.Helpers/`) — PERMITIDO desde Features

Utilidades estáticas, sin estado, sin BD/tenant. **No se inyectan ni se mockean.**

| Helper | Maneja | Salud |
|--------|--------|-------|
| `Encryption` | SHA256 | ✅ se queda |
| `HelpersJson` | serialize/deserialize JSON | ✅ se queda |
| `HttpHelper` | HTTP genérico (GET/POST), query string, base64 de URL | ✅ se queda |
| `ObjectExtensions` | objeto → diccionario | ✅ se queda |
| `Extensions/` | Collection/Enum/IQueryable extensions | ✅ se queda |
| `Settings/` | POCOs de config (Azul, Company, AutoMapper…) | ✅ se queda |
| `DbHelper` | params/DataTable para SPs (Dapper) | ⚠️ sabor legado — cae al migrar a EF |

---

## 4. Legado pendiente (`Kaptas.Services/` + `Controllers/`) — zona LEGADO

Cola de RECICLADO. No tocar sin tests de caracterización (R1). Prioridad: sube al
tope el que acumule 3 bugs o 1 crítico de seguridad/IDOR.

### Controllers legado (12)
`Auth` · `CatalogoCargosAdicionales` · `Contact` · `Mail` · `ManifestApp` ·
`Manifest` · `Ponchador` · `Qz` · `RealtimeDashboard` · `Security` ·
`UiFieldConfiguration` · `User`

### Servicios legado destacados
`AuthService` · `ProductsService`/`ProductService` · `InvoiceService` ·
`CustomerService` · `SubscriptionService` · `CompanyService` · `BranchService` ·
`SecurityService` · `AccountService` · `TicketService` · `PrintService` ·
`KSalesServices` · `KProductsService` · … (ver `Kaptas.Services/Implementations/`)

> `BaseService` / `IBaseService` (`Kaptas.Core`) = raíz del legado. **Nunca heredar
> ni importar desde `Features/`.**

---

## 5. Cómo se actualiza este tablero

En cada cierre (C3): mover la fila de zona/estado, ajustar tests, anotar deuda.
Movimiento permitido solo hacia adelante: `LEGADO → PUENTE → LIMPIO`.
