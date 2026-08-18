# Tareas: Refactorizar el módulo RepairShop (Taller)

Este es el primer módulo que sacamos de la zona LEGADO. Ojo con eso: no es solo mover un servicio de lugar, es la primera vez que armamos la carpeta `Features/`, la carpeta compartida `_Shared/`, el mecanismo para prender y apagar el código nuevo por cliente, y el registro automático de servicios. Todo eso se construye una vez acá y después lo reusan los otros 23 módulos. Así que vale la pena hacerlo con calma y bien.

**La regla que no se negocia en todo el cambio:** primero escribimos tests que capturan lo que el código hace HOY, incluso si lo que hace hoy está mal. No arreglamos nada en esa etapa. Primero fotografiamos el comportamiento actual, después migramos, y recién ahí corregimos los defectos —cada cosa en su momento—. Si mezclamos "migro y de paso arreglo", no vamos a saber si algo se rompió por la migración o por el arreglo.

Estados: `[ ]` sin empezar · `[~]` en curso · `[x]` terminado.

---

## Etapa 1 — Fotografiar cómo se comporta hoy

Escribimos los tests que dejan registrado lo que el módulo hace actualmente, antes de tocar una sola línea. Corren contra las bases de pruebas aisladas (`kw21_test`). Estos mismos tests, más adelante, se corren contra el código nuevo para probar que se comporta igual. Los defectos que ya conocemos los dejamos documentados tal cual están; no los arreglamos todavía.

### 1.1 Capturar las pantallas de consulta
`[x]` · Hecho · 9 tests en verde en `Kaptas.Tests/Legacy/RepairShopCharacterizationTests.cs` (suite completa: 19 verde, nada roto)

Primero una verificación: hay que mirar en la base si los procedimientos almacenados filtran por empresa internamente. Tres operaciones (consultar por id, imprimir y cambiar estado) no le pasan la empresa al procedimiento, y necesitamos saber si eso es un agujero real o si el procedimiento se protege solo. De eso depende cómo escribimos los tests de seguridad más abajo.

Después, tests que dejen fijado el comportamiento de listar, consultar, cargar la pantalla inicial e imprimir:

- El listado devuelve totales de paginación que cierran entre sí.
- Pedir páginas de a 2 devuelve como mucho 2 casos.
- Buscar por texto filtra los resultados.
- Consultar un caso que existe trae su cabecera y sus líneas de detalle bien armadas.
- Consultar un caso que NO existe hoy revienta con error interno. Lo dejamos documentado; es el defecto D4, se corrige más adelante.
- La pantalla inicial trae técnicos, tipos de comprobante fiscal, monedas y sucursales.
- Los impuestos de esa pantalla vienen filtrados por la empresa del usuario.
- La lista de estados posibles del caso sale de nuestro catálogo interno, no de la base.
- Imprimir un caso que existe trae sus datos, los de la sucursal y el detalle.
- Imprimir un caso que no existe devuelve "no encontrado" (esta operación sí maneja bien el caso vacío).

**Listo cuando:** todos estos tests pasan en verde reflejando el comportamiento actual. Ninguno arregla nada.

### 1.2 Capturar el alta y la edición de casos
`[ ]` · Depende de 1.1

- Crear un caso nuevo devuelve su identificador y las líneas cargadas. Esto confirma que la lista de servicios y piezas viaja bien hasta el procedimiento.
- Cuando el procedimiento rechaza los datos por una regla de negocio, devolvemos ese mensaje y no se crea el caso.
- Crear un caso cuando el procedimiento no devuelve nada hoy revienta con error interno (otra vez el defecto D4).
- Editar la cabecera de un caso existente confirma el cambio.
- Cambiar el estado de un caso a un valor válido confirma la operación.
- Dejar anotado que el cambio de estado no le manda la empresa al procedimiento (así queda claro cuál es el contrato de hoy).

**Listo cuando:** los tests de alta y edición pasan en verde, con el paso de líneas y los mensajes de error del motor cubiertos.

### 1.3 Capturar el flujo donde se maneja plata
`[ ]` · Depende de 1.1

Las dos operaciones que registran documentos de pago —generar y completar el caso— son las más delicadas de todo el módulo. Acá hay que ir con cuidado.

- Generar el recibo con documentos de pago devuelve el número de recibo.
- Generar sin especificar empresa en el pedido usa la empresa del usuario.
- Generar especificando una empresa EN EL PEDIDO usa esa empresa. Esto es el defecto D3 y es grave; lo dejamos documentado acá para tenerlo por escrito, y se corrige en la etapa 2.
- Completar el caso con documentos de pago devuelve el número de recibo.
- Cuando el procedimiento falla al completar, propagamos el código de error que devuelve.

**Listo cuando:** los tests pasan en verde. El test del defecto D3 deja constancia de que hoy, si el cliente manda una empresa en el pedido, el sistema le hace caso.

### 1.4 Tests de seguridad — estos nacen en rojo y se quedan en rojo
`[ ]` · Depende de 1.3

Ojo con esta tarea. Estos tests documentan agujeros de seguridad que NO arreglamos en este cambio. Los escribimos, los marcamos como tests de seguridad, y los dejamos en rojo a propósito, apuntando al cambio aparte que los va a arreglar. No se borran nunca.

- Una petición sin sesión a cualquier endpoint debería dar "no autorizado" (defecto D1: el controlador no exige login).
- Un usuario que manda en el encabezado una empresa que no es la suya no debería poder operar sobre ella (defecto D2).
- Generar un caso con una empresa ajena en el pedido no debería escribir en esa empresa (defecto D3).
- Consultar un caso de otra empresa no debería devolverlo (defecto D2, depende de lo que averigüemos en 1.1 sobre los procedimientos).

**Listo cuando:** los cuatro tests existen y anotamos si quedan en rojo o en verde. Importante: los defectos D2 y D3 no son solo del taller, están en una pieza que usa todo el sistema. Eso se conversa por privado con el revisor técnico, no se sube al tablero público.

---

## Etapa 2 — Construir el módulo nuevo y el interruptor

### 2.1 Armar la carpeta compartida `_Shared/`
`[ ]` · Depende de 1.4

Acá nace la base de `Features/`, que se hace una vez y la usan todos los módulos que vengan después. Son cuatro piezas que reemplazan las dependencias viejas que tenemos prohibido usar:

- Una que nos dice quién es el usuario y en qué empresa está trabajando (reemplaza a `BaseService`).
- Una que arma la conexión a la base del cliente (reemplaza a `IDbService`).
- Una para ejecutar los procedimientos almacenados, nuestra, sin depender del código viejo (reemplaza a `ISpExecute`).
- Una para consultar las sucursales del usuario (reemplaza la llamada al servicio viejo de sucursales).
- Y configurar el registro automático de servicios, que hoy el proyecto no tiene.

**Hay una decisión acá que el revisor técnico necesita definir antes de escribir código:** la pieza que resuelve el usuario y la empresa, ¿valida que la empresa del encabezado sea realmente del usuario? Si la valida, arreglamos el defecto D2 de raíz, pero cambiamos el comportamiento y rompemos a propósito los tests que sacamos en la etapa 1. Si no la valida, arrastramos el problema al código nuevo. No arrancamos esta tarea sin esa respuesta.

Además, tests unitarios de estas piezas (sin base de datos): sin contexto de petición falla con un mensaje claro; con el encabezado de empresa devuelve los datos correctos; el ejecutor de procedimientos devuelve bien los valores de salida.

**Listo cuando:** compila sin advertencias nuevas, el registro automático anda, y los tests unitarios están en verde.

### 2.2 Armar el módulo `Features/RepairShop/`
`[ ]` · Depende de 2.1

El orden importa: primero los objetos de datos, después las interfaces, después la lógica, y el controlador al final.

- Mover los 14 objetos de datos del módulo a la carpeta nueva.
- Definir la interfaz de acceso a datos: una operación por cada procedimiento almacenado (son 9).
- Escribir la implementación de acceso a datos. Este es el único archivo que sabe que del otro lado hay SQL. Reproduce los dos parámetros de tabla exactamente como están hoy.
- Escribir la lógica del módulo: resuelve la empresa, llama al acceso a datos, arma la respuesta y maneja los errores.
- Escribir el controlador nuevo, corto (unas 30 líneas), y esta vez CON login obligatorio (así corregimos el defecto D1 en el código nuevo).
- En la única consulta directa a la base (la de impuestos), leer sin seguimiento de cambios, como manda la regla del proyecto.
- Tests de la lógica nueva (simulando el acceso a datos): consultar un caso que no existe devuelve "no encontrado" en vez de reventar (corrige D4); generar un caso ignora la empresa del pedido y usa la del usuario (corrige D3); la pantalla inicial combina bien impuestos, técnicos y sucursales.
- Tests de equivalencia: correr los mismos tests de la etapa 1 contra el código nuevo. Tienen que pasar todos MENOS los que documentaban D3 y D4, que ahora van a fallar justamente porque arreglamos esos defectos. A esos los reescribimos con el comportamiento correcto y anotamos el cambio en el pull request.

**Listo cuando:** los tests de la lógica nueva están en verde, los de equivalencia corren contra las dos versiones, y cada diferencia de comportamiento quedó documentada una por una.

### 2.3 Armar el interruptor por cliente
`[ ]` · Depende de 2.2

- Un adaptador que usa el servicio viejo.
- Un adaptador que usa el servicio nuevo.
- Un selector que elige uno u otro según la configuración de cada cliente.
- Registrar el selector en lugar del servicio viejo. El controlador viejo no se toca para nada.
- Tests: con el interruptor apagado usa el viejo; encendido usa el nuevo; un cliente sin configurar usa el viejo por defecto (esa es la opción segura).

**Listo cuando:** los tests están en verde y el interruptor arranca apagado para todos. Es decir: subimos el cambio y no le cambia el comportamiento a nadie todavía.

---

## Etapa 3 — Encender el código nuevo, cliente por cliente

### 3.1 Ir prendiendo el interruptor de a poco
`[ ]` · Depende de 2.3

Como el servicio tiene un solo consumidor, no hay que migrar código de nadie: vamos activando clientes.

- Prender el interruptor en un cliente interno. Mirar cómo se comporta durante una semana.
- Comparar contra el comportamiento viejo: errores, tiempos de respuesta, cantidad de casos creados por día.
- Ir sumando clientes de a grupos. Si algo se ve raro, apagamos el interruptor —sin necesidad de subir nada—.

**Listo cuando:** todos los clientes están con el código nuevo y pasó una semana sin problemas. Con métricas, no con "parece que anda bien".

---

## Etapa 4 — Marcar el código viejo como a punto de morir

### 4.1 Avisar que el servicio viejo ya no va
`[ ]` · Depende de 3.1

- Marcar el servicio viejo como obsoleto, apuntando a este cambio y a que se elimina en la etapa 5.
- Dejar un aviso en el adaptador viejo: si algún cliente todavía cae ahí, queremos que quede registrado.

**Listo cuando:** compila sin errores y nadie debería estar usando el servicio viejo.

---

## Etapa 5 — Borrar el código viejo

### 5.1 Eliminar todo lo legado
`[ ]` · Depende de 4.1 · **y de tener confirmado que ya nadie lo usa**

Cuidado con esta: es la única que no se puede deshacer fácil. El aviso que dejamos en la etapa 4 tiene que mostrar cero registros durante al menos 30 días antes de tocar nada.

- Borrar el servicio viejo, su interfaz y su controlador.
- Borrar las tres piezas del interruptor (los dos adaptadores y el selector): ya no hacen falta.
- Borrar la configuración del interruptor.
- Los tests de la etapa 1 se quedan. Ahora son la red de seguridad del módulo nuevo.

**Listo cuando:** compila, todos los tests en verde, no queda ni una referencia al servicio viejo. El módulo pasó oficialmente a zona LIMPIO.

---

## Cierre — lo que revisamos antes de dar por terminado

- **Revisión técnica:** compila sin errores ni advertencias nuevas, tests en verde, controlador corto, lectura sin seguimiento, filtro por empresa presente, códigos de respuesta correctos (nada de devolver "todo bien" tapando un error), cero código comentado, login obligatorio.
- **Revisión de dependencias:** el módulo nuevo no usa nada del proyecto viejo de servicios, no hereda del servicio base, no toca las piezas viejas de acceso a datos ni la consulta vieja de sucursales.
- **Tablero de módulos:** crear el registro de módulos (hoy no existe) y anotar RepairShop como LIMPIO, con su cantidad de tests y la fecha.
- **Patrones reutilizables:** las cuatro piezas de `_Shared/` quedan listas para los 23 módulos que siguen.

## Deuda que dejamos anotada (no la resolvemos ahora)

- La lógica de negocio del taller vive en 9 procedimientos almacenados que no están en el repositorio.
- La consulta de sucursales del usuario queda duplicada hasta que refactoricemos el módulo de sucursales.
- El defecto de la empresa por encabezado afecta a todo el sistema, no solo al taller.
- Los controladores de Gastos y Compras tampoco exigen login (queda para otro momento).
