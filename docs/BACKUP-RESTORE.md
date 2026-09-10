# Backup / Restore de Base de Datos — ManagerHotel (SOLMI OS)

> Procedimiento de respaldo y restauración de la DB en los dos motores.
> Issue GitLab #298. DB multi-motor: **SQLite** en dev, **PostgreSQL** en prod (elegido por `DATABASE_URL`).

## Resumen

| Entorno | Motor | Ubicación | Herramienta backup |
|---------|-------|-----------|--------------------|
| Dev (local) | SQLite (bun:sqlite/WAL) | `backend/data/managerhotel.db` | copia de archivo + WAL checkpoint |
| Prod (hotel.zx89.site) | PostgreSQL 16 | base `solmios` @ `localhost:5432` | `pg_dump` / `pg_restore` |

---

## 1. SQLite (desarrollo)

### Ubicación

```
backend/data/managerhotel.db        # base principal
backend/data/managerhotel.db-wal    # Write-Ahead Log (cambios sin checkpoint)
backend/data/managerhotel.db-shm    # shared memory index
```

Los tres archivos están **gitignored** (no se commitean).

### Backup en caliente

SQLite en modo WAL guarda escrituras recientes en el `-wal`, así que copiar solo el `.db` puede
dejar datos afuera. Dos opciones:

**Opción A — checkpoint + copia (recomendada, consolida el WAL en el `.db`):**

```bash
cd backend
# Fuerza el WAL a integrarse al archivo principal, luego copia
sqlite3 data/managerhotel.db "PRAGMA wal_checkpoint(TRUNCATE);"
cp data/managerhotel.db data/managerhotel.$(date +%Y%m%d-%H%M%S).bak
```

**Opción B — `.backup` de sqlite3 (consistente sin detener la app, incluye el WAL):**

```bash
cd backend
sqlite3 data/managerhotel.db ".backup 'data/managerhotel.$(date +%Y%m%d-%H%M%S).bak'"
```

### Restore

```bash
cd backend
# Detener el backend de dev antes de restaurar (evita corrupción)
cp data/managerhotel.YYYYMMDD-HHMMSS.bak data/managerhotel.db
# Limpiar WAL/SHM viejos para no mezclar estados
rm -f data/managerhotel.db-wal data/managerhotel.db-shm
```

Alternativa desde `.bak` creado con `.backup`: es un `.db` completo, se copia igual.

---

## 2. PostgreSQL (producción)

Base `solmios` en `localhost:5432` (user `solmios`). Ejecutar en el servidor (`SOLSSH` del runbook)
o vía `sudo -u postgres`.

### Backup con `pg_dump` (formato custom `-Fc`)

El formato custom (`-Fc`) es comprimido, restaurable selectivamente con `pg_restore` y el recomendado
para respaldos operativos:

```bash
# En el servidor de prod
sudo -u postgres pg_dump -Fc -d solmios -f /var/backups/solmios/solmios-$(date +%Y%m%d-%H%M%S).dump
```

> Ajustar el directorio `/var/backups/solmios/` según lo que exista en el server (crear con
> `mkdir -p` y permisos para el user `postgres`). **(completar: confirmar path definitivo en prod).**

Backup en texto plano (SQL, más portable pero sin restore selectivo), como alternativa:

```bash
sudo -u postgres pg_dump -d solmios -f /var/backups/solmios/solmios-$(date +%Y%m%d-%H%M%S).sql
```

### Restore con `pg_restore`

```bash
# Restaurar sobre una base LIMPIA (dropea y recrea objetos)
sudo -u postgres pg_restore --clean --if-exists -d solmios /var/backups/solmios/solmios-YYYYMMDD-HHMMSS.dump

# O crear una base nueva desde cero y restaurar ahí (más seguro para probar)
sudo -u postgres createdb solmios_restore
sudo -u postgres pg_restore -d solmios_restore /var/backups/solmios/solmios-YYYYMMDD-HHMMSS.dump
```

Restore de un dump `.sql` en texto plano:

```bash
sudo -u postgres psql -d solmios -f /var/backups/solmios/solmios-YYYYMMDD-HHMMSS.sql
```

> Detener el backend (`systemctl stop solmios-backend`) antes de un restore destructivo (`--clean`)
> y volver a arrancarlo después (`systemctl start solmios-backend`).

### Cron diario sugerido

> ⚠️ El **cron automático de backup es el issue #292**, aún **pendiente de configurar en prod**.
> Esto es la referencia sugerida hasta que se implemente.

```cron
# /etc/cron.d/solmios-db-backup  (ejemplo — pendiente de instalar, issue #292)
# Backup diario 03:00, formato custom, en /var/backups/solmios/
0 3 * * * postgres pg_dump -Fc -d solmios -f /var/backups/solmios/solmios-$(date +\%Y\%m\%d).dump 2>> /var/log/solmios-backup.log
# Retención: borrar dumps con más de 14 días
30 3 * * * postgres find /var/backups/solmios -name 'solmios-*.dump' -mtime +14 -delete
```

**Retención sugerida:** 14 días de dumps diarios en el server. Para mayor seguridad, copiar
periódicamente los dumps a almacenamiento externo/offsite **(completar: definir destino offsite)**.

---

## 2b. Backups desde la pantalla `/admin/monitoring` (solo `super_admin`)

La pantalla de monitoreo crea, lista, descarga y borra volcados completos de la base
(`GET/POST /api/admin/backups`, `GET /api/admin/backups/:id/download`, `DELETE /api/admin/backups/:id`).
Usa `pg_dump` si hay `DATABASE_URL` (el binario tiene que estar en el `PATH` del servicio; la
contraseña viaja por `PGPASSWORD`, nunca por argv) y una copia consistente (`VACUUM INTO`) si es
SQLite (`DB_PATH`). Crear y descargar quedan en el audit log.

Variables de entorno (van en `backend/.env`, todas opcionales):

| Variable | Default | Qué hace |
|---|---|---|
| `BACKUP_DIR` | `backend/data/backups` (se crea si falta) | Directorio de los volcados. Tiene que quedar FUERA de `frontend/dist` y de `uploads/`: un backup nunca se sirve como estático. |
| `BACKUP_RETENTION_COUNT` | `10` | Cuántos se conservan: al crear el N+1 se borra el más viejo. |
| `ERROR_LOG_RETENTION_DAYS` | `30` | Días que se conservan las filas de `error_logs` (5xx/429 agrupados por ruta+mensaje); el cron de retención corre una vez por día. |

Riesgo residual: el archivo queda sin cifrar en disco. El id de descarga se resuelve por coincidencia
exacta contra el listado real del directorio, nunca concatenando el id del cliente a una ruta.

## 3. Portabilidad — recrear el schema desde cero

Si no hay dump (o se migra a un motor nuevo), el schema se **reconstruye en 2 capas, en orden
insaltable** (ver `CLAUDE.md` → "Database — Migraciones y Seeders"):

```bash
cd backend

# Paso 1 — tablas desde los modelos ORM (CREATE TABLE IF NOT EXISTS). NO bindea puerto HTTP.
#   Postgres:
DATABASE_URL=postgres://solmios:...@localhost:5432/solmios RUN_MIGRATE=1 bun run src/composition-root.ts
#   SQLite (dev):
DB_PATH=data/managerhotel.db RUN_MIGRATE=1 bun run src/composition-root.ts

# Paso 2 — seed demo + tablas EXTRA no-modeladas (packages, devices, announcements, api_keys,
#   audit_log, configuration, email_queue, groups, maintenance, tickets, notifications, ai_*).
bun run migrate-db.ts
```

**Orden insaltable:** `migrate-db.ts` corre `seedBase()` (INSERT en `hotels`/`users`/...) ANTES de
crear las tablas extra y NO crea las tablas base. Si se corre sobre una DB vacía sin el Paso 1 →
falla con `no such table: hotels`. Primero Paso 1 (tablas base), después Paso 2.

> En prod usar la ruta completa de bun (`/root/.bun/bin/bun`) para el Paso 1: `bun` pelado falla 127
> en silencio (ver runbook). Scripts idempotentes: se pueden re-correr sin duplicar
> (`CREATE TABLE IF NOT EXISTS` + `exists()`/`COUNT(*)` + `ON CONFLICT`).

### Notas de portabilidad relevantes al restore

| Nota | Detalle |
|------|---------|
| camelCase ↔ lowercase | PG pliega identificadores no-entrecomillados a minúsculas (`hotelId`→`hotelid`); el framework 1.6.2 remapea nativamente a camelCase al leer. Las columnas físicas en PG son lowercase. |
| Booleanos | El ORM mapea `type:'boolean'` ↔ columna INTEGER en ambos motores. Un dump preserva el INTEGER. |
| `configuration` UNIQUE | `UNIQUE(hotelId, key)` se garantiza vía `CREATE UNIQUE INDEX idx_configuration_hotel_key` (el ORM no crea unique compuesto). Un restore de schema debe incluirlo. |
| PG prod sin seed financiero | folios/facturas/gastos/caja arrancan en 0; reports computan desde reservas. |

---

## 4. Checklist rápido

| Necesito... | Comando |
|-------------|---------|
| Backup dev (SQLite) | `sqlite3 data/managerhotel.db ".backup 'data/managerhotel.<ts>.bak'"` |
| Restore dev | `cp <bak> data/managerhotel.db && rm -f data/managerhotel.db-wal data/managerhotel.db-shm` |
| Backup prod (PG) | `sudo -u postgres pg_dump -Fc -d solmios -f <path>.dump` |
| Restore prod (PG) | `sudo -u postgres pg_restore --clean --if-exists -d solmios <path>.dump` |
| Recrear schema | Paso 1 `RUN_MIGRATE=1 ... composition-root.ts` → Paso 2 `bun run migrate-db.ts` |
