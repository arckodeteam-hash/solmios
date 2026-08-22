// plans-order.ts — El orden de toda lista de planes del producto (#30).
//
// Decisión del dueño: los planes se listan del MÁS BARATO al MÁS CARO en todas las
// superficies (landing, /registro, /panel/suscripción, /admin). El precio es la clave
// natural de orden — NO se agrega ningún campo nuevo para esto, y `sortOrder` dejó de
// mandar en el orden público (quedó como dato editable del admin, sin efecto de orden).
//
// El orden lo impone el BACKEND en la query del repo (findMany con `orderBy`), para que
// ninguna UI lo tenga que recordar: las vistas pintan lo que llega. `slug` es el
// desempate porque es UNIQUE y todo minúscula — orden total y determinista en SQLite y
// Postgres (un desempate por `name` cambiaría entre motores por la collation).
import type { OrderByClause } from 'arckode-framework'

/** Del más barato al más caro; a igual precio, por slug ASC (determinista entre motores). */
export const PLANS_PRICE_ORDER: OrderByClause[] = [
  { field: 'price', dir: 'ASC' },
  { field: 'slug', dir: 'ASC' },
]
