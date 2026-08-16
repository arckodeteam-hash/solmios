# Despliegue de las páginas del footer — solmios.com

> Sistema completo: **CMS en el panel** (editar sin deploys) + **archivos estáticos**
> (funcionan hoy, sin tocar el repo del landing). Esta carpeta contiene ambos.

## Las dos piezas

| Pieza | Qué es | Dónde vive |
|---|---|---|
| **CMS `site-pages`** | Módulo backend + `/admin/sitio` en el panel. Edición, publish/draft, orden. API pública para que el landing renderice. | `backend/src/modules/site-pages/` + `frontend/src/pages/super-admin/sitio.vue` |
| **Archivos estáticos** | Los 15 `.html` + `paginas.css` de esta carpeta, listos para copiar a la raíz del sitio. | `documentacion/paginas-solmios/` |

## Camino A — hoy, sin tocar el repo del landing

1. Copiar **todo el contenido** de esta carpeta (`.html` + `paginas.css`) a la raíz
   estática del sitio (donde vive el `index.html` de la SPA).
2. El hosting sirve el archivo real antes que el fallback de la SPA → `solmios.com/privacidad`
   pasa a existir. Los links internos entre páginas ya están con paths absolutos (`/ayuda`…).
3. ⚠️ El hosting debe resolver `/privacidad` → `privacidad.html` (clean URLs):
   Cloudflare Pages lo hace por defecto; si no, agregar regla de reescritura.

## Camino B — el definitivo: el landing consume el CMS

El repo del landing (Vue SPA, NO está en este repo) necesita ~10 líneas: una ruta
catch-all del footer que fetchee la API pública y renderice el `contentHtml`:

```
GET https://hotel.zx89.site/api/public/site-pages        → índice (slug, title, category)
GET https://hotel.zx89.site/api/public/site-pages/:slug  → { slug, title, metaDescription, contentHtml, ... }
```

- CORS: abierto (`access-control-allow-origin: *`), rate-limit 30 req/min/IP.
- Solo `status: published`; un draft da 404 igual que una inexistente.
- Renderizar `contentHtml` con sanitización (DOMPurify o equivalente) por defensa,
  aunque el contenido solo lo escribe el super_admin.
- Al pasar al Camino B, los archivos estáticos del Camino A se retiran (excepto
  `estado.html`, que es funcional — su fetch en vivo no puede vivir en el CMS).

## Seed inicial del CMS (ya corrido en dev)

```bash
cd backend
bun run scripts/seed-site-pages.ts        # idempotente por slug (14 páginas)
```

## Patch del footer del landing (el TODO externo)

Los links del footer de la SPA están hoy en `href="#"`. Valores a setear:

| Columna footer | Link | href |
|---|---|---|
| Producto | API | `/api` |
| Empresa | Sobre Nosotros | `/sobre-nosotros` |
| Empresa | Blog | `/blog` |
| Empresa | Carreras | `/carreras` |
| Empresa | Contacto | `/contacto` |
| Soporte | Centro de Ayuda | `/ayuda` |
| Soporte | Documentación | `/documentacion` |
| Soporte | Estado del Sistema | `/estado` |
| Soporte | Comunidad | `/comunidad` |
| Legal | Privacidad (hoy texto plano) | `/privacidad` |
| Legal | Términos (hoy texto plano) | `/terminos` |
| Legal | Cookies (hoy texto plano) | `/cookies` |

(Funciones/Precios/Integraciones ya son anchors `#features/#pricing/#integrations` — no tocar.)

## Pendientes de negocio (no de código)

1. **Buzones**: crear en Cloudflare `privacidad@solmios.com`, `contacto@solmios.com`,
   `soporte@solmios.com` (redirecciones; las páginas los usan como contacto).
2. **Prod**: al deployar el backend, correr `RUN_MIGRATE=1` (crea `site_pages`) +
   `bun run migrate` (crea `idx_site_pages_slug`) + `seed-site-pages.ts`.
3. **Google Play**: la URL de privacidad a declarar sigue siendo `https://solmios.com/privacidad`
   (ver `guia-play-store.html`).
