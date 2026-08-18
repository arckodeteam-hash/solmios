# Proposal: Migrar módulo Contacts (Contactos) — LEGADO a LIMPIO

> **Análisis técnico de respaldo:** [`pasos.md`](./pasos.md). Este documento no lo
> duplica: lo referencia. Si un dato de acá contradice a `pasos.md`, se re-mide con
> el comando y se corrigen los dos.
>
> **Verificado al 2026-07-19** · rama `refactor/contactos-v2` · commit `a3aca1ef`

## Intent

Sacar `ContactService` de la zona LEGADO y llevarlo a `Features/Contacts/` por
ciclo RECICLADO. Es el **segundo RECICLADO del proyecto**: a diferencia de Taller,
el andamiaje (`Features/`, `_Shared/`, CQRS, filtros, infra de tests) ya existe y
se reusa. Lo que este cambio agrega al andamiaje son cuatro puertos nuevos en
`_Shared/` (`Fiscal/IRncLookup`, `Dictionaries/IDictionaryReader`,
`Geography/IGeographyLookup`) y un puerto público del módulo
(`Features/Contacts/IContactOwnershipGuard`) que resuelve una deuda abierta del PR
de Taller.

## Por qué este módulo

| Criterio | Valor al 2026-07-19 | Cómo se re-mide |
|---|---|---|
| LOC del servicio legado | 734 | `wc -l Kaptas.Services/Implementations/ContactService.cs` |
| LOC del controller legado | 116 | `wc -l Kaptas.API/Controllers/ContactController.cs` |
| Endpoints declarados | 21 | `grep -c "\[Http" Kaptas.API/Controllers/ContactController.cs` |
| Métodos públicos del servicio | 21 | `grep -cE "public (async )?Task" Kaptas.Services/Implementations/ContactService.cs` |
| `AsNoTracking()` en todo el servicio | 0 | `grep -c "AsNoTracking" Kaptas.Services/Implementations/ContactService.cs` |
| `[Authorize(Roles=…)]` **comentados** | 6 (líneas 27, 32, 76, 81, 87, 93) | `grep -n "// *\[Authorize" Kaptas.API/Controllers/ContactController.cs` |
| `DateTime.Now` (viola CLAUDE.md §6) | 2 (líneas 428, 546) | `grep -n "DateTime.Now" Kaptas.Services/Implementations/ContactService.cs` |

Contactos es transversal: lo consume prácticamente todo el ERP (ventas, compras,
taller, cuentas por cobrar). Eso lo hace caro de postergar y valioso de migrar
bien: el `IContactOwnershipGuard` que nace acá tapa un agujero que hoy está abierto
en Taller.

## El alcance se derrumbó — y es la mejor noticia del análisis

**VERIFICADO** contra el frontend `RefactorKaptasWeb/`: de los 21 endpoints
declarados, **9 tienen cero llamadas**. De los 21 métodos del servicio, **10 se
migran**.

**Vivos (con cantidad de llamadas en `RefactorKaptasWeb/`):**

| Endpoint | Llamadas | Endpoint | Llamadas |
|---|---|---|---|
| `GetLookups` | 13 | `LoadData` | 2 |
| `GetById` | 9 | `GetRncData` | 2 |
| `types` | 3 | `Delete` | 2 |
| `GetPreciosPermitidos` | 3 | `Create` | 2 |
| `Get` | 3 | `UpdateSigaData` | 1 |
| `GetClientesAdministrados` | 1 | `UpdateClienteAdministrado` | 1 |

**Muertos (0 llamadas):** `ContactsSimpleList` · `UpdateContactoImagen` ·
`GetContactById` · `GetContactType` · `GeType` · `/api/documents/types` ·
`PUT ContactLocation` · y **todo el subsistema de contactos relacionados**
(`RelatedContactInsert`, `DeleteRelatedContact`, `UpdateRelatedContactRelationType`,
`GetRelatedContacts`).

Dos hallazgos que ordenan el trabajo:

1. **El subsistema de relaciones está muerto de punta a punta.** 0 llamadas del
   frontend, tabla `Contactos_relacionados` con **0 filas**, y los 3 métodos de
   escritura pasan `Id_UserCreate = 1` literal
   (`ContactService.cs:326,356,386` — `grep -n "Id_UserCreate" …`). La escritura
   real de relaciones ya ocurre dentro de `Create` vía table-valued parameter.
   **No se migra ningún controller de Relations.**
2. **`PUT Contact/Update` está muerto:** el frontend hace upsert por
   `POST Contact/Create`. Es el peor código del archivo (IDOR + `RemoveRange`
   destructivo + NRE sin null-check). **No se migra.**

### Decisión sobre los muertos — no se borran todavía

Se marcan `[Obsolete]` y **NO se eliminan** hasta tener **30 días de log de acceso
en PRODUCCIÓN con 0 tráfico por ruta**.

Razón: la evidencia de "0 llamadas" cubre únicamente `RefactorKaptasWeb/`. No cubre
apps móviles, integraciones de terceros ni scripts. Es una acción destructiva
respaldada por un conteo, y el protocolo §0 exige un **segundo camino de
verificación independiente** antes de actuar. El log de producción es ese segundo
camino.

## Scope

**Dentro:**
- Los 10 métodos vivos de `ContactService` y sus DTOs
- 4 controllers nuevos por sub-recurso bajo `api/v2/`
- 3 puertos nuevos en `_Shared/` (`Fiscal/IRncLookup`, `Dictionaries/IDictionaryReader`,
  `Geography/IGeographyLookup`) **cada uno con su implementación** — cero puertos huérfanos
- `Features/Contacts/IContactOwnershipGuard` + su test (el contrato, no los call sites)
- Seed de una **segunda empresa** en las bases `_test` (precondición #1, ver abajo)

**Fuera (explícito):**
- **Los 17 stored procedures.** La lógica vive en SQL Server. Se migra el borde.
- Los 9 endpoints muertos: se marcan `[Obsolete]`, no se migran ni se borran.
- **Los call sites de Taller.** Contactos entrega `IContactOwnershipGuard` y su
  test; quien lo cablea en `GenerateRepairShopCaseCommand.cs:78` es otro cambio.
- **La fuga de PII en `dbo.Log`.** Sale de acá como deuda de sistema separada.
- La semántica de búsqueda multi-token: contrato congelado (ver `design.md` §5).

## Rama base — corrección al plan v1

El plan v1 dice `feature/contactos-v2` desde `pre-produccion`. **Está mal en las dos
mitades.**

`pre-produccion` **no existe**. Solo existe `pre-produccion-joel`:

```bash
git branch -a --format="%(refname:short)" | grep -cx "pre-produccion\|origin/pre-produccion"   # → 0
git branch -a --format="%(refname:short)" | grep -E "^(origin/)?(main|main-test|qa|dev)$"      # → main, origin/dev, origin/main, origin/main-test, origin/qa
```

**Lo correcto:** rama `refactor/contactos-v2`, creada desde `refactor/repair-shop`
(commit `a3aca1ef`). El PR va contra `refactor/repair-shop` hasta que Taller
mergee; después se cambia la base a `main-test`.

Razón de la base — `Features/` no existe en ninguna rama publicada:

```bash
for b in origin/main origin/qa origin/dev origin/main-test; do
  echo -n "$b Features/: "; git ls-tree -r --name-only $b -- Kaptas.API/Features | wc -l
  echo -n "$b Kaptas.Tests/: "; git ls-tree -r --name-only $b -- Kaptas.Tests | wc -l
done
```
→ `Features/` = **0 archivos en las cuatro**. `Kaptas.Tests/` = 0 en main/qa/dev,
**18 en `main-test`** (versión previa, sin la infra de Taller). Toda la fundación
vive en la rama de Taller.

## Relación con el ciclo PARCHE — la trampa de la equivalencia

El plan manda equivalencia byte a byte legacy-vs-v2. Pero el legado tiene IDOR: si
v2 replica fiel, replica la fuga y el test sale **VERDE certificándola**; si v2
corrige, sale **ROJO por hacer lo correcto**. Un test así no juzga: confunde.

**Regla del cambio:** *equivalencia por defecto, divergencia por excepción
declarada.* Todo endpoint corre la comparación **salvo** los de la tabla de
desviaciones de `design.md` §4. Cada exclusión lleva su test propio **en el mismo
commit**. Un endpoint excluido sin test propio no pasa el gate: es un endpoint sin
juez. Si durante la implementación aparece una divergencia no listada, **se para** y
se agrega la fila **antes** de escribir el código.

## Precondición bloqueante — seed de una segunda empresa

Sin dos empresas con contactos propios en `_test`, **ningún test de IDOR puede
fallar en rojo**. Y un fix de seguridad sin test rojo previo no pasa el gate
(CLAUDE.md §6: "arreglar un bug sin poder reproducirlo primero" está prohibido).

Es la precondición #1 del cambio. Detalle del seed en `tasks.md` 1.1.

## Rollback plan

**No hay feature flag.** El corte legado→v2 es **por ruta** (`api/` vs `api/v2/`) y
lo decide el frontend — igual que en Taller. Consecuencia honesta: no hay migración
cliente por cliente ni rollback por tenant.

| Momento | Cómo se revierte |
|---|---|
| v2 desplegado, frontend apuntando al legado | Nada que revertir: v2 no recibe tráfico |
| Frontend movido a `api/v2/` y algo falla | Revertir el **frontend** a `api/`. El legado sigue vivo y compilando |
| Legado marcado `[Obsolete]` | Igual que arriba: `[Obsolete]` no cambia comportamiento |
| Legado eliminado | Revertir el commit. Por eso exige 30 días de log con 0 tráfico |

## Módulos afectados

| Módulo | Zona antes | Zona después |
|---|---|---|
| Contacts | LEGADO | PUENTE (etapas 2–4) → LIMPIO (etapa 5) |
| `_Shared/Fiscal` | existe (`INcfProvider`) | + `IRncLookup` |
| `_Shared/Dictionaries` | existe (`IDictionaryResolver`, solo escritura) | + `IDictionaryReader` |
| `_Shared/Geography` | no existe | NUEVO |
| RepairShop | PUENTE | PUENTE (sin cambios; recibe el contrato del guard, no lo cablea acá) |

## Riesgos

| Riesgo | Mitigación |
|---|---|
| **Pérdida silenciosa de auditoría:** `Contacto_Bitacora` la escribe el SP. Si v2 lo reemplaza por EF y no la escribe, la auditoría desaparece **sin error y sin test que lo note** (el JSON de respuesta es idéntico) | Test dedicado que cuenta filas de bitácora antes y después de una modificación. Es su propia tarea (`tasks.md` 3.2), no un bullet de otra |
| **Ninguna medición de rendimiento contra `kw21` es transferible a producción**: 1 sola empresa y 3.196 contactos → `IdCompany` tiene selectividad cero | Prohibido decidir índices o estrategia de búsqueda con datos de dev. Antes hacen falta volúmenes reales (ver §Pendientes) |
| El modelo EF **miente** sobre los índices: `KaptasCoreContext.cs:5278,5282` declara dos `HasIndex` que **no existen en la base** | Toda decisión de plan se valida contra `sys.indexes`, nunca contra el DbContext |
| Cambiar la búsqueda multi-token cambia **qué filas ve el usuario** | Contrato congelado. Cambiarla es funcional, no refactor: va a desviación declarada con aprobación de negocio, o no va |
| Reactivar los 6 `[Authorize(Roles=…)]` comentados es **cambio observable**: usuarios sin rol pasan de 200 a 403 | Desviación declarada con dueño de negocio. No se reactiva "de paso" |
| `_Shared/Sequences/SequenceNumberProvider.cs:62-72` hace read-modify-write sin lock | **Deuda heredada, no regresión del refactor** (ver `design.md` §6). Contactos v2 nace bien; no se acusa al refactor de haberla creado |

## Pendientes declarados — bloquean decisiones, no el arranque

| # | Pregunta abierta | Qué decide | Cómo se resuelve |
|---|---|---|---|
| P1 | `dbo.dGetDate()`: ¿UTC o local? | Si v2 puede usar `UtcNow` sin cambiar datos escritos | `SELECT dbo.dGetDate(), GETUTCDATE(), GETDATE()` |
| P2 | Nulabilidad y collation de `Contactos` / `Contacto_Bitacora` | La semántica exacta de comparación de la bitácora | `sys.columns` + `sys.types` sobre ambas tablas |
| P3 | Volúmenes de producción: empresas por base y filas en `Contactos` del cliente más grande | Estrategia de índices y de búsqueda | Conteo por tenant contra producción |
