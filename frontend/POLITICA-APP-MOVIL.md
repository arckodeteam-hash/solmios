# Lo que falta en la política de privacidad para la app móvil

> Para agregar a `https://solmios.com/p/privacidad`
> Verificado contra el código de la app el 2026-08-30 · build `1.0.50+50`

## Por qué hace falta

La política publicada es sólida y cubre bien al **huésped** y al **PMS web**: WhatsApp,
reservas, pagos, datos técnicos del sitio. Pero no contempla a la **app móvil del
personal**, que recolecta cosas que el documento no menciona.

Google Play **cruza el formulario de Data Safety con la política de privacidad**. Si en
Data Safety declarás que recolectás fotos y videos, y la política no los menciona, el
desajuste es motivo de rechazo — y de suspensión después de publicada.

### Qué busqué en el texto actual

| Término | ¿Aparece? |
|---|---|
| fotos · videos · imágenes | No |
| aplicación móvil · Android | No |
| notificaciones | No |
| huella · biometría | No |
| housekeeping · empleados | No |
| cámara | Sí, pero es "**Cámara de Comercio**" (registro mercantil) |
| limpieza | Sí, pero en el eslogan de marketing del footer |

---

## Texto propuesto

Entra como sección nueva, sin tocar el resto del documento. Sugiero numerarla **3.5**,
después de "3.4 Datos técnicos", y agregar el párrafo de conservación al apartado que ya
existe sobre plazos.

---

### 3.5 Cuando el personal del hotel usa la aplicación móvil

SOLMI OS ofrece una aplicación móvil para Android destinada **exclusivamente al personal
de los establecimientos** que contratan la plataforma: camareras de piso, supervisores,
personal de mantenimiento y administración. No está dirigida a huéspedes ni al público
general, y el acceso requiere una cuenta creada por el establecimiento. No existe registro
abierto.

**Datos de la cuenta del empleado.** Nombre completo, correo electrónico, número de
teléfono, cargo o rol dentro del establecimiento, y el hotel al que pertenece. Estos datos
los provee el establecimiento empleador al dar de alta a la persona, y se usan para
autenticar el acceso y determinar qué información puede ver cada quien según su función.
Base legal: ejecución de la relación contractual con el establecimiento e interés legítimo
en la gestión de sus operaciones.

**Fotografía de perfil.** Opcional. La persona puede subir una foto para su avatar dentro
de la aplicación, y puede eliminarla en cualquier momento desde su perfil.

**Fotografías y videos del trabajo realizado.** La aplicación permite al personal de
limpieza registrar evidencia del estado de las habitaciones antes y después de cada
servicio. Estas imágenes documentan **espacios físicos del establecimiento**, no personas,
y quedan asociadas a la tarea, a quien la ejecutó y al momento en que se tomaron. Su
finalidad es el control de calidad interno: el supervisor las revisa para aprobar o
rechazar el trabajo. Base legal: interés legítimo del establecimiento en verificar la
prestación del servicio.

Las imágenes se capturan mediante la aplicación de cámara del sistema operativo, que
gestiona sus propios permisos. SOLMI OS no accede a la galería ni al carrete del
dispositivo, ni a ninguna imagen distinta de la que la persona decide adjuntar a una tarea.

**Notificaciones.** Si la persona autoriza las notificaciones, se registra un
identificador del dispositivo provisto por Firebase Cloud Messaging (Google) para poder
enviarle avisos de tareas asignadas y mensajes de su equipo. Ese identificador no revela
la identidad de la persona y deja de utilizarse al cerrar sesión. Base legal:
consentimiento, otorgado al aceptar el permiso de notificaciones del sistema.

**Desbloqueo por huella digital.** La aplicación permite desbloquear la sesión con la
huella o el reconocimiento facial ya configurados en el teléfono. **Esa verificación la
realiza íntegramente el sistema operativo del dispositivo: SOLMI OS no recibe, no procesa
y no almacena ningún dato biométrico.** La aplicación solo obtiene la confirmación de que
el sistema validó a la persona.

**Mensajería interna.** El personal puede intercambiar mensajes dentro de la aplicación
para coordinar el trabajo. El contenido se conserva mientras la cuenta esté activa en el
establecimiento.

### 3.6 Qué NO recoge la aplicación móvil

Con el mismo detalle que lo anterior, y porque conviene que quede escrito:

- **No recoge la ubicación** del dispositivo. La aplicación no solicita ni declara ningún
  permiso de geolocalización.
- **No utiliza herramientas de analítica ni de publicidad.** No hay rastreo de
  comportamiento, ni perfiles publicitarios, ni identificadores de marketing.
- **No accede** a los contactos, al calendario, a los archivos personales, al micrófono ni
  a las llamadas.
- **No comparte datos con terceros con fines comerciales.** La información viaja
  únicamente a los servidores de SOLMI OS.

Toda la comunicación entre la aplicación y nuestros servidores viaja cifrada mediante
HTTPS.

### Conservación y eliminación (agregar al apartado de plazos)

Los datos del personal se conservan mientras la persona mantenga una cuenta activa en el
establecimiento. Cuando el establecimiento da de baja a un empleado, su cuenta se
desactiva y deja de tener acceso.

Las fotografías y videos de las tareas de limpieza se conservan como registro de la
operación del establecimiento, que es el responsable de definir por cuánto tiempo los
necesita.

Cualquier persona puede solicitar el acceso, la rectificación o la eliminación de sus
datos escribiendo a **privacidad@solmios.com**, o a través de
**https://solmios.com/p/eliminacion-datos**.

---

## Cómo esto se corresponde con Data Safety

Cada fila del formulario de Play tiene que encontrar respaldo en la política. Con la
sección de arriba, queda así:

| Data Safety declara | Sección de la política que lo respalda |
|---|---|
| Nombre · Email · Teléfono | 3.5 — Datos de la cuenta del empleado |
| Fotos | 3.5 — Fotografía de perfil · Fotografías y videos del trabajo |
| Videos | 3.5 — Fotografías y videos del trabajo |
| Mensajes | 3.5 — Mensajería interna |
| **No** ubicación | 3.6 |
| **No** analytics ni publicidad | 3.6 |
| **No** datos biométricos | 3.5 — Desbloqueo por huella |
| **No** se comparte con terceros | 3.6 |
| Cifrado en tránsito | 3.6 — último párrafo |
| Se puede pedir la eliminación | Conservación y eliminación |

---

## Antes de publicar

**Verificá que el último punto sea cierto.** La política va a decir que alguien puede
pedir la eliminación de sus datos. En el formulario de Data Safety, Play pregunta lo mismo
por separado. Las dos respuestas tienen que coincidir **con lo que el backend permite
hoy** — no con lo que se planea implementar. Prometer de más acá es exactamente lo que
hace que Google baje una app meses después de publicada.

**Actualizá la fecha** de "Última actualización", que hoy dice 25 de agosto de 2026.

Este texto está redactado sobre hechos verificados en el código, pero es un documento
legal y quien lo firma es SOLMI OS, S.R.L. Conviene que lo revise quien lleva lo legal
antes de publicarlo.

---

## De dónde salió cada afirmación

Para que se pueda auditar sin volver a leer todo el código:

| Afirmación | Evidencia en el repositorio |
|---|---|
| Recoge nombre, email, teléfono, rol, hotel | `lib/features/auth/presentation/providers/auth_provider.dart` — lo que persiste tras el login |
| Foto de perfil opcional y borrable | `lib/features/profile/` — `uploadAvatar` y `removeAvatar` |
| Fotos y videos de limpieza | Flujo de housekeeping — evidencia que aprueba el supervisor |
| No accede a la galería | `image_picker` abre la cámara del sistema por intent |
| No declara permiso de cámara | `android/app/src/main/AndroidManifest.xml` — es deliberado, está comentado ahí |
| Token de notificaciones | `lib/core/notifications/fcm_service.dart` |
| Biometría solo local | `local_auth` — la valida Android, nada viaja al servidor |
| Sin ubicación | No hay permiso de ubicación en el manifest |
| Sin analytics ni ads | No hay ningún SDK de ese tipo en `pubspec.yaml` |
| Cifrado en tránsito | `API_BASE_URL=https://solmios.com` — todo el tráfico va por HTTPS |
