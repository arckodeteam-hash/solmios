# UX — Centro de configuración inicial

> **Revisión 2026-09-07** — el usuario pidió explícitamente reusar el sistema
> actual (`OnboardingGuide.vue`: lista de pasos expandible, check verde al
> completar, texto de "cómo se hace" al abrir cada uno) en vez del wizard lineal
> "Paso 1 de 7 → Siguiente → Atrás" que proponía la primera versión de este
> documento. Este documento reemplaza esa versión anterior por completo.

## Qué es y qué no es

**No es** un formulario lineal forzado (no hay "Paso X de 7", no hay que
completar el paso 3 para ver el 4). **Es** una lista de pasos, cada uno
independiente, que se puede abrir en cualquier orden — el mismo modelo mental
que ya tiene la guía actual del dashboard, llevado a su propia pantalla y
con mejor contenido.

Cada paso es uno de dos tipos:

- **Paso de perfil** (Bienvenida, Identidad, Contacto, Ubicación, Políticas,
  Amenities): al expandirse, muestra un mini-formulario inline — se completa
  ahí mismo, sin salir de la pantalla. Guarda al tocar "Guardar" de ese bloque
  (no hay un solo botón global que dependa de otros pasos — fix directo del bug
  3.1 de la auditoría).
- **Paso operativo** (Habitaciones, Tarifas, Canales de venta, Equipo): al
  expandirse, muestra la explicación (qué es, por qué importa) y **un botón que
  manda a la pantalla real** — no se completa inline, porque son flujos de
  carga de datos con su propia pantalla dedicada ya construida. Esto es
  exactamente el comportamiento de hoy para estos 4 pasos (`OnboardingGuide.vue`
  ya hace esto), no cambia.

## Dónde vive

**Pantalla propia** (no modal), ruta nueva sugerida `/panel/configuracion-inicial`
(nombre final a definir — ver doc 08, D6). Se llega ahí con el botón "Completar"
de la franja del dashboard (doc 04), y opcionalmente desde un link en el menú
("Asistente de configuración" o similar) para reabrirla cuando se quiera, aunque
ya esté todo completo, por si el usuario quiere repasar o editar algo opcional.

**Por qué pantalla y no modal**: el usuario pidió "manda a la pantalla de una
configuración" — lectura literal de "pantalla" más que "modal". Una pantalla
propia además da más aire para que cada paso de perfil muestre su formulario
completo (el mapa de Ubicación, el editor de política de cancelación) sin la
sensación apretada de un modal chico. Si en el futuro se prefiere un modal
liviano en su lugar, el mismo diseño de acordeón funciona igual dentro de un
modal — es un cambio de contenedor, no de lógica.

## Diseño visual

```
┌─────────────────────────────────────────────────────────────────┐
│  Configuración inicial de tu hotel                    60%  ▓▓▓░ │
│  Completá esto para que tu hotel se vea listo en la página       │
│  pública y funcione sin baches.                                  │
├─────────────────────────────────────────────────────────────────┤
│  ✓  Bienvenida                                    hecho          │  ← colapsado, tachado, check verde
├─────────────────────────────────────────────────────────────────┤
│  ○  Identidad de tu hotel                    3 campos pendientes │  ← expandible
│     Tipo de alojamiento, estrellas y logo — es lo primero        │
│     que ve un huésped en tu página.                              │
├─────────────────────────────────────────────────────────────────┤
│  ●  Ubicación                                          [abierto] │  ← expandido
│     ┌───────────────────────────────────────────────────────┐   │
│     │  Dirección  [_______________________]                 │   │
│     │  [ mapa interactivo ]                                  │   │
│     │  Provincia [____]  Municipio [____]  CP [____]         │   │
│     │                                    [ Guardar ubicación]│   │
│     └───────────────────────────────────────────────────────┘   │
├─────────────────────────────────────────────────────────────────┤
│  ○  Políticas de reserva              opcional · recomendado     │
├─────────────────────────────────────────────────────────────────┤
│  ○  Amenities y niños                            opcional        │
├─────────────────────────────────────────────────────────────────┤
│  ⬡  Habitaciones                          Cargá tu inventario    │  ← paso operativo, ícono distinto
│     El calendario está vacío sin esto.            [Ir a Habitaciones →] │
├─────────────────────────────────────────────────────────────────┤
│  ⬡  Tarifas / Canales de venta / Equipo …                        │
└─────────────────────────────────────────────────────────────────┘
```

- **Un solo paso expandido por vez** (igual que hoy: `open.value` es un único
  valor, no un Set) — evita que la pantalla se vuelva una pared de formularios
  abiertos a la vez.
- **Ícono distinto para pasos operativos** (ej. un rombo/hexágono en vez de
  círculo numerado) — refuerza visualmente que "esto te manda a otro lado" antes
  de siquiera abrirlo.
- **Badge de opcional/recomendado/requerido** en la cabecera de cada paso
  colapsado — se ve sin necesidad de expandir, a diferencia de hoy donde solo se
  nota al abrir (`OnboardingGuide.vue:49`, el badge "opcional" hoy solo aparece
  si `!s.done`, dentro de la fila — se mantiene esa idea, se la hace más visible).

### Animaciones (elegantes, no exageradas)

- Expandir/colapsar un paso: transición de alto + fade (~200ms), igual espíritu
  que el `rotate-180` del chevron que ya existe hoy.
- Al guardar un paso de perfil con éxito: el check se anima de vacío a tildado
  (~250ms), el paso se colapsa solo después de un breve delay (para que el
  usuario vea que quedó guardado antes de que se cierre).
- Al llegar al 100%: la cabecera de la pantalla cambia a un estado de cierre
  ("Tu hotel está listo") con una transición notoria una sola vez — acá sí vale
  algo más llamativo (fade + scale del bloque de cabecera, opcionalmente un
  ícono de check grande) porque es un evento que pasa una sola vez en la vida
  del hotel.
- Todo respeta `prefers-reduced-motion`.

## Los pasos de perfil — contenido de cada uno

Igual clasificación de campos que la versión anterior de este documento (doc 02
es la fuente de verdad, no repetida acá en detalle):

1. **Bienvenida** (requerido): nombre del hotel, país, **teléfono principal**
   (ahora requerido explícito, doc 08 D1), email, nombre del dueño — todo
   pre-cargado desde el registro, edición rápida inline.
2. **Identidad** (requerido con logo opcional): tipo de alojamiento, estrellas,
   logo, moneda, zona horaria (sugerida por país), check-in/out (colapsado bajo
   "usar horarios estándar").
3. **Contacto** (100% opcional): teléfono 2, sitio web, CIF/NIF/RNC.
4. **Ubicación** (requerido): dirección, mapa (con el fix de centrado por país,
   doc 06), coordenadas, provincia/municipio/localidad/CP.
5. **Políticas de reserva** (recomendado, con aviso explícito de impuestos no
   silencioso — ver doc 02.E sobre el riesgo del default `ITBIS 18%`).
6. **Amenities y niños** (opcional con buenos defaults).

Cada uno guarda con su propio botón, aislado de los demás — un error de
validación en Identidad nunca bloquea guardar Ubicación (fix del bug 3.1 desde
el diseño, no como parche después).

## Los pasos operativos — sin cambios de comportamiento

Habitaciones, Tarifas, Canales de venta, Equipo: mismo criterio de "hecho" que
ya calcula `OnboardingUseCase` hoy (cantidad de habitaciones > 0, tarifas
cargadas, canal conectado, más de un usuario). Al expandirse muestran la
explicación existente (`how`, `impact`) y un botón que navega a la pantalla
real — se reusa el copy que ya existe en `onboarding.ts`, no hace falta
reescribirlo.

## Salir y volver

Al no ser un flujo lineal forzado, no hay "salir a mitad de camino" en el
sentido de perder progreso — cada paso que se guardó, quedó guardado. El
usuario puede cerrar la pantalla en cualquier momento (volver al dashboard) y
reabrirla después con el mismo estado.
