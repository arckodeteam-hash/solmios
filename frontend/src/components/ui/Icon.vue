<script lang="ts">
import { h, defineComponent, type PropType } from 'vue'

// Set de íconos de línea (outline). Heredan el color vía `currentColor` y el tamaño por prop.
// Cada entrada es una lista de nodos hijos [tag, attrs] del SVG (viewBox 0 0 24 24).
type Node = [string, Record<string, any>]
const ICONS: Record<string, Node[]> = {
  search: [['circle', { cx: 11, cy: 11, r: 7 }], ['path', { d: 'M21 21l-4.3-4.3' }]],
  // Llegadas/Salidas: dos flechas opuestas (entra / sale)
  'in-out': [['path', { d: 'M9 7H21M9 7l3-3M9 7l3 3' }], ['path', { d: 'M15 17H3M15 17l3-3M15 17l3 3' }]],
  lock: [['rect', { x: 5, y: 11, width: 14, height: 10, rx: 2 }], ['path', { d: 'M8 11V7a4 4 0 018 0v4' }]],
  sync: [['path', { d: 'M4 5v5h5' }], ['path', { d: 'M20 19v-5h-5' }], ['path', { d: 'M5.5 14.5A8 8 0 0018.9 16M18.5 9.5A8 8 0 005.1 8' }]],
  calendar: [['rect', { x: 3, y: 5, width: 18, height: 16, rx: 2 }], ['path', { d: 'M3 9h18M8 3v4M16 3v4' }]],
  'calendar-plus': [['rect', { x: 3, y: 5, width: 18, height: 16, rx: 2 }], ['path', { d: 'M3 9h18M8 3v4M16 3v4M12 13v4M10 15h4' }]],
  palette: [['path', { d: 'M12 3a9 9 0 100 18h1.4a2.3 2.3 0 002.3-2.3 1.8 1.8 0 011.8-1.8H19a2 2 0 002-2A8 8 0 0012 3z' }], ['circle', { cx: 7.5, cy: 11, r: 1, fill: 'currentColor', stroke: 'none' }], ['circle', { cx: 12, cy: 8, r: 1, fill: 'currentColor', stroke: 'none' }], ['circle', { cx: 16.5, cy: 11, r: 1, fill: 'currentColor', stroke: 'none' }]],
  ruler: [['rect', { x: 3, y: 8, width: 18, height: 8, rx: 1 }], ['path', { d: 'M7 8v3M11 8v4M15 8v3M19 8v4' }]],
  ban: [['circle', { cx: 12, cy: 12, r: 9 }], ['path', { d: 'M5.6 5.6l12.8 12.8' }]],
  x: [['path', { d: 'M6 6l12 12M18 6L6 18' }]],
  document: [['path', { d: 'M14 3H7a2 2 0 00-2 2v14a2 2 0 002 2h10a2 2 0 002-2V8z' }], ['path', { d: 'M14 3v5h5' }]],
  clipboard: [['rect', { x: 6, y: 4, width: 12, height: 17, rx: 2 }], ['path', { d: 'M9 4V3.2A1.2 1.2 0 0110.2 2h3.6A1.2 1.2 0 0115 3.2V4M9 10h6M9 14h4' }]],
  bell: [['path', { d: 'M18 8a6 6 0 10-12 0c0 7-3 9-3 9h18s-3-2-3-9' }], ['path', { d: 'M13.7 21a2 2 0 01-3.4 0' }]],
  trash: [['path', { d: 'M4 7h16M10 11v6M14 11v6M6 7l1 13a2 2 0 002 2h6a2 2 0 002-2l1-13M9 7V4h6v3' }]],
  user: [['circle', { cx: 12, cy: 8, r: 4 }], ['path', { d: 'M4 21a8 8 0 0116 0' }]],
  // Dos personas — ocupación de más de 1 huésped (selector de "para N", carrito de reserva).
  users: [['circle', { cx: 9, cy: 8, r: 3.5 }], ['path', { d: 'M2.5 20c0-3.6 2.9-6.5 6.5-6.5s6.5 2.9 6.5 6.5' }], ['path', { d: 'M16.5 5.2a3.5 3.5 0 010 6.6M18 13.9c2.1.8 3.5 2.8 3.5 5.1' }]],
  bolt: [['path', { d: 'M13 2L4 14h6l-1 8 9-12h-6l1-8z' }]],
  alert: [['path', { d: 'M10.3 3.9L2 18a2 2 0 001.7 3h16.6a2 2 0 001.7-3L13.7 3.9a2 2 0 00-3.4 0z' }], ['path', { d: 'M12 9v4M12 17h.01' }]],
  globe: [['circle', { cx: 12, cy: 12, r: 9 }], ['path', { d: 'M3 12h18M12 3a15 15 0 010 18M12 3a15 15 0 000 18' }]],
  card: [['rect', { x: 3, y: 5, width: 18, height: 14, rx: 2 }], ['path', { d: 'M3 10h18' }]],
  building: [['path', { d: 'M6 21V5a1 1 0 011-1h10a1 1 0 011 1v16M3 21h18M10 21v-4h4v4' }], ['path', { d: 'M9 8h.01M13 8h.01M9 12h.01M13 12h.01' }]],
  money: [['circle', { cx: 12, cy: 12, r: 9 }], ['path', { d: 'M12 7v10M14.5 9.3A2.7 2 0 0012 8a2.2 1.9 0 000 3.8 2.2 1.9 0 010 3.8A2.7 2 0 019.5 14.7' }]],
  printer: [['path', { d: 'M6 9V3h12v6M6 18H4a2 2 0 01-2-2v-4a2 2 0 012-2h16a2 2 0 012 2v4a2 2 0 01-2 2h-2' }], ['rect', { x: 6, y: 14, width: 12, height: 7, rx: 1 }]],
  'arrow-down': [['path', { d: 'M12 4v12M6 11l6 6 6-6M5 21h14' }]],
  'arrow-up': [['path', { d: 'M12 20V8M6 13l6-6 6 6M5 3h14' }]],
  battery: [['rect', { x: 2, y: 8, width: 18, height: 9, rx: 2 }], ['path', { d: 'M22 11.5v2' }]],
  'circle-check': [['circle', { cx: 12, cy: 12, r: 9 }], ['path', { d: 'M8 12l3 3 5-6' }]],
  check: [['path', { d: 'M5 13l4 4L19 7' }]],
  'circle-half': [['circle', { cx: 12, cy: 12, r: 8 }], ['path', { d: 'M12 4a8 8 0 010 16z', fill: 'currentColor', stroke: 'none' }]],
  circle: [['circle', { cx: 12, cy: 12, r: 8 }]],
  dot: [['circle', { cx: 12, cy: 12, r: 4, fill: 'currentColor', stroke: 'none' }]],
  chart: [['path', { d: 'M3 21h18' }], ['rect', { x: 5, y: 11, width: 3, height: 7, rx: 1 }], ['rect', { x: 10.5, y: 6, width: 3, height: 12, rx: 1 }], ['rect', { x: 16, y: 14, width: 3, height: 4, rx: 1 }]],
  target: [['circle', { cx: 12, cy: 12, r: 8 }], ['circle', { cx: 12, cy: 12, r: 4 }], ['circle', { cx: 12, cy: 12, r: 1, fill: 'currentColor', stroke: 'none' }]],
  mail: [['rect', { x: 3, y: 5, width: 18, height: 14, rx: 2 }], ['path', { d: 'M3 7l9 6 9-6' }]],
  'trending-up': [['path', { d: 'M3 17l6-6 4 4 8-8' }], ['path', { d: 'M15 7h6v6' }]],
  login: [['path', { d: 'M15 3h4a2 2 0 012 2v14a2 2 0 01-2 2h-4' }], ['path', { d: 'M10 17l5-5-5-5M15 12H3' }]],
  edit: [['path', { d: 'M12 20h9' }], ['path', { d: 'M16.5 3.5a2.1 2.1 0 013 3L7 19l-4 1 1-4z' }]],
  plus: [['path', { d: 'M12 5v14M5 12h14' }]],
}

export default defineComponent({
  name: 'Icon',
  props: {
    name: { type: String as PropType<string>, required: true },
    size: { type: [Number, String], default: 18 },
  },
  setup(props) {
    return () => {
      const nodes = ICONS[props.name] || ICONS.dot
      return h('svg', {
        width: props.size, height: props.size, viewBox: '0 0 24 24',
        fill: 'none', stroke: 'currentColor', 'stroke-width': 2,
        'stroke-linecap': 'round', 'stroke-linejoin': 'round',
        class: 'icon inline-block align-middle shrink-0',
        'aria-hidden': 'true',
      }, nodes.map(([tag, attrs]) => h(tag, attrs)))
    }
  },
})
</script>
