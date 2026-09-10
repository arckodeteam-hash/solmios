# Diseño — monitoreo-plataforma-real

## Decisión 1 — Métricas de petición en memoria, errores en base

**Contexto**: se necesita latencia por endpoint y errores recientes. Escribir una fila por petición
sería el registro más completo, pero pone un INSERT en el camino de cada request.

**Decisión**: dos caminos distintos según el volumen y la vida útil del dato.

| Dato | Dónde | Por qué |
|---|---|---|
| Peticiones y latencias | Memoria del proceso, agregado incremental | Miles por minuto; solo interesa el agregado. Un INSERT por request agregaría I/O al percentil 99 de TODA la API. |
| Errores 5xx | Tabla `error_logs` | Son pocos y su valor está justamente en sobrevivir al reinicio que el error pudo provocar. |

**Consecuencia asumida**: al reiniciar el backend, las latencias arrancan de cero. La pantalla lo
dice explícitamente ("desde el último reinicio"), en vez de simular una ventana de 30 días que no se
tiene. Es la diferencia entre una medición honesta y el "99.99% uptime" actual, que es texto fijo.

**Alternativa descartada**: Prometheus + Grafana. Es la respuesta correcta a escala, pero son dos
servicios más para operar en un servidor que hoy corre un backend y un nginx, y el pedido es que el
panel propio funcione.

## Decisión 2 — Normalización de rutas antes de agregar

`/api/reservas/9f8e-.../charges` con un UUID por reserva generaría una clave por reserva y el mapa
crecería sin techo.

```
/api/reservas/9f8e7d6c-.../charges  ─┐
/api/reservas/1a2b3c4d-.../charges  ─┼─→  /api/reservas/:id/charges
/api/reservas/44/charges            ─┘
```

Regla: un segmento es variable si es UUID, ULID, o sólo dígitos. Además, tope duro `MAX_ROUTES`;
superado, se acumula en `otras`, de modo que el mapa tenga un techo aunque aparezca un patrón nuevo.

## Decisión 3 — El estado global se deriva, no se declara

Hoy la pantalla dice "Todos los sistemas operativos" en un `<span>` fijo: lo diría también con la
base caída. El estado pasa a calcularse:

```
errores5xx última hora > 0        → degradado
cola con fallidos                 → degradado
disco usado > 90%                 → degradado
no responde la consulta           → sin datos (nunca "operativo")
en cualquier otro caso            → operativo
```

## Decisión 4 — Backup: proceso externo, no biblioteca

`pg_dump` es la herramienta soportada por Postgres para un volcado consistente. Se invoca como
proceso hijo con la `DATABASE_URL` del entorno.

```
Admin            Backend                  Disco            pg_dump
  │  POST /backups  │                        │                │
  ├────────────────>│                        │                │
  │                 │ ¿existe pg_dump?       │                │
  │                 ├───────────────────────────────────────> │
  │                 │ (si no: 503 explicativo)                │
  │                 │ spawn con timeout      │                │
  │                 ├───────────────────────────────────────> │
  │                 │                        │ <──── escribe ─┤
  │                 │ registra en audit log  │                │
  │  201 + metadata │                        │                │
  │ <───────────────┤                        │                │
```

**Dónde vive el archivo**: un directorio fuera de la raíz servida por nginx. Si viviera bajo
`frontend/dist` o `uploads/`, un volcado con los datos de todos los hoteles quedaría descargable por
URL directa sin autenticación.

**Descarga**: el `id` que manda el cliente NUNCA se concatena a una ruta. Se lista el directorio, se
busca la coincidencia exacta por nombre y se sirve ese archivo; si no está en la lista, 404. Esto
cierra el path traversal por construcción, no por validación de cadenas.

## Decisión 5 — Persistir el error fuera del ciclo de respuesta

El middleware captura el error, arma la fila y dispara la escritura sin esperarla. Si la base está
caída —el escenario donde más importa no empeorar las cosas— el cliente igual recibe su respuesta y
el fallo de escritura se traga con un log.

Agrupación por `(path, message)`: el mismo error repetido 500 veces es UNA fila con `count` y
`lastSeenAt`, no 500 filas. Así la tabla no crece con el incidente y la pantalla sigue legible.

## Decisión 6 — Métricas de base por motor, sin inventar

El adapter expone `query(sql, params)`, así que las métricas salen del catálogo del propio motor:

| Métrica | Postgres | SQLite |
|---|---|---|
| Tamaño | `pg_database_size(current_database())` | tamaño del archivo |
| Conexiones | `pg_stat_activity` | no aplica → se omite |
| Tablas | `information_schema.tables` | `sqlite_master` |

Cuando una métrica no existe en el motor activo, se omite del payload y la UI no dibuja la fila. Es
preferible a un cero que se lee como medición.

## Riesgo operativo del backup

Un backup es el activo más sensible del sistema: contiene los datos de todos los hoteles. Tres
controles, en capas:

1. **Autorización**: `super_admin` explícito, no un permiso de hotel.
2. **Ubicación**: fuera del árbol servido por nginx.
3. **Rastro**: cada creación y cada descarga quedan en el audit log con el usuario.

Queda **fuera de alcance y anotado como riesgo residual**: el archivo se guarda sin cifrar en el
disco del servidor. Cifrarlo en reposo, o mandarlo a almacenamiento externo, es una decisión
separada que conviene tomar junto con la política de retención.
