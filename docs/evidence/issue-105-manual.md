# Issue #105 — Prueba manual: un anuncio global llega a todos los hoteles

Fecha: 2026-09-10 · Entorno: backend local (SQLite temporal, seed de demo) + frontend Vite · Navegador: Chromium headless vía Playwright.

## Objetivo

Verificar de punta a punta que un anuncio creado desde `/admin/announcements` con audiencia
"Todos los hoteles" (sin `hotelId`) aparece en el banner de `/panel` de **dos hoteles distintos**
y que `GET /api/anuncios` de cada hotel devuelve el global sin filtrar anuncios de otro hotel.

## Cuentas usadas (seed de demo; contraseñas no se documentan)

| Rol | Email | Hotel | hotelId |
|---|---|---|---|
| super_admin | admin@solmios.com | — | — |
| hotel_admin | admin@caribeparadise.com | Hotel Boutique Palma | `bca45933-075b-4f0b-bed2-322c3cd7a216` |
| hotel_admin | hotel@solmios.com | SolmiOS Corp | `aa000000-0000-0000-0000-000000000001` |

Estado inicial de `announcements`: 3 anuncios seed, todos con `hotelId = aa000000-…0001` (SolmiOS Corp).
Hotel Boutique Palma no tenía ninguno.

## Pasos

1. Backend: `cd backend && bun run src/composition-root.ts` (PORT=3001, `DB_PATH` temporal migrada y seedeada).
   Frontend: `cd frontend && bunx vite --port 5105` (proxy `/api` → 3001).
2. Script Playwright (`manual-105.mjs`, fuera del repo) con **tres contextos de navegador separados**
   (cookies/localStorage independientes):
   1. Login `admin@solmios.com` → `/admin/announcements` → "Nuevo Anuncio" → título
      `Global #105 <timestamp>`, tipo Mantenimiento, checkbox "Todos los hoteles" marcado → "Enviar Ahora".
      Se espera la fila en "Anuncios Enviados" y se lee la columna **Audiencia**.
   2. Login `admin@caribeparadise.com` → `/panel` → se espera el `AnnouncementBanner` con el título;
      `GET /api/anuncios?active=1` con el token de ese usuario (`Authorization: Bearer`).
   3. Ídem con `hotel@solmios.com`.
3. Se verifica en cada hotel: el global está en `data` (con `hotelId: null`) y **no** aparece ningún
   anuncio cuyo `hotelId` sea el del otro hotel.

## Resultado del script

```
title: Global #105 1789070457288
admin (super_admin): fila visible en la tabla · Audiencia = "Todos los hoteles"

admin@caribeparadise.com (Hotel Boutique Palma, hotelId bca45933-075b-4f0b-bed2-322c3cd7a216)
  banner /panel: ["Global #105 1789070457288"]                      → muestra el título: SÍ
  GET /api/anuncios?active=1 → 200, 1 item:
    06ef3d7f-e22d-4f6f-976c-78e91f52e791  "Global #105 1789070457288"  hotelId=null
  leakFromOtherHotel: []  foreignHotelIds: []

hotel@solmios.com (SolmiOS Corp, hotelId aa000000-0000-0000-0000-000000000001)
  banner /panel: ["Mantenimiento programado", "Global #105 1789070457288", "Nueva versión disponible"]
                                                                       → muestra el título: SÍ
  GET /api/anuncios?active=1 → 200, 4 items:
    a3f11b45-3491-45a0-9255-bc1c2a662bc1  "Mantenimiento programado"   hotelId=aa000000-…0001
    7b382724-8786-47bb-a02a-3995a7f015aa  "Nueva versión disponible"   hotelId=aa000000-…0001
    25b5538c-0370-4efd-91ee-129498f48d21  "Capacitación obligatoria"   hotelId=aa000000-…0001
    06ef3d7f-e22d-4f6f-976c-78e91f52e791  "Global #105 1789070457288"  hotelId=null
  leakFromOtherHotel: []  foreignHotelIds: []

RESULT: OK
```

Conclusión: el anuncio global creado desde la pantalla de super admin se lista como
"Todos los hoteles", ambos hoteles lo reciben en `GET /api/anuncios` y lo muestran en el banner de
`/panel`; cada hotel sólo ve sus propios anuncios más los globales (sin fugas entre hoteles).

## Capturas (fuera del repo, en el directorio temporal del job)

- `/data/home/.claude/jobs/4fffe381/tmp/105-admin.png` — tabla de `/admin/announcements` con la fila del global (Audiencia "Todos los hoteles").
- `/data/home/.claude/jobs/4fffe381/tmp/105-hotel-palma.png` — `/panel` de Hotel Boutique Palma con el banner del global.
- `/data/home/.claude/jobs/4fffe381/tmp/105-hotel-solmios.png` — `/panel` de SolmiOS Corp con el banner del global junto a sus anuncios propios.
- `/data/home/.claude/jobs/4fffe381/tmp/manual-105.mjs` / `manual-105.out` — script y salida completa (JSON).

## Nota

El listado de anuncios tiene cache de 300 s que `create` no invalida (#160, fuera de alcance):
el global se creó **antes** de que cualquier cuenta de hotel listara `/api/anuncios` por primera vez.
