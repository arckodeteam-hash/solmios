# 🧩 Pull Request

## 📌 Descripción
- Reescribe el módulo de Taller en una versión nueva (v2) que ya no depende de los procedimientos almacenados: la misma lógica ahora vive en código y responde igual que el sistema viejo, verificado con pruebas que comparan uno contra otro.
- Ordena el código que comparten los módulos y deja cada módulo aislado, con sus propios datos y su propio registro, siguiendo la guía de desarrollo del equipo.
- **Cierra una fuga de datos entre empresas (IDOR).** Al dar de alta un caso se podía apuntar al renglón o a las piezas de **otra empresa** y modificarlos o borrarlos, porque esos identificadores llegaban del cuerpo del pedido sin validarse. Ahora se comprueba que el renglón pertenezca a la operación, y la operación a la empresa del usuario. Hay dos pruebas que reproducen el ataque: fallaban antes del arreglo y pasan después.
- **Acota el tamaño de página del listado a 100.** Antes se podía pedir la empresa entera en un solo request.
- Los errores técnicos se registran con contexto y devuelven 500 en vez de un 200 con `success=false`, que escondía la falla. *(Nota: el mensaje de la excepción todavía viaja al cliente — ver "Deuda conocida" al final.)*
- Se resolvió una consulta repetida que era lenta y se agregó una prueba que confirma que sin sesión no se puede entrar.
- Las respuestas de error de validación pasan por un filtro único (`ValidateModelFilter`), así un 400 tiene siempre la misma forma `ResponseVM`.

---

## 🔗 Issue(s) que resuelve
<!-- Todas las tareas del Taller en Azure DevOps. La sintaxis AB#<id> las VINCULA y notifica
     automáticamente en Azure Boards. NO se usa "closes #" porque eso cerraría un issue de
     GitHub, que es otra cosa. -->
- AB#490 — [Taller] 1.1 Capturar las pantallas de consulta
- AB#491 — [Taller] 1.2 Capturar el alta y la edición de casos
- AB#492 — [Taller] 1.3 Capturar el flujo donde se maneja dinero
- AB#493 — [Taller] 1.4 Endurecer la validación de acceso del módulo
- AB#494 — [Taller] 2.1 Armar la base compartida de módulos
- AB#495 — [Taller] 2.2 Construir el módulo nuevo de Taller
- AB#496 — [Taller] 2.3 Migrar los procedimientos almacenados del taller a código
- AB#497 — [Taller] 2.4 Ordenar la base compartida de módulos
- AB#498 — [Taller] 3.1 Endurecer errores, registros y rendimiento del módulo
- AB#499 — [Taller] 3.2 Registrar la deuda técnica para la fase de limpieza

---

## 🔄 PRs relacionados
- Ninguno. Es el primer PR del módulo Taller v2. (El siguiente será el de Contactos, work item #500.)

---

## 🗄️ Cambios en base de datos (SQL)
- **No hay cambios de esquema.** No se agregan ni modifican tablas ni columnas.
- Los procedimientos del taller viajan versionados en `db/migrations/` solo como **referencia y base de las pruebas** (V001 base, V002 procedimientos del taller, V003/V004 datos de prueba). El módulo v2 **no los modifica**: los reemplaza por código. Cuando se apague el sistema viejo, esos procedimientos se podrán borrar.

```sql
-- Sin cambios de esquema en este PR (ningún ALTER TABLE / CREATE TABLE nuevo).
```

---

## ⚠️ Importante para el equipo de frontend
- El módulo v2 responde igual que el sistema viejo: mismo formato, **mismos nombres de campos**. No se cambió el backend para adaptarlo a la pantalla.
- Por eso **el frontend tiene que acomodarse al response de este sistema**: debe leer los nombres de campo tal como los devuelve el backend. Antes no funcionaba justamente por esto — la pantalla esperaba nombres distintos a los que manda el backend, y por eso se veía "RD$NaN" y columnas vacías (cliente, caso, costo, pendiente).
- Regla clara: **el frontend se adapta al contrato del backend**, no al revés.

### ⚠️ Un cambio de comportamiento a tener en cuenta
El listado (`All`) ahora **tiene un tope de 100 por página** y devuelve los **valores efectivos**, no los que se pidieron:

| Se pide | Legado devolvía | v2 devuelve |
|---|---|---|
| `PageSize=10` | `itemsPerPage: 10` | `itemsPerPage: 10` (igual) |
| `PageSize=999999` | `itemsPerPage: 999999` | **`itemsPerPage: 100`** |

Si la pantalla usa `itemsPerPage` para calcular páginas o para pedir la siguiente, tiene que leer el valor que devuelve la respuesta y no asumir el que mandó. Con los tamaños normales (10, 20, 50) no cambia nada.

---

## ✅ Estado de pruebas
- Suite completa en verde: **121/121, 0 fallos** (`dotnet test`, sin ningún test apagado ni con `Skip`).
- Incluye la comparación por HTTP legado-vs-v2 de los endpoints del taller (mismo request → misma respuesta).
- **Las dos pruebas del IDOR fallaban antes del arreglo y pasan después** — no comprueban solo que la respuesta sea un error, sino que el dato de la otra empresa **no cambió**:

| Prueba | Antes del fix | Después |
|---|---|---|
| `AddRepairShopCase_NewCaseWithForeignDetailId_DoesNotTouchForeignLine` | 🔴 `Expected: Not 4 / Actual: 4` | 🟢 |
| `AddRepairShopCase_ForeignPieceId_DoesNotOverwriteForeignPiece` | 🔴 `Expected: 1320.00 / Actual: 999999.00` | 🟢 |

### Verificación contra la API levantada
Además de las pruebas, se levantó la API real y se le pegó por HTTP con un token válido:

- Los 9 endpoints responden (`401` sin token; `200` con token).
- Los dos ataques quedan rechazados y **el dato de la víctima no se toca**:
  - `IdOper=0` + renglón ajeno → `"No existe el renglon! id 59969"`; renglón intacto y sus piezas sin borrar.
  - Pieza ajena por id → `"Debe especificar una pieza valida!"`; el monto sigue en `1000.00`.
- `PageSize=2147483647` → el servidor responde `itemsPerPage=100`.

---

## 🧾 Deuda conocida (no bloquea este PR)
Queda registrado para la fase de limpieza (AB#499):

1. **Sin permisos por acción.** Cualquier usuario autenticado de la empresa puede facturar, emitir NCF y mover inventario. **No es una regresión**: el controlador viejo (`Controllers/KaptasCore/RepairShopController.cs`) tampoco tiene ningún `[Authorize(Roles=...)]` — ni siquiera `[Authorize]`. Es transversal a legado y v2, y necesita una decisión de negocio sobre qué rol hace qué. **Por eso AB#493 se cierra en la parte de aislamiento por empresa e IDOR, no en la de permisos.**
2. **El mensaje de la excepción llega al cliente.** `ExceptionMiddleware` devuelve `exception.Message`, que en un fallo de base puede incluir nombres de tabla o restricción. Se arregla acotando el `catch` a una excepción de dominio propia.
3. **Claves foráneas sin validar pertenencia** (`IdContacto`, `IdMoneda`, `IdTecnico`, `IdProducto`): se puede atar una operación a un contacto de otra empresa. Es integridad, no fuga de datos.
4. **`Estado` sin validación de valores** en el alta de caso y de renglón, a diferencia de `ChangeRepairShopStatus`, que sí la tiene.
5. **`ServerDataBases.Id=1` del entorno de pruebas apunta a un puerto que rechaza la conexión** (`,1650`; el que funciona es `,1504`). No afecta al código ni a las pruebas (que resuelven la conexión aparte), pero **hoy impide levantar la API contra ese entorno** sin corregir el registro a mano.
