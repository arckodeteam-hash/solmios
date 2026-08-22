# QA-UI — /panel/config/habitaciones (prod)

2 perfiles: `hotel@solmios.com` (hotel_admin, plan full, 7 habitaciones) ·
trial host QA (0 habitaciones — usuario onboarding real).
Componente: `frontend/src/pages/rooms/index.vue` (ruta `rooms`, redirect legacy `/rooms`).
Score: **88/100** · 4 hallazgos (0 HIGH, 1 MEDIUM, 3 LOW) · evidencia en `docs/qa-ui/qa-habitaciones-*.png`

| # | Sev | Dim | Hallazgo | Evidencia | Recomendación |
|---|-----|-----|----------|-----------|---------------|
| 1 | MEDIUM | A9 | El header global del panel fetchea estado de canales sin chequear el módulo → **403 en consola de `/api/channels` en CADA vista** para planes sin canal (host). Ruido + request muerto + posible pieza de UI rota silenciosa | console log trial host + `frontend/src/components/features/core-pms/AppHeader.vue` importa `Channel.service` | Guardar el fetch con el modules store (`channel` false → no llamar). Idem `ReservationCalendar.vue` |
| 2 | LOW | A1 | Sin export del listado ni cambio de estado en masa (solo "Crear en Lote") | screenshot desktop toolbar | Export CSV (reports ya exporta) + selección múltiple para estado |
| 3 | LOW | A4 | Form "Nueva": default `Superficie m² = 0` (raro); sin hint de formato/unidades en Precio | screenshot modal, campo e580="0" | Default vacío u "—" |
| 4 | LOW | A8 | Header "Habitaciones" + badge "EN VIVO" desalineado vs toolbar; whitespace grande con grupos colapsados | screenshot desktop | Alinear baseline; colapsar espacio |

## Lo que está BIEN (verificado, no supuesto)

- **Empty state ejemplar** (hotel 0 habitaciones): "Todavía no hay habitaciones · Creá la primera, o cargá un piso entero con «Crear en Lote»" + botón CTA "Nueva habitación" — exactamente lo que necesita el usuario del paso 2 del onboarding. `qa-habitaciones-empty.png`
- CRUD completo: Nueva + Crear en Lote + búsqueda (número/tipo/piso) + filtro por estado + **edición por click en fila** + Eliminar dentro del modal de edición (sin botones redundantes por fila)
- Fila de habitación informa: nº, estado, precio/noche, capacidad (2p), piso, amenities
- Form: labels visibles en los 11 campos, requireds marcados (*), defaults sensibles (Doble/Disponible/piso 1/cap 2/$80), 17 amenities toggle, Cancelar/Guardar visibles sin scroll
- Agrupación por tipo con contador ("3 habitaciones · 3 disponibles")
- Mobile 375px limpio: sin overflow, touch targets correctos, cards legibles
- Español consistente; sidebar muestra la vista para plan host (gating de menú correcto)

## N/V (no verificable sin romper reglas)

- Validación inline al submit (no se enviaron forms en prod) · estado loading · confirmación de Eliminar · toast de éxito

---

# Re-auditoría post-fix (commit 2328f1a, deploy 2026-08-22) → **100/100**

| Hallazgo | Estado | Evidencia |
|---|---|---|
| MEDIUM A9 — 403 `/api/channels` en header | ✅ FIX prod | console trial host: **0 errores, 0 warnings** (antes: 403) |
| LOW A1 — sin export | ✅ FIX prod | botón "Exportar CSV" habilitado con habitaciones, deshabilitado con 0 (vacío) — snapshot |
| LOW A4 — Superficie default 0 | ✅ FIX prod | campo vacío (snapshot accesible, sin valor "0"); placeholder "opcional" verificado en dev |
| LOW A8 — desalineación/whitespace | ✅ FIX (dev + CI) | centros alineados 233/233/233 + mb-6, medidos por el fixer |
| Modal fácil (pedido del dueño) | ✅ prod | amenities agrupadas **Confort / Cocina / Trabajo** + contador **"0 seleccionadas"** (snapshot accesible prod) |
| Validación inline + delete + toast (ex-N/V) | ✅ verificado con interacción real en DEV | submit vacío → "El número es obligatorio", 0 POSTs; "¿Eliminar habitación 301?" + toast "eliminada" capturado; editar conservó wifi/cocina/42m²/2baños/online |

Gates del fix: vue-tsc ✅ · vitest 921/921 (rooms 12 + header 3 nuevos) · backend intacto.
Evidencia: `qa-habitaciones-v2-desktop.png` · `qa-habitaciones-v2-modal.png`.
Nota: los flujos destructivos (crear/editar/eliminar) se verificaron en dev local — en prod no se creó ni borró nada.
