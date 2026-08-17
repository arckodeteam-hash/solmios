# Módulo de Ejemplo: Contactos — Estructura Conceptual

**Ciclo:** VERDE (módulo nuevo desde cero)
**Fecha:** 2026-06-29
**Propósito:** Documento de referencia para crear cualquier módulo nuevo

---

## 1. ¿QUÉ ES EL MÓDULO?

El módulo **Contactos** es el encargado de gestionar todas las entidades de personas/empresas con las que interactúa el negocio: clientes, proveedores, vendedores, técnicos, etc.

**Es un módulo CENTRAL** — muchos otros módulos leen datos de Contactos pero no lo modifican directamente.

---

## 2. ¿QUÉ DATOS MANEJA?

### 2.1 Tablas que el módulo ESCRIBE (crea, actualiza, elimina)

| Tabla | Qué almacena | Ubicación en BD |
|-------|-------------|-----------------|
| `Contactos` | Datos principales del contacto (nombre, documento, dirección, crédito, vendedor) | BD tenant (KaptasCoreContext) |
| `ContactoNumeros` | Teléfonos del contacto (celular, casa, trabajo) — múltiples por contacto | BD tenant |
| `ContactosTipos` | Tipo de contacto (cliente, proveedor, ambos) — múltiples por contacto | BD tenant |
| `ContactosRelacionados` | Contactos vinculados entre sí (ej: cliente → proveedor) | BD tenant |
| `ContactoPrecioPermitidos` | Qué precios de venta puede ver/modificar el contacto | BD tenant |
| `ContactoBitacora` | Historial de cambios del contacto | BD tenant |

### 2.2 Tablas que el módulo LEE (solo consulta, nunca modifica)

| Tabla | Qué lee | Por qué |
|-------|---------|---------|
| `Diccionario` | Tipos de documento, tipos de número, categorías de cliente, tipos de relación | Son catálogos del sistema |
| `DatosGeografia` | País, ciudad, sector, provincia del contacto | Está en BD de gestión (KaptaswebContext) |
| `TipoNcf` | Tipos de comprobante fiscal | Catálogo del sistema |
| `Companies` | Datos de la empresa (tenant) | Solo para referencia |
| `Branches` | Datos de la sucursal | Solo para referencia |
| `Users` | Datos del usuario que creó/modificó | Solo para auditoría |

### 2.3 Tablas que LEEN de Contactos (otros módulos que dependen de él)

| Módulo | Qué lee | Cómo |
|--------|---------|------|
| **Ventas (Sales)** | Nombre del cliente en la factura | FK `Operacion.IdContacto` → `Contacto` |
| **Compras (Purchases)** | Nombre del proveedor en la compra | FK `Operacion.IdContacto` → `Contacto` |
| **Caja Chica** | Contacto del movimiento de caja | FK `CajaChicaMovimiento.IdContacto` → `Contacto` |
| **Facturación Electrónica (ECF)** | Datos del cliente para el NCF | FK `Operacion.IdContacto` → `Contacto` |
| **Notas de Crédito** | Cliente de la nota de crédito | FK `Operacion.IdContacto` → `Contacto` |
| **Empleados** | Contacto asociado al empleado | FK `Empleado.IdContacto` → `Contacto` |
| **Productos** | Proveedor del producto | FK `ProductoContactoProveedor.IdContacto` → `Contacto` |
| **Tickets** | Contacto que envía/recibe | Parámetro `@IdContacto` en SPs |
| **Manifiestos** | Embarcador, consignatario | Parámetro `@idContacto` en SPs |
| **Restaurante** | Cliente default de la configuración | FK `RestauranteConfiguracion.IdContactoDefault` → `Contacto` |
| **Cuentas Corrientes** | Contacto de la cuenta corriente | FK `CuentasCorriente.Idcontacto` → `Contacto` |
| **Taller** | Técnico de la operación | FK `OperacionTaller.IdTecnico` → `Contacto` |
| **Recibos de Caja** | Contacto del recibo | FK `ReciboCaja.IdContacto` → `Contacto` |
| **Comisiones** | Vendedor de la comisión | FK `Comision.Vendedor` → `Contacto` |

> **Conclusión:** Contactos es un módulo de ALTO impacto. Si lo mueves, 14+ módulos se afectan.

---

## 3. ¿DE DÓNDE VIENE LA DATA?

### 3.1 Stored Procedures que usa el LEGADO

| SP | Qué hace | Cuándo se usa |
|----|----------|---------------|
| `P_Contactos_Read_Filter_Paging` | Lista contactos con filtros y paginación | Listado principal |
| `P_Contactos_Read_simple_Filter_Paging` | Lista contactos simplificado (lookups) | Combos, búsquedas rápidas |
| `P_Contactos_simple_Paging` | Lista muy simplificada (solo ID + nombre) | Selectores pequeños |
| `P_Contactos_Read_By_Id` | Detalle completo de 1 contacto | Pantalla de detalle |
| `P_Contactos_Tipo_Read_By_ContactoId` | Tipos de un contacto | Detalle |
| `P_Contactos_Relacionados_Read` | Contactos relacionados | Detalle |
| `P_Contactos_Insert_Update_Grabar` | Crear o actualizar contacto | Alta/edición |
| `P_Contactos_Delete` | Eliminar (soft delete) contacto | Baja |
| `P_Contactos_Relacionado_Insert` | Agregar contacto relacionado | Detalle |
| `P_Contactos_Relacionados_Delete` | Eliminar contacto relacionado | Detalle |
| `P_Contactos_Relacionados_Tipo_Relacion_Update` | Cambiar tipo de relación | Detalle |
| `P_Contactos_Ubicacion_Insert_Upd_Grabar` | Actualizar ubicación geográfica | Detalle |

### 3.2 Consultas EF Core que usa el LEGADO

| Tabla | Tipo de consulta | Propósito |
|-------|-----------------|-----------|
| `Contactos` | `.Include()` + `.Where()` | Detalle con números, tipos, relacionados |
| `DatosGeografia` | `.Where().Select()` | Descripción de geografía del contacto |
| `Operacions` | `.AnyAsync()` | Verificar si tiene facturas pendientes |
| `ContactoPrecioPermitidos` | `.Where().OrderBy().Select()` | Precios permitidos del contacto |
| `TipoNcfs` | `.Where().Select()` | Tipos de comprobante (dato auxiliar) |

### 3.3 Llamadas externas

| Servicio | Qué hace | Cuándo |
|----------|----------|--------|
| `api.indexa.do/api/rnc` | Consulta RNC de empresas dominicanas | Botón "Consultar RNC" en el frontend |

---

## 4. ENDPOINTS QUE EXPONE

| Método | Ruta | Qué hace | Auth requerido |
|--------|------|----------|----------------|
| `GET` | `/api/Contacto/{id}` | Detalle de 1 contacto | Sí |
| `GET` | `/api/Contacto` | Listado paginado con filtros | Sí |
| `POST` | `/api/Contacto` | Crear nuevo contacto | Sí |
| `PUT` | `/api/Contacto` | Actualizar contacto | Sí |
| `DELETE` | `/api/Contacto/{id}` | Inactivar contacto | Sí |
| `PUT` | `/api/Contacto/ActualizarImagen` | Cambiar foto del contacto | Sí |
| `PUT` | `/api/Contacto/ActualizarSigaData` | Actualizar datos SIGA | Sí |
| `GET` | `/api/Contacto/precios-permitidos/{id}` | Precios permitidos del contacto | Sí |
| `GET` | `/api/Contacto/datos-auxiliares` | Tipos de doc, categorías, comprobantes | Sí |
| `GET` | `/api/Contacto/clientes-administrados` | Clientes administrados por el usuario | Sí |
| `PUT` | `/api/Contacto/clientes-administrados` | Actualizar crédito del cliente | Sí |
| `GET` | `/api/Contacto/rnc?rnc=...` | Consultar RNC externo | Sí |
| `POST` | `/api/Contacto/relacionados` | Agregar contacto relacionado | Sí |
| `DELETE` | `/api/Contacto/relacionados/{id}` | Eliminar contacto relacionado | Sí |
| `PUT` | `/api/Contacto/relacionados/{id}/tipo` | Cambiar tipo de relación | Sí |
| `PUT` | `/api/Contacto/ubicacion` | Actualizar ubicación | Sí |
| `GET` | `/api/Contacto/tipos` | Tipos de contacto (diccionario) | Sí |
| `GET` | `/api/Contacto/simple` | Listado simplificado | Sí |

---

## 5. PERMISOS QUE NECESITA

| Código | Nombre | Uso |
|--------|--------|-----|
| `SYSTEMALL` | Acceso total | Admin — puede todo |
| `ADDCLI` | Agregar clientes | Crear contacto tipo cliente |
| `ADDPROV` | Agregar proveedores | Crear contacto tipo proveedor |
| `MODCLI` | Modificar clientes | Editar contacto tipo cliente |
| `MODPROV` | Modificar proveedores | Editar contacto tipo proveedor |
| `DELCLI` | Eliminar clientes | Inactivar contacto tipo cliente |
| `DELPROV` | Eliminar proveedores | Inactivar contacto tipo proveedor |
| `ListContactosCli` | Listar clientes | Ver listado de clientes |
| `ListContactosPro` | Listar proveedores | Ver listado de proveedores |
| `ListContactos` | Listar contactos | Ver listado general |

> **Nota:** En el LEGADO, muchos `[Authorize]` están comentados. En el Features nuevo, TODOS deben estar activos.

---

## 6. DEPENDENCIAS DEL MÓDULO

### 6.1 Qué necesita PARA FUNCIONAR

| Dependencia | De dónde | Qué le da |
|-------------|----------|-----------|
| `KaptasCoreContext` | `Kaptas.Context` | Acceso a tablas del tenant |
| `KaptaswebContext` | `Kaptas.Context` | Acceso a `DatosGeografia` (BD de gestión) |
| `ICurrentUserProvider` | `Features/_Shared/` | Tenant (IdCompany, IdBranch) y usuario actual |
| `Diccionario` (tabla) | BD tenant | Catálogos: tipos de doc, tipos de número, etc. |

### 6.2 Qué NO necesita (y por qué)

| Lo que el LEGADO usa | Por qué NO lo necesitamos |
|----------------------|--------------------------|
| `IBaseService` | Reemplazado por `ICurrentUserProvider` |
| `IDbService` | Ya no hace falta — el tenant viene del provider |
| `ISpExecute` | EF Core directo — sin Dapper |
| `IRestaurantContext` | Contactos no maneja restaurantes |
| `IKaptaswebContext` (excesivo) | Solo necesitamos `DatosGeografia`, no todo el contexto |
| `IHttpClientFactory` | Solo para RNC externo — mover a servicio auxiliar |

---

## 7. FLUJO DE INFORMACIÓN

### 7.1 Crear Contacto

```
Frontend envía POST /api/Contacto
    │
    ▼
Controller recibe ContactoCreateRequest
    │
    ▼
Service valida:
    ├── ¿Nombre no está vacío?
    ├── ¿Teléfono incluido?
    └── ¿Documentos válidos?
    │
    ▼
Service escribe en:
    ├── Contactos (registro principal)
    ├── ContactoNumeros (teléfonos)
    ├── ContactosTipos (tipos: cliente/proveedor)
    └── ContactosRelacionados (vínculos)
    │
    ▼
Service retorna ID creado
    │
    ▼
Controller retorna 201 Created
```

### 7.2 Listar Contactos

```
Frontend envía GET /api/Contacto?page=1&size=20&busqueda=juan
    │
    ▼
Controller recibe ContactoListRequest
    │
    ▼
Service:
    ├── Lee IdCompany del ICurrentUserProvider
    ├── Aplica filtros (búsqueda, tipo, estatus)
    ├── Ejecuta consulta (EF Core o SP)
    └── Calcula paginación
    │
    ▼
Controller retorna 200 OK con PaginatedResult
```

### 7.3 Otros módulos leyendo Contactos

```
Ejemplo: Ventas crea una factura
    │
    ▼
SalesService:
    ├── SELECT nombre FROM Contactos WHERE id = @idContacto
    ├── Usa el nombre en la factura
    └── NUNCA modifica Contactos
```

---

## 8. ESTRUCTURA DEL MÓDULO NUEVO

```
Features/Contactos/
│
├── DTOs/                        ← Define QUÉ datos entran y salen
│   ├── ContactoDetailDto        ← Response: detalle completo
│   ├── ContactoListDto          ← Response: item en listado
│   ├── ContactoCreateRequest    ← Request: datos para crear
│   ├── ContactoUpdateRequest    ← Request: datos para actualizar
│   ├── ContactoListRequest      ← Request: filtros de búsqueda
│   ├── ContactoNumerosDto       ← Response/Request: teléfonos
│   └── ContactoRelacionadoDto   ← Response/Request: relacionados
│
├── IContactoService.cs          ← El CONTRATO: qué puede hacer
├── ContactoService.cs           ← La IMPLEMENTACIÓN: cómo lo hace
│
├── IContactoRepository.cs       ← (Opcional) Contrato de acceso a datos
├── ContactoRepository.cs        ← (Opcional) Queries complejas
│
├── ContactoController.cs        ← Los ENDPOINTS HTTP (~30 líneas)
└── README.md                    ← Documentación del módulo
```

### Qué va en CADA carpeta

| Carpeta | Contenido | Ejemplo |
|---------|-----------|---------|
| `DTOs/` | Clases que definen la forma de los datos de entrada y salida | `ContactoDetailDto` tiene `Nombre`, `Apellido`, `Documento` |
| `IContactoService.cs` | Interface con los métodos: Crear, Listar, Obtener, Actualizar, Eliminar | `Task<int> CrearAsync(ContactoCreateRequest request)` |
| `ContactoService.cs` | Implementación de la interface — toda la lógica de negocio | Validaciones, reglas, acceso a BD |
| `IContactoRepository.cs` | (Opcional) Interface para queries complejas | Solo si hay Dapper/SPs |
| `ContactoRepository.cs` | (Opcional) Implementación de queries | Solo si el service no puede con EF Core |
| `ContactoController.cs` | Endpoints HTTP — ~30 líneas máximo | Solo recibe HTTP, delega al service, retorna HTTP |

---

## 9. CHECKLIST PARA CREAR EL MÓDULO

### FASE 1 — Antes de escribir código
```
[ ] Identificar tablas que ESCRIBE (las que modifica)
[ ] Identificar tablas que LEE (solo consulta)
[ ] Identificar módulos que LEEN de este módulo (dependientes)
[ ] Listar SPs que usa el LEGADO (si los hay)
[ ] Listar permisos necesarios
[ ] Definir endpoints HTTP
```

### FASE 2 — Crear estructura
```
[ ] Crear carpeta Features/[Modulo]/
[ ] Crear subcarpeta DTOs/
[ ] Crear I[Modulo]Service.cs (contrato)
[ ] Crear [Modulo]Service.cs (implementación)
[ ] Crear [Modulo]Controller.cs (~30 líneas)
```

### FASE 3 — Lógica de negocio
```
[ ] Mover validaciones del LEGADO
[ ] Reemplazar IBaseService por ICurrentUserProvider
[ ] Agregar filtro IdCompany en TODAS las queries
[ ] Agregar AsNoTracking() en toda lectura
[ ] Usar DateTime.UtcNow (no DateTime.Now)
[ ] Quitar dependencias innecesarias
```

### FASE 4 — Tests
```
[ ] Test de listado (retorna paginación)
[ ] Test de creación (con datos válidos)
[ ] Test de creación (con datos inválidos — lanza error)
[ ] Test de detalle (contacto existente)
[ ] Test de detalle (contacto inexistente — retorna null)
[ ] Test de eliminación (contacto existente)
[ ] Test de eliminación (contacto ya eliminado — retorna false)
```

### FASE 5 — Cierre
```
[ ] Build: 0 errores, 0 warnings nuevos
[ ] Tests: todos verdes
[ ] Controller: ~30 líneas
[ ] NO importa Kaptas.Services
[ ] NO hereda de BaseService
[ ] Entrada en REGISTRO-MODULOS.md
[ ] Commit con prefijo feat:
```

---

## 10. COMPARACIÓN: LEGADO vs NUEVO

| Aspecto | LEGADO (ContactService) | NUEVO (Features/Contactos) |
|---------|------------------------|---------------------------|
| **Archivos** | 1 archivo de 735 líneas | 8-12 archivos de ~50 líneas |
| **Dependencias** | 8 inyecciones | 2-3 inyecciones |
| **Tenant filter** | Manual en cada método | Automático via ICurrentUserProvider |
| **AsNoTracking** | No usa | Siempre en lectura |
| **DateTime** | DateTime.Now | DateTime.UtcNow |
| **Tests** | 0 | 7+ tests |
| **Controller** | 117 líneas, 16 endpoints | ~30 líneas, 5-7 endpoints |
| **SPs** | 12 Stored Procedures | Queries EF Core limpias |
| **Importa de Services?** | ES de Services | NO importa Services |

---

## 11. NOTAS PARA OTROS MÓDULOS

Cuando crees un módulo nuevo, sigue este mismo patrón:

1. **Primero** define las tablas que maneja (ESCRIBE + LEE)
2. **Segundo** identifica quién lee de tus tablas (dependientes)
3. **Tercero** define los endpoints y permisos
4. **Cuarto** crea la estructura de carpetas
5. **Quinto** implementa la lógica
6. **Sexto** escribe tests
7. **Séptimo** registra en REGISTRO-MODULOS.md

> **Regla de oro:** Si un módulo lee de tu tabla pero no la modifica, ese módulo es tu DEPENDIENTE. Si tú lees de la tabla de otro módulo, ese módulo es tu DEPENDENCIA.
