# Spec: Modulo RepairShop (Taller)

Comportamiento observable del modulo, en escenarios Given/When/Then. Es el contrato que la migracion **debe preservar**: si el codigo nuevo se comporta distinto en alguno de estos escenarios (salvo los marcados como defecto a corregir), la migracion esta mal.

Zona afectada: **LEGADO → LIMPIO** (ciclo RECICLADO).

---

## Que hace el modulo

Gestiona ordenes de servicio tecnico: el ciclo completo desde que un cliente trae un equipo a reparar hasta que lo retira pagado. Un caso pasa por cuatro estados: Pendiente, En proceso, Solucionado y Sin solucion. Cada caso tiene un cliente, un tecnico, una descripcion del equipo y su falla, y una lista de lineas donde cada renglon es un servicio o una pieza (comprada afuera, sacada del inventario, o cubierta por garantia).

---

## Requisito: Listar casos de taller

### Escenario: Listado paginado con totales consistentes
- **Given** un tenant con casos de taller registrados
- **When** se pide el listado con un tamano de pagina
- **Then** se devuelve la pagina pedida y los totales de paginacion (cantidad total, primera fila, ultima fila, cantidad de paginas) son coherentes entre si

### Escenario: Filtro por texto de busqueda
- **Given** casos de taller con distintos clientes y numeros de caso
- **When** se pide el listado con un valor de busqueda
- **Then** solo se devuelven los casos que coinciden con ese valor

### Escenario: Filtros por estado y por rangos de fecha
- **Given** casos en distintos estados y con distintas fechas de taller, compromiso y entrega
- **When** se pide el listado filtrando por estado de pago, estatus del taller, tecnico o cualquiera de los tres rangos de fecha
- **Then** solo se devuelven los casos que caen dentro de esos filtros

---

## Requisito: Consultar un caso por su identificador

### Escenario: Caso existente devuelve cabecera y detalle
- **Given** un caso de taller que existe
- **When** se consulta por su identificador
- **Then** se devuelve la cabecera del caso y su lista de lineas de detalle, con los servicios y piezas de cada linea correctamente estructurados

### Escenario (DEFECTO D4 — a corregir en el codigo nuevo): Caso inexistente
- **Given** un identificador que no corresponde a ningun caso
- **When** se consulta por ese identificador
- **Then** el codigo actual falla con un error interno (500)
- **AND** el codigo nuevo **debe** devolver "no encontrado" (404) en su lugar

---

## Requisito: Cargar los datos iniciales de la pantalla de taller

### Escenario: Combos de la pantalla
- **Given** un usuario ubicado en una compania y sucursal
- **When** se piden los datos iniciales del taller
- **Then** se devuelven los tecnicos, los tipos de comprobante fiscal, las monedas, las sucursales del usuario, los impuestos de la compania y la lista de estados posibles del caso

### Escenario: Los impuestos se filtran por la compania del usuario
- **Given** un usuario de una compania determinada
- **When** se piden los datos iniciales
- **Then** solo se devuelven los impuestos que pertenecen a esa compania

---

## Requisito: Abrir un caso de taller

### Escenario: Alta de un caso nuevo con sus lineas
- **Given** un cliente, la descripcion de un equipo y una lista de servicios o piezas
- **When** se registra el caso
- **Then** el caso queda creado y se devuelve su identificador junto con las lineas registradas

### Escenario: El motor de base de datos reporta un error de negocio
- **Given** datos que el stored procedure considera invalidos
- **When** se intenta registrar el caso
- **Then** se devuelve el mensaje de error de negocio que reporta el motor, sin registrar el caso

---

## Requisito: Generar y completar el caso (flujo de dinero)

### Escenario: Generar el recibo del caso con documentos de pago
- **Given** un caso de taller y una lista de documentos de pago (anticipo)
- **When** se genera el recibo
- **Then** se devuelve el identificador del recibo generado

### Escenario: Completar y cobrar el caso
- **Given** un caso de taller listo para cerrar y sus documentos de pago
- **When** se completa el caso
- **Then** se devuelve el identificador del recibo y el caso queda cerrado

### Escenario (DEFECTO D3 — a corregir en el codigo nuevo): Compania tomada del cuerpo del pedido
- **Given** un pedido de generacion de caso que incluye una compania en su cuerpo distinta a la del usuario
- **When** se genera el caso
- **Then** el codigo actual usa la compania que viene en el cuerpo, permitiendo escribir en una compania ajena
- **AND** el codigo nuevo **debe** ignorar la compania del cuerpo y usar siempre la del usuario autenticado

---

## Requisito: Cambiar el estado de un caso

### Escenario: Transicion de estado
- **Given** un caso de taller en un estado valido
- **When** se cambia su estado
- **Then** el caso queda en el nuevo estado y se confirma la operacion

---

## Requisito: Imprimir la orden de taller

### Escenario: Impresion de un caso existente
- **Given** un caso de taller que existe
- **When** se pide su impresion
- **Then** se devuelven los datos del caso, los datos de la sucursal y la compania, y el detalle de lineas

### Escenario: Impresion de un caso inexistente
- **Given** un identificador que no corresponde a ningun caso
- **When** se pide su impresion
- **Then** se devuelve "no encontrado" (este metodo ya maneja correctamente el caso vacio)

---

## Requisito transversal: Autenticacion (DEFECTO D1 — a corregir en el codigo nuevo)

### Escenario: Peticion sin sesion
- **Given** una peticion a cualquier endpoint del modulo sin token de sesion
- **When** llega al servidor
- **Then** el codigo actual no exige autenticacion en el controlador (no hay proteccion declarada)
- **AND** el codigo nuevo **debe** exigir sesion valida y responder "no autorizado" (401) sin sesion

---

## Requisito transversal: Aislamiento entre tenants (DEFECTO D2 — fuera de scope, tratar por PARCHE)

### Escenario: Compania tomada de un encabezado HTTP
- **Given** un usuario autenticado que pertenece a la compania A
- **When** envia una peticion indicando la compania B en el encabezado
- **Then** el codigo actual opera sobre la compania B sin validar que el usuario le pertenezca
- **AND** la correccion vive en `BaseService`, afecta a todo el sistema, y se trata en un cambio PARCHE aparte por canal privado
