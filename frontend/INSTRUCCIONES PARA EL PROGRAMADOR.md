# Instrucciones para montar las tres páginas legales

**Para:** el equipo de desarrollo de SOLMI OS
**De:** Leo
**Fecha:** 10 de agosto de 2026

---

## Por qué urge

Meta **no aprueba** el acceso a la API de WhatsApp, Instagram y Messenger sin
estas tres URLs públicas y funcionando. Son campos obligatorios del formulario
de la app. Sin ellas el trámite se detiene.

## Las tres páginas

| Documento | URL sugerida |
|---|---|
| `1 - POLITICA DE PRIVACIDAD.md` | `https://<dominio>/privacidad` |
| `2 - TERMINOS Y CONDICIONES.md` | `https://<dominio>/terminos` |
| `3 - ELIMINACION DE DATOS.md` | `https://<dominio>/eliminar-datos` |

## Requisitos técnicos que Meta exige

1. **Públicas y sin login.** Meta las revisa con un robot que no tiene sesión.
   Si piden usuario y contraseña, rechazan la solicitud.
2. **HTTPS obligatorio.** Certificado válido, sin advertencias del navegador.
3. **Contenido en HTML real**, no una imagen ni un PDF. Debe poder leerse como
   texto.
4. **URL estable.** Una vez enviada a Meta no se cambia. Nada de `?id=123`
   ni rutas temporales.
5. **Responsive.** Se revisan también desde celular.
6. **Enlazadas entre sí** y accesibles desde el pie de página del sitio.

## Además: el formulario de eliminación

La página de eliminación de datos menciona un formulario. **Hay que construirlo
de verdad**, no puede ser solo texto. Necesita:

- Campos: nombre completo, teléfono o usuario, establecimiento (opcional)
- Al enviar: genera un número de solicitud y lo muestra en pantalla
- Envía un correo automático de acuse de recibo al solicitante
- Notifica al administrador
- Guarda la solicitud con su fecha, para poder demostrar el cumplimiento del
  plazo de 15 días hábiles

También hay que programar que la frase **"ELIMINAR MIS DATOS"** recibida por
WhatsApp abra automáticamente una solicitud.

## Datos que faltan — Leo los tiene que confirmar

Los documentos tienen marcadores `[PENDIENTE: ...]`. **Búscalos y reemplázalos
todos antes de publicar.** Son:

- [ ] Dominio definitivo de SOLMI OS
- [ ] Correo de privacidad (se sugiere `privacidad@<dominio>`)
- [ ] Teléfono de contacto del negocio
- [ ] Los tres enlaces cruzados entre las páginas

## Diseño

Usar el logotipo de SOLMI OS que está en
`~/Desktop/SOLMI OS/manual de la marca y logo/` — el isotipo "SO" en celeste.
Fondo claro, texto legible, sin adornos. Son páginas legales: lo que importa es
que se lean bien y carguen rápido.

## Aviso legal

Estos textos son un **borrador de trabajo** preparado para cumplir los
requisitos de Meta y ajustado a la Ley 172-13 (protección de datos), la Ley
358-05 (consumidor) y la Ley 20-00 (propiedad industrial) de la República
Dominicana. **No sustituyen la revisión de un abogado.** Antes de que SOLMI OS
se venda a terceros conviene que un abogado dominicano los revise, sobre todo
las cláusulas de limitación de responsabilidad y los plazos de conservación
fiscal.
