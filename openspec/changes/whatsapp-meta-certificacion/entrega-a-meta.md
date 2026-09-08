# Lo que hay que entregarle a Meta

Todo lo que el sistema podía dejar listo, está listo. Esto es lo que queda, en orden, y quién lo hace.

---

## 1. Los cuatro datos que faltan (30 minutos, en el panel de Meta)

| Dato | Dónde | Para qué |
|---|---|---|
| **App Secret** | `developers.facebook.com/apps/1727869705161184/settings/basic/` → "Mostrar" | Sin esto el botón "Conectar WhatsApp" responde 503 y el webhook rechaza todo |
| **WABA ID** | consola de WhatsApp de la app | Ya lo tenemos de la cuenta de prueba: `2631160424009333` |
| **Número emisor** | misma consola | Ya lo tenemos: `+1 555-678-1103` (`1194399700434439`) |
| **Celulares de prueba** | misma consola, campo "Para" | En modo desarrollo Meta **solo** entrega a los números registrados |

El App Secret **no se pega en el repositorio ni en un chat**: va al `.env` del servidor.

## 2. Cargarlo en producción

```bash
# En el servidor, backend/.env
META_APP_ID=1727869705161184
META_APP_SECRET=<el que sacaste>
META_GRAPH_VERSION=v26.0
WHATSAPP_APP_SECRET=<el MISMO valor que META_APP_SECRET>

systemctl restart solmios-backend
```

Verificación inmediata, sin adivinar:

```bash
cd backend && bun run verificar-whatsapp
```

Ese comando dice exactamente qué falta y cómo se arregla. Si sale todo en verde, el sistema está
listo.

## 3. Hotel de prueba para el revisor

```bash
cd backend
DEMO_PASSWORD='<una contraseña que le vas a dar a Meta>' \
DEMO_PHONE='<tu celular ya registrado en la consola>' \
bun run seed-demo-meta
```

Crea un hotel aislado con datos inventados, tres habitaciones, dos reservas y el usuario
`revisor@solmios.com`. Es idempotente: correrlo de nuevo solo actualiza la contraseña.

Después, entrando con ese usuario: conectar el WhatsApp del hotel y crear las plantillas
recomendadas con el botón.

## 4. El formulario de Meta — respuestas listas

**Proveedores externos** (relevado del código y del servidor):

| Pregunta | Respuesta |
|---|---|
| Servidor / hosting | **Contabo GmbH** — servidor virtual, centro de datos en Lauterbourg, **Francia** (UE) |
| Base de datos | PostgreSQL 16, **en ese mismo servidor**. Ningún tercero |
| Envío de correo | SMTP configurable por hotel, con respaldo en **Resend** |
| Respaldos | ⬜ **Falta confirmar** — no se puede saber desde el código, hay que mirarlo en el panel del servidor |
| Otros con acceso a datos | **Stripe** (cobros) · **Channex** (reservas y datos del huésped) · **TTLock** (cerraduras) · **DeepSeek / OpenAI** · **Firebase** (avisos al celular) · **Google** (mapas, geocodificación, ficha de negocio) · **Cloudflare** · **Open Exchange Rates** · **Meta Pixel** |

⚠️ **DeepSeek y OpenAI hay que declararlos.** El contenido de los mensajes del huésped se manda a un
modelo de un tercero para redactar la respuesta. Meta lo pregunta de forma explícita; omitirlo y que
lo detecten después es peor que declararlo.

**Acceso para el revisor**:

| | |
|---|---|
| URL | Una sola, la misma del vídeo. `solmios.com` y `hotel.zx89.site` responden las dos: hay que elegir |
| Usuario | `revisor@solmios.com` |
| Contraseña | La de `DEMO_PASSWORD`. **No está en el repositorio** |

## 5. El vídeo — guion

Una sola toma, sin cortes, entre 2 y 4 minutos. Ensayarlo una vez antes de grabar: no sale a la
primera. Sin contraseñas ni datos reales en pantalla.

| # | Qué se ve | Dónde | Aprox. |
|---|---|---|---|
| 1 | Entrar al PMS como el hotel de prueba | pantalla de acceso | 0:15 |
| 2 | **Configuración → Integraciones → Conectar WhatsApp**, la advertencia, y la **ventana de Meta apareciendo y autorizando** | panel del hotel | 0:60 |
| 3 | La tarjeta ya con el número, el negocio y la calidad | misma pantalla | 0:15 |
| 4 | Abrir una reserva → "Enviar por WhatsApp" → elegir plantilla → enviar | ficha de la reserva | 0:30 |
| 5 | **El celular recibiendo el mensaje** | filmar el teléfono | 0:20 |
| 6 | El huésped responde y esa respuesta **entra al PMS** | Operaciones → WhatsApp de huéspedes | 0:40 |
| 7 | La pantalla de plantillas con una creada y su estado | Configuración → Mensajería | 0:20 |

**El paso 2 es obligatorio.** Si la ventana de Meta no aparece en cámara, rechazan sin mirar el
resto.

Antes de grabar, comprobar que los siete pasos salen de corrido. Si alguno falla, se arregla y
recién después se graba.

## 6. Enviar la solicitud

Con el vídeo y el formulario completo. Anotar la fecha. Si vuelve con observaciones, se abren las
tareas que correspondan.

---

## Lo que NO hay que hacer

- **No crear otra app en Meta.** La que sirve es `1727869705161184`; una nueva obliga a rehacer la
  verificación del negocio y la revisión.
- **No mandar la solicitud "para probar".** Meta guarda el historial de rechazos y encarece la
  siguiente.
- **No dejar visible la vinculación por código QR.** El sistema ya la oculta cuando el hotel tiene
  la conexión oficial, pero conviene comprobarlo con el usuario del revisor antes de grabar.
