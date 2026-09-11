---
name: solmios-ui
description: >
  Design system de SOLMI OS (panel del hotel): KPIs, cards, tablas, modales y estados vacíos.
  Trigger: al crear o rediseñar CUALQUIER vista de `frontend/src/pages/**`, cuando se pida
  "mejorar la vista/las cards/la tabla/el modal", o antes de escribir un `<table>`, un KPI
  o un modal nuevo. Cargar ANTES de escribir markup, no después.
license: Apache-2.0
metadata:
  author: phantom
  version: "1.0"
---

## When to Use

- Vista nueva o rediseño en `frontend/src/pages/**`.
- Cualquier markup con: fila de KPIs, tabla, modal, estado vacío.
- Antes de escribir `<Teleport>` a mano (casi siempre está mal: existe `AppModal`).

## Regla de oro

**Nunca inventes el contenedor.** Si vas a escribir una card, un modal o un header de
tabla desde cero, primero buscá el componente. Cuatro cubren el 90% de las vistas:

| Necesito | Componente | Import |
|---|---|---|
| Cifra destacada (KPI) | `KpiHeroCard` | `@/components/features/dashboard/KpiHeroCard.vue` |
| Sección con título + tabla/contenido | `SectionCard` | `@/components/ui/SectionCard.vue` |
| Modal (todos, sin excepción) | `AppModal` | `@/components/ui/AppModal.vue` |
| Lista sin datos / búsqueda sin resultados | `EmptyState` | `@/components/ui/EmptyState.vue` |
| Vista con 3+ secciones del mismo nivel | `PillTabs` | `@/components/ui/PillTabs.vue` |

Otros: `SearchSelect` (combo con búsqueda), `ConfirmModal` (confirmación destructiva),
`SkeletonLoader`, `Breadcrumbs`, `ChannelIcon`.

## Critical Patterns

### 1. Jerarquía de superficies — navy afuera, claro adentro

El sistema apila **una sola** barra navy por card. `SectionCard` ya trae el header navy,
así que la tabla que va adentro usa header **claro** vía la clase `tbl-head` (definida en
`styles/main.css`). Dos barras navy apiladas se ven pesadas y es el error más repetido.

```vue
<SectionCard title="Listado de facturas" :subtitle="`${total} documentos`" body-class="p-0">
  <template #actions><!-- buscador y filtros van ACÁ, sobre el navy --></template>
  <div class="overflow-x-auto">
    <table class="w-full min-w-[840px] tbl-head">…</table>
  </div>
</SectionCard>
```

Controles dentro del header navy: `border-white/15 bg-white/10 text-white placeholder:text-white/45`.
En un `<select>`, las `<option>` necesitan `class="text-navy"` (heredan blanco y desaparecen).

### 2. KPIs — `KpiHeroCard`, nunca una card a mano

```vue
<div class="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4 mb-6">
  <KpiHeroCard label="Total Huéspedes" :value="total" icon="users" accent="blue"
    :unit="`${nuevos} nuevos · ${vip} VIP`" :progress="pct" />
</div>
```

- `icon`: `bed | checkin | checkout | money | building | users | bookings`.
- `accent`: `blue | green | purple | amber | teal | rose`.
- **Anima solo** (`useCountUp` interno) → NO envolver el value en otro `useCountUp`.
- `unit` es la línea chica: usala para un dato extra, no repitas el label.

### 3. Modales — siempre `AppModal`

Aporta header navy, ESC, bloqueo de scroll del body, transición y footer. Escribir
`<Teleport>` + backdrop a mano duplica todo eso y sale distinto.

```vue
<AppModal v-if="show" size="lg" title="Nueva factura" subtitle="Paso 1 de 3" @close="close">
  <template #header><!-- opcional: reemplaza título por avatar+badges --></template>
  …contenido…
  <template #footer>
    <button class="…text-text-secondary">Cancelar</button>
    <button class="rounded-full bg-navy px-5 py-2.5 text-sm font-bold text-white">Guardar</button>
  </template>
</AppModal>
```

`size`: `sm | md | lg(2xl) | xl(5xl)`. Contenido full-bleed (tabla, franja de métricas) → `body-class="p-0"`.
Perfil/detalle con muchos datos → `size="xl"` + dos columnas: ficha izquierda, actividad derecha.

### 4. Los campos vacíos NO se pintan

El error más feo y más repetido: filas y fichas llenas de `—`. Un dato que no existe
se omite; si la sección entera queda vacía, colapsa a una línea.

```vue
<div v-if="guest.nationality" class="text-[11px] text-text-muted">{{ guest.nationality }}</div>
<p v-if="!sec.fields.length" class="px-4 py-3 text-xs text-text-muted">Sin datos registrados</p>
```

Declarar la ficha como **datos** (array de secciones/campos en un `computed`) y filtrar
`fields.filter(f => f.value !== '—')`, en vez de repetir markup por campo.

### 5. Tablas

- Números (montos, cantidades, puntos) → `text-right` + `tabular-nums`.
- Identidad → avatar con iniciales + nombre + badge de segmento/estado.
- Acciones → botones de **icono** (`h-8 w-8`, `grid place-items-center`, `hover:bg-navy/10`), no texto.
- Responsive: `overflow-x-auto` + `min-w-[Npx]`; columnas secundarias `hidden lg:table-cell`
  y su dato sube como línea bajo el nombre en `<lg`.
- Paginación: `1–10 de 47`, no solo el total.
- Sin filas → `EmptyState` con **dos** mensajes distintos: sin datos (CTA crear) vs.
  filtro sin resultados (CTA limpiar filtros).

### 6. Pestañas — `PillTabs`, nunca secciones apiladas ni un tablist a mano

**Toda vista con 3+ secciones independientes del mismo nivel usa `PillTabs`** (#203): una sección
visible por vez, la fila de pestañas arriba con contador real. Apilar `SectionCard`s hace que lo que
uno busca esté siempre abajo (Carta tenía 5 cabeceras navy seguidas).

```vue
<PillTabs v-model="tab" :tabs="[{ value: 'items', label: 'Ítems', count: items.length }, …]" query-param="tab" aria-label="Secciones de la carta" />
<SectionCard v-if="tab === 'items'" …>
```

- `query-param="tab"` → `?tab=` en la URL: enlace directo abre esa pestaña, F5/back la conservan.
  Omitirlo cuando la pestaña es estado efímero (Caja).
- Trae `role=tablist/tab`, `aria-selected`, teclado ← → Home End y scroll horizontal en 375 px. No
  reimplementar el markup de Caja: es exactamente este componente.
- Pestaña gateada por permiso → filtrarla del array (`if (editPerm) list.push(...)`), no `v-if` en el
  contenido solo.

**Deuda registrada — vistas con pestañas a mano que deben migrar a `PillTabs`** (una tarea por vista):
Salón (zonas, ver issue de Salón) · `settings/index.vue` · `reports/` · `rrhh/attendance` · `crm/` ·
`empleados/` · `pagina-publica/` · `super-admin/settings.vue` · `super-admin/api-keys.vue`.
Ya migradas: `restaurante/carta.vue`, `CashRegisterView.vue`.

### 7. Estado y carga

Skeletons (`animate-pulse rounded bg-surface`) en vez de "Cargando…".
Badge de estado: fondo `color/10` + texto `color` (`bg-teal/10 text-teal`).

## Paleta y tokens

| Token | Uso |
|---|---|
| `navy` | headers, texto principal, CTA primario |
| `cyan` | acento/CTA secundario, "en curso" |
| `teal` | positivo, completado, reciente |
| `gold` | dinero/puntos, alertas suaves |
| `text-muted` / `text-secondary` | labels y texto de apoyo |
| `border` / `surface` | separadores y fondos suaves |

Tipografía: labels `text-[10px] font-bold uppercase tracking-wide text-text-muted`;
cifras `font-black tabular-nums`; radios `rounded-2xl` / `rounded-[20px]` en cards, `rounded-full` en CTAs.

## Reglas Vue del proyecto (no negociables)

- `<script setup lang="ts">` + `<style scoped>`.
- `fetch()` jamás en el componente → `XxxService.method()`.
- Nombres de personal/participantes se resuelven por **`/api/usuarios`** (`TeamService.list()`),
  NUNCA por `employee-profiles` → si no, sale "Sin asignar".
- Iconos SVG inline como `Record<string,string>` + `v-html` sobre un `<span>` con tamaño
  (`class="h-4 w-4"`), y el `<svg>` con `class="h-full w-full"`.

## Commands

```bash
cd frontend && npx vue-tsc --noEmit && bun run build   # ambos deben pasar
# Verificación visual (obligatoria en cambios de UI, el typecheck no ve un modal feo):
cd backend && PORT=3001 bun run --hot src/composition-root.ts   # :3000 suele estar ocupado
cd frontend && bun run dev                                       # login local: admin@caribeparadise.com / demo123
```

## Checklist antes de decir "listo"

- [ ] Cero `<Teleport>` propios: todos los modales son `AppModal`.
- [ ] Cero cards de KPI a mano: son `KpiHeroCard`.
- [ ] La tabla vive en `SectionCard` y usa `tbl-head`.
- [ ] No hay `—` sueltos repetidos ni secciones de puros vacíos.
- [ ] Montos a la derecha con `tabular-nums`.
- [ ] `EmptyState` cubre sin-datos y sin-resultados por separado.
- [ ] 3+ secciones del mismo nivel → `PillTabs`, no cards apiladas ni `role="tablist"` a mano.
- [ ] Scroll horizontal en mobile, no desborde de página.
- [ ] **Mirado en el navegador**, no solo typecheck.

## Resources

- Componentes: `frontend/src/components/ui/`, `frontend/src/components/features/dashboard/`
- Tokens y `tbl-head`: `frontend/src/styles/main.css`
- Referencias ya migradas: `pages/guests/index.vue` (completa), `pages/housekeeping/index.vue`,
  `pages/super-admin/*.vue`
