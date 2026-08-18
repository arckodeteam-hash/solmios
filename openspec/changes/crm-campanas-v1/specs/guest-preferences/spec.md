# Guest Preferences Specification

## Purpose

El perfil del huésped no registra preferencias: el recepcionista vuelve a preguntar piso,
almohada, alergias en cada estadía. v1 = UN campo de texto libre y visible (ficha + check-in):
la data real dirá qué etiquetas merecen estructura en v2. Sin taxonomía rígida prematura.

Equivalente MisterPlan: "guest profile notes/preferences" — empareja con v1 texto.

## Requirements

### Requirement: Campo preferences en el huésped

`guests` MUST tener `preferences` (texto, editable desde la ficha, permiso `guests:edit`).
Visible en la ficha del panel y en el detalle de check-in del recepcionista.

#### Scenario: cargar preferencia

- GIVEN recepcionista editando la ficha de Carlos
- WHEN guarda "Piso alto, almohada firme, alérgico al maní"
- THEN al reabrir la ficha (y al hacer check-in de una reserva suya) el texto está presente

#### Scenario: sin preferencias

- GIVEN huésped sin preferences
- THEN la ficha muestra el campo vacío con placeholder sugerido (cero ruido)

## DB

- Columna `guests.preferences` (text, nullable) vía orm.define — ADD COLUMN automático.
- ⚠️ Validar el modelo GANADOR: `birthDate` aparece en `huespedes/model.ts:29` Y en
  `shared/models.ts:233` (dual) — declarar preferences en el que gana el registro (módulos
  después de shared) y anotar el hallazgo (regla anti modelo-dual de CLAUDE.md).

## UI

- Ficha del huésped: bloque "Preferencias" editable (textarea 2 líneas).
- Detalle de check-in: línea de solo lectura con las preferencias si existen.
