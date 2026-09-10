# anuncios-plataforma-real

## Intent

Que `/admin/announcements` sirva para lo único que justifica su existencia: **que el dueño de la
plataforma le hable a sus hoteles y sepa si lo leyeron**. Hoy la pantalla deja escribir y guardar un
anuncio, pero el anuncio **no llega a ningún hotel** salvo que se le grabe a mano el `hotelId` de uno
solo, y todas las métricas que muestra están escritas en el HTML.

Referencia MisterPlan: no aplica — MisterPlan no tiene panel de plataforma. Esto es comunicación
del SaaS con sus clientes, no una función del PMS que replicamos.

## Estado al abrir el change (2026-09-09)

Parte del decorado ya se corrigió en el árbol de trabajo (sin commit): `sendAnnouncement()` ahora
hace `POST /api/anuncios`, y "Ver"/"Eliminar" tienen handler con confirmación
(`announcements.vue:250-296`). Eso NO se re-hace acá. Lo que queda es lo de abajo.

## El problema, con evidencia

| Lo que promete la pantalla | Realidad | Evidencia |
|---|---|---|
| "Envía mensajes a **todos** los hoteles" (`announcements.vue:7`) | Un anuncio sin `hotelId` **no lo ve nadie**: para un usuario que no es super_admin el listado filtra por igualdad exacta `hotelId = <su hotel>`, y `NULL` nunca matchea | `anuncios/service.ts:47-52` |
| Checkboxes "Todos los hoteles" / "Solo admins" | `newAnnouncement.allHotels` y `.adminsOnly` **no se mandan** en el `create`; el modelo no tiene dónde guardarlos | `announcements.vue:134,138` vs `announcements.vue:256-263`, `anuncios/model.ts` |
| Columna "Vistas / N leídos" | `views: 0, reads: 0` literal — no existe tabla de lecturas | `announcements.vue:237` |
| Tarjeta "Alcance": 24 hoteles · 89 usuarios · 72% apertura · 18% click | Los cuatro números están escritos en el HTML | `announcements.vue:72,76,80,84` |
| Tarjeta "Plantillas Guardadas" | Array literal en el `<script>`, sin `@click` | `announcements.vue:214-219` |
| Tarjeta "Programación" | `scheduled = ref([])` — siempre vacía; no hay envío diferido ni vigencia | `announcements.vue:221` |
| Banner "✕ no volver a mostrar" | Se guarda en `configuration('dismissed_announcements', hotelId)`: **un recepcionista que cierra el aviso lo oculta para todo el hotel**, incluido el dueño | `AnnouncementBanner.vue:66,77` |
| Badge de prioridad `urgent` en el banner | Inalcanzable: el validador solo acepta `low\|medium\|high` | `AnnouncementBanner.vue:13` vs `validators/schema.ts:7` |
| Publicar un anuncio | El hotel puede tardar hasta 5 min en verlo: la clave que se borra al crear (`anuncios:list:<hotelId>`) **no es** la que se escribe al listar (`anuncios:list:<hotelId>:p1:l20:{...}`) | `anuncios/service.ts:93,106,119` vs `:62` |

## Alcance

1. **Difusión real**: un anuncio sin hotel llega a todos los hoteles.
2. **Audiencia elegible** y persistida: todos · un hotel · solo administradores.
3. **Vigencia**: desde/hasta, con programación de publicación que la tarjeta ya promete.
4. **Lecturas por usuario**: quién lo vio y quién lo cerró; el ✕ deja de ser del hotel entero.
5. **Alcance medido**: hoteles, usuarios, tasa de apertura — de la base, no del HTML.
6. **Plantillas guardadas** reales, o se borra la tarjeta.
7. Higiene: invalidación de caché correcta, `urgent` aceptado, tipos coherentes.

## Fuera de alcance

- Envío del anuncio por email o WhatsApp. Acá es solo el banner dentro del panel.
- Segmentación por plan, país o antigüedad del hotel.
- Editor enriquecido (el mensaje sigue siendo texto plano).

## Módulos afectados

`backend/src/modules/anuncios` (model, service, controller, validators, types, index),
`backend/src/modules/admin` (`listAnnouncements`, stats),
`frontend/src/pages/super-admin/announcements.vue`,
`frontend/src/components/features/core-pms/AnnouncementBanner.vue`,
`frontend/src/services/Announcements.service.ts`.

## Riesgo y rollback

Riesgo medio: el cambio de filtrado hace **visible** contenido que hoy no se ve. Un anuncio viejo con
`hotelId` nulo y `active = 1` empezaría a aparecerle a todos los hoteles al desplegar.

- **Mitigación previa al deploy**: `SELECT id, title, active FROM announcements WHERE hotelId IS NULL`
  y desactivar (`active = 0`) lo que no deba difundirse.
- **Rollback**: revertir el commit. Las columnas nuevas (`audience`, `startsAt`, `endsAt`) y la tabla
  `announcement_reads` quedan huérfanas pero son aditivas — ningún código viejo las lee, así que no
  rompen. Borrarlas es opcional y manual (el ORM hace ADD COLUMN, nunca DROP: ver CLAUDE.md).
