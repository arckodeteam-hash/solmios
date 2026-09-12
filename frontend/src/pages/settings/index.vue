<template>
  <div>
    <!-- Loading skeleton -->
    <div v-if="loading" class="space-y-6">
      <div class="flex items-center justify-between mb-6">
        <div>
          <div class="h-6 w-48 bg-surface rounded-lg animate-pulse"></div>
          <div class="h-4 w-72 bg-surface rounded mt-2 animate-pulse"></div>
        </div>
        <div class="h-10 w-32 bg-surface rounded-xl animate-pulse"></div>
      </div>
      <div class="flex gap-2 mb-6">
        <div v-for="i in 5" :key="i" class="h-9 w-28 bg-surface rounded-full animate-pulse"></div>
      </div>
      <div class="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div class="lg:col-span-2 space-y-6">
          <div v-for="c in 2" :key="c" class="rounded-2xl border border-border bg-white shadow-(--shadow-card) overflow-hidden">
            <div class="h-14 bg-navy animate-pulse"></div>
            <div class="grid grid-cols-2 gap-4 p-5">
              <div v-for="i in 6" :key="i">
                <div class="h-3 w-20 bg-surface rounded mb-2 animate-pulse"></div>
                <div class="h-10 w-full bg-surface rounded-xl animate-pulse"></div>
              </div>
            </div>
          </div>
        </div>
        <div class="space-y-6">
          <div class="rounded-2xl border border-border bg-white shadow-(--shadow-card) overflow-hidden">
            <div class="h-14 bg-navy animate-pulse"></div>
            <div class="p-5"><div class="h-24 w-full bg-surface rounded-xl animate-pulse"></div></div>
          </div>
        </div>
      </div>
    </div>

    <!-- Page content -->
    <div v-else>
    <div class="flex items-center justify-between mb-6">
      <div>
        <h2 class="text-xl font-black text-navy">Configuración</h2>
        <p class="text-sm text-text-muted mt-0.5">Datos del hotel, amenities, tarifas e integraciones</p>
      </div>
      <!-- El builder de la landing, reputación externa y tracking se mudaron a su propia
           sección del menú (Página pública). Las pestañas que quedan acá persisten con
           saveAll (form del hotel) o tienen su propio "Guardar" en la propia card. -->
      <span v-if="hasErrors" class="mr-3 text-[11px] font-bold text-danger">
        {{ Object.keys(fieldErrors).length }} campo(s) con errores
      </span>
      <span v-else-if="isDirty" class="mr-3 text-[11px] font-bold text-text-muted">Cambios sin guardar</span>
      <button @click="saveAll" :disabled="saving || hasErrors"
        :title="hasErrors ? 'Corregí los campos marcados en rojo para poder guardar' : ''"
        class="bg-cyan text-navy font-extrabold text-sm px-5 py-2.5 rounded-full hover:shadow-lg transition-all cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed">
        {{ saving ? 'Guardando...' : 'Guardar' }}
      </button>
    </div>

    <!-- Tabs agrupados: administrativo vs. configuraciones e integraciones -->
    <div class="mb-6 flex flex-col gap-4 lg:flex-row lg:items-start lg:gap-8">
      <div v-for="group in tabGroups" :key="group.label" class="min-w-0 lg:shrink">
        <p class="mb-2 text-[11px] font-extrabold uppercase tracking-wide text-text-muted">{{ group.label }}</p>
        <div class="flex gap-2 overflow-x-auto pb-1">
          <button v-for="tab in group.tabs" :key="tab.value" @click="activeTab = tab.value"
            class="px-4 py-2 rounded-full text-sm font-bold transition-all cursor-pointer whitespace-nowrap"
            :class="activeTab === tab.value ? 'bg-navy text-white' : 'bg-white text-text-secondary border border-border hover:border-navy/30'">
            {{ tab.label }}
          </button>
        </div>
      </div>
    </div>

    <!-- ========== HOTEL ========== -->
    <div v-if="activeTab === 'hotel'" class="grid grid-cols-1 lg:grid-cols-3 gap-6">
      <div class="lg:col-span-2 space-y-6">
        <SectionCard title="Datos del hotel" subtitle="Identidad que aparece en facturas, emails y OTAs. Tipo de alojamiento, estrellas, logo, teléfono principal y email se editan en Página pública → General.">
          <div class="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label class="mb-2 block text-[11px] font-bold uppercase tracking-wide text-text-muted">Nombre *</label>
              <input v-model="form.name" type="text" class="w-full rounded-xl border px-4 py-2.5 text-sm focus:border-navy focus:outline-none" :class="fieldClass('name')" data-field="name" @blur="touchField('name')">
              <p v-if="errorOf('name')" class="mt-1 text-[10px] font-bold text-danger">{{ errorOf('name') }}</p>
            </div>
            <div>
              <!-- País: identidad administrativa/fiscal del hotel (moneda, impuestos por defecto,
                   facturación) — se queda en Configuración aunque el resto de Ubicación (dirección,
                   mapa, provincia/municipio/CP) se mudó a Página pública. Página pública muestra
                   este valor de solo lectura con un link "Cambiar" que apunta acá. -->
              <label class="mb-2 block text-[11px] font-bold uppercase tracking-wide text-text-muted">País *</label>
              <SearchSelect v-model="form.country" :options="COUNTRIES" placeholder="Buscar país..." />
            </div>
          </div>
        </SectionCard>

        <!-- Teléfono principal y email se mudaron a Página pública → General (issue #79): son
             contacto PÚBLICO (doc 02 sección B) y se editan/guardan desde allá. Acá queda sólo
             phone2, que es contacto interno/operativo y no se publica. -->
        <SectionCard title="Contacto interno" subtitle="No se publica: teléfono secundario para uso operativo. El teléfono principal y el email públicos se editan en Página pública → General.">
          <div class="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label class="mb-2 block text-[11px] font-bold uppercase tracking-wide text-text-muted">Teléfono 2</label>
              <PhoneInput v-model="form.phone2" :country="form.country" />
            </div>
          </div>
        </SectionCard>
      <!-- WiFi del establecimiento: dato OPERATIVO (pre-checkin, emails, WhatsApp), no parte de
           ninguna "descripción" pública — la página pública sólo lista el badge amenity. Vivía en
           un tab "Descripción" que había quedado con este único contenido tras sacar la
           descripción multilingüe; acá va con los demás datos del hotel (feedback panel/config). -->
      <SectionCard title="WiFi" subtitle="Se comparte con el huésped en el pre-checkin">
        <div class="grid grid-cols-2 gap-3">
          <div>
            <label class="text-[10px] font-bold text-text-muted uppercase mb-1 block">Red</label>
            <input v-model="form.wifiNetwork" class="w-full px-3 py-2 rounded-lg border text-sm" :class="fieldClass('wifiNetwork')" data-field="wifiNetwork" @blur="touchField('wifiNetwork')">
              <p v-if="errorOf('wifiNetwork')" class="mt-1 text-[10px] font-bold text-danger">{{ errorOf('wifiNetwork') }}</p>
          </div>
          <div>
            <label class="text-[10px] font-bold text-text-muted uppercase mb-1 block">Contraseña</label>
            <input v-model="form.wifiPassword" type="password" autocomplete="new-password" name="hotel-wifi-password" class="w-full px-3 py-2 rounded-lg border text-sm" :class="fieldClass('wifiPassword')" data-field="wifiPassword" @blur="touchField('wifiPassword')">
              <p v-if="errorOf('wifiPassword')" class="mt-1 text-[10px] font-bold text-danger">{{ errorOf('wifiPassword') }}</p>
          </div>
        </div>
      </SectionCard>

        <SectionCard title="Propietario" subtitle="Titular fiscal que figura en las facturas emitidas">
          <div class="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label class="mb-2 block text-[11px] font-bold uppercase tracking-wide text-text-muted">Nombre del propietario</label>
              <input v-model="form.ownerName" type="text" class="w-full rounded-xl border px-4 py-2.5 text-sm focus:border-navy focus:outline-none" :class="fieldClass('ownerName')" data-field="ownerName" @blur="touchField('ownerName')">
              <p v-if="errorOf('ownerName')" class="mt-1 text-[10px] font-bold text-danger">{{ errorOf('ownerName') }}</p>
            </div>
            <div>
              <label class="mb-2 block text-[11px] font-bold uppercase tracking-wide text-text-muted">CIF/NIF/RNC</label>
              <input v-model="form.ownerTaxId" type="text" class="w-full rounded-xl border px-4 py-2.5 text-sm focus:border-navy focus:outline-none" :class="fieldClass('ownerTaxId')" data-field="ownerTaxId" @blur="touchField('ownerTaxId')">
              <p v-if="errorOf('ownerTaxId')" class="mt-1 text-[10px] font-bold text-danger">{{ errorOf('ownerTaxId') }}</p>
            </div>
          </div>
        </SectionCard>

        <!-- `users.name` del usuario logueado — DISTINTO del "Nombre del propietario" fiscal de
             arriba (`hotels.ownerName`). Guardado propio (AuthService.updateMe), no entra en
             saveAll() porque no es un campo de `hotels`. -->
        <SectionCard title="Tu perfil" subtitle="El nombre con el que iniciaste sesión — no es el titular fiscal de arriba">
          <template #actions>
            <button @click="saveOwnerUserName" :disabled="ownerUserNameSaving"
              class="rounded-full bg-cyan px-4 py-2 text-xs font-bold text-navy transition-all hover:shadow-lg cursor-pointer disabled:opacity-50">
              {{ ownerUserNameSaving ? 'Guardando…' : 'Guardar' }}
            </button>
          </template>
          <div class="max-w-sm">
            <label class="mb-2 block text-[11px] font-bold uppercase tracking-wide text-text-muted">Tu nombre (dueño o gerente)</label>
            <input v-model="ownerUserName" type="text" class="w-full rounded-xl border border-border px-4 py-2.5 text-sm focus:border-navy focus:outline-none">
          </div>
        </SectionCard>

        <SectionCard title="Estadía y moneda" subtitle="Horarios de entrada/salida, zona horaria y moneda base de la operación">
          <div class="grid grid-cols-2 lg:grid-cols-4 gap-4">
            <div>
              <label class="mb-2 block text-[11px] font-bold uppercase tracking-wide text-text-muted">Check-in</label>
              <input v-model="form.checkIn" type="time" class="w-full rounded-xl border px-4 py-2.5 text-sm focus:border-navy focus:outline-none" :class="fieldClass('checkIn')" data-field="checkIn" @blur="touchField('checkIn')">
              <p v-if="errorOf('checkIn')" class="mt-1 text-[10px] font-bold text-danger">{{ errorOf('checkIn') }}</p>
            </div>
            <div>
              <label class="mb-2 block text-[11px] font-bold uppercase tracking-wide text-text-muted">Check-out</label>
              <input v-model="form.checkOut" type="time" class="w-full rounded-xl border px-4 py-2.5 text-sm focus:border-navy focus:outline-none" :class="fieldClass('checkOut')" data-field="checkOut" @blur="touchField('checkOut')">
              <p v-if="errorOf('checkOut')" class="mt-1 text-[10px] font-bold text-danger">{{ errorOf('checkOut') }}</p>
            </div>
            <div>
              <label class="mb-2 block text-[11px] font-bold uppercase tracking-wide text-text-muted">Zona horaria</label>
              <SearchSelect v-model="form.timezone" :options="TIMEZONES" placeholder="Buscar zona horaria..." />
            </div>
            <div>
              <label class="mb-2 block text-[11px] font-bold uppercase tracking-wide text-text-muted">Moneda</label>
              <SearchSelect v-model="form.currency" :options="CURRENCIES" placeholder="Buscar moneda..." />
            </div>
          </div>
        </SectionCard>

        <!-- Conversión de moneda (F3 match-misterplan) -->
        <SectionCard title="Conversión de moneda"
          subtitle="Moneda secundaria para mostrar totales convertidos (ej. en el detalle de reserva)">
          <template #actions>
            <button @click="saveCurrency" :disabled="currencySaving"
              class="rounded-full bg-cyan px-4 py-2 text-xs font-bold text-navy transition-all hover:shadow-lg cursor-pointer disabled:opacity-50">
              {{ currencySaving ? 'Guardando…' : 'Guardar conversión' }}
            </button>
          </template>
          <div class="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label class="mb-2 block text-[11px] font-bold uppercase tracking-wide text-text-muted">Moneda secundaria</label>
              <select v-model="currencyConfig.secondaryCurrency" class="w-full rounded-xl border border-border px-4 py-2.5 text-sm focus:border-navy focus:outline-none cursor-pointer">
                <option value="DOP">DOP (Pesos dominicanos)</option><option value="USD">USD</option><option value="EUR">EUR</option>
                <option value="COP">COP</option><option value="MXN">MXN</option><option value="ARS">ARS</option><option value="CLP">CLP</option>
              </select>
            </div>
            <div>
              <label class="mb-2 block text-[11px] font-bold uppercase tracking-wide text-text-muted">Tipo de cambio manual (opcional)</label>
              <input v-model.number="currencyConfig.exchangeRate" type="number" min="0" step="0.01" placeholder="Automático"
                class="w-full rounded-xl border border-border px-4 py-2.5 text-sm font-bold text-navy text-right tabular-nums focus:border-navy focus:outline-none" />
              <p class="mt-1 text-[10px] text-text-muted">Si lo dejás vacío se usa la tasa automática.</p>
            </div>
          </div>
          <!-- Tasa automática: la MISMA que usa el backend (GET /api/tasa-cambio). Antes acá había
               un 60 escrito a mano que nadie actualizaba. -->
          <div class="mt-4 rounded-xl border border-border bg-surface px-4 py-3">
            <p class="text-[11px] font-bold uppercase tracking-wide text-text-muted">Tasa automática</p>
            <p v-if="autoRate.exchangeRate" class="mt-1 text-base font-bold text-navy tabular-nums">
              1 {{ form.currency }} = {{ autoRate.exchangeRate }} {{ autoRate.secondaryCurrency }}
            </p>
            <p v-else class="mt-1 text-sm font-bold text-text-muted">Sin tasa disponible todavía</p>
            <p v-if="autoRate.exchangeRate" class="mt-1 text-[10px] text-text-muted">
              Actualizada el {{ autoRateFetchedAt }}<span v-if="autoRate.source"> · origen: {{ autoRate.source }}</span>
            </p>
            <p v-if="autoRate.stale" class="mt-1 text-[10px] font-bold text-warning">
              La tasa está desactualizada: se sigue mostrando la última obtenida.
            </p>
            <!-- Atribucion EXIGIDA por los terminos del plan Open Access del proveedor: el texto
                 del enlace tiene que ser literalmente "Rates By Exchange Rate API" apuntando a su
                 sitio. No es decorativo: sin esto el uso queda fuera de licencia. -->
            <p class="mt-2 text-[10px] text-text-muted">
              <a href="https://www.exchangerate-api.com" target="_blank" rel="noopener" class="underline">Rates By Exchange Rate API</a>
            </p>
          </div>
        </SectionCard>

        <!-- PIN de tarjeta de garantía (MisterPlan) -->
        <SectionCard title="PIN de tarjeta de garantía"
          subtitle="Protege los datos de las tarjetas de garantía en el detalle de reserva">
          <template #actions>
            <span v-if="hasGuaranteePin" class="rounded-full bg-teal/20 px-3 py-1 text-[10px] font-extrabold uppercase text-teal">Configurado</span>
            <span v-else class="rounded-full bg-white/10 px-3 py-1 text-[10px] font-extrabold uppercase text-white/80">Sin configurar</span>
          </template>
          <div class="flex flex-wrap items-end gap-3">
            <div>
              <label class="mb-2 block text-[11px] font-bold uppercase tracking-wide text-text-muted">Nuevo PIN (4-8 dígitos)</label>
              <!-- autocomplete="new-password": sin esto Chrome trata el campo como login y lo
                   rellena con una credencial guardada — el PIN aparecía escrito sin haberlo
                   tipeado (GH-32). `guaranteePinDraft` arranca vacío, no viene de la app. -->
              <input v-model="guaranteePinDraft" type="password" inputmode="numeric" maxlength="8" placeholder="Ingresar PIN"
                autocomplete="new-password" name="guarantee-pin" data-testid="guarantee-pin"
                class="w-40 rounded-xl border border-border px-4 py-2.5 font-mono text-sm tracking-widest focus:border-navy focus:outline-none" />
            </div>
            <button @click="saveGuaranteePin" :disabled="guaranteePinSaving || !guaranteePinDraft"
              class="rounded-full bg-navy px-5 py-2.5 text-sm font-bold text-white transition-all hover:shadow-lg cursor-pointer disabled:opacity-50">
              {{ guaranteePinSaving ? 'Guardando…' : 'Guardar PIN' }}
            </button>
          </div>
        </SectionCard>

        <!-- Automatización del flujo de reserva (auto/manual) -->
        <SectionCard title="Automatización"
          subtitle="Acciones automáticas al confirmar o hacer check-in — podés apagarlas y operar manual">
          <template #actions>
            <button @click="saveAutomation" :disabled="automationSaving"
              class="rounded-full bg-cyan px-4 py-2 text-xs font-bold text-navy transition-all hover:shadow-lg cursor-pointer disabled:opacity-50">
              {{ automationSaving ? 'Guardando…' : 'Guardar automatización' }}
            </button>
          </template>
          <div class="space-y-3">
            <label class="flex items-center justify-between gap-4 rounded-xl bg-surface p-3.5 cursor-pointer">
              <span class="text-sm font-bold text-navy">Generar código de puerta al hacer check-in
                <span class="block text-[11px] font-normal text-text-muted">Requiere TTLock conectado</span></span>
              <input type="checkbox" v-model="automation.autoLockCode" class="h-5 w-5 shrink-0 rounded text-cyan cursor-pointer" />
            </label>
            <label class="flex items-center justify-between gap-4 rounded-xl bg-surface p-3.5 cursor-pointer">
              <span class="text-sm font-bold text-navy">Enviar requerimiento de pago al confirmar
                <span class="block text-[11px] font-normal text-text-muted">Deuda técnica: hook backend</span></span>
              <input type="checkbox" v-model="automation.autoPaymentRequest" class="h-5 w-5 shrink-0 rounded text-cyan cursor-pointer" />
            </label>
          </div>
        </SectionCard>
      </div>

      <!-- Columna lateral: identidad y plan -->
      <div class="space-y-6">
        <!-- Nombre y precio salen de la suscripción real cruzada con la tabla `plans`
             (GET /api/subscription/me + GET /api/public/plans) — GH-31. Antes decía
             'Professional' y un precio de una tabla hardcodeada acá abajo, sin mirar el plan
             contratado: tres pantallas mostraban tres números distintos. -->
        <SectionCard title="Plan" subtitle="Suscripción de la plataforma">
          <div class="rounded-xl bg-purple/10 p-4 text-center">
            <div v-if="planLoading" class="mx-auto h-14 w-36 animate-pulse rounded-lg bg-white/60"></div>
            <template v-else-if="planCard">
              <div class="mb-1 text-[10px] font-bold uppercase text-teal" data-testid="settings-plan-status">{{ planStatusLabel }}</div>
              <div class="text-lg font-black text-purple" data-testid="settings-plan-name">{{ planCard.name }}</div>
              <div class="mt-1 text-2xl font-black text-navy tabular-nums" data-testid="settings-plan-price">{{ planCard.priceLabel }}<span
                v-if="planCard.priceKnown && !planCard.quote" class="text-sm font-bold text-text-muted">/mes</span></div>
            </template>
            <div v-else class="text-sm font-bold text-text-muted" data-testid="settings-plan-empty">
              No pudimos leer tu plan. Miralo en Suscripción.
            </div>
          </div>
        </SectionCard>
        <div class="rounded-2xl border border-border bg-white p-6 text-center shadow-(--shadow-card)">
          <span class="mx-auto mb-2 block h-8 w-8 text-navy/40" v-html="ICON_BUILDING"></span>
          <div class="text-sm font-bold text-navy">{{ form.name || 'Hotel' }}</div>
          <div v-if="form.country" class="mt-1 text-[10px] font-bold uppercase tracking-wide text-text-muted">{{ form.country }}</div>
        </div>
      </div>
    </div>

    <!-- ========== AMENITIES ========== -->
    <div v-if="activeTab === 'amenities'" class="space-y-6">
      <!-- Las amenidades por habitación (con precio y disponibilidad) viven en Habitaciones (#290). -->
      <div class="rounded-2xl bg-cyan/10 border border-cyan/20 px-5 py-4 text-sm text-navy" data-testid="amenities-config-hint">
        Las amenidades de cada habitación (cuna, cama extra, precios y disponibilidad) se configuran en
        <router-link to="/panel/config/habitaciones" class="font-bold text-navy underline underline-offset-2 hover:text-cyan">Habitaciones → Crear/Editar habitación</router-link>.
        Acá solo se define el catálogo general del hotel.
      </div>
      <div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        <div v-for="(items, category) in amenityCatalog" :key="category" class="rounded-[20px] border border-border bg-white shadow-(--shadow-card) p-6">
          <h3 class="font-extrabold text-navy mb-4 capitalize">{{ categoryLabels[category] || category }}</h3>
          <div class="space-y-2 max-h-96 overflow-y-auto">
            <label v-for="key in items" :key="key" class="flex items-center gap-3 p-2 rounded-lg hover:bg-surface cursor-pointer transition-colors">
              <input type="checkbox" :value="key" v-model="selectedAmenities"
                class="w-4 h-4 rounded border-gray-300 text-cyan focus:ring-cyan cursor-pointer" />
              <span class="text-sm text-navy font-medium">{{ amenityLabels[key] || key }}</span>
            </label>
          </div>
        </div>
      </div>
      <!-- Custom amenity -->
      <div class="rounded-[20px] border border-border bg-white shadow-(--shadow-card) p-6">
        <h3 class="font-extrabold text-navy mb-4">Agregar Amenity Personalizada</h3>
        <div class="flex flex-wrap gap-3">
          <select v-model="newAmenityCategory" class="px-4 py-2.5 rounded-full border border-border text-sm cursor-pointer">
            <option value="interior">Interior</option>
            <option value="exterior">Exterior</option>
            <option value="services">Servicios</option>
          </select>
          <input v-model="newAmenityName" type="text" placeholder="Nombre de la amenity..." class="flex-1 min-w-[140px] px-4 py-2.5 rounded-full border border-border text-sm" @keyup.enter="addCustomAmenity" />
          <button @click="addCustomAmenity" class="px-5 py-2.5 bg-cyan text-navy rounded-full text-sm font-bold cursor-pointer hover:shadow-lg">Agregar</button>
        </div>
        <div v-if="customAmenities.length > 0" class="mt-3 flex flex-wrap gap-2">
          <span v-for="a in customAmenities" :key="a.key" class="px-3 py-1.5 bg-navy/5 text-navy rounded-full text-xs font-bold flex items-center gap-1">
            {{ a.label }}
            <button @click="removeCustomAmenity(a.key)" class="w-3 h-3 text-coral hover:opacity-75 cursor-pointer ml-1" v-html="ICON_X"></button>
          </span>
        </div>
      </div>
    </div>

    <!-- ========== CONDICIONES ========== -->
    <div v-if="(activeTab as string) === 'conditions'" class="grid grid-cols-1 lg:grid-cols-2 gap-6">
      <!-- Política de cancelación REAL: tiers con horas/penalidad/refundo y excepciones por
           canal. Unifica la doble fuente de verdad — antes este tab sólo escribía el preset
           (`hotels.cancellationType`, nivel 3 de resolvePolicy) y si el hotel tenía política
           base guardada, editar acá no cambiaba nada. El editor trae los 4 presets como
           plantillas rápidas y guarda por su cuenta (PUT /api/cancellation-policies/base);
           la base guardada es la que aplican cancelaciones, motor y landing. -->
      <div class="lg:col-span-2">
        <CancellationPolicyEditor :hotel-id="hotelId" />
      </div>

      <div class="rounded-[20px] border border-border bg-white shadow-(--shadow-card) p-6">
        <h3 class="font-extrabold text-navy mb-4">Condiciones de la reserva</h3>
        <div class="space-y-4">
          <div class="flex items-center justify-between p-3 bg-surface rounded-xl">
            <div>
              <div class="text-sm font-bold text-navy">Cancelación gratuita</div>
              <div class="text-[10px] text-text-muted">La muestra el motor de reservas y el pre-checkin · la política con detalle va en el editor de abajo</div>
            </div>
            <label class="relative inline-flex items-center cursor-pointer">
              <input v-model="form.freeCancellation" type="checkbox" class="sr-only peer" data-field="freeCancellation">
              <div class="w-11 h-6 bg-gray-200 rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:absolute after:top-[2px] after:left-[2px] after:bg-white after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-teal"></div>
            </label>
          </div>

          <div class="flex items-center justify-between p-3 bg-surface rounded-xl">
            <div><div class="text-sm font-bold text-navy">Depósito requerido</div></div>
            <label class="relative inline-flex items-center cursor-pointer">
              <input v-model="form.depositRequired" type="checkbox" class="sr-only peer">
              <div class="w-11 h-6 bg-gray-200 rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:absolute after:top-[2px] after:left-[2px] after:bg-white after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-teal"></div>
            </label>
          </div>
          <div v-if="form.depositRequired" class="flex items-center gap-3 bg-surface rounded-xl p-3">
            <span class="text-sm text-text-secondary">% Depósito</span>
            <input v-model.number="form.depositPercent" type="number" min="1" max="100" class="w-20 px-3 py-2 rounded-full border text-sm font-bold text-navy text-right" :class="fieldClass('depositPercent')" data-field="depositPercent" @blur="touchField('depositPercent')">
              <p v-if="errorOf('depositPercent')" class="mt-1 text-[10px] font-bold text-danger">{{ errorOf('depositPercent') }}</p>
            <span class="text-sm text-text-muted">%</span>
          </div>
        </div>
      </div>

      <div class="rounded-[20px] border border-border bg-white shadow-(--shadow-card) p-6">
        <h3 class="font-extrabold text-navy mb-4">Impuestos</h3>
        <div class="space-y-4">
          <div class="grid grid-cols-2 gap-3">
            <div>
              <label class="text-[10px] font-bold text-text-muted uppercase mb-1 block">Nombre</label>
              <input v-model="form.taxName" placeholder="ITBIS" class="w-full px-3 py-2 rounded-full border text-sm" :class="fieldClass('taxName')" data-field="taxName" @blur="touchField('taxName')">
              <p v-if="errorOf('taxName')" class="mt-1 text-[10px] font-bold text-danger">{{ errorOf('taxName') }}</p>
            </div>
            <div>
              <label class="text-[10px] font-bold text-text-muted uppercase mb-1 block">Tasa (%)</label>
              <input v-model.number="form.taxRate" type="number" min="0" max="100" class="w-full px-3 py-2 rounded-full border text-sm font-bold text-navy text-right" :class="fieldClass('taxRate')" data-field="taxRate" @blur="touchField('taxRate')">
              <p v-if="errorOf('taxRate')" class="mt-1 text-[10px] font-bold text-danger">{{ errorOf('taxRate') }}</p>
            </div>
          </div>
        </div>
      </div>

      <div class="rounded-[20px] border border-border bg-white shadow-(--shadow-card) p-6">
        <h3 class="font-extrabold text-navy mb-4">Depósito y Fianza</h3>
        <div class="space-y-4">
          <div>
            <label class="text-[10px] font-bold text-text-muted uppercase mb-1 block">Tipo de Fianza</label>
            <select v-model="form.depositType" class="w-full px-3 py-2 rounded-full border border-border text-sm cursor-pointer">
              <option value="none">Ninguna</option>
              <option value="fixed">Fija</option>
              <option value="percentage">Porcentaje</option>
            </select>
          </div>
          <div v-if="form.depositType === 'fixed' || form.depositType === 'percentage'">
            <label class="text-[10px] font-bold text-text-muted uppercase mb-1 block">Valor</label>
            <div class="flex items-center gap-2">
              <span class="text-sm text-text-muted">{{ form.depositType === 'fixed' ? '$' : '' }}</span>
              <input v-model.number="form.depositFixed" type="number" min="0" class="w-24 px-3 py-2 rounded-full border text-sm font-bold text-navy text-right" :class="fieldClass('depositFixed')" data-field="depositFixed" @blur="touchField('depositFixed')">
              <p v-if="errorOf('depositFixed')" class="mt-1 text-[10px] font-bold text-danger">{{ errorOf('depositFixed') }}</p>
              <span v-if="form.depositType === 'percentage'" class="text-sm text-text-muted">%</span>
            </div>
          </div>
          <div>
            <label class="text-[10px] font-bold text-text-muted uppercase mb-1 block">Forma de Pago por Defecto</label>
            <select v-model="form.defaultPaymentMethod" class="w-full px-3 py-2 rounded-full border border-border text-sm cursor-pointer">
              <!-- value = PAYMENT_METHOD_ENUM. 'paypal' y 'link' no existen en el enum y hacían
                   fallar el guardado completo; ambos son pasarela → 'gateway'. -->
              <option value="transfer">Transferencia</option>
              <option value="card">Tarjeta</option>
              <option value="cash">Efectivo</option>
              <option value="gateway">Pasarela / Link de Pago</option>
            </select>
          </div>
        </div>
      </div>

      <div class="rounded-[20px] border border-border bg-white shadow-(--shadow-card) p-6">
        <h3 class="font-extrabold text-navy mb-4">Valoraciones</h3>
        <div class="space-y-3">
          <div class="flex items-center justify-between p-3 bg-surface rounded-xl">
            <div class="text-sm font-bold text-navy">Solicitar reseñas</div>
            <label class="relative inline-flex items-center cursor-pointer">
              <input v-model="form.requestReviews" type="checkbox" class="sr-only peer">
              <div class="w-11 h-6 bg-gray-200 rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:absolute after:top-[2px] after:left-[2px] after:bg-white after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-teal"></div>
            </label>
          </div>
          <!-- publishReviewScore y publishReviewComments se mudaron a la sección
               "Página pública" del menú (General): son flags que controlan qué se muestra
               en la landing pública, no configuración operativa de reseñas. -->
        </div>
      </div>

      <!-- Políticas para factura: el texto de cancelación y reembolso que se imprime al pie.
           Estaba en la pestaña Integraciones, que ahora es solo conexiones con servicios de afuera. -->
      <div class="rounded-[20px] border border-border bg-white shadow-(--shadow-card) p-6">
        <div class="flex items-start justify-between gap-4 mb-4">
          <div>
            <h3 class="font-extrabold text-navy">Políticas para factura</h3>
            <p class="text-[11px] text-text-muted mt-1 leading-relaxed">
              Texto que aparecerá al pie de cada factura emitida como “Políticas de cancelación y reembolso”.
              Déjalo vacío para no mostrar la sección.
            </p>
          </div>
        </div>
        <div class="space-y-3">
          <textarea v-model="invoicePolicyText" rows="4"
            placeholder="Ej. Cancelación gratuita hasta 48 h antes de la entrada. Después de ese plazo, la primera noche no es reembolsable..."
            class="w-full px-3 py-2 rounded-xl border border-border text-sm resize-y"></textarea>
          <button @click="saveInvoicePolicy" :disabled="invoicePolicySaving"
            class="w-full px-4 py-2 bg-navy text-white rounded-full text-sm font-bold hover:shadow-lg transition-all cursor-pointer disabled:opacity-50">
            {{ invoicePolicySaving ? 'Guardando...' : 'Guardar' }}
          </button>
        </div>
      </div>
    </div>

    <!-- ========== NIÑOS (Requerimiento 1) ========== -->
    <div v-if="(activeTab as string) === 'children'" class="grid grid-cols-1 lg:grid-cols-2 gap-6">
      <div class="rounded-[20px] border border-border bg-white shadow-(--shadow-card) p-6">
        <div class="flex items-start justify-between gap-4 mb-4">
          <div>
            <h3 class="font-extrabold text-navy">Política de niños</h3>
            <p class="text-[11px] text-text-muted mt-1 leading-relaxed">
              Define cómo cuentan los niños en las reservas del motor público (adultos + niños + edad de cada uno).
            </p>
          </div>
          <button @click="saveChildPolicy" :disabled="childPolicySaving || !!childPolicyError"
            class="shrink-0 px-4 py-2 bg-navy text-white rounded-full text-sm font-bold hover:shadow-lg cursor-pointer disabled:opacity-50">
            {{ childPolicySaving ? 'Guardando...' : 'Guardar' }}
          </button>
        </div>

        <div class="space-y-4">
          <div class="flex items-center justify-between p-3 bg-surface rounded-xl">
            <div>
              <div class="text-sm font-bold text-navy">Aceptar niños</div>
              <div class="text-[10px] text-text-muted">Si está apagado, la página de reservas no deja agregar niños</div>
            </div>
            <label class="relative inline-flex items-center cursor-pointer">
              <input v-model="childPolicy.acceptChildren" type="checkbox" class="sr-only peer">
              <div class="w-11 h-6 bg-gray-200 rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:absolute after:top-[2px] after:left-[2px] after:bg-white after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-teal"></div>
            </label>
          </div>

          <template v-if="childPolicy.acceptChildren">
            <div class="grid grid-cols-2 gap-3">
              <div>
                <label class="text-[10px] font-bold text-text-muted uppercase mb-1 block">Edad máxima considerada niño</label>
                <input v-model.number="childPolicy.maxChildAge" type="number" min="0" max="17" class="w-full px-3 py-2 rounded-full border border-border text-sm font-bold text-navy text-right">
              </div>
              <div>
                <label class="text-[10px] font-bold text-text-muted uppercase mb-1 block">Edad máxima sin consumir plaza</label>
                <input v-model.number="childPolicy.maxFreeAge" type="number" min="0" max="17" class="w-full px-3 py-2 rounded-full border text-sm font-bold text-navy text-right" :class="childPolicyError ? 'border-danger' : 'border-border'">
              </div>
            </div>
            <!-- Tarea 21 (Identificar bebés, 2026-09-08) — subconjunto de "sin consumir plaza": el
                 huésped y Administración ven "Bebé" en vez de "Niño" hasta esta edad. -->
            <div>
              <label class="text-[10px] font-bold text-text-muted uppercase mb-1 block">Edad máxima considerada bebé</label>
              <input v-model.number="childPolicy.maxBabyAge" type="number" min="0" :max="childPolicy.maxFreeAge" class="w-full px-3 py-2 rounded-full border text-sm font-bold text-navy text-right" :class="childPolicyError ? 'border-danger' : 'border-border'">
            </div>
            <!-- REQ-03 (#235) — tope de niños/bebés que NO consumen plaza por habitación. Vacío = sin
                 límite (null); nunca se precarga un número por default. -->
            <div>
              <label for="settings-max-free-children" class="text-[10px] font-bold text-text-muted uppercase mb-1 block">Máximo de niños que no consumen plaza por habitación</label>
              <input id="settings-max-free-children" name="maxFreeChildrenPerRoom" v-model="childPolicy.maxFreeChildrenPerRoom" type="number" min="0" step="1" placeholder="Sin límite" aria-label="Máximo de niños que no consumen plaza por habitación" class="w-full px-3 py-2 rounded-full border text-sm font-bold text-navy text-right" :class="childPolicyError ? 'border-danger' : 'border-border'">
              <p class="text-[10px] text-text-muted mt-1">
                Se aplica a cada habitación de la reserva, sin importar su tipo. Vacío = sin límite.
                Los niños y bebés que no consumen plaza no ocupan capacidad, pero cuentan para este máximo.
              </p>
            </div>
            <p v-if="childPolicyError" class="text-[10px] font-bold text-danger">{{ childPolicyError }}</p>
            <p class="text-[11px] text-text-muted leading-relaxed bg-surface rounded-xl p-3">
              Con estos valores: 0–{{ childPolicy.maxBabyAge }} años se considera BEBÉ (no consume plaza, no genera cargo) ·
              {{ childPolicy.maxBabyAge + 1 }}–{{ childPolicy.maxFreeAge }} años no consume plaza (no genera cargo de alojamiento) ·
              {{ childPolicy.maxFreeAge + 1 }}–{{ childPolicy.maxChildAge }} años consume plaza y se cobra como un ocupante más ·
              mayor de {{ childPolicy.maxChildAge }} años se trata como adulto.
            </p>

            <!-- Tarea "Cobro % niños" (2026-09-09) — solo afecta a quien YA consume plaza (el
                 rango de arriba); bebés y niños libres nunca reciben esta regla. -->
            <div class="pt-2 border-t border-border">
              <div class="flex items-center justify-between p-3 bg-surface rounded-xl">
                <div>
                  <div class="text-sm font-bold text-navy">Cobro reducido para niños</div>
                  <div class="text-[10px] text-text-muted">
                    Si está prendido, cada niño que consume plaza paga un % del valor de un adulto, en vez del precio completo de ocupante
                  </div>
                </div>
                <label class="relative inline-flex items-center cursor-pointer shrink-0 ml-3">
                  <input v-model="childPolicy.childrenDiscountEnabled" type="checkbox" class="sr-only peer">
                  <div class="w-11 h-6 bg-gray-200 rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:absolute after:top-[2px] after:left-[2px] after:bg-white after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-teal"></div>
                </label>
              </div>

              <div v-if="childPolicy.childrenDiscountEnabled" class="mt-3">
                <label class="text-[10px] font-bold text-text-muted uppercase mb-1 block">Porcentaje de tarifa para niños</label>
                <div class="flex items-center gap-2">
                  <input v-model.number="childPolicy.childrenRatePercent" type="number" min="1" max="100"
                    class="w-24 px-3 py-2 rounded-full border text-sm font-bold text-navy text-right"
                    :class="childPolicyError ? 'border-danger' : 'border-border'">
                  <span class="text-sm font-bold text-text-muted">%</span>
                </div>
                <p class="text-[11px] text-text-muted leading-relaxed bg-surface rounded-xl p-3 mt-2">
                  Ejemplo: si el valor de un adulto en la reserva es $100 y configurás {{ childPolicy.childrenRatePercent || 0 }}%,
                  cada niño con plaza paga ${{ childPolicy.childrenRatePercent || 0 }}.
                  No aplica a bebés ni a niños que no consumen plaza — esos siguen las reglas de arriba.
                </p>
              </div>
            </div>

            <!-- Tarea 22 (Cuna, 2026-09-08), simplificada 2026-09-09 — reemplaza el checklist de
                 "amenidades para bebé" por un único toggle: ¿el hotel ofrece cuna? Sin esto, el
                 composer público ni pregunta "¿Necesita cuna?" aunque la reserva tenga un bebé. -->
            <div class="pt-2 border-t border-border">
              <div class="flex items-center justify-between p-3 bg-surface rounded-xl">
                <div>
                  <div class="text-sm font-bold text-navy">Ofrece cuna para bebés</div>
                  <div class="text-[10px] text-text-muted">
                    Si está prendido, el motor público pregunta "¿Necesita cuna?" (Sí/No) cuando la reserva tiene un bebé
                  </div>
                </div>
                <label class="relative inline-flex items-center cursor-pointer shrink-0 ml-3">
                  <input v-model="childPolicy.cribAvailable" type="checkbox" class="sr-only peer">
                  <div class="w-11 h-6 bg-gray-200 rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:absolute after:top-[2px] after:left-[2px] after:bg-white after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-teal"></div>
                </label>
              </div>
            </div>
          </template>
        </div>
      </div>
    </div>

    <!-- ========== TIPOS DE HABITACIÓN Y CAPACIDAD (Requerimiento 2) ========== -->
    <!-- La pestaña "Integraciones" se mudó a su propia sección del menú (/panel/integraciones,
         pages/integraciones): WhatsApp, pasarelas, cerraduras, dispositivos y facturación
         electrónica estaban partidos entre esta pestaña y tres entradas sueltas del menú, así que
         "dónde conecto X" había que adivinarlo. "Políticas para factura" NO se fue con ellas: no
         es una conexión con nadie, es texto al pie de la factura — vive en Condiciones. -->

    <!-- EMERGENCIAS -->
    <div v-if="(activeTab as string) === 'emergency'" class="space-y-6">
      <div class="rounded-[20px] border border-border bg-white shadow-(--shadow-card) p-6">
        <div class="flex items-start justify-between gap-4 mb-4">
          <div>
            <h3 class="font-extrabold text-navy">Contactos de emergencia</h3>
            <p class="text-[11px] text-text-muted mt-1 leading-relaxed">
              Estos números aparecen en el botón de Emergencia del panel, disponible en todas las pantallas.
            </p>
          </div>
          <button @click="saveEmergencyContacts" :disabled="emergencySaving"
            class="shrink-0 px-4 py-2 bg-navy text-white rounded-full text-sm font-bold hover:shadow-lg cursor-pointer disabled:opacity-50">
            {{ emergencySaving ? 'Guardando...' : 'Guardar' }}
          </button>
        </div>

        <div v-if="emergencyContacts.length === 0" class="p-6 bg-surface rounded-xl text-center">
          <p class="text-xs text-text-muted">Todavía no cargaste contactos de emergencia.</p>
        </div>

        <div v-else class="space-y-3">
          <div v-for="c in emergencyContacts" :key="c.id"
            class="grid grid-cols-1 gap-3 md:grid-cols-[1fr_1fr_auto_auto] items-center p-3 bg-surface rounded-xl">
            <div>
              <label class="block text-[10px] font-bold text-text-muted uppercase tracking-wide mb-1">Nombre</label>
              <input v-model="c.label" type="text" placeholder="Nombre del contacto"
                class="w-full rounded-xl border border-border px-3 py-2 text-sm focus:border-navy focus:outline-none" />
            </div>
            <div>
              <label class="block text-[10px] font-bold text-text-muted uppercase tracking-wide mb-1">Teléfono</label>
              <input v-model="c.phone" type="tel" placeholder="Número de contacto"
                class="w-full rounded-xl border border-border px-3 py-2 text-sm focus:border-navy focus:outline-none" />
            </div>
            <div>
              <label class="block text-[10px] font-bold text-text-muted uppercase tracking-wide mb-1">Tipo</label>
              <select v-model="c.kind"
                class="w-full rounded-xl border border-border px-3 py-2 text-sm focus:border-navy focus:outline-none cursor-pointer">
                <option value="external">Externo</option>
                <option value="internal">Interno</option>
              </select>
            </div>
            <button @click="removeEmergencyContact(c.id)" aria-label="Eliminar contacto"
              class="self-end px-3 py-2 rounded-xl bg-danger/10 text-danger text-xs font-bold hover:bg-danger/20 transition-colors cursor-pointer">
              Eliminar
            </button>
          </div>
        </div>

        <button @click="addEmergencyContact"
          class="mt-4 px-4 py-2 bg-navy/10 text-navy rounded-full text-sm font-bold hover:bg-navy/20 transition-colors cursor-pointer">
          + Agregar contacto
        </button>
      </div>
    </div>

    </div>

    <!-- L6 (qa-ui config-2026-08-22): confirmación para quitar un contacto de emergencia,
         como el resto de acciones destructivas del panel. -->
    <ConfirmModal v-if="confirmModal" :title="confirmModal.title" :message="confirmModal.message"
      :confirm-label="confirmModal.confirmLabel" :danger="confirmModal.danger" :loading="confirmBusy"
      @confirm="runConfirm" @close="confirmModal = null" />
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted, nextTick, watch, reactive } from 'vue'
import { useRoute, useRouter, onBeforeRouteLeave } from 'vue-router'
import { INTEGRATIONS_PATH } from '@/config/integration-tabs'
import SectionCard from '@/components/ui/SectionCard.vue'
import WhatsappConnectionCard from '@/components/features/WhatsappConnectionCard.vue'
import WhatsappUsageCard from '@/components/features/WhatsappUsageCard.vue'
// Política de cancelación con tiers: el editor canónico (mismo componente que usa el Motor de
// reservas). Vive acá desde la unificación de Condiciones — antes sólo en Página pública.
import CancellationPolicyEditor from '@/components/booking/CancellationPolicyEditor.vue'
import SearchSelect from '@/components/ui/SearchSelect.vue'
import PhoneInput from '@/components/ui/PhoneInput.vue'
import { COUNTRIES, countryName } from '@/data/locales'
import { TIMEZONES, CURRENCIES } from '@/data/intl-catalogs'
import { CurrencyCode } from '@/types/currency'
import { loadCurrencyConfig, type CurrencyConfig } from '@/composables/useCurrency'
import { validateField, validateAll, warnOnUnsavedChanges, HOTEL_RULES } from '@/composables/useFieldValidation'
import { HotelService } from '@/services/Hotel.service'
import { SettingsService, type HotelFull } from '@/services/Settings.service'
import { AuthService } from '@/services/Auth.service'
import { ConfigService, EmergencyContactsService } from '@/services/Platform.service'
import { GuaranteeService } from '@/services/Guarantee.service'
import { SignupService, type PublicPlan } from '@/services/Signup.service'
import { PlanCatalogService, type DisplayPlan } from '@/services/PlanCatalog.service'
import { useAuthStore } from '@/stores/auth.store'
import { useToast } from '@/composables/useToast'
import ConfirmModal from '@/components/features/ConfirmModal.vue'
import { useConfirm } from '@/composables/useConfirm'
import type { AmenityCatalog } from '@/services/Hotel.service'
import type { HotelEmergencyContact } from '@/types'

const ICON_X = '<svg viewBox="0 0 24 24" class="w-full h-full" fill="none" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M6 18 18 6M6 6l12 12"/></svg>'
const ICON_BUILDING = '<svg viewBox="0 0 24 24" class="w-full h-full" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M6 22V4a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2v18Z"/><path d="M6 12H4a2 2 0 0 0-2 2v6a2 2 0 0 0 2 2h2"/><path d="M18 9h2a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2h-2"/><path d="M10 6h4"/><path d="M10 10h4"/><path d="M10 14h4"/><path d="M10 18h4"/></svg>'
const ICON_CARD = '<svg viewBox="0 0 24 24" class="w-full h-full" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect width="20" height="14" x="2" y="5" rx="2"/><line x1="2" x2="22" y1="10" y2="10"/></svg>'
const ICON_MESSAGE = '<svg viewBox="0 0 24 24" class="w-full h-full" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M7.9 20A9 9 0 1 0 4 16.1L2 22Z"/></svg>'
const ICON_RECEIPT = '<svg viewBox="0 0 24 24" class="w-full h-full" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 2v20l2-1 2 1 2-1 2 1 2-1 2 1 2-1 2 1V2l-2 1-2-1-2 1-2-1-2 1-2-1-2 1Z"/><path d="M8 7h8"/><path d="M8 11h8"/><path d="M8 15h5"/></svg>'

const auth = useAuthStore()
const toast = useToast()
const { confirmModal, confirmBusy, askConfirm, runConfirm } = useConfirm()
const hotelId = computed(() => (auth.user?.hotelId && auth.user.hotelId !== 'platform' ? auth.user.hotelId : undefined))

// Stripe se configura en /panel/config/pasarelas (tabla payment_gateways, cifrada y por hotel).
// El bloque anterior leía configuration['stripe_config'] y traía la secretKey EN CLARO al
// navegador: el endpoint genérico de configuración devuelve el JSON entero, secretos incluidos.

// Conversión de moneda secundaria (F3 match-misterplan — totales convertidos en el detalle de reserva).
// `exchangeRate` es un OVERRIDE MANUAL opcional: vacío/null = usar la tasa automática que devuelve
// `GET /api/tasa-cambio`, la misma que consume el backend. Acá no se hardcodea ninguna tasa.
const currencyConfig = reactive<{ secondaryCurrency: string; exchangeRate: number | string | null }>({ secondaryCurrency: '', exchangeRate: null })
const currencySaving = ref(false)
const autoRate = ref<CurrencyConfig>({ secondaryCurrency: '', exchangeRate: 0, fetchedAt: null, source: null, stale: false })
const autoRateFetchedAt = computed(() => {
  const at = autoRate.value.fetchedAt
  if (!at) return 'fecha desconocida'
  const d = new Date(at)
  return isNaN(d.getTime()) ? 'fecha desconocida' : d.toLocaleString('es-DO', { dateStyle: 'medium', timeStyle: 'short' })
})
// `force`: la tasa se cachea a nivel de módulo, y acá hace falta el valor de AHORA (un override
// manual recién guardado cambia lo que devuelve el endpoint).
async function loadAutoRate() {
  try { autoRate.value = await loadCurrencyConfig(hotelId.value, true) } catch { /* sin tasa: la UI muestra "sin tasa disponible" */ }
}
async function loadCurrency() {
  try {
    const c = await ConfigService.get('currency_config') as { secondaryCurrency?: string; exchangeRate?: number } | null
    if (c) {
      currencyConfig.secondaryCurrency = c.secondaryCurrency || ''
      // 0 es como el backend representa "sin override manual": el campo se muestra vacío.
      currencyConfig.exchangeRate = Number(c.exchangeRate) > 0 ? Number(c.exchangeRate) : null
    }
  } catch { /* sin config guardada: queda la tasa automática */ }
  // Sin await a propósito: la tasa automática es informativa (se muestra en su tarjeta) y el resto
  // de la pantalla no depende de ella; encadenarla retrasaría toda la carga por una petición que
  // puede tardar o no estar disponible.
  void loadAutoRate()
}
// El logo del hotel (subida arrastrar/soltar) se mudó a Página pública → General (tarea 1.7,
// docs/wizard-refactor) — es público (allow-list de getPublicHotelInfo), no identidad
// administrativa. Ver pagina-publica/general.vue.

// Contactos de emergencia del hotel (feedback #414). Viven en configuration['contactos_emergencia'];
// si el hotel no tiene los suyos, el backend cae al default global (hotelId='platform').
const emergencyContacts = ref<HotelEmergencyContact[]>([])
const emergencySaving = ref(false)
async function loadEmergencyContacts() {
  try {
    const cfg = await ConfigService.get('contactos_emergencia') as { contacts?: HotelEmergencyContact[] } | null
    emergencyContacts.value = Array.isArray(cfg?.contacts) ? cfg.contacts : []
  } catch { emergencyContacts.value = [] }
}
function addEmergencyContact() {
  emergencyContacts.value.push({ id: crypto.randomUUID(), label: '', phone: '', kind: 'external' })
}
function removeEmergencyContact(id: string) {
  const contact = emergencyContacts.value.find(c => c.id === id)
  askConfirm({
    title: 'Eliminar contacto',
    message: `¿Eliminar el contacto${contact?.label ? ` "${contact.label}"` : ''}? Se quita al Guardar.`,
    confirmLabel: 'Eliminar',
    danger: true,
    run: async () => { emergencyContacts.value = emergencyContacts.value.filter(c => c.id !== id) },
  })
}
async function saveEmergencyContacts() {
  const clean = emergencyContacts.value.map(c => ({ ...c, label: c.label.trim(), phone: c.phone.trim() }))
  if (clean.some(c => !c.label || !c.phone)) {
    toast.error('Cada contacto necesita nombre y teléfono')
    return
  }
  emergencySaving.value = true
  try {
    await ConfigService.set('contactos_emergencia', { contacts: clean })
    EmergencyContactsService.invalidate() // #636: el header (cacheado 5min) no debe mostrar datos viejos
    emergencyContacts.value = clean
    await nextTick()
    markClean()   // se guardó por afuera del botón global: la foto se renueva igual
    toast.success('Contactos de emergencia guardados')
  } catch (e) {
    toast.error((e as Error).message || 'No se pudo guardar')
  } finally {
    emergencySaving.value = false
  }
}

async function saveCurrency() {
  currencySaving.value = true
  try {
    // Campo vacío → 0, que el backend interpreta como "sin override manual" y resuelve la automática.
    await ConfigService.set('currency_config', { secondaryCurrency: currencyConfig.secondaryCurrency, exchangeRate: Number(currencyConfig.exchangeRate) || 0 })
    await loadAutoRate()
    toast.success('Conversión de moneda guardada')
  } catch (e) {
    toast.error((e as Error).message || 'No se pudo guardar')
  } finally {
    currencySaving.value = false
  }
}

// Nombre del usuario logueado (dueño/gerente) — `users.name`, DISTINTO del "Nombre del
// propietario" fiscal de arriba (`hotels.ownerName`). Antes solo se podía editar desde el paso
// Bienvenida del wizard de alta (`configuracion-inicial/steps/StepBienvenida.vue`): un hotel que
// lo completó mal ahí no tenía forma de corregirlo después. Mismo mecanismo que ese paso
// (`AuthService.updateMe`), con su propio guardado — no es un campo de `hotels`, así que no
// puede ir en `saveAll()`.
const ownerUserName = ref('')
const ownerUserNameSaving = ref(false)
async function saveOwnerUserName() {
  const trimmed = ownerUserName.value.trim()
  if (!trimmed) { toast.error('Tu nombre no puede quedar vacío'); return }
  if (trimmed === auth.user?.name) { markClean(); toast.success('Nombre guardado'); return }
  ownerUserNameSaving.value = true
  try {
    const updated = await AuthService.updateMe({ name: trimmed })
    if (auth.user) {
      auth.user.name = updated.name
      localStorage.setItem('user', JSON.stringify(auth.user))
    }
    markClean()   // se guardó por afuera del botón global: la foto se renueva igual
    toast.success('Nombre actualizado')
  } catch (e) {
    toast.error((e as Error).message || 'No se pudo actualizar el nombre')
  } finally {
    ownerUserNameSaving.value = false
  }
}

// PIN de tarjeta de garantía del hotel (MisterPlan) — protege el acceso a las tarjetas en el detalle de reserva.
const guaranteePinDraft = ref('')
const guaranteePinSaving = ref(false)
const hasGuaranteePin = ref(false)
async function loadGuaranteePin() {
  try { hasGuaranteePin.value = (await GuaranteeService.hasPin()).hasPin } catch { /* ignore */ }
}
async function saveGuaranteePin() {
  const pin = (guaranteePinDraft.value || '').trim()
  if (!/^\d{4,8}$/.test(pin)) { toast.error('El PIN debe tener entre 4 y 8 dígitos'); return }
  guaranteePinSaving.value = true
  try {
    await GuaranteeService.setPin(pin)
    hasGuaranteePin.value = true
    guaranteePinDraft.value = ''
    await nextTick()
    markClean()
    toast.success('PIN de garantía guardado')
  } catch (e) {
    toast.error((e as Error).message || 'No se pudo guardar el PIN')
  } finally {
    guaranteePinSaving.value = false
  }
}

// Automatización del flujo de reserva (auto/manual): PIN de puerta al check-in y requerimiento de pago al confirmar.
const automation = reactive({ autoLockCode: false, autoPaymentRequest: false })
const automationSaving = ref(false)
async function loadAutomation() {
  try {
    const c = await ConfigService.get('automation_config') as { autoLockCode?: boolean; autoPaymentRequest?: boolean } | null
    if (c) { automation.autoLockCode = !!c.autoLockCode; automation.autoPaymentRequest = !!c.autoPaymentRequest }
  } catch { /* default off */ }
}
async function saveAutomation() {
  automationSaving.value = true
  try {
    await ConfigService.set('automation_config', { autoLockCode: automation.autoLockCode, autoPaymentRequest: automation.autoPaymentRequest })
    await nextTick()
    markClean()
    toast.success('Automatización guardada')
  } catch (e) {
    toast.error((e as Error).message || 'No se pudo guardar')
  } finally {
    automationSaving.value = false
  }
}

// La facturación electrónica (NCF) se mudó a Integraciones → Facturación electrónica
// (pages/integraciones/facturacion.vue), con su propio estado y su propio aviso de cambios
// sin guardar.

// ─── Política de niños (Requerimiento 1, 2026-09-03) ───────────────────────────────────────
// configuration('child_policy'), mismo patrón que automation_config/electronic_invoicing.
// Consumida por el motor público (backend `resolveChildPolicy`) y por el wizard `/book/:slug`
// (`childPolicy` de `GET /public/hotel/:slug`) para decidir si ofrece el stepper de niños.
// Tarea 21 (Identificar bebés, 2026-09-08) — `maxBabyAge` es un SUBCONJUNTO de "no consume
// plaza": 0 ≤ maxBabyAge ≤ maxFreeAge (ver backend/src/shared/usecases/child-composition.ts).
// Tarea "Cobro % niños" (2026-09-09) — `childrenDiscountEnabled`+`childrenRatePercent` (1-100,
// NUNCA hardcodeado a 50): cada niño que consume plaza paga ese % del "valor de un adulto" en vez
// del precio completo de ocupante, SOLO si el hotel lo habilita.
// Tarea 22 (Cuna, 2026-09-08), simplificada 2026-09-09 — `cribAvailable` reemplaza el checklist
// de "amenidades para bebé" (isChildAmenity sobre upsells) por un único toggle a nivel hotel.
// REQ-03 (#235) — `maxFreeChildrenPerRoom`: tope de niños/bebés que no consumen plaza por
// habitación (entero ≥ 0). `null` = sin límite; el input vacío se guarda como null, NUNCA se
// precarga un número por default. El backend lo aplica por habitación en motor público, panel,
// API/IA y reagendado.
const childPolicy = reactive({
  acceptChildren: true, maxChildAge: 17, maxFreeAge: 0, maxBabyAge: 0,
  childrenDiscountEnabled: false, childrenRatePercent: 50, cribAvailable: false,
  maxFreeChildrenPerRoom: null as number | string | null,
})
/** REQ-03 — input vacío/null → null (sin límite); cualquier otra cosa → Number (validado aparte). */
function normalizeMaxFreeChildren(v: number | string | null): number | null {
  if (v === null || v === undefined || (typeof v === 'string' && v.trim() === '')) return null
  return Number(v)
}
const childPolicySaving = ref(false)
async function loadChildPolicy() {
  try {
    const c = await ConfigService.get('child_policy') as {
      acceptChildren?: boolean; maxChildAge?: number; maxFreeAge?: number; maxBabyAge?: number
      childrenDiscountEnabled?: boolean; childrenRatePercent?: number; cribAvailable?: boolean
      maxFreeChildrenPerRoom?: number | null
    } | null
    if (c) {
      childPolicy.acceptChildren = c.acceptChildren !== false
      childPolicy.maxChildAge = Number.isFinite(c.maxChildAge) ? Number(c.maxChildAge) : 17
      childPolicy.maxFreeAge = Number.isFinite(c.maxFreeAge) ? Number(c.maxFreeAge) : 0
      childPolicy.maxBabyAge = Number.isFinite(c.maxBabyAge) ? Number(c.maxBabyAge) : 0
      childPolicy.childrenDiscountEnabled = c.childrenDiscountEnabled === true
      childPolicy.childrenRatePercent = Number.isFinite(c.childrenRatePercent) ? Number(c.childrenRatePercent) : 50
      childPolicy.cribAvailable = c.cribAvailable === true
      childPolicy.maxFreeChildrenPerRoom = Number.isInteger(c.maxFreeChildrenPerRoom) && Number(c.maxFreeChildrenPerRoom) >= 0
        ? Number(c.maxFreeChildrenPerRoom) : null
    }
  } catch { /* default: acepta niños, sin plaza gratis hasta 0 años, nadie es "bebé", sin descuento ni cuna */ }
}
// "La edad máxima sin consumir plaza no puede ser superior a la edad máxima considerada niño."
// Tarea 21 — mismo criterio para maxBabyAge, pero contra maxFreeAge (del cual es subconjunto).
// Tarea "Cobro % niños" — el % solo se valida mientras la regla está prendida (apagada, cualquier
// valor guardado antes queda inerte, no hace falta bloquear el guardado por él).
const childPolicyError = computed(() => {
  if (childPolicy.maxFreeAge > childPolicy.maxChildAge) return 'La edad sin consumir plaza no puede ser mayor que la edad máxima de niño'
  if (childPolicy.maxBabyAge > childPolicy.maxFreeAge) return 'La edad máxima de bebé no puede ser mayor que la edad sin consumir plaza'
  if (childPolicy.childrenDiscountEnabled) {
    const pct = childPolicy.childrenRatePercent
    if (!Number.isFinite(pct) || pct < 1 || pct > 100) return 'El porcentaje de tarifa para niños debe estar entre 1% y 100%'
  }
  // REQ-03 (#235) — vacío/null es válido (sin límite); si hay valor, entero ≥ 0 (mismo criterio que el backend).
  const maxFree = normalizeMaxFreeChildren(childPolicy.maxFreeChildrenPerRoom)
  if (maxFree !== null && (!Number.isInteger(maxFree) || maxFree < 0)) return 'El máximo de niños que no consumen plaza por habitación debe ser un entero mayor o igual a 0'
  return ''
})
async function saveChildPolicy() {
  if (childPolicyError.value) { toast.error(childPolicyError.value); return }
  childPolicySaving.value = true
  try {
    await ConfigService.set('child_policy', {
      acceptChildren: childPolicy.acceptChildren, maxChildAge: childPolicy.maxChildAge,
      maxFreeAge: childPolicy.maxFreeAge, maxBabyAge: childPolicy.maxBabyAge,
      childrenDiscountEnabled: childPolicy.childrenDiscountEnabled, childrenRatePercent: childPolicy.childrenRatePercent,
      cribAvailable: childPolicy.cribAvailable,
      maxFreeChildrenPerRoom: normalizeMaxFreeChildren(childPolicy.maxFreeChildrenPerRoom),
    })
    await nextTick()
    markClean()
    toast.success('Política de niños guardada')
  } catch (e) {
    toast.error((e as Error).message || 'No se pudo guardar')
  } finally {
    childPolicySaving.value = false
  }
}

// Políticas de cancelación y reembolso para factura (configuration['invoice_policy_text']).
// Texto libre que se imprime al pie de cada factura A4 emitida. Vacío = no se imprime el bloque.
const invoicePolicyText = ref('')
const invoicePolicySaving = ref(false)
async function loadInvoicePolicy() {
  try {
    const v = await ConfigService.get('invoice_policy_text') as string | null
    invoicePolicyText.value = (typeof v === 'string' && v.trim()) ? v : ''
  } catch { /* default: vacío */ }
}
async function saveInvoicePolicy() {
  invoicePolicySaving.value = true
  try {
    await ConfigService.set('invoice_policy_text', invoicePolicyText.value.trim())
    await nextTick()
    markClean()
    toast.success('Políticas de factura guardadas')
  } catch (e) {
    toast.error((e as Error).message || 'No se pudo guardar')
  } finally {
    invoicePolicySaving.value = false
  }
}

const activeTab = ref('hotel' as string)
// Deep-link ?tab=... (el botón de Emergencia del header entra directo a su pestaña)
const route = useRoute()
const router = useRouter()
onMounted(() => {
  const t = route.query.tab
  // La pestaña "Integraciones" se mudó a /panel/integraciones. Un link guardado a ?tab=integrations
  // no debe aterrizar en la pestaña Hotel sin explicación: se lo lleva a donde está ahora.
  if (t === 'integrations') {
    router.replace({ path: INTEGRATIONS_PATH })
    return
  }
  if (typeof t === 'string' && allTabs.value.some(tab => tab.value === t)) activeTab.value = t
})
const saving = ref(false)
const loading = ref(true)

type SettingsTab = { value: string; label: string }
type SettingsTabGroup = { label: string; tabs: SettingsTab[] }

// Dos grupos de configuración (feedback #139):
// - Administrativo: identidad del hotel + políticas comerciales/fiscales.
// - Configuraciones e integraciones: catálogos configurables + conexiones con terceros.
const tabGroups: SettingsTabGroup[] = [
  {
    label: 'Config. administrativo',
    tabs: [
      { value: 'hotel', label: 'Hotel' },
      { value: 'conditions', label: 'Condiciones' },
      { value: 'children', label: 'Niños' },
      // "Tipos de habitación" se mudó a Habitaciones (pestaña "Tipos y capacidad"): definir el
      // inventario estaba partido entre dos entradas distintas del mismo menú.
      { value: 'emergency', label: 'Emergencias' },
      // "RRHH" (días laborables) se mudó a RRHH → Asistencia → Horarios: es lo único que
      // configuraba y estaba a dos secciones de distancia de ahí.
    ],
  },
  {
    label: 'Configuraciones e integraciones',
    tabs: [
      // Página pública / Landing / Reputación externa / Tracking se mudaron a su propia
      // sección del menú lateral (Página pública). Acá queda solo config operativa.
      // "Catálogo de amenities", no "Amenities" a secas: las del HOTEL (piscina, gimnasio —
      // las que salen en la landing) se editan en Página pública → General. Dos catálogos
      // distintos que se llamaban igual, al punto que la otra vista necesitaba una nota
      // aclaratoria para que no se confundieran. Y "catálogo" porque las amenidades de CADA
      // habitación (cuna, cama extra, precio, disponibilidad) se configuran en Habitaciones (#290).
      { value: 'amenities', label: 'Catálogo de amenities' },
      // "Integraciones" se fue a su propia sección del menú (/panel/integraciones).
    ],
  },
]

// ─── Validación por campo ────────────────────────────────────────────────────
// `touchedFields` evita el patrón molesto de marcar en rojo un formulario recién abierto:
// un campo sólo muestra su error después de que el usuario pasó por él (o al intentar guardar).
const fieldErrors = ref<Record<string, string>>({})
const touchedFields = ref<Set<string>>(new Set())

/** En qué pestaña vive cada campo — para poder llevar al usuario hasta el error. */
const FIELD_TAB: Record<string, string> = {
  name: 'hotel', phone2: 'hotel',
  timezone: 'hotel', currency: 'hotel',
  checkIn: 'hotel', checkOut: 'hotel', ownerName: 'hotel', ownerTaxId: 'hotel',
  // website/logo/accommodationType/starRating se mudaron a Página pública (tarea 1.7).
  // phone/email (contacto público) se mudaron a Página pública → General (issue #79); acá
  // queda sólo phone2 como contacto interno. Al no estar acá tampoco entran en `activeRules`.
  // País: Dirección/mapa/provincia/municipio/CP se mudaron a Página pública (tarea 1.8,
  // docs/wizard-refactor) — país se queda acá porque es identidad administrativa/fiscal
  // (doc 03), ahora vive en la pestaña Hotel junto al resto de la identidad.
  country: 'hotel',
  wifiNetwork: 'hotel', wifiPassword: 'hotel',
  depositPercent: 'conditions', weekendSurcharge: 'conditions', depositFixed: 'conditions',
  advanceAmount: 'conditions', releaseHours: 'conditions', taxName: 'conditions', taxRate: 'conditions',
}
function tabOfField(field: string): string | undefined {
  return FIELD_TAB[field]
}

/** Valida un campo al salir de él. Se llama desde @blur. */
function touchField(field: string) {
  touchedFields.value = new Set(touchedFields.value).add(field)
  const rule = HOTEL_RULES[field]
  if (!rule) return
  const msg = validateField((form.value as Record<string, unknown>)[field], rule)
  const next = { ...fieldErrors.value }
  if (msg) next[field] = msg
  else delete next[field]
  fieldErrors.value = next
}

/** Mensaje a mostrar bajo el campo: sólo si ya fue tocado. */
function errorOf(field: string): string {
  return touchedFields.value.has(field) ? (fieldErrors.value[field] ?? '') : ''
}

/** Clase del input: borde rojo cuando el campo tiene error visible. */
function fieldClass(field: string): string {
  return errorOf(field) ? 'border-danger' : 'border-border'
}

const hasErrors = computed(() => Object.keys(fieldErrors.value).length > 0)

// ─── Cambios sin guardar ─────────────────────────────────────────────────────
// Se compara contra una foto del formulario tomada al cargar (y renovada al guardar bien).
// Antes se podía salir de la pantalla y perder todo lo tipeado sin ningún aviso.
const savedSnapshot = ref('')
function snapshot(): string {
  // Antes solo se rastreaba `form`/`descriptions`: tildar un amenity, editar un contacto de
  // emergencia, tipear un PIN de garantía o tocar cualquiera de los toggles satélite y navegar
  // afuera sin guardar no mostraba ningún aviso — ni el banner "Cambios sin guardar" ni la
  // confirmación al salir. Cada bloque que tiene su PROPIO botón "Guardar" entra acá.
  return JSON.stringify({
    form: form.value, ownerUserName: ownerUserName.value,
    selectedAmenities: selectedAmenities.value, emergencyContacts: emergencyContacts.value,
    currencyConfig, guaranteePinDraft: guaranteePinDraft.value, automation,
    childPolicy,
    // Slug, amenities hotel-level, traducciones públicas y flags de reseñas públicas
    // se gestionan y persisten desde la sección "Página pública" del menú. Capacidad por tipo
    // de habitación y días laborables, desde Habitaciones y Asistencia respectivamente.
  })
}
function markClean() {
  savedSnapshot.value = snapshot()
}

const isDirty = computed(() => savedSnapshot.value !== '' && snapshot() !== savedSnapshot.value)

onBeforeRouteLeave(() => {
  if (!isDirty.value) return true
  return window.confirm('Tenés cambios sin guardar en la configuración. ¿Salir y descartarlos?')
})

let stopUnloadWarning: (() => void) | null = null
onMounted(() => { stopUnloadWarning = warnOnUnsavedChanges(() => isDirty.value) })
onUnmounted(() => { stopUnloadWarning?.() })

const allTabs = computed<SettingsTab[]>(() => tabGroups.flatMap(g => g.tabs))

type HotelForm = Partial<HotelFull> & { cancellationType?: string; freeCancellation?: boolean }

const form = ref<HotelForm>({
  name: '', country: '', address: '', phone: '', email: '',
  timezone: 'America/Santo_Domingo', currency: CurrencyCode.USD,
  checkIn: '15:00', checkOut: '12:00', plan: '',
  freeCancellation: true, depositRequired: true, depositPercent: 30,
  weekendSurcharge: 0, accommodationType: '', starRating: '',
  ownerName: '', ownerTaxId: '', phone2: '', website: '',
  province: '', municipality: '', locality: '', postalCode: '',
  latitude: undefined as number | undefined, longitude: undefined as number | undefined,
  cancellationType: 'flexible', cleaningType: 'checkout',
  depositType: 'none', depositFixed: 0,
  advanceType: 'percentage', advanceAmount: 0, releaseHours: 0,
  defaultPaymentMethod: 'transfer',
  requestReviews: false, publishReviewScore: false, publishReviewComments: false,
  taxName: 'ITBIS', taxRate: 18,
  wifiNetwork: '', wifiPassword: '', logo: '',
  slug: '', amenities: [], descriptionTranslations: {},
  id: '',
})

/**
 * Un logo que no resuelve (archivo borrado del storage, valor legacy, URL absoluta que no carga)
 * no debe dejar el recuadro de imagen rota del navegador: se trata como "sin logo" y cae al
 * placeholder de arrastrar/soltar. Mismo tratamiento que CommandCenterHeader.
 */
const logoFailed = ref(false)
const logoSrc = computed(() => (logoFailed.value ? '' : form.value.logo || ''))
// Un logo NUEVO (recién subido o pegado a mano) merece otra chance aunque el anterior fallara.
watch(() => form.value.logo, () => { logoFailed.value = false })

// Plan contratado: la suscripción manda (`planId`), y el precio/nombre salen de la tabla `plans`.
// `hotels.plan` sólo se usa como último recurso para resolver el slug cuando todavía no hay
// suscripción — nunca para el precio.
const planLoading = ref(true)
const planCard = ref<DisplayPlan | null>(null)
const planStatus = ref<string>('none')
const PLAN_STATUS_LABELS: Record<string, string> = {
  trialing: 'En prueba', active: 'Activo', past_due: 'Pago pendiente',
  expired: 'Vencida', canceled: 'Cancelada', suspended: 'Suspendida', none: 'Sin suscripción',
}
const planStatusLabel = computed(() => PLAN_STATUS_LABELS[planStatus.value] ?? planStatus.value)

async function loadPlan() {
  planLoading.value = true
  try {
    const [sub, plans] = await Promise.all([
      SignupService.mySubscription().catch(() => null),
      SignupService.publicPlans().catch(() => [] as PublicPlan[]),
    ])
    planStatus.value = sub?.status ?? 'none'
    const hotelPlan = String(form.value.plan ?? '').toLowerCase()
    const match = plans.find((p) => p.id === sub?.planId)
      ?? (hotelPlan ? plans.find((p) => p.slug === hotelPlan || p.name.toLowerCase() === hotelPlan) : undefined)
    planCard.value = match ? PlanCatalogService.toDisplay(match) : null
  } finally {
    planLoading.value = false
  }
}

// Presets canónicos (mismos tiers que el backend, cancellation-math.ts).


// Amenities
const amenityCatalog = ref<AmenityCatalog>({ interior: [], exterior: [], services: [] })
const selectedAmenities = ref<string[]>([])
const newAmenityName = ref('')
const newAmenityCategory = ref('interior')
const customAmenities = ref<{ key: string; label: string; category: string }[]>([])

function addCustomAmenity() {
  const name = newAmenityName.value.trim()
  if (!name) return
  const key = name.toLowerCase().replace(/\s+/g, '_').replace(/[^a-z0-9_]/g, '')
  if (customAmenities.value.find(a => a.key === key)) return
  customAmenities.value.push({ key, label: name, category: newAmenityCategory.value })
  if (!amenityCatalog.value[newAmenityCategory.value as keyof AmenityCatalog]) {
    amenityCatalog.value[newAmenityCategory.value as keyof AmenityCatalog] = []
  }
  amenityCatalog.value[newAmenityCategory.value as keyof AmenityCatalog].push(key)
  amenityLabels[key] = name
  selectedAmenities.value.push(key)
  newAmenityName.value = ''
  saveCustomAmenities()
}
function removeCustomAmenity(key: string) {
  customAmenities.value = customAmenities.value.filter(a => a.key !== key)
  selectedAmenities.value = selectedAmenities.value.filter(k => k !== key)
  saveCustomAmenities()
}
async function saveCustomAmenities() {
  try {
    const { ConfigService } = await import('@/services/Platform.service')
    await ConfigService.set('custom_amenities', customAmenities.value, hotelId.value)
  } catch {}
}
async function loadCustomAmenities() {
  try {
    const { ConfigService } = await import('@/services/Platform.service')
    const data = await ConfigService.get('custom_amenities', hotelId.value)
    if (Array.isArray(data)) {
      customAmenities.value = data
      for (const a of data) {
        if (!amenityCatalog.value[a.category as keyof AmenityCatalog]) {
          amenityCatalog.value[a.category as keyof AmenityCatalog] = []
        }
        amenityCatalog.value[a.category as keyof AmenityCatalog].push(a.key)
        amenityLabels[a.key] = a.label
      }
    }
  } catch {}
}

const categoryLabels: Record<string, string> = { interior: 'Interior', exterior: 'Exterior', services: 'Servicios' }
const amenityLabels: Record<string, string> = {
  ac: 'Aire Acondicionado', heating: 'Calefacción', kitchen: 'Cocina', microwave: 'Microondas',
  fridge: 'Nevera', coffee_maker: 'Cafetera', washer: 'Lavadora', dishwasher: 'Lavavajillas',
  tv: 'TV', wifi: 'WiFi', safe: 'Caja Fuerte', minibar: 'Minibar', hair_dryer: 'Secador',
  iron: 'Plancha', balcony: 'Balcón', bathtub: 'Bañera', work_desk: 'Escritorio',
  pool: 'Piscina', pool_heated: 'Piscina Climatizada', parking_free: 'Parking Gratis',
  parking_paid: 'Parking Pago', gym: 'Gimnasio', spa: 'SPA', restaurant: 'Restaurante',
  bar: 'Bar', garden: 'Jardín', terrace: 'Terraza', bbq: 'Barbacoa', elevator: 'Ascensor',
  lounge: 'Salón', kids_playground: 'Zona Infantil',
  room_service: 'Room Service', laundry: 'Lavandería', concierge: 'Conserjería',
  luggage_storage: 'Guardaequipaje', pets_allowed: 'Mascotas', wheelchair_access: 'Acceso Silla Ruedas',
}

onMounted(async () => {
  let errors: string[] = []

  try {
    // Hotel settings
    const s = await SettingsService.get()
    const h = s.hotel as HotelFull & Record<string, unknown>
    form.value = {
      // countryName() acepta el nombre o el ISO viejo ('DO'): la columna quedó con los dos formatos
      // porque el registro guardaba el nombre y esta pantalla guardaba el código. Sin normalizar,
      // un hotel con 'DO' no matcheaba ninguna opción del selector ni resolvía bandera/prefijo.
      name: h.name ?? '', country: countryName(h.country), address: h.address ?? '',
      phone: h.phone ?? '', email: h.email ?? '',
      timezone: h.timezone ?? 'America/Santo_Domingo', currency: h.currency ?? 'USD',
      checkIn: h.checkIn || '15:00', checkOut: h.checkOut || '12:00',
      plan: h.plan ?? '',
      freeCancellation: h.freeCancellation !== false,
      depositRequired: h.depositRequired !== false,
      depositPercent: h.depositPercent ?? 30,
      weekendSurcharge: h.weekendSurcharge ?? 0,
      accommodationType: h.accommodationType ?? '',
      starRating: h.starRating ?? '',
      ownerName: h.ownerName ?? '', ownerTaxId: h.ownerTaxId ?? '',
      phone2: h.phone2 ?? '', website: h.website ?? '',
      province: h.province ?? '', municipality: h.municipality ?? '',
      locality: h.locality ?? '', postalCode: h.postalCode ?? '',
      latitude: h.latitude ? Number(h.latitude) : undefined,
      longitude: h.longitude ? Number(h.longitude) : undefined,
      cancellationType: h.cancellationType ?? 'flexible',
      cleaningType: h.cleaningType ?? 'checkout',
      depositType: h.depositType ?? 'none', depositFixed: h.depositFixed ?? 0,
      advanceType: h.advanceType ?? 'percentage', advanceAmount: h.advanceAmount ?? 0,
      releaseHours: h.releaseHours ?? 0,
      defaultPaymentMethod: h.defaultPaymentMethod ?? 'transfer',
      requestReviews: h.requestReviews === 1 || h.requestReviews === true,
      publishReviewScore: h.publishReviewScore === 1 || h.publishReviewScore === true,
      publishReviewComments: h.publishReviewComments === 1 || h.publishReviewComments === true,
      taxName: h.taxName ?? 'ITBIS', taxRate: h.taxRate ?? 18,
      wifiNetwork: h.wifiNetwork ?? '', wifiPassword: h.wifiPassword ?? '', logo: h.logo ?? '',
      slug: h.slug ?? '',
      amenities: Array.isArray(h.amenities) ? [...(h.amenities as string[])] : [],
      descriptionTranslations: (h.descriptionTranslations && typeof h.descriptionTranslations === 'object')
        ? { ...(h.descriptionTranslations as Record<string, { title?: string; description?: string }>) }
        : {},
      id: h.id || (h as any)._id,
    }
    ownerUserName.value = auth.user?.name || ''
    // INT-3: los watchers de #34 son flush 'pre' (diferidos al scheduler), NO corren
    // sincrónico con la asignación de arriba. Si el flag se setea acá mismo, cuando los
    // callbacks corren (microtask posterior) ya ven true y el guard es INERTE: el dato
    // legacy contradictorio se auto-flippea igual que antes. El flag se enciende en el
    // nextTick DESPUÉS de la hidratación: para entonces los watchers diferidos ya corrieron
    // (y fueron bloqueados por el flag en false), así que el dato contradictorio llega
    // intacto al render y el aviso del template es alcanzable. La auto-resolución sólo
    // ocurre si el usuario INTERACTÚA después de la carga.
    await nextTick()

    // Amenities catalog + selected
    const [cat, sel] = await Promise.all([
      HotelService.amenitiesCatalog(),
      HotelService.amenitiesHotel().catch(() => ({ data: [] })),
    ])
    amenityCatalog.value = cat
    selectedAmenities.value = sel.data.map((a: any) => a.amenityKey)
    await loadCustomAmenities()

    // Todo lo de abajo cargaba en onMounted() separados, en carrera con éste: si llegaban
    // DESPUÉS del markClean() de acá abajo, el snapshot quedaba viejo y la pantalla marcaba
    // "cambios sin guardar" apenas terminaba de cargar, sin que el usuario tocara nada.
    await loadEmergencyContacts()
    await loadCurrency()
    await loadGuaranteePin()
    await loadAutomation()
    await loadChildPolicy()
    await loadInvoicePolicy()
  } catch (e) {
    toast.error('Error al cargar datos')
  } finally {
    // COR-4: la tarjeta "Plan" NO puede depender de que los siete loaders de arriba hayan salido
    // bien. Cuando `loadPlan()` era el último `await` del `try`, cualquier fallo previo (amenities,
    // moneda, PIN, automatización, fiscal, política de facturas) lo salteaba,
    // `planLoading` se quedaba en `true` para siempre y la tarjeta mostraba el skeleton eterno: el
    // fallback "No pudimos leer tu plan" era inalcanzable. Va en el `finally` y trae su propio
    // try/finally, así el indicador siempre se apaga.
    await loadPlan()
    loading.value = false
    // Foto inicial DESPUÉS de poblar el formulario: sin esto todo se vería como "cambios sin guardar"
    // apenas se abre la pantalla.
    await nextTick()
    markClean()
  }
})

async function saveAll() {
  if (saving.value) return

  // Se revalida todo y se marcan los campos: antes sólo se comprobaban nombre y país, y cualquier
  // otro problema aparecía como un 400 con un toast genérico que no decía cuál era el campo.
  //
  // Bug real encontrado en la revisión de F1 (tareas 1.7/1.8): `HOTEL_RULES` es compartido con
  // `ubicacion.vue` y todavía declara `website`/`logo` (mudados a Página pública en 1.7) y
  // `address`/`province`/`municipality`/`locality`/`postalCode`/`latitude`/`longitude` (mudados
  // en 1.8) — `form.value` los sigue cargando desde `SettingsService.get()` aunque ya no tengan
  // ningún input en esta pantalla. Validar el set COMPLETO de `HOTEL_RULES` contra esos valores
  // viejos podía bloquear el guardado entero de Hotel/Condiciones por un campo que el usuario no
  // puede ver ni corregir acá (el toast apuntaba a un `data-field` que ya no existe en el DOM).
  // `FIELD_TAB` ya lista exactamente los campos que siguen activos en esta pantalla — se usa como
  // filtro en vez de validar todo `HOTEL_RULES`.
  const activeRules = Object.fromEntries(Object.entries(HOTEL_RULES).filter(([k]) => k in FIELD_TAB))
  touchedFields.value = new Set(Object.keys(activeRules))
  fieldErrors.value = validateAll(form.value as Record<string, unknown>, activeRules)
  const bad = Object.keys(fieldErrors.value)
  if (bad.length) {
    const first = bad[0]!
    // Llevar al usuario hasta el problema: la pestaña que lo contiene y el foco en el campo.
    const tab = tabOfField(first)
    if (tab && activeTab.value !== tab) activeTab.value = tab
    await nextTick()
    document.querySelector<HTMLElement>(`[data-field="${first}"]`)?.focus()
    toast.error(bad.length === 1
      ? fieldErrors.value[first]!
      : `Hay ${bad.length} campos con errores. Revisá los marcados en rojo.`)
    return
  }

  saving.value = true
  const errors: string[] = []

  const saveField = (k: string, v: any) => v !== undefined && v !== null ? v : undefined
  const patch: Record<string, any> = {}
  // address/province/municipality/locality/postalCode/latitude/longitude ya NO se guardan
  // desde acá (tarea 1.8, docs/wizard-refactor) — los persiste Página pública → Ubicación con
  // su propio guardado aislado. Incluirlos acá pisaría ese guardado con lo que haya quedado
  // cargado en este formulario al abrir Configuración.
  // accommodationType/starRating/website/logo ya NO se guardan desde acá (tarea 1.7,
  // docs/wizard-refactor) — los persiste Página pública → General con su propio guardado.
  // phone/email ya NO se guardan desde acá (issue #79) — los persiste Página pública → General
  // (Contacto público); incluirlos pisaría ese guardado con lo cargado al abrir Configuración
  // (mismo motivo que address en 1.8). phone2 sí se queda: es contacto interno.
  const keys = ['name','country','timezone','currency','checkIn','checkOut',
    'freeCancellation','depositRequired','depositPercent','weekendSurcharge',
    'ownerName','ownerTaxId','phone2',
    'cleaningType',
    'depositType','depositFixed','advanceType','advanceAmount','releaseHours','defaultPaymentMethod',
    'requestReviews','taxName','taxRate',
    'wifiNetwork','wifiPassword']
  for (const k of keys) {
    const v = saveField(k, (form.value as Record<string, unknown>)[k])
    // Los booleanos viajan como booleanos. Antes se mandaban como 0/1 y el schema del backend
    // exige `type: 'boolean'` estricto: como freeCancellation/depositRequired/requestReviews
    // siempre tienen default, TODO "Guardar" devolvía 400 y no se persistía
    // NINGÚN campo del hotel (validateSchema rechaza el body entero, no hace guardado parcial).
    // Verificado contra prod: {"freeCancellation":0} → 400; {"freeCancellation":false} → 200.
    // publishReviewScore/publishReviewComments NO van acá: los persiste la sección
    // "Página pública" (general.vue) — si los incluyéramos, saveAll pisaría el valor que
    // el admin editó ahí con el cargado al abrir Configuración.
    if (v !== undefined) (patch as Record<string, unknown>)[k] = v
  }
  // El slug, amenities (hotel-level), descriptionJson (título+descripción base ES),
  // descriptionTranslations y flags de reseñas públicas (publishReviewScore/Comments)
  // los persiste la sección "Página pública" (general.vue) con su propio botón
  // Guardar. Acá ya no se tocan.

  try {
    await SettingsService.patchHotel(patch)
  } catch (e) {
    // #34: antes el catch era bare y el toast decía solo "Error guardando: hotel" — el usuario
    // no sabía QUÉ campo corregir. El ApiError del http ya trae el detalle del backend
    // (campo rechazado por el schema, 403 de permisos, etc.).
    errors.push(`hotel — ${e instanceof Error ? e.message : 'error desconocido'}`)
  }

  try {
    await HotelService.saveAmenitiesHotel(selectedAmenities.value)
  } catch (e) {
    errors.push(`amenities — ${e instanceof Error ? e.message : 'error desconocido'}`)
  }

  saving.value = false
  if (errors.length) {
    toast.error(`Error guardando: ${errors.join(', ')}`)
  } else {
    markClean()   // la foto se renueva: lo guardado ya no cuenta como cambio pendiente
    toast.success('Configuración guardada')
  }
}

// El mapa de ubicación (composables/useHotelLocationMap.ts) ya NO se usa acá — Ubicación
// completa (dirección, mapa, coordenadas, provincia/municipio/CP) se mudó a Página pública
// (tarea 1.8, docs/wizard-refactor). Sigue viviendo en pagina-publica/ubicacion.vue.

// Temporadas y tarifas se mudaron a su propia página: pages/tarifas/index.vue (config/tarifas).
</script>
