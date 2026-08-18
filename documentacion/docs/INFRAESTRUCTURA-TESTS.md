# Infraestructura de Tests — Kaptas ERP

> **Qué es esto:** la explicación de cómo está armado y cómo funciona el entorno de
> tests (`Kaptas.Tests/`), construido en 7 pasos (tareas 1.1 → 1.7 del cambio
> `inicializar-entorno`).
>
> **¿Venís a configurarlo en tu máquina?** Andá directo a [§2 Cómo se configura](#2-cómo-se-configura-sistema-nuevo-de-cero).
> El resto del documento explica el conjunto, para entenderlo.

---

## 1. El problema que resuelve

Kaptas es **multi-tenant** (1 BD por suscripción) y **sin migraciones EF** (el schema
viaja en las propias BDs). Para testear contra datos reales sin romper nada, se necesita:

- BDs de prueba **aisladas** (`kaptaswebdev_test`, `kw21_test`) — nunca se tocan las de desarrollo.
- Poder **resetearlas a un estado limpio** antes de cada corrida (rápido).
- Que todo funcione **en cualquier sistema** (local o contra el server de prueba), sin Docker.

La infraestructura de tests es la maquinaria que hace todo eso automático.

---

## 2. Cómo se configura (sistema nuevo, de cero)

Tres pasos. Solo el primero es obligatorio.

> **Funciona igual en Linux, macOS y Windows.** Hay dos scripts equivalentes —
> `setup-test-db.sh` y `setup-test-db.ps1` — con los mismos flags y la misma lógica.
> `dotnet test` elige el correcto según el sistema operativo (ver §6.1).

### Paso 1 — Instalar `sqlcmd` (sin Docker, sin sudo)

**Linux / macOS:**
```bash
curl -L https://github.com/microsoft/go-sqlcmd/releases/latest/download/sqlcmd-linux-amd64.tar.bz2 \
  | tar xj -C ~/.local/bin sqlcmd && chmod +x ~/.local/bin/sqlcmd
```

**Windows:**
```powershell
winget install sqlcmd
```

Verificá que quedó en el PATH: `sqlcmd -?`.

### Paso 2 — Crear el archivo de credenciales

Este es **el único archivo que hay que crear a mano**. Se copia del ejemplo versionado:

```bash
# Linux / macOS
cp Kaptas.Tests/appsettings.Tests.example.json Kaptas.Tests/appsettings.Tests.json

# Windows (PowerShell)
Copy-Item Kaptas.Tests\appsettings.Tests.example.json Kaptas.Tests\appsettings.Tests.json
```

Después editás `Kaptas.Tests/appsettings.Tests.json` y ponés el SA password real:

```json
{
  "KaptasSql": {
    "Host": "173.249.31.75,1433",
    "SaPassword": "<SA-password-del-server-de-prueba>"
  }
}
```

| Campo | Qué poner |
|-------|-----------|
| `Host` | `173.249.31.75,1433` (server de prueba compartido) o `localhost` (SQL Server local nativo) |
| `SaPassword` | El SA password del host que elegiste. Pedíselo al equipo — no está en el repo. |

> `appsettings.Tests.json` está en `.gitignore`. Nunca se commitea. El que **sí** se
> commitea es `appsettings.Tests.example.json`, con el password como placeholder.

**Alternativa (CI/CD):** en vez del archivo, exportá las env vars — tienen prioridad sobre todo:

```bash
# Linux / macOS
export KAPTAS_SQL_HOST=173.249.31.75,1433
export KAPTAS_SA_PASSWORD='...'
```
```powershell
# Windows (PowerShell)
$env:KAPTAS_SQL_HOST = '173.249.31.75,1433'
$env:KAPTAS_SA_PASSWORD = '...'
```

### Paso 3 — Correr los tests

```bash
dotnet test
```

Y nada más, en cualquier sistema operativo. No hace falta crear las BDs `_test` a mano:
si faltan los snapshots, el reset previo a los tests de integración dispara el setup
completo solo (ver §6, auto-bootstrap).

> **La primera corrida tarda varios minutos** — está creando las BDs `_test` vía
> BACKUP/RESTORE. Las siguientes resetean en ~6-9s. El límite de espera son 600s;
> se ajusta con `KAPTAS_RESET_TIMEOUT_SEC`.

Si querés forzar el setup completo por adelantado:

```bash
# Linux / macOS
bash Kaptas.Tests/scripts/setup-test-db.sh
```
```powershell
# Windows
powershell -ExecutionPolicy Bypass -File Kaptas.Tests\scripts\setup-test-db.ps1
```

### Qué pasa si te salteás el Paso 2

Los tests fallan con un error explícito, no con un stacktrace críptico:

```
No se resolvio el host SQL. Setea KAPTAS_SQL_HOST, o crea
Kaptas.Tests/appsettings.Tests.json (copia de appsettings.Tests.example.json).
```

---

## 3. Los 7 pasos de un vistazo

| Paso | Nombre | Qué aporta |
|------|--------|------------|
| **1.1** | Estructura base del proyecto de tests | Crea `Kaptas.Tests/` con sus carpetas y el `.csproj` |
| **1.2** | Scripts de base de datos aislada | `setup-test-db.sh` — clona las BDs dev a `_test` vía BACKUP/RESTORE |
| **1.3** | Fixtures de conexión y reset | `TestDbFixture` (conecta) + `DatabaseReset` (resetea antes de correr) |
| **1.4** | Tests de verificación de infraestructura | Confirman que las BDs `_test` conectan y tienen el seed |
| **1.5** | Template de test unitario | Ejemplo a copiar para tests sin BD (mocks) |
| **1.6** | Template de test de integración | Ejemplo a copiar para tests con BD real `_test` |
| **1.7** | Bootstrap reproducible en cualquier sistema | Auto-configura las BDs la primera vez, sin paso manual |

**Dependencias:** `1.1 → 1.2 → 1.3 → 1.4 → 1.6`. La `1.5` es independiente. La `1.7`
refuerza la `1.2`/`1.3` para que funcione en un sistema nuevo.

---

## 4. Estructura de archivos

```
Kaptas.Tests/
├── Kaptas.Tests.csproj          # referencias: Kaptas.Services, Kaptas.Context, Kaptas.DTO, Moq, xUnit
│
├── appsettings.Tests.example.json  # template de credenciales (se copia, ver §2)
├── seed-test-user.sql              # datos mínimos de prueba (usuario + empresa)
│
├── scripts/                     # ── PASO 1.2 ──
│   ├── setup-test-db.sh         # crea/resetea las BDs _test — Linux/macOS
│   ├── setup-test-db.ps1        # idem, Windows (mismos flags, misma lógica)
│   └── sql/
│       ├── create-test-db.sql.tmpl   # plantilla BACKUP/RESTORE dev → _test
│       └── reset-test-db.sql.tmpl    # plantilla RESTORE desde snapshot limpio
│
├── Fixtures/                    # ── PASO 1.3 ──
│   ├── TestDbFixture.cs         # resuelve credenciales + crea los DbContext contra _test
│   └── DatabaseReset.cs         # collection fixture: resetea la BD UNA vez antes de la corrida
│
├── Features/                    # ── PASO 1.5 ── (tests unitarios, sin BD)
│   └── TemplateUnitTests.cs     # template con Moq
│
├── Legacy/                      # ── PASO 1.6 ── (tests de integración, con BD real)
│   └── TemplateIntegrationTests.cs
│
├── InfraestructuraTests.cs      # ── PASO 1.4 ── sanidad del entorno
├── ConexionSimpleTest.cs        # test de conexión pura (sin reset)
└── SmokeTest.cs                 # el runner corre (1+1=2)
```

---

## 5. Cómo funciona (el flujo completo)

### 5.1 De dónde salen las credenciales
Nunca hay credenciales en el repo. Se resuelven **en este orden** (gana la primera que exista):

1. **Variables de entorno**: `KAPTAS_SQL_HOST` / `KAPTAS_SA_PASSWORD` (override, para CI/CD).
2. **`Kaptas.Tests/appsettings.Tests.json`** (gitignored) → `KaptasSql:Host` / `KaptasSql:SaPassword`.
   Config **propia del test**: para correr tests solo necesitás este archivo chico, no el
   appsettings gigante de la API. Se crea copiando `appsettings.Tests.example.json` (ver §2).
3. **`Kaptas.API/appsettings.Development.json`** (gitignored) → `ConnectionStrings:SqlKaptas`.
   Fallback de compatibilidad: si un dev solo tiene el config viejo, sigue andando.

Si no hay ninguna → error explícito. La misma cadena la usan el script (`setup-test-db.sh`)
y el fixture C# (`TestDbFixture`), leyendo de la misma fuente.

### 5.2 El destino (local o remoto)
`KAPTAS_SQL_HOST` decide contra qué SQL Server se trabaja:
- `localhost` → SQL Server nativo local.
- `173.249.31.75` → server de prueba compartido.

Sin Docker: usa `sqlcmd` nativo del PATH.

### 5.3 Ciclo de vida de las BDs de prueba

```
   BDs dev (kaptaswebdev, kw21)          ← NUNCA se modifican
            │  BACKUP / RESTORE  (setup-test-db.sh, paso 1.2)
            ▼
   BDs _test (kaptaswebdev_test, kw21_test)
            │  + seed-test-user.sql  (usuario/empresa de prueba)
            ▼
   Snapshot limpio (*_clean.bak)         ← foto del estado post-seed
            │  RESTORE desde snapshot  (--reset-only, ~6-9s)
            ▼
   Estado limpio antes de CADA corrida de tests
```

### 5.4 Qué pasa cuando corrés `dotnet test`

1. Los tests de integración están marcados con `[Collection("DatabaseReset")]`.
2. Ese collection fixture (`DatabaseReset.cs`, paso 1.3) ejecuta **una vez** el reset
   (`--reset-only` / `-ResetOnly`) → restaura las BDs `_test` al snapshot limpio.
3. `TestDbFixture` abre los `DbContext` contra las BDs `_test` ya reseteadas.
4. Cada test corre contra datos limpios y predecibles.

Los tests **unitarios** (`Features/`, paso 1.5) no tocan nada de esto: usan mocks.

---

## 6. El paso 1.7 — por qué funciona en cualquier sistema

**El problema:** el fixture solo sabe hacer `--reset-only`. En un sistema nuevo todavía
**no existen los snapshots**, así que el reset fallaba y el primer `dotnet test` no arrancaba.

**La solución (auto-bootstrap):** el script detecta si faltan los snapshots. Si faltan,
en vez de fallar, corre el **setup completo** automáticamente esa primera vez (crea las
BDs `_test` + genera los snapshots) y sigue.

```
--reset-only / -ResetOnly
   ├── ¿existen los snapshots?  ── SÍ ──→ RESTORE rápido (~6s)
   └──                          ── NO ──→ setup completo (crea BD + snapshots)  ← auto-bootstrap
```

Resultado: en cualquier sistema, con solo clonar + configurar credenciales + `dotnet test`,
el entorno se auto-configura. Sin paso manual previo.

> Detección de directorio: el script busca `/var/opt/mssql/backup` en el server destino;
> si no existe (como en el server de prueba), cae a `/var/opt/mssql/data`. Sin rutas fijas
> que rompan en otro host.

### 6.1 Cómo funciona en Windows

Hay **dos scripts equivalentes**, no uno portado a medias:

| Sistema | Script | Invocación |
|---------|--------|------------|
| Linux / macOS | `scripts/setup-test-db.sh` | `bash setup-test-db.sh --reset-only` |
| Windows | `scripts/setup-test-db.ps1` | `powershell -ExecutionPolicy Bypass -File setup-test-db.ps1 -ResetOnly` |

`TestDbFixture` elige el par correcto (script + intérprete) con
`RuntimeInformation.IsOSPlatform(OSPlatform.Windows)`. El dev no configura nada:
`dotnet test` funciona igual en las tres plataformas.

El `-ExecutionPolicy Bypass` no es opcional: los `.ps1` sin firmar no se ejecutan
con la política por defecto de Windows.

**Las rutas `/var/opt/mssql/*` son del SERVIDOR, no del cliente.** El `BACKUP`/`RESTORE`
lo ejecuta el motor de SQL Server sobre su propio filesystem. Como el server de prueba
corre Linux, esas rutas valen aunque el dev esté en Windows.

> ⚠️ Si alguien monta un **SQL Server local sobre Windows**, esas rutas no existen
> (serían `C:\Program Files\Microsoft SQL Server\...\DATA`) y el setup falla. Hoy
> ningún script detecta el SO del motor. Caso no soportado.

Dos diferencias de implementación, por limitaciones de la plataforma:

- El `.sh` parsea el JSON con `grep -oP`; el `.ps1` usa `ConvertFrom-Json`.
- El `.sh` pipea el seed a `sqlcmd -i /dev/stdin`; en Windows no existe `/dev/stdin`,
  así que el `.ps1` escribe un archivo temporal (UTF-8 **sin BOM** — con BOM, `sqlcmd`
  lo toma como parte del primer statement) y lo borra en un `finally`.

---

## 7. Cómo correr

**Linux / macOS:**
```bash
# Setup inicial (una vez por sistema) — crea BDs _test + snapshots
bash Kaptas.Tests/scripts/setup-test-db.sh

# Reset rápido desde snapshot limpio (auto-bootstrap si faltan)
bash Kaptas.Tests/scripts/setup-test-db.sh --reset-only
```

**Windows:**
```powershell
# Setup inicial (una vez por sistema) — crea BDs _test + snapshots
powershell -ExecutionPolicy Bypass -File Kaptas.Tests\scripts\setup-test-db.ps1

# Reset rápido desde snapshot limpio (auto-bootstrap si faltan)
powershell -ExecutionPolicy Bypass -File Kaptas.Tests\scripts\setup-test-db.ps1 -ResetOnly
```

**Correr tests (igual en todos los sistemas):**
```bash
dotnet test                                    # todos
dotnet test --filter "Category=Unit"           # solo unitarios (~1s, sin BD)
dotnet test --filter "Category=Integration"    # solo integración (~20s, con BD _test)
```

### Flags equivalentes
| Linux / macOS | Windows |
|---------------|---------|
| `--reset-only` | `-ResetOnly` |
| `--force-recreate` | `-ForceRecreate` |
| `--refresh-snapshot` | `-RefreshSnapshot` |

### Variables de entorno
| Variable | Default | Para qué |
|----------|---------|----------|
| `KAPTAS_SQL_HOST` | `localhost` | Host:puerto del SQL Server destino |
| `KAPTAS_SA_PASSWORD` | (de appsettings) | Password SA del destino |
| `KAPTAS_SQLCMD` | `sqlcmd` | Binario sqlcmd del PATH |
| `KAPTAS_RESET_TIMEOUT_SEC` | `600` | Espera máxima del fixture al reset. La primera corrida (auto-bootstrap) tarda minutos |

---

## 8. Troubleshooting

| Síntoma | Causa probable | Solución |
|---------|----------------|----------|
| `Faltan snapshots limpios` | Nunca corriste el setup completo | `bash setup-test-db.sh` (sin `--reset-only`) — o ya lo hace solo con 1.7 |
| `sqlcmd no está en el PATH` | Falta el cliente | Instalar go-sqlcmd (§2, Paso 1 — sin Docker/sudo). Windows: `winget install sqlcmd` |
| `(reset) no termino en Ns (timeout)` | Primera corrida: el auto-bootstrap crea las BDs y tarda minutos | Subir `KAPTAS_RESET_TIMEOUT_SEC` (default 600) |
| `no se puede cargar el archivo ... no está firmado digitalmente` (Windows) | Execution policy de PowerShell | El fixture ya pasa `-ExecutionPolicy Bypass`. Si lo corrés a mano, agregalo vos |
| `No se encontro setup-test-db.ps1` (Windows) | El script no está junto al `.sh` | Ambos viven en `Kaptas.Tests/scripts/`. Verificá que el `.ps1` esté commiteado |
| `No se resolvió el host SQL` | Sin env vars ni config de test | `cp appsettings.Tests.example.json appsettings.Tests.json` y completar el password (o setear `KAPTAS_SQL_HOST`/`KAPTAS_SA_PASSWORD`) |
| `No se resolvió el password SA` / `SA password vacio` | Copiaste el example pero dejaste el placeholder `<SA-password-...>` | Editar `appsettings.Tests.json` y poner el password real |
| `SQL Server no responde tras 30s` | Host/credenciales mal, o server caído | Verificar `KAPTAS_SQL_HOST` y que el server esté arriba |
| `proquia@gmail.com no existe` | La BD dev origen no tiene el usuario de prueba | Crearlo desde la app antes de aislar |

---

_Referencia de la infraestructura de tests · cambio `inicializar-entorno` (pasos 1.1–1.7)._
