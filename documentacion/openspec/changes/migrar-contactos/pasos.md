# Migrar Contactos a Features/ — pasos a seguir (v2)

> **v2 — reescrito el 2026-07-19** incorporando 6 revisiones. La v1 queda en
> `pasos-v1-obsoleto.md` con la nota de por qué se cayó: midió 1 SP donde hay 14 y construyó
> todo el plan sobre esa premisa.
>
> Ciclo: **RECICLADO** (el módulo existe en LEGADO). Patrón de referencia: RepairShop v2.
> Reglas de arquitectura: `CLAUDE.md`. Criterio de ubicación: protocolo §7.1.

**Convención de este documento:** todo número lleva al lado el comando que lo re-mide.
Un número sin comando no se escribe. Todo bloque marca `VERIFICADO` (comando corrido, salida
pegada) o `HIPÓTESIS` (requiere acceso a la BD; nadie codea contra esto).

Todos los comandos se corren desde `kaptas-web-api/`.

---

## 1. Radiografía real del legado — VERIFICADO al 2026-07-19

| Qué | Valor real | Comando que lo re-mide |
|---|---|---|
| Controller | `Kaptas.API/Controllers/ContactController.cs` — **21 endpoints** | `grep -c "\[Http" Kaptas.API/Controllers/ContactController.cs` → `21` |
| Service | `Kaptas.Services/Implementations/ContactService.cs` — **734 líneas** | `wc -l Kaptas.Services/Implementations/ContactService.cs` → `734` |
| Métodos de interfaz | **19** | `grep -c "Task\|List<\|bool \|int " Kaptas.Services/Interfaces/IContactService.cs` → `19` |
| **Stored procedures** | **14 invocaciones** | `grep -c "P_Contactos\|p_Contactos" Kaptas.Services/Implementations/ContactService.cs` → `14` |
| DbContexts en uso | **3**: `KaptasCoreContext` 14 · `RestaurantContext` (`_context`) 6 · `KaptaswebContext` 2 | `for p in _kaptasCoreContext _context _kaptaswebContext; do grep -c "$p\." Kaptas.Services/Implementations/ContactService.cs; done` → `14 6 2` |
| Dependencias legado del ctor | `IDbService`, `IBaseService`, `RestaurantContext`, `KaptasCoreContext`, `KaptaswebContext`, `IMapper`, `ISpExecute`, `IDiccionarioService`, `IHttpClientFactory` | `ContactService.cs:40-41` |
| Entidades EF | `Contacto`, `ContactoNumero`, `ContactosRelacionado`, `ContactoPrecioPermitido`, `ContactosTipo`, `ContactoBitacora` | `grep -n "Entity<Contacto" Kaptas.Context/KaptasCoreContext/KaptasCoreContext.cs` |

> **La premisa de la v1 era falsa.** No es "casi todo EF con 1 SP": son **14 SPs**, y el de
> escritura principal usa 4 TVPs y toca 5 tablas. Contactos NO es más barato que Taller — es
> comparable, con más superficie HTTP.

### 1.1 — Los 14 SPs → método (tabla de trabajo, VERIFICADO)

| SP | Línea | Método | Tipo |
|---|---|---|---|
| `P_Contactos_Insert_Update_Grabar` | :484 | Create | **crítico**: 4 TVPs, 5 tablas, numera `Contacto.Secuencia` |
| `P_Contactos_Delete` | :292 | Delete | escritura |
| `P_Contactos_Read_Filter_Paging` | :182 | GetContacts | lectura paginada |
| `P_Contactos_Read_simple_Filter_Paging` | :157 | GetLookups | lectura paginada |
| `P_Contactos_simple_Paging` | :219 | ContactsSimpleList | lectura paginada |
| `P_Contactos_Read_By_Id` | :240 | GetContactById | lectura |
| `P_Contactos_Tipo_Read_By_ContactoId` | :265 | GetContactType | lectura |
| `P_Contactos_Relacionados_Read` | :276 | GetRelatedContacts | lectura |
| `P_Contactos_Relacionado_Insert` | :332 | RelatedContactInsert | escritura TVP |
| `P_Contactos_Relacionados_Delete` | :362 | DeleteRelatedContact | escritura |
| `P_Contactos_Relacionados_Tipo_Relacion_Update` | :392 | UpdateRelatedContactRelationType | escritura |
| `P_Contactos_Ubicacion_Insert_Upd_Grabar` | :609 | UpdateContactLocation | escritura trivial |
| `p_Contactos_Clientes_administrados` | :659 | GetClientesAdministrados | lectura paginada |
| `p_Contactos_Update_Administrado` | :688 | UpdateClienteAdministrado | escritura |

Re-medir: `grep -n "P_Contactos\|p_Contactos" Kaptas.Services/Implementations/ContactService.cs`

**Los 4 TVPs de Create** están en `ContactService.cs:471-474`:
`Contact_Type` · `ContactoNumerosLista` · `Related_Contact_Type` · `dbo.ContactoPrecioPermitido_Type`.

### 1.2 — Cruce con Taller

El frontend del taller consume `Contact/GetLookups`. Cuando Contactos v2 esté validado, ese
consumo cambia de ruta. **Nada de Taller se toca en esta migración** (ver §4, alcance del guard).

---

## 2. Precondiciones bloqueantes — HIPÓTESIS, requieren acceso a la BD

> **Van ANTES de la FASE 0.** Son tres preguntas cuya respuesta cambia el diseño del módulo.
> Codear sin resolverlas es adivinar. Ninguna se puede contestar desde el repo.

### P1 — ¿Quién escribe `ContactoBitacora`?

**Hecho verificado:** cero escrituras desde C#.
`grep -rn "ContactoBitacora" --include=*.cs Kaptas.Services/ Kaptas.API/` → sin `Add`/`Update`.

**Riesgo:** si la escribe el SP y v2 lo reemplaza por EF, la auditoría desaparece **en silencio**
y ningún test lo detecta — el JSON de respuesta es idéntico con y sin bitácora.

```sql
SELECT o.name, o.type_desc
FROM sys.sql_modules m
JOIN sys.objects o ON o.object_id = m.object_id
WHERE m.definition LIKE '%ContactoBitacora%';
```

**Salidas posibles:** (a) la escribe un SP → v2 la replica en EF dentro del mismo `SaveChanges`;
(b) la escribe un trigger → v2 no toca nada pero el `RemoveRange` del Update genera auditoría
falsa (ver §6); (c) nadie la escribe → se declara muerta por escrito y se documenta.

### P2 — ¿Cómo numera `P_Contactos_Insert_Update_Grabar`?

**Hecho verificado:** `Contacto.Secuencia` es `int` no nullable, generado dentro del SP.
`grep -rn "IsolationLevel" --include=*.cs Kaptas.API/ | wc -l` → `0`.

**Riesgo:** si numera con `MAX+1` sin lock, v2 en EF hereda la condición de carrera y dos altas
simultáneas de la misma empresa colisionan.

```sql
EXEC sp_helptext 'P_Contactos_Insert_Update_Grabar';
-- buscar: MAX(Secuencia), sp_getapplock, SEQUENCE, HOLDLOCK, UPDLOCK
```

**Si numera con MAX+1:** v2 necesita `sp_getapplock` o `SEQUENCE` nativa, **más** índice único
`(IdCompany, Secuencia)`. Sin el índice único, el lock es una promesa sin garantía.

### P3 — Forense de PII (ver §7)

```sql
SELECT TOP 100 RequestUrl, RequestQueryString
FROM dbo.Log
WHERE RequestUrl LIKE '%Contact%';
```

Si devuelve filas, la fuga de PII **ya ocurrió** y deja de ser un problema preventivo: pasa a
ser incidente con datos ya persistidos en una tabla compartida entre tenants.

---

## 3. Arquitectura y ubicación

### 3.1 — La regla que reemplaza a la línea 78 de la v1

La v1 decía: *"nada nuevo entra a share salvo que lo usen ≥2 módulos"*. **Eso es falso** y ya
costó un revert en este repo (`9aad5182` → `a3aca1ef`). Se reemplaza por el protocolo §7.1:

> **La pregunta no es cuántos módulos lo usan. Es: si Contactos cambia, ¿esto tiene que cambiar?**
> **Sí → módulo. No → `_Shared/`, aunque hoy lo use uno solo.**

Corolarios:

| # | Corolario |
|---|---|
| a | ¿Tiene dependencias inyectables / hay que mockearlo? → servicio de `_Shared/` con interfaz |
| b | ¿Estoy separando algo de la pieza que lo consume? → frená, rompés cohesión |
| c | "Solo lo usa un módulo" **no decide nada** por sí solo |
| d | **Mecanismo** → `_Shared/` · **valores del dominio** → módulo |
| e | **TEST DEL NOMBRE:** si la interfaz necesita el nombre de un módulo para tener sentido, no va a `_Shared/` |
| f | Un movimiento de ubicación es un cambio de arquitectura: **commit propio**, nunca "de paso" |

### 3.2 — Decisiones de ubicación

| Pieza | Ubicación | Argumento (no es conteo de consumidores) |
|---|---|---|
| **Consulta RNC (DGII)** | `_Shared/Fiscal/IRncLookup` + `RncLookup` | **La v1 lo mandaba al módulo: se INVIERTE.** Si Contactos cambia, la consulta de RNC no cambia. Es identificación fiscal DGII que Facturación y NCF también necesitan. `_Shared/Fiscal/INcfProvider` ya existe |
| **Guard de pertenencia** | `Features/Contacts/IContactOwnershipGuard` | 2º puerto público del módulo, **NO** `_Shared/`. Falla el test del nombre (corolario e): si Contactos cambia qué significa "es tuyo" (baja lógica, alcance por sucursal), el guard cambia con él |
| **SP de ubicación** | módulo, reescrito en EF | Conclusión de la v1 correcta, **argumento equivocado** (usaba conteo). El correcto: la ubicación es un atributo del contacto |
| **Lectura de diccionarios** | `_Shared/Dictionaries/IDictionaryReader` + impl | Mecanismo neutro. `IDictionaryResolver` existente **solo tiene escritura** |
| **Claves de diccionario** | `Features/Contacts/DTOs/ContactDictionaryTypes.cs` | Valores del dominio (corolario d) |
| **Largos de campo** | `Features/Contacts/DTOs/ContactFieldLengths.cs` | Valores del dominio. Los atributos `[MaxText(n)]` viven en `_Shared/Http/Validation/` |

**`IRncLookup` — contrato:**
```csharp
Task<RncLookupResult?> FindAsync(string rnc, CancellationToken ct);
// null       = no encontrado (respuesta legítima del proveedor)
// excepción tipada = falla de red / timeout
// NUNCA null por error de red: eso convierte una caída en "no existe"
```
URL y timeout a `appsettings` (`Fiscal:Rnc:BaseUrl`, `Fiscal:Rnc:TimeoutSeconds`), nunca
hardcodeados.

**`IContactOwnershipGuard` — contrato:**
```csharp
Task<bool> BelongsToCompanyAsync(int contactId, int companyId, CancellationToken ct);
```
NO es un método de `IContactsService`: esa interfaz tiene 19 métodos y Taller se acoplaría a
los 19 para usar 1 (violación de ISP).

**Conflicto resuelto:** `_Shared/` vs módulo lo decidió el coordinador a favor de clean-arch
(módulo). Registrar como ADR.

**Resuelve la deuda #3 del PR de Taller:** `GenerateRepairShopCaseCommand.cs:78` escribe
`request.IdContacto` sin validar, mientras `:61` sí valida la operación.
**ALCANCE:** Contactos entrega el contrato y su test. **Los call sites de Taller NO se tocan
acá** — es diff de Taller, "ya que estoy" está prohibido. La deuda #3 pasa a
*"desbloqueada: contrato disponible"*, no a *"resuelta"*.

### 3.3 — `IDictionaryResolver`: lectura faltante — VERIFICADO

```
grep -n "Task" Kaptas.API/Features/_Shared/Dictionaries/IDictionaryResolver.cs
→ Task<int> CreateOrSelectAsync(int companyId, string type, string desc);   (única)
```

Solo escritura. Se agrega `IDictionaryReader` + `DictionaryReader` en **commit aparte**
(corolario f). `IDiccionarioService` del legado **no se importa** (`Kaptas.Services`, prohibido
por CLAUDE.md §5).

Claves del dominio → `ContactDictionaryTypes`: `contacto_tipo`, `tipo_relacion`,
`documento_tipo`, `categoria_cliente`, `contact_tipo_2`.

### 3.4 — `HttpHelper.GenericGet`: no se usa, no se arregla

Es un servicio disfrazado de helper: `static` (no mockeable), `new HttpClient()` por llamada
(agotamiento de sockets), `catch(Exception){return null}` que traga — y `ContactService.cs:593`
hace `res.Success` sobre ese `null` → `NullReferenceException`.

**Queda intacto:** es LEGADO con otros consumidores (protocolo §7). Se registra como deuda.
Verificación de que Contactos no lo hereda: `grep -rn "HttpHelper" Kaptas.API/Features/Contacts/` → `0`.

### 3.5 — Contención de `_Shared/` — VERIFICADO

| Dato | Valor | Comando |
|---|---|---|
| Áreas en `_Shared/` | **10** | `ls -d Kaptas.API/Features/_Shared/*/ \| wc -l` → `10` |
| LOC de `_Shared/` | **1.942** | `find Kaptas.API/Features/_Shared -name "*.cs" -exec cat {} + \| wc -l` → `1942` |
| Módulos de negocio migrados | **1** | `ls Kaptas.API/Features/` |

1.942 líneas de infra compartida para UN módulo. **Regla nueva:** todo lo que entra a `_Shared/`
entra **con su implementación**. Un puerto en `_Shared/` cuya implementación vive en un módulo es
dependencia invertida disfrazada.

Contactos aporta `IRncLookup`+impl y `IDictionaryReader`+impl. **Cero puertos huérfanos.**

> Contactos es el primer módulo que migra **sin un solo SP**. Si al terminar aparece un
> `ISpRunner` en `Features/Contacts/`, algo se hizo mal.
> `grep -rn "ISpRunner\|SpRunner" Kaptas.API/Features/Contacts/` → debe dar `0`.

### 3.6 — Estructura del módulo

**CQRS no es opcional.** 21 endpoints, 19 métodos, un god-service de 734 líneas es exactamente
lo que estamos desarmando.

**5 controllers**, uno por sub-recurso con identidad propia (tabla propia, ciclo de vida propio,
id propio en la ruta):

| Controller | Endpoints | Ruta | Nota |
|---|---|---|---|
| `ContactsController` | 10 | `api/v2/Contacts` | agregado principal |
| `ContactRelationsController` | 3 | `api/v2/Contacts/{id}/Relations` | — |
| `ContactCatalogsController` | 5 | `api/v2/Contacts/Catalogs` | solo lectura |
| `ContactPricesController` | 1 | `api/v2/Contacts/{id}/Prices` | frontera con Facturación |
| `ManagedClientsController` | 2 | `api/v2/ManagedClients` | otro agregado |

**5 interfaces segmentadas** (ISP), no una de 19 métodos.

```
Features/Contacts/
├── DTOs/          ← contratos propios + ContactFieldLengths + ContactDictionaryTypes
├── Commands/      ← 10
├── Queries/       ← 7
├── Internal/      ← ContactTenantFilter, ContactOwnershipGuard, ContactNumbersMapper
├── I*Service.cs   ← 5 interfaces segmentadas
├── IContactOwnershipGuard.cs   ← 2º puerto público
├── *Controller.cs ← 5
└── ContactsServiceCollectionExtensions.cs
```

### 3.7 — Atributos obligatorios en los 5 controllers

```csharp
[ApiController]
[Authorize]
[ServiceFilter(typeof(ValidateModelFilter), Order = ValidateModelFilter.FilterOrder)]
[ServiceFilter(typeof(ValidateTenantFilter))]
```

**El `Order` explícito NO es opcional.** `ServiceFilterAttribute` implementa `IOrderedFilter`
con su propio `Order = 0` e ignora el de la clase envuelta; sin él, `ValidateModelFilter` corre
**después** del `ModelStateInvalidFilter` de `[ApiController]` (`Order = -2000`) y nunca actúa.
Ya pasó: 7 tests unitarios en verde con el filtro roto. Referencia: `RepairShopController.cs:23`.

---

## 4. Seguridad y desviaciones declaradas

### 4.1 — IDOR vivo en el legado — VERIFICADO

Cuatro métodos sin filtro de empresa:

| Línea | Método | Agravante |
|---|---|---|
| `ContactService.cs:134` | `UpdateContactSigaData` | — |
| `ContactService.cs:534` | `Update` | además hace `RemoveRange` de tipos y relacionados |
| `ContactService.cs:567` | `UpdateContactoImagen` | — |
| `ContactService.cs:621` | `GetAllowedPricesByContactoId` | expone precios de contacto ajeno |

Más `ContactService.cs:123-124`: chequeo de facturas pendientes sin `IdCompany`.

### 4.2 — Autorización desactivada — VERIFICADO

```
grep -n "//.*\[Authorize" Kaptas.API/Controllers/ContactController.cs
→ 6 hits: líneas 27, 32, 76, 81, 87, 93
```

Roles reales comentados: `SYSTEMALL`, `ADDCLI`, `ADDPROV`, `MODCLI`, `MODPROV`, `DELCLI`,
`DELPROV`, `ListContactosCli`, `ListContactosPro`, `ListContactos`.
**Consecuencia hoy: cualquier usuario autenticado borra contactos.**

### 4.3 — Auditoría falsificada — VERIFICADO

`ContactService.cs:326`, `:356`, `:386` pasan `Id_UserCreate = 1` literal a los 3 SPs de
contactos relacionados. En el **mismo archivo**, `:425` y `:543` sí usan `GetCurrentuserIdInt()`.

Si `ContactoBitacora` la escribe el SP (ver P1), la auditoría dice "usuario 1" desde siempre.
**Una auditoría que miente es peor que no tener auditoría**: la primera se cita en una
investigación, la segunda obliga a buscar otra fuente.

### 4.4 — LA TRAMPA CENTRAL: reemplazo del paso 12 de la v1

La v1 mandaba equivalencia byte-a-byte para todo. Con 4 IDOR vivos eso es una trampa:

- si v2 **replica** el legado → replica el IDOR y el test sale **VERDE certificando la fuga**;
- si v2 **corrige** → el test sale **ROJO por hacer lo correcto**.

**Regla nueva:**

> **Equivalencia por defecto, divergencia por excepción declarada.**
> Todo endpoint corre la comparación legacy-vs-v2 **SALVO** los de la tabla de desviaciones.
> Cada exclusión lleva **su test propio, escrito en el mismo commit**. Un endpoint excluido sin
> test propio **no pasa el gate: es un endpoint sin juez**.
> Si en FASE 2 aparece una divergencia no listada, **se para** y se agrega la fila ANTES de
> escribir el código.

### 4.5 — Tabla de desviaciones declaradas

| ID | Endpoint / comportamiento | Legado hace | v2 hace | Test propio obligatorio |
|---|---|---|---|---|
| DEV-01 | `UpdateSigaData` | sin filtro de empresa (`:134`) | guard IDOR | rechazo de contacto ajeno |
| DEV-02 | `Update` | sin filtro de empresa (`:534`) | guard IDOR + diff explícito | rechazo + no-`RemoveRange` |
| DEV-03 | `UpdateImagen` | sin filtro de empresa (`:567`) | guard IDOR | rechazo de contacto ajeno |
| DEV-04 | `PreciosPermitidos` | expone precios ajenos (`:621`) | contacto ajeno → **lista vacía, NO 404** | 404 permitiría enumerar contactos por id |
| DEV-05 | `GetById` | flag de facturas pendientes sin `IdCompany` (`:123-124`) | flag calculado con `IdCompany` | flag correcto cross-tenant |
| DEV-06 | `GetRncData` | GET con RNC en query string | **POST con body** | ver §7 (PII) |
| DEV-07 | fallo del proveedor RNC | `catch{return null}` → NRE en `:593` | error de negocio, **no 500** | `HttpMessageHandler` fake: timeout y 500 |
| DEV-08 | autorización y autoría | `[Authorize]` comentado + `Id_UserCreate = 1` | authz por rol + userId real | 403 por rol; autoría = usuario real |

### 4.6 — Guards obligatorios

1. **Guard IDOR antes de toda escritura** (patrón `CompleteRepairShopCaseCommand.cs:70`).
2. **MÁS repetir el filtro dentro del `Where` de la escritura.** No es redundancia: el módulo
   tiene 5 tablas satélite y `Update` hace `RemoveRange`. La defensa no puede depender del
   orden de las sentencias.
3. **Satélites sin `IdCompany` propio** (`ContactoPrecioPermitido`, `ContactoNumero`,
   `ContactosRelacionado`, `ContactosTipo`): se filtran **SIEMPRE por el padre ya validado**,
   nunca por su id suelto.
4. **Mismo mensaje para "no existe" y "es ajeno".** Distinguirlos es un oráculo de enumeración.
5. **El tenant sale del scope, nunca del request.** Ningún DTO `Request` expone `IdCompany`,
   `IdBranch` ni `IdUserCreate`.
   Verificación: `grep -rn "IdCompany\|IdBranch\|IdUserCreate" Kaptas.API/Features/Contacts/DTOs/` → `0`.

---

## 5. Backend — reglas de implementación

| # | Regla | Evidencia / precedente |
|---|---|---|
| B1 | `MaxPageSize = 100` con `Math.Min` **antes** de ir a la BD, y devolver el **PageSize efectivo** en la respuesta | Patrón `RepairShopCaseListQuery.cs:20-33,58`. El legado hace `.ToList().Take(100)` (`ContactService.cs:163`): trae todo del SQL y descarta en memoria |
| B2 | `CancellationToken` end-to-end en **todo** endpoint | `grep -rn "CancellationToken" Kaptas.API/Features/ \| wc -l` → **`0` hoy**. Contactos tiene paginación pesada + llamada HTTP a tercero: es donde más duele |
| B3 | DTOs usan el vocabulario de `_Shared/Http/Validation/`: `[RequiredId]`, `[MaxText(n)]`, `[Positive]`, `[NonNegative]`, `[Percentage]`, `[RequiredDate]` | Largos en `ContactFieldLengths` — mecanismo compartido, valores del dominio |
| B4 | `AddContacts()` registra **a mano** cada Command, Query y Service | **NO hay Scrutor**, pese a CLAUDE.md §2: `grep -rn "Scrutor\|\.Scan(" Kaptas.API/ \| wc -l` → `0`. Olvidar una línea **no rompe el build: rompe el request**. Check de cierre: comparar la lista de `AddScoped<` contra la lista de `private readonly I…` del módulo |
| B5 | Controller: delegación pura. Cada acción una sola expresión `=> Ok(await _service.X(request, ct))`. Cero `if`, cero `foreach`, cero `_core` | Métrica correcta: **líneas por endpoint ≈ 2**, no el total del archivo. Con 5 controllers, "~30 líneas" por archivo es una métrica sin sentido |
| B6 | `/api/documents/types` está declarado con **ruta absoluta** en `ContactController.cs:51` y escapa del prefijo. En v2 va bajo `api/v2/Contacts/Catalogs/documents/types` | Verificación: `grep -rn 'Route("/\|Http\w*("/' Kaptas.API/Features/Contacts/` → vacío |

### 5.1 — Flujo de errores (no negociable)

| Caso | Qué se hace |
|---|---|
| Regla de negocio esperada | `return new ResponseVM<T>(msg, CUSTOM_ERROR)` |
| Validación de entrada | `ValidateModelFilter` → 400 |
| Fallo técnico | `await tx.RollbackAsync();` · `_logger.LogError(ex, "...{Placeholder}", args);` · `throw;` → middleware → 500 |

**NUNCA 200 con cuerpo de error.** El legado lo hace en `ContactService.cs:697-700` y además
filtra `ex.Message` al cliente.
**Ningún `catch (Exception)` del módulo termina sin `throw;`.**
Verificación: `grep -rn -A4 "catch (Exception" Kaptas.API/Features/Contacts/` → cada hit con `throw;`.

---

## 6. Datos

### 6.1 — Índices — HIPÓTESIS, verificar contra `sys.indexes`

**Medido en el contexto scaffoldeado:** los bloques de configuración de las 6 entidades del
módulo (`Contacto`, `ContactoNumero`, `ContactosRelacionado`, `ContactoPrecioPermitido`,
`ContactosTipo`, `ContactoBitacora`) tienen **0 `HasIndex`**.

> **El contexto scaffoldeado es un PROXY, no la cosa.** Puede omitir índices que sí existen en
> la BD. Hay además dos `HasIndex` sobre `IdContacto` fuera de esos bloques
> (`KaptasCoreContext.cs:5278,5282`), lo que confirma que la configuración no es uniforme.
> **Verificar contra `sys.indexes` antes de escribir cualquier migración.**

```sql
SELECT t.name AS tabla, i.name AS indice, i.type_desc,
       STRING_AGG(c.name, ',') WITHIN GROUP (ORDER BY ic.key_ordinal) AS columnas
FROM sys.indexes i
JOIN sys.tables t ON t.object_id = i.object_id
JOIN sys.index_columns ic ON ic.object_id = i.object_id AND ic.index_id = i.index_id
JOIN sys.columns c ON c.object_id = ic.object_id AND c.column_id = ic.column_id
WHERE t.name IN ('Contacto','ContactoNumero','ContactosRelacionado',
                 'ContactoPrecioPermitido','ContactosTipo','ContactoBitacora')
GROUP BY t.name, i.name, i.type_desc;
```

**Si faltan:** `IX_Contacto_Company_Estatus (IdCompany, Estatus) INCLUDE (Nombre, Apellido,
Documento, Secuencia)` + un NC por FK en cada hija. **DDL en ventana**, no en el deploy del módulo.

### 6.2 — Búsqueda

El modelo ya tiene `TelefonosCleaned` y `DocumentoCleaned` — columnas precalculadas que existen
precisamente para búsqueda por prefijo.

En v2: **`StartsWith` → `LIKE 'x%'` sargable**. **NUNCA `Contains` sobre columnas concatenadas**
— ese es el bug de `RepairShopCaseListQuery.cs:93-97`. Si el negocio exige `Contains`, entonces
Full-Text, no un `LIKE '%x%'` sobre una expresión.

### 6.3 — `GetById`: cero `Include` en cascada

El legado tiene 5 `Include`/`ThenInclude` sobre 3 colecciones hermanas (`ContactService.cs:57-60`)
→ producto cartesiano: hasta 120 filas para traer 1 contacto.

**En v2:** proyección `.Select()` + queries batch por `IdContacto` con `Contains`, unidas en
memoria (patrón `RepairShopCaseLinesQuery`).

Estado actual: `grep -rn "\.Include(" Kaptas.API/Features/ | wc -l` → `2`, ambos en
`_Shared/Identity/UserBranchesQuery.cs`. **En módulos de negocio: 0.** Contactos mantiene el 0.

### 6.4 — `Update`: diff explícito, no `RemoveRange`

El legado hace `RemoveRange` + reinserta las colecciones hijas (`ContactService.cs:536-540`):
churn de PKs, fragmenta índices, y **si la bitácora es por trigger genera auditoría falsa**
(cada update aparece como borrado masivo + alta masiva).

**En v2:** diff explícito, solo altas y bajas reales (patrón `keepPieceIds` de
`CreateRepairShopCaseCommand`).

### 6.5 — `Create` con 4 TVPs

Una transacción · `AddRange` por colección hija · **UN solo `SaveChangesAsync`** (EF batchea).
**Prohibido `foreach` con query adentro.**

**Criterio de aprobación: round-trips constantes respecto al número de hijos**, medido con
logging de EF **antes** de aprobar. No vale "los tests pasan".
Precedente de lo que no se repite: `StockMovementWriter.cs:120-128` hace ~8 round-trips por
producto dentro de la transacción.

### 6.6 — Transacciones

`CommandTimeout` explícito e `IsolationLevel` declarado.
`grep -rn "CommandTimeout" Kaptas.API/ Kaptas.Context/ | wc -l` → `0`
`grep -rn "IsolationLevel" Kaptas.API/ | wc -l` → `0`
Hoy todo corre con el techo default de 30 s y el nivel default, sin que nadie lo haya decidido.

**Tres preguntas por transacción:**
1. ¿Qué queda adentro que no debería? — **la llamada HTTP al RNC JAMÁS va adentro.**
2. ¿Qué queda afuera que sí debería?
3. ¿Cuánto vive?

### 6.7 — Truncamiento de `ContactoBitacora`

`ContactoBitacora.ValorAnterior` y `.ValorNuevo` son `HasMaxLength(50)`
(`KaptasCoreContext.cs:1306-1307`), pero `Contacto.Nombre` es 200.

Si v2 escribe bitácora por EF: **truncar explícito**, o revienta a mitad de transacción por un
apellido largo.

---

## 7. Observabilidad

### 7.1 — PII: BLOQUEANTE

**Hechos verificados:**

| Hecho | Comando / referencia |
|---|---|
| `nlog.config:56` persiste `@RequestQueryString` en cada fila de `dbo.Log` | `grep -n "RequestQueryString" Kaptas.API/nlog.config` → `32, 38, 56` |
| `dbo.Log` es una tabla **central compartida entre tenants, SIN columna de empresa** | `grep -in "company\|tenant" Kaptas.API/nlog.config \| wc -l` → `0` |
| `ContactController.cs:102` manda cédula/RNC por query string | `ContactController.cs:102` |
| El listado manda `SearchValue` (nombre/teléfono de persona) | `ContactController.cs` |
| **Hoy no filtra POR ACCIDENTE:** `ContactService` tiene 0 llamadas a `_logger.Log*` | `grep -c "_logger" Kaptas.Services/Implementations/ContactService.cs` → `0` |

> **El primer `LogError` de v2 enciende la fuga.** No hay nada que la contenga salvo la ausencia
> de logs.

**NO se agrega ni un log a Contactos antes de resolverlo.** Dos salidas aceptables:
(a) el RNC y la búsqueda pasan a POST con body (ver DEV-06); (b) se sanitiza
`@RequestQueryString` con un layout renderer que enmascare `rnc`, `searchValue` y `cedula`.

### 7.2 — Frontera de las dos bitácoras

| | `ContactoBitacora` | `dbo.Log` |
|---|---|---|
| Qué es | auditoría de negocio | diagnóstico técnico |
| Dónde | BD del tenant | central, compartida |
| Cómo | transaccional, mismo `SaveChanges` que el cambio | target `async=true` |
| Garantía | atómica con el dato | **bajo presión NLog DESCARTA mensajes** |

`dbo.Log` **no sirve como auditoría**. Decidir en FASE 0 (con P1 resuelta) si v2 escribe
`ContactoBitacora` o se la declara muerta por escrito.

### 7.3 — El módulo no puede confiar en el middleware

`ExceptionMiddleware` **no tiene logger**: `ExceptionMiddleware.cs:16` recibe solo
`RequestDelegate`. **Cada Command loguea antes de relanzar.**

Los `catch` de validación que devuelven `ResponseVM` sin registrar nada **loguean `LogWarning`
antes del `return`** — es un hueco abierto en RepairShop que no se repite acá.

### 7.4 — Tabla evento → nivel → campos (específica de Contactos)

| Evento | Nivel | Campos | Qué NUNCA loguear |
|---|---|---|---|
| Búsqueda de contactos | **MÉTRICA, no log** | contador + duración | `SearchValue` — es nombre/teléfono de persona. Es el log más tentador y el peor |
| Contacto creado/actualizado | Information | `{CompanyId}`, `{ContactId}`, `{ChangedFieldNames}` | **valores** de los campos — los valores van a `ContactoBitacora` |
| Consulta RNC OK | **MÉTRICA** | contador + duración | el RNC |
| Fallo del proveedor RNC | Warning | `{DurationMs}`, `{StatusCode}`, `{RncMasked}` (últimos 4: `***4521`) | el RNC completo |
| Guard IDOR rechazado | Warning | `{UserId}`, `{CompanyId}`, `{ContactId}` pedido, `RequestIP` | **datos del contacto ajeno** — confirmaría su existencia |
| Ubicación actualizada | Information | `{ContactId}` | **lat/long** — geolocalización de persona física |
| Fallo técnico | Error | `ex` como **primer argumento** | la entidad serializada |

### 7.5 — Health check

`grep -rn "AddHealthChecks\|MapHealthChecks" Kaptas.API/ | wc -l` → `0`.

Se agrega `/health/ready` que valide `SqlKaptas`. **La disponibilidad del proveedor RNC va como
MÉTRICA, no en el health check**: si indexa.do cae, Contactos sigue funcionando salvo esa consulta.
Meterlo en el health check haría que un tercero declare caída a nuestra API.

---

## 8. Tests

### 8.1 — Criterio de validez (a la Definición de Done)

> **Cada test de caracterización probó su rojo:** comentar el cuerpo del método legado → el test
> **debe fallar**. Cero `return` condicionales, cero asserts tautológicos, cero `Assert.NotNull`
> como único assert.

Precedentes reales de este repo: `RepairShopValidationContractTests.cs:84` tiene un
`if (...) return;` y pasa en verde **sin asertar nada**; y se llegó a escribir
`Assert.True(true is not false)`.

### 8.2 — Reemplazo de "1 test mínimo por método migrado"

Es una métrica de **conteo**, no de calidad: 19 × `Assert.NotNull` la cumple y no prueba nada.

> **Por método migrado: 1 happy path + 1 negativo de tenant + los edge cases de sus parámetros.**

### 8.3 — FASE 0 clasifica CONTRATO vs DEFECTO

Cada caracterización se clasifica:

| Clase | Qué significa | Destino |
|---|---|---|
| **CONTRATO** | comportamiento que se preserva | test de equivalencia |
| **DEFECTO** | comportamiento que se corrige | tabla de desviaciones §4.5 + test propio |

**Sin esta clasificación, los tests congelan los 4 IDOR como comportamiento correcto.**

### 8.4 — `ValidateTenantFilter` tiene 0 tests HOY

`grep -rln "ValidateTenantFilter" Kaptas.Tests/ | wc -l` → `0`.
**Toda la defensa de tenant de `Features/` cuelga de él.**

Test de **INTEGRACIÓN** contra la app levantada, en FASE 1, **antes de la primera query del
módulo**: `Get_ForeignCompanyHeader_IsRejectedBeforeReachingTheService`.

**Un test unitario NO cuenta** — precedente `ValidateModelFilter`: 7 unitarios verdes con el
filtro sin ejecutarse.

### 8.5 — Resto

| # | Regla |
|---|---|
| T1 | `CurrentUserProvider` real **nunca es SUT**. Solo `Mock<ICurrentUserProvider>` |
| T2 | `GetRncData` **excluido** de la equivalencia byte-a-byte (pega a la red real = flaky). Se prueba con `HttpMessageHandler` fake: timeout y 500 |
| T3 | `ContactoBitacora` rompe la comparación de estado (`FechaModificacion` difiere siempre entre corridas): **declarar columnas normalizadas**. Precedente: `RepairShopApiComparisonTests.cs:188` ya excluye `idOper` por nombre |
| T4 | Paginado: `[Theory]` con `PageIndex` `0,1,-1,int.MaxValue` · `PageSize` `0,101,int.MaxValue` · `SearchValue` `null,"","'--"`, 500 chars |
| T5 | **Concurrencia de `Secuencia`**: 2 `Create` simultáneos misma empresa → assert `COUNT(*) = COUNT(DISTINCT Secuencia)` |
| T6 | Extraer `RepairShopApiAuth` → `Kaptas.Tests/Features/_Shared/FeatureApiAuth.cs` en **PR propio y previo**: `refactor: extrae FeatureApiAuth a Tests/Features/_Shared`, generalizando a `WebApplicationFactory<Program>` con company/branch/store parametrizables |

---

## 9. Fases

### FASE −1 — Precondiciones (§2). BLOQUEANTE
- [ ] P1 resuelta: quién escribe `ContactoBitacora`
- [ ] P2 resuelta: cómo numera `Contacto.Secuencia`
- [ ] P3 resuelta: forense de PII en `dbo.Log`
- [ ] §6.1 resuelto: índices reales contra `sys.indexes`
- [ ] PR previo: `refactor: extrae FeatureApiAuth a Tests/Features/_Shared` (T6)

> Sin P1 y P2 no se escribe una línea de `Create` ni de `Update`. El resto puede avanzar.

### FASE 0 — Caracterización (R1). NO se toca código productivo
1. Listar los 19 métodos y clasificar: usados por el frontend · usados por otros módulos · muertos.
2. Mapear los **14 SPs** (§1.1) al método que los invoca y decidir cuáles se reescriben en EF.
3. Escribir caracterizaciones contra las BDs `_test` — lo que HOY hace, no lo que debería.
4. **Clasificar cada una CONTRATO vs DEFECTO** (§8.3). Los DEFECTO van a la tabla §4.5.
5. Cada caracterización **prueba su rojo** (§8.1).
6. Decidir el destino de `ContactoBitacora` (§7.2).
7. Registrar en este tracking qué métodos quedan FUERA del alcance y por qué.

### FASE 1 — Estructura
8. Rama `feature/contactos-v2` desde `pre-produccion`.
9. **Test de integración de `ValidateTenantFilter`** (§8.4) — antes de la primera query.
10. `Features/Contacts/` con la estructura de §3.6: 5 controllers, 5 interfaces, DTOs propios.
11. Commits aparte (corolario f): `_Shared/Fiscal/IRncLookup`+impl · `_Shared/Dictionaries/IDictionaryReader`+impl.
12. `IContactOwnershipGuard` en el módulo + su test. **Los call sites de Taller NO se tocan.**
13. `Program.cs`: `AddSharedServices().AddRepairShop().AddContacts()`. `AddContacts()` registra a mano (B4).
14. Los 5 controllers con los 4 atributos de §3.7, `Order` explícito incluido.

### FASE 2 — Migrar por tandas
15. **Tanda 1 — lecturas:** Get paginado, GetById, GetLookups, catálogos, precios permitidos.
    EF + `AsNoTracking()` + filtro tenant en TODAS · `MaxPageSize` con `Math.Min` (B1) ·
    `CancellationToken` (B2) · `StartsWith` sargable (§6.2) · cero `Include` en cascada (§6.3).
16. **Tanda 2 — escrituras:** Create, Update, Delete, relacionados, ubicación, cliente administrado.
    Guard IDOR + filtro repetido en el `Where` (§4.6) · transacción con `IsolationLevel` y
    `CommandTimeout` declarados (§6.6) · un solo `SaveChangesAsync` (§6.5) · diff explícito (§6.4).
17. Ubicación (`P_Contactos_Ubicacion_Insert_Upd_Grabar`) → EF dentro del módulo. **Cero `ISpRunner`.**
18. RNC → `_Shared/Fiscal/IRncLookup`. **La llamada HTTP nunca dentro de una transacción.**
19. **Si aparece una divergencia no listada en §4.5: se para y se agrega la fila ANTES de codear.**

### FASE 3 — Validación (el juez)
20. Equivalencia legacy-vs-v2 por endpoint, **salvo** los de §4.5 (patrón `RepairShopApiComparisonTests`).
21. Cada exclusión de §4.5 con **su test propio, en el mismo commit**. Sin test propio → no pasa el gate.
22. Round-trips de `Create` medidos con logging de EF (§6.5).
23. Test de concurrencia de `Secuencia` (T5).
24. Suite completa verde + build 0 errores / 0 warnings nuevos.

### FASE 4 — Convivencia y cierre (R3–R5)
25. v2 sale por `api/v2/Contacts`; el legado sigue vivo en `api/Contact`. El frontend migra
    primero lecturas, después escrituras.
26. Actualizar este tracking y `REGISTRO-MODULOS.md` (C3). Nunca un `.md` dentro de `Features/`.
27. ADR de las decisiones irreversibles: ubicación de `IRncLookup`, ubicación de
    `IContactOwnershipGuard` (conflicto resuelto por el coordinador), corte por ruta.
28. Con 0 tráfico confirmado en el viejo: `[Obsolete("Reemplazado por Features/Contacts")]` y
    desmontar (R4–R5). Recién ahí muere `ContactService`.

---

## 10. Reglas que NO se negocian

| # | Regla |
|---|---|
| 1 | **Equivalencia por defecto, divergencia por excepción declarada.** Endpoint excluido sin test propio = endpoint sin juez = no pasa el gate |
| 2 | **Ubicación:** "si Contactos cambia, ¿esto cambia?". El conteo de consumidores **no decide nada** |
| 3 | Todo lo que entra a `_Shared/` entra **con su implementación**. Cero puertos huérfanos |
| 4 | Un movimiento de ubicación va en **commit propio** |
| 5 | El módulo trae **sus propios DTOs** aunque el legado tenga uno igual (deuda transicional declarada) |
| 6 | Dependencia siempre **módulo → `_Shared/`**, nunca al revés |
| 7 | El tenant sale del **scope**, nunca del request |
| 8 | **Ningún log en Contactos** hasta resolver la fuga de PII de `nlog.config:56` |
| 9 | **NUNCA 200 con cuerpo de error.** Ningún `catch (Exception)` termina sin `throw;` |
| 10 | La llamada HTTP al RNC **jamás** dentro de una transacción |
| 11 | El legado NO se toca (ni "de paso") hasta la FASE 4 |
| 12 | **Cero `ISpRunner` en `Features/Contacts/`** — es el primer módulo que migra sin un solo SP |
| 13 | Commits `feat:`/`refactor:` cortos; PR a `qa` |

---

## 11. Definición de Done — con comandos verificables

**Precondiciones**
- [ ] P1, P2, P3 respondidas y registradas en este archivo (§2)
- [ ] Índices reales verificados contra `sys.indexes`, no contra el contexto scaffoldeado (§6.1)
- [ ] PR previo de `FeatureApiAuth` mergeado (T6)

**Caracterización**
- [ ] Caracterizaciones escritas ANTES de tocar nada, cada una clasificada CONTRATO o DEFECTO
- [ ] Cada caracterización probó su rojo (§8.1)
- [ ] Tabla de desviaciones §4.5 completa; cada fila con su test propio en el mismo commit

**Acoplamiento** — todos deben dar `0`
- [ ] `grep -rn "using Kaptas.Services" Kaptas.API/Features/Contacts/ | wc -l`
- [ ] `grep -rn "BaseService\|IBaseService\|ISpExecute\|IDbService" Kaptas.API/Features/Contacts/ | wc -l`
- [ ] `grep -rn "ISpRunner\|SpRunner" Kaptas.API/Features/Contacts/ | wc -l` (regla 12)
- [ ] `grep -rn "HttpHelper" Kaptas.API/Features/Contacts/ | wc -l` (§3.4)
- [ ] `grep -rn "IdCompany\|IdBranch\|IdUserCreate" Kaptas.API/Features/Contacts/DTOs/ | wc -l` (regla 7)
- [ ] `grep -rn 'Route("/\|Http\w*("/' Kaptas.API/Features/Contacts/ | wc -l` (B6)
- [ ] `grep -rn "\.Include(" Kaptas.API/Features/Contacts/ | wc -l` (§6.3)
- [ ] `grep -rn "DateTime.Now\|AddHours(-4)" Kaptas.API/Features/Contacts/ | wc -l`

**Presencia** — deben dar `> 0` en todo endpoint/lectura
- [ ] `grep -rc "CancellationToken" Kaptas.API/Features/Contacts/*Controller.cs` (B2)
- [ ] `grep -rn "AsNoTracking" Kaptas.API/Features/Contacts/Queries/ | wc -l` == nº de queries
- [ ] `grep -rn "IsolationLevel" Kaptas.API/Features/Contacts/Commands/ | wc -l` (§6.6)
- [ ] `grep -c "\[Authorize\]" Kaptas.API/Features/Contacts/*Controller.cs` → `1` por controller
- [ ] `grep -c "ValidateModelFilter.FilterOrder" Kaptas.API/Features/Contacts/*Controller.cs` → `1` por controller (§3.7)
- [ ] Cabecera §9 en todo archivo: `find Kaptas.API/Features/Contacts -name "*.cs" -exec sh -c 'head -1 "$1" | grep -q "^// \(LIMPIO\|NUEVO\|PUENTE\)" || echo "sin cabecera: $1"' _ {} \;` → vacío

**Revisión manual (no hay comando; se declara explícitamente)**
- [ ] Lista de `AddScoped<` de `AddContacts()` == lista de `private readonly I…` del módulo (B4)
- [ ] Cada `catch (Exception)` del módulo termina en `throw;` (§5.1)
- [ ] Tabla evento→nivel de §7.4 respetada; cero `SearchValue`/RNC/lat-long en logs (§7.1)
- [ ] Round-trips de `Create` constantes respecto al nº de hijos, medidos con logging EF (§6.5)

**Cierre**
- [ ] `dotnet build --nologo -warnaserror` → 0/0
- [ ] `dotnet test --nologo` → verde (re-medir el total; no citar un número de este archivo)
- [ ] `REGISTRO-MODULOS.md` actualizado: zona **PUENTE** mientras `Controllers/ContactController.cs` exista
- [ ] ADRs escritos (paso 27)
- [ ] Deuda #3 de Taller marcada **"desbloqueada: contrato disponible"**, no "resuelta"

---

## 12. Estado de la evidencia

| Bloque | Estado | Nota |
|---|---|---|
| §1 Radiografía | **VERIFICADO** 2026-07-19 | comandos corridos, salidas pegadas |
| §1.1 Los 14 SPs | **VERIFICADO** | `grep -n` con líneas |
| §2 Precondiciones | **HIPÓTESIS** | requiere acceso a la BD |
| §3 Ubicación | **VERIFICADO** (`_Shared` 10 áreas / 1.942 LOC, `IDictionaryResolver` solo escritura) | decisión de ubicación = criterio, va a ADR |
| §4 Seguridad | **VERIFICADO** | 4 IDOR, 6 `[Authorize]` comentados, 3 × `Id_UserCreate = 1` |
| §5 Backend | **VERIFICADO** (Scrutor `0`, CancellationToken `0`, ruta absoluta `:51`) | — |
| §6.1 Índices | **HIPÓTESIS** | el contexto scaffoldeado es un proxy |
| §6.2–6.7 | **VERIFICADO** | `Include` `2` (ambos en `_Shared`), `IsolationLevel` `0`, `CommandTimeout` `0`, bitácora `HasMaxLength(50)` en `:1306-1307` |
| §7 Observabilidad | **VERIFICADO** | `nlog.config:56`, `0` menciones de tenant, `ExceptionMiddleware.cs:16` sin logger, `0` health checks |
| §8 Tests | **VERIFICADO** | `ValidateTenantFilter` con `0` archivos de test |

**Corrección sobre el input de la revisión:** se reportó `0` `.Include(` en `Features/`; el
comando da **`2`**, ambos en `_Shared/Identity/UserBranchesQuery.cs:35,44`. En módulos de negocio
sí es `0`. El plan usa el número medido.

**Verificado al 2026-07-19** · rama: sin commitear (working tree) · plan anterior: `pasos-v1-obsoleto.md`
