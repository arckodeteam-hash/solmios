# Runbook de Deploy — ManagerHotel (SOLMI OS)

> Runbook operativo para desplegar a producción (`hotel.zx89.site`).
> Issue GitLab #297. Fuente de verdad: `CLAUDE.md` ("## Producción" + "### Deploy rápido") y skill `ssh-solmios`.

## 1. Datos de producción

| Campo | Valor |
|-------|-------|
| Dominio | `hotel.zx89.site` (HTTPS vía Cloudflare → nginx origen) |
| Host SSH | `root@158.220.103.200` |
| Password SSH | en `~/.solmios-env` → `SOLMIOS_SSH_PASS` (chmod 600, fuera del repo). NUNCA en el repo. |
| Panel | aaPanel (`/www/server/panel`), OS Ubuntu 24.04 LTS |
| Repo en prod | `/www/wwwroot/hotel.zx89.site/solmios` |
| SSH key del repo | `/root/.ssh/id_ed25519` (comentario `deploy@hotel.zx89.site`) |

### Componentes desplegados

| Componente | Detalle |
|------------|---------|
| **Backend** | systemd `solmios-backend.service` (`Restart=on-failure`), Bun en `:3000`. bun binario en `/root/.bun/bin/bun` (**NO está en el PATH del SSH**). Logs: `journalctl -u solmios-backend`. |
| **Frontend** | `frontend/dist/` (SPA build de Vite) servido por **nginx**. nginx hace proxy de `/api` y `/uploads` → `:3000`. |
| **DB** | PostgreSQL 16, base `solmios` en `localhost:5432` (user `solmios`). `.env` del backend tiene `DATABASE_URL=postgres://...`. |
| **Runtime** | Bun >= 1.3 (NO Node.js para el backend). |

> nginx corre vía aaPanel (init.d), **no** systemd → `systemctl is-active nginx` dice `inactive` aunque esté sirviendo. Es normal.

---

## 2. Setup de conexión SSH (una vez por sesión)

Patrón `SSH_ASKPASS` (sin `sshpass`). Ver el skill `ssh-solmios` para el detalle completo.

```bash
set -a && source ~/.solmios-env && set +a   # exporta SOLMIOS_SSH_PASS
printf '#!/bin/bash\necho "$SOLMIOS_SSH_PASS"\n' > /tmp/solmios-askpass.sh && chmod 700 /tmp/solmios-askpass.sh
SOLSSH() { SSH_ASKPASS=/tmp/solmios-askpass.sh SSH_ASKPASS_REQUIRE=force setsid -w ssh -o StrictHostKeyChecking=no -o ConnectTimeout=15 -o PreferredAuthentications=password -o PubkeyAuthentication=no root@158.220.103.200 "$1" 2>&1; }
# Al terminar la sesión: rm -f /tmp/solmios-askpass.sh   (no dejar la credencial en /tmp)
```

---

## 3. Procedimiento de deploy paso a paso

```bash
REPO=/www/wwwroot/hotel.zx89.site/solmios
BACK=$REPO/backend
FRONT=$REPO/frontend
```

### Paso 1 — `git pull` (con el gotcha de las 2 SSH keys)

El servidor tiene **2 SSH keys** (`id_ed25519` + `id_rsa`). El `git pull` a veces falla con
`could not read... make sure you have access` aunque `ssh -T git@gitlab.com` funcione, porque
SSH ofrece ambas keys y GitLab rechaza el intento. Forzar la key correcta con `IdentitiesOnly`:

```bash
SOLSSH "cd $REPO && GIT_SSH_COMMAND='ssh -i /root/.ssh/id_ed25519 -o IdentitiesOnly=yes -o StrictHostKeyChecking=accept-new' git pull origin main"
```

> Fix permanente ya aplicado en `/root/.ssh/config` (`Host gitlab.com` + `IdentitiesOnly yes`).
> Regla: servidor con >1 key → SIEMPRE fijar `IdentitiesOnly yes` para el host de git.

### Paso 2 — Backend: install + restart

```bash
SOLSSH "cd $BACK && bun install && systemctl restart solmios-backend"
```

### Paso 3 — Migración ORM condicional (SOLO si cambiaron modelos)

Si el deploy incluye cambios en modelos ORM (`orm.define`), sincronizar tablas.
Idempotente (`CREATE TABLE IF NOT EXISTS`), NO bindea el puerto HTTP.
**Usar la ruta completa de bun** — `bun` pelado falla con exit 127 en silencio y la tabla nueva NO se crea:

```bash
SOLSSH "cd $BACK && set -a && source .env && set +a && RUN_MIGRATE=1 /root/.bun/bin/bun run src/composition-root.ts"
```

> `ormMigrate` en fw 1.6.2 hace `ADD COLUMN` para campos nuevos, pero NO renombra: renombrar un
> campo deja la columna vieja **orphan** (solo warning). Migrar data a mano + `DROP COLUMN` explícito.

### Paso 4 — Frontend: build (SIEMPRE `bun --bun`)

El server tiene Node 18; **Node 18 + Vite 8 rompe**. Forzar el runtime bun con `--bun`:

```bash
SOLSSH "cd $FRONT && bun --bun vite build"
```

**⚠️ Verificar SIEMPRE que el build termine en `✓ built` antes de dar el deploy por hecho.**
Si el build de Vite falla, **NO pisa el `dist/` viejo** → queda servida la versión anterior y
parece que "no pasó nada". nginx sirve `dist/` directo, no hace falta reload salvo cambio de vhost.

### Paso 5 — (opcional) Reload nginx si cambió el vhost

```bash
SOLSSH "nginx -t && nginx -s reload"
```

---

## 4. Verificación post-deploy (health-check)

```bash
# Backend systemd activo
SOLSSH "systemctl status solmios-backend --no-pager | head -12"

# Dominio responde
curl -sI https://hotel.zx89.site/ | head -2

# Login demo funciona (esperar HTTP 200)
curl -s -X POST https://hotel.zx89.site/api/auth/login -H 'Content-Type: application/json' \
  -d '{"email":"hotel@solmios.com","password":"demo123"}' -w '\n%{http_code}\n' -o /dev/null

# Health-check de integraciones (Channex) — desde local contra el backend
cd backend && bun run doctor
```

Credenciales demo en prod (verificadas): todas `@solmios.com` / `demo123`
(`hotel@` = hotel_admin, `admin@` = super_admin, `recepcion@`, `rosa@`, `carlos@`, `luis@`).
Acepta email o teléfono en el mismo campo. Los dominios `@caribeparadise.com` / `@managerhotel.com`
dan **401 en prod** (la DB fue re-seedeada con `@solmios.com`; solo existen en la SQLite local de dev).

---

## 5. Rollback básico

```bash
# 1. Ver el commit anterior estable
SOLSSH "cd $REPO && git log --oneline -5"

# 2. Volver al commit anterior (reemplazar <sha>)
SOLSSH "cd $REPO && GIT_SSH_COMMAND='ssh -i /root/.ssh/id_ed25519 -o IdentitiesOnly=yes' git checkout <sha>"

# 3. Rebuild frontend + restart backend
SOLSSH "cd $BACK && bun install && systemctl restart solmios-backend"
SOLSSH "cd $FRONT && bun --bun vite build"   # verificar '✓ built'

# 4. Volver a main cuando esté fixeado
SOLSSH "cd $REPO && git checkout main"
```

> Si el rollback incluye revertir un cambio de modelo ORM: `ADD COLUMN` no se auto-revierte.
> Las columnas nuevas quedan (inocuas si el código viejo no las usa); un `DROP COLUMN` manual solo
> si hace falta. La DB Postgres NO se rollbackea sola — ver `docs/BACKUP-RESTORE.md`.

---

## 6. Advertencias reales (checklist rápido)

| Advertencia | Detalle |
|-------------|---------|
| **Build de Vite que falla no pisa `dist/`** | Verificar `✓ built` SIEMPRE. Sin eso, queda la versión vieja servida. |
| **`bun` pelado en prod falla 127** | Para `RUN_MIGRATE` usar `/root/.bun/bin/bun` (ruta completa), no `bun`. |
| **`bun --bun vite build` obligatorio** | Node 18 + Vite 8 rompe. Sin `--bun` el build falla. |
| **`git pull` con 2 SSH keys** | Forzar `IdentitiesOnly=yes` + `-i /root/.ssh/id_ed25519`. |
| **nginx no está en systemd** | `systemctl is-active nginx` = inactive es normal (corre vía aaPanel). |
| **Migración solo si cambiaron modelos** | Correr `RUN_MIGRATE` de más es idempotente pero innecesario. |
| **PG prod sin seed financiero** | folios/facturas/gastos/caja = 0 registros; reports computan desde reservas. |
| **`PUBLIC_URL` vacía = links de correo sin host** | De ahí sale el host de los links que van por email (verificación del alta, `/api/public/verify-email?token=…`). Si queda vacía el link sale relativo y no se puede clickear: el correo llega, pero inservible. Tiene que ser el origen que **sirve la app**, no una URL sólo de API — la verificación responde 302 con `Location` relativo a `/verificar-email`, que resuelve contra ese mismo origen. No confundir con `PUBLIC_BASE_URL`, que es la URL pública del sitio del hotel (Stripe success/cancel, sitemap). |

---

## 7. Comandos de gestión frecuentes

```bash
SOLSSH "systemctl restart solmios-backend"                 # restart backend
SOLSSH "journalctl -u solmios-backend -f --no-pager"       # logs en vivo
SOLSSH "systemctl status solmios-backend --no-pager | head -12"
SOLSSH "sudo -u postgres psql -d solmios"                  # consola PG
```

> Deploy completo y protocolo extendido: skill `ssh-solmios`.
