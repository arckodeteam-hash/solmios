# Tasks: Inicializar entorno de desarrollo

---

### 1.1 Estructura base del proyecto de tests

**Tags:** `inicializar-entorno; F1`

Crear `Kaptas.Tests/` con `dotnet new xunit` y subcarpetas:
- `scripts/` — scripts bash/sql para gestionar BDs de prueba
- `Fixtures/` — clases de infraestructura (conexion BD, reset)
- `Setup/` — configuracion global de la suite de tests
- `Features/` — tests unitarios de modulos nuevos (sin BD)
- `Legacy/` — tests de integracion de modulos legacy (con BD real _test)

Agregar al csproj las referencias a: `Kaptas.Services`, `Kaptas.Context`, `Kaptas.DTO`. Packages adicionales: Moq, Microsoft.AspNetCore.Http.Abstractions.

Agregar el proyecto al `KaptasAPI.sln`.

Crear `README.md` que documente: estructura de carpetas y su proposito, requisitos (dotnet 7, sqlcmd, SQL Server), variables de entorno necesarias (`KAPTAS_SQL_HOST`, `KAPTAS_SA_PASSWORD`), comandos basicos para build y tests.

**Acceptance:** `dotnet build` 0 errores. README escrito. Cualquier dev clona, lee y sabe que hacer.

---

### 1.2 Scripts de base de datos aislada

**Tags:** `inicializar-entorno; F1`

**Depende:** 1.1

Crear `scripts/setup-test-db.sh` — script bash que automatiza la clonacion de BDs reales a copias `_test` aisladas. Responsabilidades:
- Leer `KAPTAS_SQL_HOST` y `KAPTAS_SA_PASSWORD` del entorno (con fallback a archivo `~/.azure-env`)
- Detectar directorio de backups del SQL Server (`/var/opt/mssql/backup` o `/data`)
- Modo completo: BACKUP de `kaptaswebdev` → RESTORE como `kaptaswebdev_test` (con MOVE de archivos .mdf/.ldf si aplica)
- Lo mismo para `kw21` → `kw21_test`
- Ejecutar `seed-test-user.sql` contra `kaptaswebdev_test`
- Guardar snapshot `*_clean.bak` para resets posteriores
- Modo `--reset-only`: RESTORE desde snapshot en menos de 15s
- Verificar que las BDs _test existen con tablas

Crear `scripts/seed-test-user.sql` — datos de prueba minimos (usuario test + empresa test). Debe ser tolerante a tablas con IDENTITY (check `sys.columns.is_identity` antes de INSERT). Repetible (no duplica datos si se ejecuta多次).

**Acceptance:** `bash setup-test-db.sh` corre sin errores. BDs _test existen y tienen datos. `--reset-only` restaura en < 15s.

---

### 1.3 Fixtures de conexion y reset de BD

**Tags:** `inicializar-entorno; F1`

**Depende:** 1.2

Crear `Fixtures/TestDatabase.cs` — fixture de xUnit (implementando `IClassFixture`) que:
- Lee `KAPTAS_SQL_HOST` y `KAPTAS_SA_PASSWORD` del entorno al construirse
- Expone dos connection strings: `KaptasCoreConnectionString` → `kaptaswebdev_test`, `KaptaswebConnectionString` → `kw21_test`
- Usa `SqlConnectionStringBuilder` para construirlas
- No ejecuta reset ni seed (separacion de responsabilidades)
- Implementa `IDisposable` para limpiar recursos

Crear `Fixtures/DatabaseReset.cs` — clase estatica o coleccion de xUnit (`[CollectionDefinition]`) que:
- Ejecuta `bash scripts/setup-test-db.sh --reset-only` con timeout de 30s
- Captura stdout/stderr y lanza excepcion si falla
- Se aplica con `[Collection("DatabaseReset")]` en cada clase de test que toque BD

**Acceptance:** Compila sin errores. TestDatabase se inyecta correctamente. DatabaseReset ejecuta el script y lanza error si falla.

---

### 1.4 Tests de verificacion de infraestructura

**Tags:** `inicializar-entorno; F1`

**Depende:** 1.3

Crear `Legacy/ConnectionTests.cs` — 2 tests que verifican que las BDs _test responden:
- Abrir conexion a `kaptaswebdev_test` y ejecutar SELECT 1 → debe pasar sin excepcion
- Abrir conexion a `kw21_test` y ejecutar SELECT 1 → debe pasar sin excepcion
- Marcar ambos con `[Trait("Category", "Integration")]`

Crear `Legacy/SeedTests.cs` — 2 tests que verifican el seed:
- Consultar tablas en `kaptaswebdev_test` → debe haber al menos 1 tabla
- Consultar usuario test por email en `kaptaswebdev_test` → debe existir
- Marcar ambos con `[Trait("Category", "Integration")]`

Ambos archivos usan `[Collection("DatabaseReset")]` y reciben `TestDatabase` por inyeccion.

**Acceptance:** `dotnet test --filter "Category=Integration"` — 4 tests pasan. Verifican que el setup de BD funciona de punta a punta.

---

### 1.5 Template de test unitario (Features/)

**Tags:** `inicializar-entorno; F1`

**Depende:** 1.1

Crear `Features/SampleUnitTest.cs` — 1 test de ejemplo que:
- Usa Moq para mockear una dependencia
- No toca BD real
- Sigue el patron Arrange/Act/Assert
- Marcado con `[Trait("Category", "Unit")]`
- Sirve como template: cualquier dev que cree un modulo nuevo copia este archivo y adapta

**Acceptance:** `dotnet test --filter "Category=Unit"` — 1 test pasa.

---

### 1.6 Template de test de integracion (Legacy/)

**Tags:** `inicializar-entorno; F1`

**Depende:** 1.3

Crear `Legacy/SampleIntegrationTest.cs` — 1 test de ejemplo que:
- Usa `[Collection("DatabaseReset")]` + `IClassFixture<TestDatabase>`
- Ejecuta una consulta simple contra `kaptaswebdev_test`
- Marcado con `[Trait("Category", "Integration")]`
- Sirve como template para tests de modulos legacy contra BD real

**Acceptance:** `dotnet test --filter "Category=Integration"` — 5 tests pasan (4 de 1.4 + 1 de 1.6).

---

### 1.7 Bootstrap de BDs _test reproducible en cualquier sistema

**Tags:** `inicializar-entorno; F1`

**Depende:** 1.2

Hacer que la suite de integracion corra de punta a punta desde un clone limpio en **cualquier sistema** (local o remoto). Hoy los tests con `[Collection("DatabaseReset")]` fallan en un entorno nuevo porque faltan los snapshots `*_clean.bak`.

- `bash setup-test-db.sh` (modo completo) crea `kaptaswebdev_test` y `kw21_test` y genera los snapshots `*_clean.bak`
- Detecta el directorio del SQL Server en cualquier host (`/var/opt/mssql/backup` o `/data`), sin asumir ruta fija
- Funciona igual con `KAPTAS_SQL_HOST` local o remoto (`173.249.31.75`)
- Primer run: sin `--reset-only` (crea snapshots); runs siguientes con `--reset-only` (< 15s)
- Mensaje de error claro si faltan snapshots, guiando al dev a correr el setup completo

**Acceptance:** En un sistema nuevo: clone + creds + `bash setup-test-db.sh` + `dotnet test --filter Category=Integration` → todos verdes.

**Azure:** Work Item #488

---

### 1.8 Soporte Windows en la infraestructura de tests

**Tags:** `inicializar-entorno; F1`

**Depende:** 1.2, 1.3, 1.7

Hoy la suite solo corre en Linux/macOS: `TestDbFixture.Reset()` invoca `FileName = "bash"` hardcodeado, asi que un dev en Windows falla antes de tocar el script. Los devs del equipo que usan Windows no pueden correr los tests de integracion.

- `scripts/setup-test-db.ps1`: equivalente del `.sh` con los mismos flags (`-ResetOnly`, `-ForceRecreate`, `-RefreshSnapshot`), misma cadena de resolucion de credenciales y mismo auto-bootstrap
- `TestDbFixture` elige script + interprete segun el SO (`RuntimeInformation.IsOSPlatform`): `powershell -ExecutionPolicy Bypass -File ... -ResetOnly` en Windows, `bash ... --reset-only` en el resto
- Timeout del reset configurable via `KAPTAS_RESET_TIMEOUT_SEC` (default 600s). El valor anterior (30s fijo) mataba el auto-bootstrap de la primera corrida, que tarda minutos — bug que afectaba a todos los sistemas, no solo a Windows
- Documentar en `Kaptas.Tests/README.md` y `docs/INFRAESTRUCTURA-TESTS.md` los comandos por SO y la tabla de flags equivalentes

**Fuera de alcance:** SQL Server local sobre Windows. Las rutas `/var/opt/mssql/*` son del motor (Linux en el server de prueba), no del cliente. Si alguien monta el motor en Windows, el setup falla — queda documentado como no soportado.

**Acceptance:** En Windows: clone + creds + `dotnet test` → verdes, sin configurar nada extra. En Linux: los 10 tests siguen verdes (sin regresion).

**Azure:** Work Item #489

---

### Orden de ejecucion

```
1.1 ──→ 1.2 ──→ 1.3 ──→ 1.4 ──→ 1.6
                        ↑
1.5 ────────────────────┘ (paralelo con 1.2-1.4)

1.7 ──→ 1.8   (1.8 necesita el auto-bootstrap de 1.7 andando)
```

1.1 es base. 1.2→1.3→1.4→1.6 son secuenciales (cada uno necesita el anterior). 1.5 es independiente y puede ir en paralelo. 1.8 cierra la portabilidad que 1.7 dejo a medias (reproducible en cualquier sistema, pero solo con bash).
