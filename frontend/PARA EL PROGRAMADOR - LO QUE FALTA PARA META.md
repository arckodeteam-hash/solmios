# Lo que falta para que Meta apruebe a SOLMI OS

**Para:** el equipo de desarrollo de solmios.com
**De:** Leo · **Fecha:** 25 de agosto de 2026

El trámite con Meta ya está enviado: la verificación del negocio de
**SOLMI OS, S.R.L.** quedó como *"Solicitud pendiente"* con el Registro
Mercantil y el RNC subidos. **Todo lo que falta está de este lado, en el sitio.**

Los tres documentos legales definitivos, ya con los datos de la empresa y
revisados por abogado, están en esta misma carpeta:

- `LEGAL 1 - POLITICA DE PRIVACIDAD - SOLMI OS SRL.docx`
- `LEGAL 2 - TERMINOS Y CONDICIONES - SOLMI OS SRL.docx`
- `LEGAL 3 - ELIMINACION DE DATOS - SOLMI OS SRL.docx`

*(También están en `.md` en esta carpeta, para copiar el texto directo.)*

---

## 🔴 1. Verificar el dominio — es lo que traba la aprobación

`solmios.com` ya está dado de alta en el portfolio comercial de SOLMI OS
(identificador `1737426427492058`), en estado **No verificado**.

**Camino recomendado — un registro DNS en Cloudflare** (el DNS lo llevan
`harlan.ns.cloudflare.com` / `harmony.ns.cloudflare.com`):

| Campo | Valor |
|---|---|
| Tipo | **TXT** |
| Nombre / Host | **@** (la raíz, `solmios.com`) |
| Contenido | `facebook-domain-verification=jsbyldr610laxecqusawj9gauexmaz` |
| TTL | Automático |

**Alternativa — metaetiqueta**, si no hay acceso al DNS:

`<meta name="facebook-domain-verification" content="jsbyldr610laxecqusawj9gauexmaz" />`

⚠️ Tiene que quedar en el `<head>` del **HTML estático** que sirve el servidor
(el `index.html` del build). Si la inyecta React/Vite en tiempo de ejecución,
Meta no la ve y la verificación falla.

**Avisar cuando esté puesto:** hay que volver a Meta y pulsar "Verificar dominio".

## 🔴 2. Reemplazar el texto de las tres páginas legales

Las páginas existen y el diseño está bien. Lo que hay dentro es texto de
plantilla y **no sirve para Meta**. Hay que sustituirlo por el de los tres
documentos de esta carpeta, **respetando las URLs actuales**:

| Documento | URL (no cambiarla) |
|---|---|
| Política de privacidad | `https://www.solmios.com/p/privacidad` |
| Términos y condiciones | `https://www.solmios.com/p/terminos` |
| Eliminación de datos | `https://www.solmios.com/p/eliminacion-datos` |

Por qué no sirve lo que hay hoy:

- La de **eliminación de datos** muestra **cuatro `[pendiente]`** al público, y
  pone como responsable a *"Leonardo Batista Soliman, Calle Activo 2030"*, que
  ya no es la empresa. Debe decir **SOLMI OS, S.R.L., RNC 133-78277-4, Calle
  Carmelitas No. 9** — igual que lo que se le declaró a Meta.
- La de **privacidad** no menciona WhatsApp, Instagram ni Facebook por ningún
  lado. Meta exige que diga qué datos llegan por sus plataformas, para qué se
  usan y cuánto se guardan. El documento nuevo ya lo trae.
- Los **términos** no dicen ley aplicable, no identifican a la empresa y no
  hablan del asistente de IA. El documento nuevo ya lo trae.
- Las tres están en voseo argentino (*"cargás", "podés", "probalo"*). Los
  documentos nuevos están en español dominicano neutro.

Requisitos que Meta comprueba: **públicas sin login · HTTPS · HTML de verdad
(no PDF ni imagen) · URL estable · responsive · enlazadas entre sí y desde el
pie de página**.

## 🔴 3. El formulario de eliminación de datos — hay que construirlo

Hoy la página dice que hay un formulario y no existe. Meta rechaza una URL de
borrado de datos que no permita pedirlo de verdad. Va **dentro de la misma
página** `https://www.solmios.com/p/eliminacion-datos`:

- Campos: nombre completo · teléfono o usuario · establecimiento (opcional)
- Al enviar: muestra en pantalla un **número de solicitud**
- Manda un correo automático de acuse al solicitante
- Avisa al administrador
- Guarda la solicitud con su fecha, para poder demostrar el plazo de 15 días

## 🔴 4. Correo del dominio — hoy no llega nada

`solmios.com` **no tiene registro MX**. Y el sitio ya publica
`mailto:ventas@solmios.com` en dos botones: **esos correos se están perdiendo**.

Hay que crear, mínimo: **privacidad@**, **soporte@** y **ventas@**. Con
Cloudflare Email Routing es gratis y se reenvía al Gmail de Leo. Los tres
documentos legales apuntan a `privacidad@solmios.com` y `soporte@solmios.com`.

## 🟡 5. Quitar lo que el sitio dice de más

La portada afirma *"Más de 500 hoteles y alojamientos confían en SolmiOS"* con
logos de hoteles que no existen. Es relleno de armado, pero **Meta revisa el
sitio** durante la verificación y la revisión de la app.

## 🟡 6. Enlaces cruzados

Que las tres páginas legales se enlacen entre sí, y que privacidad y eliminación
de datos queden accesibles desde el pie de página de todo el sitio.

---

## Lo que NO es del equipo web

- La palabra **ELIMINAR MIS DATOS** por WhatsApp tiene que abrir una solicitud
  automática: eso es del equipo del bridge de SOL, no de la web.
- El **webhook HTTPS** para recibir los mensajes de WhatsApp: también del bridge.

## Datos de la empresa — los definitivos, para todo el sitio

| Dato | Valor |
|---|---|
| Razón social | SOLMI OS, S.R.L. |
| RNC | 133-78277-4 |
| Registro Mercantil | 207146PSD |
| Nombre comercial | SOLMI OS (ONAPI 941808) |
| Domicilio | Calle Carmelitas No. 9, Ensanche Ozama, Santo Domingo Este, Prov. Santo Domingo, R.D. |
| Teléfono | +1 809-448-1444 |
| Correos | privacidad@solmios.com · soporte@solmios.com · ventas@solmios.com |
| Sitio | https://www.solmios.com |
