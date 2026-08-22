---
name: qa-ui
description: >
  Auditoría UI de una vista del panel (web) de SOLMI OS: detecta botones/acciones faltantes,
  estados ausentes (loading/empty/error), problemas de usabilidad, a11y, responsive y
  consistencia, con evidencia real (browser + screenshots). Trigger: "/qa-ui <vista>",
  "revisá esta vista", "falta algo en esta pantalla", "qa de ui", "está completa esta vista",
  antes de cerrar una feature de frontend.
license: Apache-2.0
metadata:
  author: phantom
  version: "1.0"
---

# QA-UI — Auditoría de vistas del panel

Audita UNA vista (ruta del panel/admin) y responde: ¿le falta algo? ¿Es fácil de usar?
Cada hallazgo lleva evidencia (screenshot o `archivo:línea`). Nada de opiniones sin prueba.

## Cuando usarla

- `/qa-ui /panel/reservas` (o cualquier ruta del panel o admin)
- Cierre de una feature de frontend (gate de calidad antes de "listo")
- El dueño reporta "algo falta" / "no es intuitivo" en una pantalla
- Después de cambios de gating por plan (botones que quedaron llamando APIs 403)

## Reglas críticas

1. **Evidencia primero**: todo hallazgo cita screenshot (path) o `archivo:línea` del componente
   (`frontend/src/pages/...`). Sin evidencia → `N/V`, no hallazgo.
2. **Nada destructivo en prod**: no crear/editar/borrar datos reales. Para probar submits usar
   dev local (`:5173` → API `:3000`) o cancelar antes de confirmar. Si no se puede probar → `N/V`.
3. **Browser real, no DOM imaginado**: `playwright-cli` por Bash (NO el plugin MCP). Snapshot
   accesible + screenshots desktop (1440×900) y mobile (375×812).
4. **Leer el screenshot**: `Read` sobre el PNG lo renderiza visualmente. Mirá antes de afirmar.
5. **Contexto del usuario**: loguearse con la cuenta correcta según la vista (ver tabla) —
   el gating por plan cambia lo que se ve.

## Entorno y cuentas

| Ambiente | URL | Notas |
|---|---|---|
| Prod | https://solmios.com | Default. Solo navegación/lectura segura |
| Dev local | http://localhost:5173 | Para probar submits/errores de verdad |

Cuentas demo (pass `demo123`): `hotel@solmios.com` (hotel_admin, /panel) ·
`recepcion@solmios.com` (receptionist) · `admin@solmios.com` (super_admin, /admin).
Trial de plan host para pruebas de gating: ver `docs/audit-plan-gating.md`.

```bash
playwright-cli open https://solmios.com/auth/login
playwright-cli fill e<email> "hotel@solmios.com"     # refs del snapshot real
playwright-cli fill e<pass> "demo123"
playwright-cli click e<submit>
playwright-cli goto https://solmios.com/panel/<vista>
playwright-cli snapshot
playwright-cli screenshot --filename=qa-<vista>-desktop.png
playwright-cli resize 375 812 && playwright-cli screenshot --filename=qa-<vista>-mobile.png
```

## Checklist (las 10 dimensiones — evaluar TODAS, marcar OK / hallazgo / N/V)

| # | Dimensión | Qué verificar |
|---|---|---|
| A1 | **Acciones completas** | Para el tipo de vista (lista/detalle/config): crear, editar, eliminar, ver, buscar/filtrar, paginar si hay volumen, exportar si el módulo lo promete. Un CRUD sin botón de crear = HIGH. |
| A2 | **Navegación** | Volver atrás, breadcrumb si hay profundidad, links internos con `router-link` (no `<a href>` crudo), ruta alcanzable desde el menú. |
| A3 | **Estados de datos** | Loading (skeleton/spinner, no pantalla en blanco), empty state con CTA ("todavía no hay X, creá una"), error con reintento (no solo console). Provocar empty/error solo en dev. |
| A4 | **Formularios** | Label visible por campo, placeholder que AYUDA (⚠️ histórico: `placeholder="••••"` en password parece lleno — prohibido), required marcado, validación inline antes de submit, botón deshabilitado durante envío. |
| A5 | **A11y** | `label for`/aria-label en iconos-botón, focus visible al tabular, contraste texto/fondo, tablas con headers semánticos, imágenes con alt. |
| A6 | **Responsive** | A 375px: sin scroll horizontal, tablas con scroll propio, botones tocables (≥44px), menú colapsado. |
| A7 | **Idioma** | Todo en español consistente con el resto del panel (rioplatense: "cargá", "creá"). Nada de inglés crudo en UI (código en inglés, UI en español). |
| A8 | **Consistencia visual** | Botones primarios/secundarios/ghost como el resto (navy/cyan/coral del design system), misma tipografía/tamaño de tablas y headers, mismos modales, spacing uniforme. Comparar contra una vista madura (reservas, facturas). |
| A9 | **Gating coherente** | Si el usuario tiene plan limitado: ningún botón/acción visible que llame a una API que dará 403 (chk contra `/api/modules`); ningún ítem de menú que no corresponda al plan. |
| A10 | **Feedback de acciones** | Destructivas piden confirmación con nombre del objeto, éxito muestra toast, fracaso muestra el error real (no genérico), hay forma de deshacer donde aplique. |

## Método

1. Identificar la vista y el componente: buscar la ruta en `frontend/src/router/` y leer el `.vue`.
2. Login + navegar + snapshot + 2 screenshots (desktop/mobile) + `Read` de los PNGs.
3. Interacción segura: abrir modales/dropdowns/tabs, tabular con teclado, probar búsqueda.
4. Para cada dimensión A1–A10: OK / hallazgo (severidad + evidencia) / N/V (por qué).
5. Reporte (respuesta al user; opcional guardarlo en `docs/qa-ui/<vista>-YYYY-MM-DD.md`):

```
# QA-UI — <vista> (<ambiente>)
Score: NN/100 · N hallazgos (HIGH x, MEDIUM y, LOW z)
| # | Sev | Hallazgo | Evidencia | Recomendación |
Botones faltantes/rotos primero. Severidades: HIGH=acción imposible o pérdida,
MEDIUM=fricción clara, LOW=pulido.
```

## Severidades

- **HIGH**: no se puede completar la acción principal (botón falta/roto), pérdida de datos, 403 desde UI.
- **MEDIUM**: fricción real (sin empty state, validación tardía, no responsive, a11y bloqueante).
- **LOW**: pulido (copy inconsistente, spacing, foco poco visible).

## Recursos

- Gating por plan: `docs/audit-plan-gating.md` + `GET /api/modules` con el token de la sesión.
- Patrones visuales de referencia: `frontend/src/pages/reservas/`, `frontend/src/pages/facturas/` (vistas maduras).
- Reglas frontend del repo: sección "Reglas — Frontend (Vue 3)" en `CLAUDE.md`.
