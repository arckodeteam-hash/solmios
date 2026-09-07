# whatsapp-meta-certificacion — Tasks

> Este change **no escribe funcionalidad**. La fase 5 (vídeo) es lo ÚLTIMO de todo el proyecto: exige
> que los otros cuatro changes estén terminados y probados.

## 1. Credenciales y entorno
- [ ] 1.1 Aceptar la invitación de Meta enviada al correo del equipo y confirmar acceso al panel de la
      app y al portfolio comercial. **Aceptación**: se puede abrir
      `developers.facebook.com/apps/1727869705161184/` y ver Configuración → Básica.
- [ ] 1.2 Obtener el **App Secret** (Configuración → Básica → Mostrar).
      **Aceptación**: cargado en el gestor de secretos, NO en el repositorio.
- [ ] 1.3 Obtener el **WABA ID** de la cuenta de prueba desde la consola de WhatsApp de la app.
      **Aceptación**: anotado junto al resto de los datos de Meta. **Es el dato que falta en el
      documento del equipo**: los cuatro que figuran no incluyen éste.
- [ ] 1.4 Registrar hasta 5 teléfonos de prueba en la consola (modo desarrollo solo entrega a esos).
      **Aceptación**: un mensaje de prueba desde la consola llega a un celular del equipo.
- [ ] 1.5 Agregar `META_APP_ID`, `META_APP_SECRET`, `META_GRAPH_VERSION` y `WHATSAPP_APP_SECRET` a
      `backend/.env.example` con la nota de dónde se sacan.
      **Aceptación**: un despliegue limpio sabe qué le falta con solo leer el archivo.
- [ ] 1.6 Cargar las variables en producción y reiniciar el servicio.
      **Aceptación**: el log de arranque ya no advierte la falta del secreto; el webhook deja de
      rechazar por firma.

## 2. Retirar la vía no oficial del alcance del revisor
- [ ] 2.1 Ocultar la pestaña de vinculación por QR cuando el hotel tiene `connectionMode='meta'`.
      **Aceptación**: escenario "hotel con conexión oficial" del spec.
- [ ] 2.2 Verificar que no queda ningún otro punto de entrada al QR desde el panel del hotel de prueba.
      **Aceptación**: recorrido completo del panel sin encontrarlo.
- [ ] 2.3 Documentar en `CLAUDE.md` que Baileys es legacy, por qué sigue existiendo y qué hoteles lo
      usan. **Aceptación**: queda escrito antes de que alguien lo "descubra" en un vídeo.
- [ ] 2.4 Dejar planteada (sin ejecutar) la baja definitiva y la migración de los hoteles que lo usan.
      **Aceptación**: una nota con el alcance y a quién habría que avisar.

## 3. Hotel y usuario de prueba
- [ ] 3.1 Crear un hotel de prueba en producción con nombre y datos inventados.
      **Aceptación**: ninguna reserva ni huésped real.
- [ ] 3.2 Cargar 3-4 habitaciones y 2 reservas con huéspedes ficticios, cuyos teléfonos sean los
      números registrados en 1.4. **Aceptación**: se le puede enviar un WhatsApp a esas reservas.
- [ ] 3.3 Crear el usuario del revisor con los permisos justos para recorrer el flujo.
      **Aceptación**: entra, ve el hotel de prueba, no alcanza datos de otros hoteles.
- [ ] 3.4 Guardar sus credenciales fuera del repositorio.
      **Aceptación**: `rg` de la contraseña en el repositorio no devuelve nada.

## 4. Formulario de Meta
- [ ] 4.1 Completar la lista de proveedores externos con lo ya relevado: **Contabo GmbH** (VPS,
      datacenter en Lauterbourg, Francia) · **PostgreSQL 16 en ese mismo servidor** · **SMTP por hotel
      con respaldo en Resend** · terceros con acceso a datos: Stripe, Channex, TTLock,
      **DeepSeek/OpenAI**, Firebase, Google (Maps, Geocoding, Business Profile), Cloudflare Turnstile,
      Open Exchange Rates, Meta Pixel. **Aceptación**: la tabla del documento queda sin espacios en
      blanco salvo el de 4.2.
- [ ] 4.2 Confirmar dónde se guardan los respaldos (única fila sin verificar; hay que mirar el panel del
      servidor). **Aceptación**: se nombra el servicio y dónde quedan físicamente.
- [ ] 4.3 Definir la URL que ve el revisor (`solmios.com` y `hotel.zx89.site` responden las dos).
      **Aceptación**: una sola URL, la misma que se usa en el vídeo.
- [ ] 4.4 Cargar en el formulario el usuario y contraseña de prueba de 3.3.
      **Aceptación**: alguien ajeno al equipo puede entrar con eso.

## 5. Vídeo y solicitud (LO ÚLTIMO)
- [ ] 5.1 Verificar que los siete momentos se pueden hacer de corrido en producción.
      **Aceptación**: pasada completa sin errores. Si alguno falla, se arregla antes de grabar.
- [ ] 5.2 Escribir el guion con los siete momentos y sus tiempos.
      **Aceptación**: la pasada entra en 2-4 minutos.
- [ ] 5.3 Ensayo grabado, descartable.
      **Aceptación**: se detectan los puntos donde se traba o donde aparece algo que no debería.
- [ ] 5.4 Grabación final, una sola toma, sin contraseñas ni datos reales en pantalla.
      **Aceptación**: se ve la ventana de Meta autorizando (paso 2) — sin eso, Meta rechaza.
- [ ] 5.5 Enviar la solicitud de revisión con el vídeo y el formulario completo.
      **Aceptación**: enviada, con la fecha anotada.
- [ ] 5.6 Registrar la respuesta de Meta y, si hay observaciones, abrir las tareas que correspondan.
      **Aceptación**: la respuesta queda documentada, se apruebe o no.

## Dependencias
- Fases 1 y 4: solo necesitan el acceso al panel de Meta. **Se pueden hacer hoy.**
- Fase 2: independiente del resto.
- Fase 3: necesita `whatsapp-meta-onboarding` terminado para que el hotel de prueba pueda conectarse.
- Fase 5: necesita los **cuatro** changes terminados y probados.
