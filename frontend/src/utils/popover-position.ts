// popover-position.ts — dónde se dibuja un menú anclado a algo que el usuario acaba de señalar.
//
// El menú del planning se posicionaba en las coordenadas crudas del click: quedaba ENCIMA del
// tramo elegido (tapando justo lo que acabás de marcar) y en las filas de abajo se salía de la
// pantalla, porque nadie lo acotaba al viewport. Acá vive esa cuenta, separada del componente,
// porque es la parte que se puede probar sin un navegador.
//
// Reglas, en orden:
//   1. Al LADO del ancla (derecha), no encima: la selección tiene que seguir viéndose.
//   2. Si a la derecha no entra, a la izquierda.
//   3. Si de ningún lado entra (pantalla angosta), abajo — o arriba si abajo no hay lugar.
//   4. Siempre dentro de la pantalla, con un margen.

export interface Rect { left: number; top: number; width: number; height: number }
export interface Size { width: number; height: number }
export interface Viewport { width: number; height: number }

export type PopoverSide = 'right' | 'left' | 'below' | 'above'

export interface PlaceInput {
  /** Rectángulo de lo señalado, en coordenadas de viewport (getBoundingClientRect). */
  anchor: Rect | null
  size: Size
  viewport: Viewport
  /** Separación entre el ancla y el menú. */
  gap?: number
  /** Aire mínimo contra los bordes de la pantalla. */
  margin?: number
}

export interface Placement { left: number; top: number; side: PopoverSide }

function clamp(v: number, min: number, max: number): number {
  // max < min pasa cuando el menú es más alto que la pantalla: gana el borde superior, así que
  // lo que se pierde es el final del menú y no su encabezado.
  if (max < min) return min
  return Math.min(Math.max(v, min), max)
}

export function placePopover(input: PlaceInput): Placement {
  const gap = input.gap ?? 8
  const margin = input.margin ?? 8
  const { size, viewport } = input
  const maxLeft = viewport.width - size.width - margin
  const maxTop = viewport.height - size.height - margin

  // Sin ancla (no se pudo medir la celda): al centro, que es lo menos sorprendente.
  if (!input.anchor) {
    return {
      left: clamp((viewport.width - size.width) / 2, margin, maxLeft),
      top: clamp((viewport.height - size.height) / 2, margin, maxTop),
      side: 'below',
    }
  }
  const a = input.anchor
  const anchorRight = a.left + a.width
  const anchorBottom = a.top + a.height

  const cabeDerecha = anchorRight + gap + size.width + margin <= viewport.width
  const cabeIzquierda = a.left - gap - size.width - margin >= 0

  if (cabeDerecha || cabeIzquierda) {
    const side: PopoverSide = cabeDerecha ? 'right' : 'left'
    const left = side === 'right' ? anchorRight + gap : a.left - gap - size.width
    // Arranca alineado con el borde de arriba del ancla; si abajo no hay lugar, sube.
    return { left: clamp(left, margin, maxLeft), top: clamp(a.top, margin, maxTop), side }
  }

  // Ni a un lado ni al otro: va debajo, centrado sobre el ancla. Si debajo tampoco entra, arriba.
  const cabeAbajo = anchorBottom + gap + size.height + margin <= viewport.height
  const side: PopoverSide = cabeAbajo ? 'below' : 'above'
  const top = cabeAbajo ? anchorBottom + gap : a.top - gap - size.height
  return {
    left: clamp(a.left + a.width / 2 - size.width / 2, margin, maxLeft),
    top: clamp(top, margin, maxTop),
    side,
  }
}
