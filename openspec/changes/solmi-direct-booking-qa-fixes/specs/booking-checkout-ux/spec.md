# Booking Checkout UX Specification

## Purpose

Reducir fricción y errores en el tramo final del motor de reservas: datos solicitados
al huésped y legibilidad de la información crítica (fechas, habitación, huéspedes,
resumen, políticas) antes de pagar. Cubre las Tareas 5, 8 y 9 del documento de
hallazgos de QA (2026-08-20).

## Requirements

### Requirement: Datos mínimos solicitados al huésped

El formulario de datos del huésped durante la reserva MUST limitarse a: nombre,
apellido, correo electrónico, teléfono, hora estimada de llegada. El motor MUST NOT
solicitar datos adicionales del huésped en esta etapa si existe un proceso posterior
(pre-check-in / checklist) donde esos datos se completan.

#### Scenario: Formulario de checkout solo pide lo esencial

- GIVEN un huésped llega al paso de datos personales (`GuestCheckoutStep.vue`)
- WHEN completa el formulario
- THEN los únicos campos requeridos son nombre, apellido, email, teléfono y hora
  estimada de llegada — ningún campo de pre-check-in aparece ahí

### Requirement: Legibilidad de información crítica de la reserva

Fecha, habitación, huéspedes y resumen de reserva MUST tener contraste, peso de fuente
y jerarquía visual suficientes para leerse sin esfuerzo. Los datos principales del
resumen (fechas, total, tipo de habitación) MUST usar mayor peso de fuente o contraste
que la información secundaria.

#### Scenario: Resumen de reserva legible antes de pagar

- GIVEN un huésped llega al paso de pago
- WHEN revisa el resumen (fechas, habitación, huéspedes, total)
- THEN los datos principales son distinguibles a simple vista, sin requerir zoom o
  esfuerzo de lectura

### Requirement: Legibilidad de políticas y condiciones

Las políticas de cancelación y condiciones de reserva MUST tener un tamaño de fuente
legible cómodamente, manteniendo su jerarquía visual como información secundaria al
resumen de compra (no MUST convertirse en el elemento principal de la pantalla), pero
MUST ser claramente visibles antes de confirmar o pagar.

#### Scenario: Política de cancelación visible sin esfuerzo

- GIVEN el resumen antes del pago incluye la política de cancelación
- WHEN el huésped la lee
- THEN el texto es legible sin necesitar zoom, aunque visualmente no compita con el
  precio total como elemento dominante

## Database

Sin cambios — este spec es puramente de UI/formulario.

## API

Sin cambios de API — depende de que `booking-availability-pricing` y
`booking-content-policies` ya entreguen los datos correctos; este spec cubre cómo se
presentan y qué campos se piden.

## UI

- `GuestCheckoutStep.vue`: eliminar cualquier campo fuera de nombre, apellido, email,
  teléfono, hora estimada de llegada. Si existen campos adicionales hoy, moverlos al
  flujo de pre-check-in/checklist post-reserva (fuera de este widget).
- `PayStep.vue` / resumen de reserva: revisar peso de fuente, tamaño, contraste,
  jerarquía visual y espaciado de fecha/habitación/huéspedes/total. Aumentar tamaño de
  fuente de políticas y condiciones sin promoverlas a elemento dominante.
