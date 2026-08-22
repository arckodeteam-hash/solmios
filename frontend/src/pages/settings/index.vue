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
        <SectionCard title="Datos del hotel" subtitle="Identidad y clasificación que aparece en facturas, emails y OTAs">
          <div class="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label class="mb-2 block text-[11px] font-bold uppercase tracking-wide text-text-muted">Nombre *</label>
              <input v-model="form.name" type="text" class="w-full rounded-xl border px-4 py-2.5 text-sm focus:border-navy focus:outline-none" :class="fieldClass('name')" data-field="name" @blur="touchField('name')">
              <p v-if="errorOf('name')" class="mt-1 text-[10px] font-bold text-danger">{{ errorOf('name') }}</p>
            </div>
            <div>
              <label class="mb-2 block text-[11px] font-bold uppercase tracking-wide text-text-muted">Tipo de alojamiento</label>
              <select v-model="form.accommodationType" class="w-full rounded-xl border border-border px-4 py-2.5 text-sm focus:border-navy focus:outline-none cursor-pointer">
                <!-- value = enum del backend (ACCOMMODATION_TYPE_ENUM), label en español.
                     Antes había opciones inventadas (boutique, aparthotel, hostal, casa_rural,
                     camping) que el schema rechazaba: elegirlas hacía fallar el guardado entero. -->
                <option value="">Seleccionar</option>
                <option value="hotel">Hotel</option>
                <option value="apartment">Apartahotel / Apartamento</option>
                <option value="hostel">Hostal</option>
                <option value="villa">Villa / Casa</option>
                <option value="bnb">Bed &amp; Breakfast</option>
              </select>
            </div>
            <div>
              <label class="mb-2 block text-[11px] font-bold uppercase tracking-wide text-text-muted">Clasificación</label>
              <select v-model="form.starRating" class="w-full rounded-xl border border-border px-4 py-2.5 text-sm focus:border-navy focus:outline-none cursor-pointer">
                <option value="">N/A</option>
                <option value="1">1 Estrella</option>
                <option value="2">2 Estrellas</option>
                <option value="3">3 Estrellas</option>
                <option value="4">4 Estrellas</option>
                <option value="5">5 Estrellas</option>
              </select>
            </div>
          </div>
        </SectionCard>

        <SectionCard title="Logo del Hotel" subtitle="Identidad visual — se muestra en facturas, pre-checkin y emails">
          <div class="flex items-start gap-4">
            <div
              @dragover.prevent="logoDragging = true"
              @dragleave.prevent="logoDragging = false"
              @drop.prevent="onLogoDrop"
              @click="logoFileInput?.click()"
              class="relative w-28 h-28 rounded-xl border-2 border-dashed overflow-hidden bg-surface flex items-center justify-center shrink-0 cursor-pointer transition-colors"
              :class="logoDragging ? 'border-cyan bg-cyan/5' : 'border-border hover:border-navy/40'">
              <img v-if="form.logo" :src="form.logo" alt="Logo" class="w-full h-full object-contain" />
              <div v-else class="flex flex-col items-center gap-1 px-2 text-center pointer-events-none">
                <span class="w-5 h-5 text-navy/40" v-html="ICON_UPLOAD"></span>
                <span class="text-[9px] font-bold text-text-muted uppercase">Arrastrá o hacé clic</span>
              </div>
              <div v-if="logoUploading" class="absolute inset-0 bg-white/80 flex items-center justify-center">
                <span class="text-[10px] font-bold text-navy">Subiendo…</span>
              </div>
            </div>
            <input ref="logoFileInput" type="file" accept="image/*" class="hidden" @change="onLogoFileChange">
            <div class="flex-1">
              <label class="text-[10px] font-bold text-text-muted uppercase mb-1 block">URL del Logo</label>
              <input v-model="form.logo" type="url" placeholder="https://ejemplo.com/logo.png" class="w-full px-3 py-2 rounded-lg border text-sm" :class="fieldClass('logo')" data-field="logo" @blur="touchField('logo')">
              <p v-if="errorOf('logo')" class="mt-1 text-[10px] font-bold text-danger">{{ errorOf('logo') }}</p>
              <p class="text-[10px] text-text-muted mt-1">PNG o JPG, máximo 5MB — o pegá la URL de un logo que ya tengas alojado</p>
            </div>
          </div>
        </SectionCard>

        <SectionCard title="Contacto" subtitle="Datos visibles para huéspedes y en las comunicaciones automáticas">
          <div class="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label class="mb-2 block text-[11px] font-bold uppercase tracking-wide text-text-muted">Teléfono principal</label>
              <PhoneInput v-model="form.phone" :country="form.country" />
            </div>
            <div>
              <label class="mb-2 block text-[11px] font-bold uppercase tracking-wide text-text-muted">Teléfono 2</label>
              <PhoneInput v-model="form.phone2" :country="form.country" />
            </div>
            <div>
              <label class="mb-2 block text-[11px] font-bold uppercase tracking-wide text-text-muted">Email</label>
              <input v-model="form.email" type="email" class="w-full rounded-xl border px-4 py-2.5 text-sm focus:border-navy focus:outline-none" :class="fieldClass('email')" data-field="email" @blur="touchField('email')">
              <p v-if="errorOf('email')" class="mt-1 text-[10px] font-bold text-danger">{{ errorOf('email') }}</p>
            </div>
            <div>
              <label class="mb-2 block text-[11px] font-bold uppercase tracking-wide text-text-muted">Sitio web</label>
              <input v-model="form.website" type="url" placeholder="https://" class="w-full rounded-xl border px-4 py-2.5 text-sm focus:border-navy focus:outline-none" :class="fieldClass('website')" data-field="website" @blur="touchField('website')">
              <p v-if="errorOf('website')" class="mt-1 text-[10px] font-bold text-danger">{{ errorOf('website') }}</p>
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
              <label class="mb-2 block text-[11px] font-bold uppercase tracking-wide text-text-muted">Tipo de cambio</label>
              <input v-model.number="currencyConfig.exchangeRate" type="number" min="0" step="0.01"
                class="w-full rounded-xl border border-border px-4 py-2.5 text-sm font-bold text-navy text-right tabular-nums focus:border-navy focus:outline-none" />
            </div>
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

    <!-- ========== LOCATION (mapa de Google) ========== -->
    <div v-if="activeTab === 'location'" class="grid grid-cols-1 lg:grid-cols-3 gap-6">
      <div class="lg:col-span-2 space-y-6">
        <!-- País y Dirección viven en Ubicación (unificación UX): todo lo geográfico en esta
             pestaña, "Datos del hotel" queda solo identidad. Mismos v-model/validaciones que
             cuando vivían en la pestaña Hotel — solo cambió el lugar del template. -->
        <div class="rounded-[20px] border border-border bg-white shadow-(--shadow-card) p-6">
          <h3 class="font-extrabold text-navy mb-1">País y dirección</h3>
          <p class="text-[11px] text-text-muted mb-4">
            La dirección, junto a provincia, municipio y código postal, forma la dirección completa
            del hotel en facturas, emails, OTAs y la página pública. No mueve el pin: para eso usá
            el mapa o las coordenadas de abajo.
          </p>
          <div class="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label class="mb-2 block text-[11px] font-bold uppercase tracking-wide text-text-muted">País *</label>
              <SearchSelect v-model="form.country" :options="COUNTRIES" placeholder="Buscar país..." />
            </div>
            <div>
              <label class="mb-2 block text-[11px] font-bold uppercase tracking-wide text-text-muted">Dirección</label>
              <input v-model="form.address" type="text" class="w-full rounded-xl border px-4 py-2.5 text-sm focus:border-navy focus:outline-none" :class="fieldClass('address')" data-field="address" @blur="touchField('address')">
              <p v-if="errorOf('address')" class="mt-1 text-[10px] font-bold text-danger">{{ errorOf('address') }}</p>
            </div>
          </div>
        </div>
        <div class="rounded-[20px] border border-border bg-white shadow-(--shadow-card) p-6">
        <h3 class="font-extrabold text-navy mb-4">Mapa Interactivo</h3>
        <!-- Con API key: mapa interactivo (clic y arrastre). Sin key: iframe embed. -->
        <div v-show="mapsInteractive" ref="mapEl" class="w-full h-96 rounded-xl border border-border overflow-hidden"></div>
        <iframe v-if="!mapsInteractive" :src="googleMapsEmbedUrl" class="w-full h-96 rounded-xl border border-border"
          style="border:0" loading="lazy" referrerpolicy="no-referrer-when-downgrade"
          title="Ubicación del hotel en Google Maps"></iframe>
        <div class="mt-2 flex items-center justify-between gap-3">
          <p class="text-[11px] text-text-muted">
            <template v-if="mapsInteractive">Hacé clic en el mapa o arrastrá el pin para ajustar la ubicación.</template>
            <template v-else>Para mover el pin: pegá abajo el enlace de Google Maps del lugar, o escribí las coordenadas.</template>
          </p>
          <a :href="googleMapsLinkUrl" target="_blank" rel="noopener"
            class="shrink-0 text-[11px] font-bold text-teal hover:underline">Abrir en Google Maps</a>
        </div>
        </div>
      </div>
      <div class="space-y-4">
        <div class="rounded-[20px] border border-border bg-white shadow-(--shadow-card) p-6">
          <h3 class="font-extrabold text-navy mb-4">Coordenadas</h3>
          <div class="grid grid-cols-2 gap-3">
            <div>
              <label class="text-[10px] font-bold text-text-muted uppercase mb-1 block">Latitud</label>
              <input v-model.number="form.latitude" type="number" step="0.000001" @change="syncMarkerFromForm"
                class="w-full px-3 py-2 rounded-full border text-sm font-bold text-navy" :class="fieldClass('latitude')" data-field="latitude" @blur="touchField('latitude')">
              <p v-if="errorOf('latitude')" class="mt-1 text-[10px] font-bold text-danger">{{ errorOf('latitude') }}</p>
            </div>
            <div>
              <label class="text-[10px] font-bold text-text-muted uppercase mb-1 block">Longitud</label>
              <input v-model.number="form.longitude" type="number" step="0.000001" @change="syncMarkerFromForm"
                class="w-full px-3 py-2 rounded-full border text-sm font-bold text-navy" :class="fieldClass('longitude')" data-field="longitude" @blur="touchField('longitude')">
              <p v-if="errorOf('longitude')" class="mt-1 text-[10px] font-bold text-danger">{{ errorOf('longitude') }}</p>
            </div>
          </div>
          <div class="mt-3">
            <label class="text-[10px] font-bold text-text-muted uppercase mb-1 block">Pegar enlace de Google Maps</label>
            <input v-model="mapsPaste" @input="applyMapsPaste" type="text"
              placeholder="https://maps.google.com/… o 18.4861, -69.9312"
              class="w-full px-3 py-2 rounded-full border border-border text-sm">
            <p class="text-[10px] text-text-muted mt-1">
              En Google Maps, clic derecho sobre el punto → copiar coordenadas, y pegalas acá.
            </p>
          </div>
          <button @click="useMyLocation" class="mt-3 w-full text-xs font-bold text-teal hover:underline cursor-pointer">
            Usar mi ubicación actual
          </button>
        </div>
        <div class="rounded-[20px] border border-border bg-white shadow-(--shadow-card) p-6">
          <h3 class="font-extrabold text-navy mb-1">Provincia, Municipio y Código Postal</h3>
          <p class="text-[11px] text-text-muted mb-4">
            <template v-if="mapsInteractive">Se completan solos al mover el pin — revisalos y corregí si hace falta.</template>
            <template v-else>Sin mapa interactivo (falta la key de Google) se completan a mano.</template>
          </p>
          <div class="grid grid-cols-2 gap-3">
            <div>
              <label class="text-[10px] font-bold text-text-muted uppercase mb-1 block">Provincia</label>
              <input v-model="form.province" class="w-full px-3 py-2 rounded-full border text-sm" :class="fieldClass('province')" data-field="province" @blur="touchField('province')">
              <p v-if="errorOf('province')" class="mt-1 text-[10px] font-bold text-danger">{{ errorOf('province') }}</p>
            </div>
            <div>
              <label class="text-[10px] font-bold text-text-muted uppercase mb-1 block">Municipio</label>
              <input v-model="form.municipality" class="w-full px-3 py-2 rounded-full border text-sm" :class="fieldClass('municipality')" data-field="municipality" @blur="touchField('municipality')">
              <p v-if="errorOf('municipality')" class="mt-1 text-[10px] font-bold text-danger">{{ errorOf('municipality') }}</p>
            </div>
            <div>
              <label class="text-[10px] font-bold text-text-muted uppercase mb-1 block">Localidad</label>
              <input v-model="form.locality" class="w-full px-3 py-2 rounded-full border text-sm" :class="fieldClass('locality')" data-field="locality" @blur="touchField('locality')">
              <p v-if="errorOf('locality')" class="mt-1 text-[10px] font-bold text-danger">{{ errorOf('locality') }}</p>
            </div>
            <div>
              <label class="text-[10px] font-bold text-text-muted uppercase mb-1 block">Código Postal</label>
              <input v-model="form.postalCode" class="w-full px-3 py-2 rounded-full border text-sm" :class="fieldClass('postalCode')" data-field="postalCode" @blur="touchField('postalCode')">
              <p v-if="errorOf('postalCode')" class="mt-1 text-[10px] font-bold text-danger">{{ errorOf('postalCode') }}</p>
            </div>
          </div>
        </div>
      </div>
    </div>

    <!-- ========== AMENITIES ========== -->
    <div v-if="activeTab === 'amenities'" class="space-y-6">
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
      <div class="rounded-[20px] border border-border bg-white shadow-(--shadow-card) p-6">
        <h3 class="font-extrabold text-navy mb-4">Políticas de Reserva</h3>
        <div class="space-y-4">
          <div class="flex items-center justify-between p-3 bg-surface rounded-xl">
            <div>
              <div class="text-sm font-bold text-navy">Cancelación gratuita</div>
              <div class="text-[10px] text-text-muted">Hasta 24h antes del check-in · incompatible con No Reembolsable</div>
            </div>
            <label class="relative inline-flex items-center cursor-pointer">
              <input v-model="form.freeCancellation" type="checkbox" class="sr-only peer" data-field="freeCancellation">
              <div class="w-11 h-6 bg-gray-200 rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:absolute after:top-[2px] after:left-[2px] after:bg-white after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-teal"></div>
            </label>
          </div>
          <div>
            <label class="block text-[11px] font-bold text-navy uppercase tracking-wide mb-2">Política de Cancelación</label>
            <div class="grid grid-cols-2 gap-2">
              <label v-for="policy in cancelPolicies" :key="policy.key"
                class="flex items-start gap-2 p-3 rounded-xl cursor-pointer transition-colors"
                :class="form.cancellationType === policy.key ? 'bg-navy/5 border border-navy/20' : 'bg-surface border border-transparent'">
                <input v-model="form.cancellationType" type="radio" :value="policy.key" class="mt-0.5 w-4 h-4 text-cyan" data-field="cancellationType" />
                <div>
                  <div class="text-xs font-bold text-navy">{{ policy.label }}</div>
                  <div class="text-[10px] text-text-muted">{{ policy.desc }}</div>
                </div>
              </label>
            </div>
            <!-- #34 (REG-3): aviso ALCANZABLE para datos legacy contradictorios — los watchers
                 ya no auto-resuelven durante la carga, así que este estado sí se renderiza.
                 Si el usuario no lo resuelve, el guardado lo rechaza el backend con este motivo. -->
            <p v-if="form.freeCancellation && form.cancellationType === 'non_refundable'"
              class="mt-2 text-[10px] font-bold text-danger">
              "No Reembolsable" es incompatible con la cancelación gratuita: desactivá una de las dos antes de guardar.
            </p>
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
    </div>

    <!-- ========== DESCRIPTION ========== -->
    <!-- La "Descripción Multilingüe" (12 idiomas) que vivía acá se quitó: escribía la
         MISMA columna `descriptionJson` que ahora es {title, description} — el título+
         descripción base en español del landing público (spec public-hotel-info D7,
         ver pagina-publica/general.vue). Los dos usos chocaban en la misma columna y esta
         tab no estaba conectada a ningún consumidor real (ni Channex, ni OTAs pese al
         subtítulo) — deuda técnica resuelta priorizando la spec documentada. -->
    <div v-if="(activeTab as string) === 'description'" class="space-y-6">
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
    </div>

    <!-- ========== INTEGRACIONES ========== -->
    <div v-if="(activeTab as string) === 'integrations'" class="grid grid-cols-1 md:grid-cols-2 gap-6">
      <div class="rounded-[20px] border border-border bg-white shadow-(--shadow-card) p-6">
        <h3 class="font-extrabold text-navy mb-4">Channel Manager</h3>
        <div class="p-4 bg-surface rounded-xl">
          <div class="flex items-center justify-between mb-3">
            <div class="flex items-center gap-3">
              <span class="w-5 h-5 text-navy/50" v-html="ICON_GLOBE"></span>
              <div><div class="text-sm font-bold text-navy">Channel Manager</div><div class="text-[10px] text-text-muted">Sincronización con OTAs</div></div>
            </div>
            <span class="text-[10px] font-bold px-2 py-1 rounded-full bg-teal/10 text-teal">Conectado</span>
          </div>
          <router-link to="/panel/channel-manager" class="block w-full text-center px-4 py-2 bg-navy/10 text-navy rounded-full text-sm font-bold hover:bg-navy/20 transition-colors cursor-pointer">Gestionar Canales</router-link>
        </div>
      </div>

      <div class="rounded-[20px] border border-border bg-white shadow-(--shadow-card) p-6">
        <h3 class="font-extrabold text-navy mb-4">Pasarela de Pagos</h3>
        <!-- Las pasarelas se configuran en /panel/config/pasarelas: acá había una segunda fuente de verdad
             (configuration.stripe_config, sin cifrar) que solo la usaba uno de los tres flujos de cobro. -->
        <div class="p-4 bg-surface rounded-xl">
          <div class="flex items-center justify-between mb-3">
            <div class="flex items-center gap-3">
              <span class="w-5 h-5 text-navy/50" v-html="ICON_CARD"></span>
              <div><div class="text-sm font-bold text-navy">Pasarelas de Pago</div><div class="text-[10px] text-text-muted">Stripe, Azul, CardNet, PayPal</div></div>
            </div>
          </div>
          <p class="text-[11px] text-text-secondary mb-3 leading-relaxed">
            Conectá la cuenta donde querés recibir el dinero de tus reservas. Las llaves se guardan cifradas.
          </p>
          <router-link to="/panel/config/pasarelas" class="block text-center w-full px-4 py-2 bg-navy text-white rounded-full text-sm font-bold hover:shadow-lg cursor-pointer">
            Configurar pasarelas
          </router-link>
        </div>
      </div>

      <div class="rounded-[20px] border border-border bg-white shadow-(--shadow-card) p-6">
        <h3 class="font-extrabold text-navy mb-4">WhatsApp Business</h3>
        <div class="p-4 bg-surface rounded-xl">
          <div class="flex items-center justify-between mb-3">
            <div class="flex items-center gap-3">
              <span class="w-5 h-5 text-navy/50" v-html="ICON_MESSAGE"></span>
              <div><div class="text-sm font-bold text-navy">WhatsApp</div><div class="text-[10px] text-text-muted">Mensajes automatizados</div></div>
            </div>
            <span class="text-[10px] font-bold px-2 py-1 rounded-full bg-gold/10 text-gold">No configurado</span>
          </div>
          <p class="text-xs text-text-muted">Requiere cuenta de Meta Business.</p>
        </div>
      </div>

      <div class="rounded-[20px] border border-border bg-white shadow-(--shadow-card) p-6">
        <div class="flex items-center justify-between mb-4">
          <h3 class="font-extrabold text-navy">Facturación Electrónica</h3>
          <span class="text-[10px] font-bold px-2 py-1 rounded-full"
            :class="fiscalConfig.enabled ? 'bg-teal/10 text-teal' : 'bg-surface text-text-muted'">
            {{ fiscalConfig.enabled ? 'Numeración activa' : 'Desactivada' }}
          </span>
        </div>
        <div class="p-4 bg-surface rounded-xl space-y-3">
          <div class="flex items-center gap-3">
            <span class="w-5 h-5 text-navy/50 shrink-0" v-html="ICON_RECEIPT"></span>
            <div class="min-w-0">
              <div class="text-sm font-bold text-navy">NCF (Comprobante Fiscal)</div>
              <div class="text-[10px] text-text-muted">Numera cada factura correlativamente según la autoridad fiscal de tu país</div>
            </div>
          </div>
          <div class="flex items-center justify-between p-3 bg-white rounded-xl">
            <div class="text-sm font-bold text-navy">Activar numeración fiscal</div>
            <label class="relative inline-flex items-center cursor-pointer">
              <input v-model="fiscalConfig.enabled" type="checkbox" class="sr-only peer">
              <div class="w-11 h-6 bg-gray-200 rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:absolute after:top-[2px] after:left-[2px] after:bg-white after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-teal"></div>
            </label>
          </div>
          <div v-if="fiscalConfig.enabled" class="grid grid-cols-2 gap-3">
            <div>
              <label class="text-[10px] font-bold text-text-muted uppercase mb-1 block">Autoridad</label>
              <select v-model="fiscalConfig.authority" class="w-full px-3 py-2 rounded-full border border-border text-sm cursor-pointer">
                <option value="DGII">DGII (Rep. Dominicana)</option>
                <option value="DIAN">DIAN (Colombia)</option>
                <option value="SAT">SAT (México)</option>
                <option value="SUNAT">SUNAT (Perú)</option>
                <option value="SII">SII (Chile)</option>
                <option value="AFIP">AFIP (Argentina)</option>
                <option value="none">Otra / Manual</option>
              </select>
            </div>
            <div>
              <label class="text-[10px] font-bold text-text-muted uppercase mb-1 block">Serie</label>
              <input v-model="fiscalConfig.serie" placeholder="E31" class="w-full px-3 py-2 rounded-full border border-border text-sm">
            </div>
          </div>
          <p v-if="fiscalConfig.enabled" class="text-[10px] text-text-muted">
            Próximo NCF: {{ nextNcfPreview }}. El envío a {{ fiscalConfig.authority === 'none' ? 'la autoridad' : fiscalConfig.authority }} requiere credenciales del país — todavía no está conectado, así que el NCF queda local por ahora.
          </p>
          <button @click="saveFiscalConfig" :disabled="fiscalSaving"
            class="w-full px-4 py-2 bg-navy text-white rounded-full text-sm font-bold hover:shadow-lg transition-all cursor-pointer disabled:opacity-50">
            {{ fiscalSaving ? 'Guardando...' : 'Guardar' }}
          </button>
        </div>
      </div>

      <!-- Políticas para factura (cancelación y reembolso) -->
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

    <!-- RRHH — Días laborables (feedback #602) -->
    <div v-if="(activeTab as string) === 'hr'" class="space-y-6">
      <SectionCard title="Días laborables"
        subtitle="Define qué días de la semana cuenta el sistema al calcular ausencias y vacaciones. Por defecto todos los días (un hotel opera fines de semana).">
        <template #actions>
          <button @click="saveWorkingDays" :disabled="workingDaysSaving"
            class="rounded-full bg-cyan px-4 py-2 text-xs font-bold text-navy transition-all hover:shadow-lg cursor-pointer disabled:opacity-50">
            {{ workingDaysSaving ? 'Guardando…' : 'Guardar días laborables' }}
          </button>
        </template>
        <div class="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-7 gap-3">
          <label v-for="day in WEEKDAYS" :key="day.value"
            class="flex flex-col items-center gap-2 rounded-xl bg-surface p-3 cursor-pointer transition-all"
            :class="workingDaysDraft.includes(day.value) ? 'ring-2 ring-cyan bg-cyan/5' : 'opacity-60 hover:opacity-100'">
            <input type="checkbox" :value="day.value" v-model="workingDaysDraft"
              class="h-5 w-5 rounded text-cyan cursor-pointer" />
            <span class="text-xs font-bold text-navy">{{ day.label }}</span>
          </label>
        </div>
        <p class="mt-3 text-[11px] text-text-muted leading-relaxed">
          Los días desmarcados se descuentan automáticamente al crear una solicitud de ausencia.
          Los días festivos configurados en Time Off siempre se descuentan, independientemente de esta selección.
        </p>
      </SectionCard>
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
import { useRoute, onBeforeRouteLeave } from 'vue-router'
import SectionCard from '@/components/ui/SectionCard.vue'
import SearchSelect from '@/components/ui/SearchSelect.vue'
import PhoneInput from '@/components/ui/PhoneInput.vue'
import { COUNTRIES, countryName } from '@/data/locales'
import { TIMEZONES, CURRENCIES } from '@/data/intl-catalogs'
import { CurrencyCode } from '@/types/currency'
import { PRESET_OPTIONS } from '@/types/cancellation'
import { parseLatLng } from '@/composables/useLatLngParse'
import { loadGoogleMaps } from '@/composables/useGoogleMaps'
import {
  mapAddressComponents, unresolvedFields, geocodeErrorMessage,
  reverseGeocodeNominatim,
  ADDRESS_FIELD_LABELS, type AddressField,
} from '@/utils/address-components'
import { validateField, validateAll, warnOnUnsavedChanges, HOTEL_RULES } from '@/composables/useFieldValidation'
import { HotelService } from '@/services/Hotel.service'
import { SettingsService, type HotelFull } from '@/services/Settings.service'
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
const ICON_GLOBE = '<svg viewBox="0 0 24 24" class="w-full h-full" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><path d="M12 2a14.5 14.5 0 0 0 0 20 14.5 14.5 0 0 0 0-20"/><path d="M2 12h20"/></svg>'
const ICON_CARD = '<svg viewBox="0 0 24 24" class="w-full h-full" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect width="20" height="14" x="2" y="5" rx="2"/><line x1="2" x2="22" y1="10" y2="10"/></svg>'
const ICON_MESSAGE = '<svg viewBox="0 0 24 24" class="w-full h-full" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M7.9 20A9 9 0 1 0 4 16.1L2 22Z"/></svg>'
const ICON_RECEIPT = '<svg viewBox="0 0 24 24" class="w-full h-full" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 2v20l2-1 2 1 2-1 2 1 2-1 2 1 2-1 2 1V2l-2 1-2-1-2 1-2-1-2 1-2-1-2 1Z"/><path d="M8 7h8"/><path d="M8 11h8"/><path d="M8 15h5"/></svg>'
const ICON_UPLOAD = '<svg viewBox="0 0 24 24" class="w-full h-full" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><path d="M17 8l-5-5-5 5"/><path d="M12 3v12"/></svg>'

const auth = useAuthStore()
const toast = useToast()
const { confirmModal, confirmBusy, askConfirm, runConfirm } = useConfirm()
const hotelId = computed(() => (auth.user?.hotelId && auth.user.hotelId !== 'platform' ? auth.user.hotelId : undefined))

// Stripe se configura en /panel/config/pasarelas (tabla payment_gateways, cifrada y por hotel).
// El bloque anterior leía configuration['stripe_config'] y traía la secretKey EN CLARO al
// navegador: el endpoint genérico de configuración devuelve el JSON entero, secretos incluidos.

// Conversión de moneda secundaria (F3 match-misterplan — totales convertidos en el detalle de reserva)
const currencyConfig = reactive<{ secondaryCurrency: string; exchangeRate: number }>({ secondaryCurrency: CurrencyCode.DOP, exchangeRate: 60 })
const currencySaving = ref(false)
async function loadCurrency() {
  try {
    const c = await ConfigService.get('currency_config') as { secondaryCurrency?: string; exchangeRate?: number } | null
    if (c) { currencyConfig.secondaryCurrency = c.secondaryCurrency || 'DOP'; currencyConfig.exchangeRate = c.exchangeRate ?? 60 }
  } catch { /* default */ }
}
// Logo del hotel — arrastrar/soltar o elegir archivo, con preview. Sube de una (endpoint dedicado,
// data URL base64) en vez de esperar al "Guardar" general: mismo patrón que el avatar de usuario.
const logoFileInput = ref<HTMLInputElement | null>(null)
const logoDragging = ref(false)
const logoUploading = ref(false)
const LOGO_MAX_BYTES = 5 * 1024 * 1024

function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result))
    reader.onerror = () => reject(new Error('No se pudo leer el archivo'))
    reader.readAsDataURL(file)
  })
}

async function uploadLogoFile(file: File) {
  if (!file.type.startsWith('image/')) { toast.error('Solo se permiten imágenes'); return }
  if (file.size > LOGO_MAX_BYTES) { toast.error('Máximo 5MB'); return }
  logoUploading.value = true
  try {
    const dataUrl = await readFileAsDataUrl(file)
    const result = await HotelService.uploadLogo(dataUrl, file.name)
    form.value.logo = result.logo
    markLogoClean()
    toast.success('Logo actualizado')
  } catch (e) {
    toast.error((e as Error).message || 'No se pudo subir el logo')
  } finally {
    logoUploading.value = false
  }
}

function onLogoFileChange(e: Event) {
  const input = e.target as HTMLInputElement
  const file = input.files?.[0]
  input.value = ''   // permite volver a elegir el mismo archivo si el usuario se arrepiente y reintenta
  if (file) uploadLogoFile(file)
}

function onLogoDrop(e: DragEvent) {
  logoDragging.value = false
  const file = e.dataTransfer?.files?.[0]
  if (file) uploadLogoFile(file)
}

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
    await ConfigService.set('currency_config', { secondaryCurrency: currencyConfig.secondaryCurrency, exchangeRate: Number(currencyConfig.exchangeRate) || 0 })
    toast.success('Conversión de moneda guardada')
  } catch (e) {
    toast.error((e as Error).message || 'No se pudo guardar')
  } finally {
    currencySaving.value = false
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

// Facturación electrónica / NCF (configuration['electronic_invoicing']) — antes esta tab solo
// mostraba una card informativa sin ningún campo: no existía forma de setear `enabled`, así que
// nextNcf() (fiscal.ts) siempre devolvía null aunque la UI insinuara "NCF automático".
const fiscalConfig = reactive({ enabled: false, serie: 'E31', authority: 'DGII', sequence: 0 })
const fiscalSaving = ref(false)
async function loadFiscalConfig() {
  try {
    const c = await ConfigService.get('electronic_invoicing') as
      { enabled?: boolean; serie?: string; authority?: string; sequence?: number } | null
    if (c) {
      fiscalConfig.enabled = !!c.enabled
      fiscalConfig.serie = c.serie || 'E31'
      fiscalConfig.authority = c.authority || 'DGII'
      fiscalConfig.sequence = c.sequence ?? 0
    }
  } catch { /* default: desactivado */ }
}
// Mismo formato que buildNcf() en fiscal.ts — preview, la numeración real la arma el backend.
const nextNcfPreview = computed(() => {
  const seq = String((fiscalConfig.sequence || 0) + 1).padStart(11, '0')
  const serie = fiscalConfig.serie || 'E31'
  const auth = fiscalConfig.authority || 'MANUAL'
  return `${serie}${auth === 'DGII' ? '' : '-'}${seq}`.replace('--', '-')
})
async function saveFiscalConfig() {
  fiscalSaving.value = true
  try {
    await ConfigService.set('electronic_invoicing', {
      enabled: fiscalConfig.enabled, serie: fiscalConfig.serie.trim() || 'E31',
      authority: fiscalConfig.authority, sequence: fiscalConfig.sequence,
    })
    await nextTick()
    markClean()
    toast.success('Facturación electrónica guardada')
  } catch (e) {
    toast.error((e as Error).message || 'No se pudo guardar')
  } finally {
    fiscalSaving.value = false
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

// Días laborables del hotel (feedback #602). Define qué días de la semana se cuentan al
// calcular ausencias/vacaciones. Default: todos marcados (un hotel opera fines de semana).
// Se persisten como array [0..6] en configuration('leave_working_days'), convenio getUTCDay: 0=Dom..6=Sáb.
const WEEKDAYS = [
  { value: 0, label: 'Domingo' },
  { value: 1, label: 'Lunes' },
  { value: 2, label: 'Martes' },
  { value: 3, label: 'Miércoles' },
  { value: 4, label: 'Jueves' },
  { value: 5, label: 'Viernes' },
  { value: 6, label: 'Sábado' },
]
const workingDaysDraft = ref<number[]>([0, 1, 2, 3, 4, 5, 6])
const workingDaysSaving = ref(false)
async function loadWorkingDays() {
  try {
    const c = await ConfigService.get('leave_working_days') as number[] | null
    if (Array.isArray(c) && c.length) {
      workingDaysDraft.value = c.filter((d) => typeof d === 'number' && d >= 0 && d <= 6)
    }
  } catch { /* default: todos los días */ }
}
async function saveWorkingDays() {
  if (workingDaysDraft.value.length === 0) {
    toast.error('Debe seleccionar al menos un día laborable')
    return
  }
  workingDaysSaving.value = true
  try {
    await ConfigService.set('leave_working_days', [...workingDaysDraft.value].sort())
    await nextTick()
    markClean()
    toast.success('Días laborables guardados')
  } catch (e) {
    toast.error((e as Error).message || 'No se pudo guardar')
  } finally {
    workingDaysSaving.value = false
  }
}

const activeTab = ref('hotel' as string)
// Deep-link ?tab=... (el botón de Emergencia del header entra directo a su pestaña)
const route = useRoute()
onMounted(() => {
  const t = route.query.tab
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
      { value: 'location', label: 'Ubicación' },
      { value: 'description', label: 'Descripción' },
      { value: 'conditions', label: 'Condiciones' },
      { value: 'emergency', label: 'Emergencias' },
      { value: 'hr', label: 'RRHH' },
    ],
  },
  {
    label: 'Configuraciones e integraciones',
    tabs: [
      // Página pública / Landing / Reputación externa / Tracking se mudaron a su propia
      // sección del menú lateral (Página pública). Acá queda solo config operativa.
      { value: 'amenities', label: 'Amenities' },
      { value: 'integrations', label: 'Integraciones' },
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
  name: 'hotel', phone: 'hotel', phone2: 'hotel',
  email: 'hotel', website: 'hotel', timezone: 'hotel', currency: 'hotel',
  checkIn: 'hotel', checkOut: 'hotel', ownerName: 'hotel', ownerTaxId: 'hotel', logo: 'hotel',
  // País y Dirección se mudaron a Ubicación: si el guardado falla por ellos, el salto
  // automático al error tiene que aterrizar en la pestaña donde ahora viven.
  country: 'location', address: 'location',
  province: 'location', municipality: 'location', locality: 'location',
  postalCode: 'location', latitude: 'location', longitude: 'location',
  wifiNetwork: 'description', wifiPassword: 'description',
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
    form: form.value,
    selectedAmenities: selectedAmenities.value, emergencyContacts: emergencyContacts.value,
    currencyConfig, guaranteePinDraft: guaranteePinDraft.value, automation, fiscalConfig,
    // Slug, amenities hotel-level, traducciones públicas y flags de reseñas públicas
    // se gestionan y persisten desde la sección "Página pública" del menú.
  })
}
function markClean() {
  savedSnapshot.value = snapshot()
}

/**
 * El logo se sube y persiste SOLO (endpoint dedicado, no pasa por saveAll): un `markClean()` común
 * marcaría como "guardado" cualquier otro campo del form que el usuario haya tocado sin apretar el
 * botón "Guardar" general — perdería ese aviso sin haber guardado nada de eso en realidad. Acá se
 * actualiza únicamente `form.logo` dentro de la foto base, dejando el resto del diff intacto.
 */
function markLogoClean() {
  if (!savedSnapshot.value) return
  try {
    const baseline = JSON.parse(savedSnapshot.value)
    baseline.form = { ...(baseline.form ?? {}), logo: form.value.logo }
    savedSnapshot.value = JSON.stringify(baseline)
  } catch { /* snapshot no parseable: no debería pasar, no rompe nada dejarlo como estaba */ }
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
const cancelPolicies = PRESET_OPTIONS

// #34: "Cancelación gratuita" y la política "No Reembolsable" son mutuamente excluyentes.
// Antes la UI permitía dejar ambas activas y el guardado reventaba con un toast genérico
// ("Error guardando: hotel") que no decía qué corregir. Ahora la selección se auto-resuelve:
// elegir No Reembolsable apaga el toggle; reactivar el toggle con No Reembolsable activa
// vuelve a Flexible. Los dos watchers no pueden loopear entre sí (cada uno solo escribe
// el campo que el otro NO observa).
//
// COR-3/REG-3: los watchers NO corren durante la hidratación. Antes, un hotel legacy con
// datos contradictorios (freeCancellation=true + non_refundable) se auto-flippeaba al
// ABRIR Configuración — mutación silenciosa de un dato persistido, sin que el usuario
// tocara nada, y el aviso de conflicto del template quedaba inalcanzable (los watchers
// resolvían el estado antes del primer render). Con el flag, el dato legacy llega intacto,
// el aviso se muestra, y la auto-resolución sólo ocurre si el usuario INTERACTÚA. Si
// guarda sin tocar, el backend rechaza (hoteles-queries.assertCancellationCompatible).
const conditionsHydrated = ref(false)
watch(() => form.value.cancellationType, (type) => {
  if (!conditionsHydrated.value) return
  if (type === 'non_refundable' && form.value.freeCancellation) form.value.freeCancellation = false
})
watch(() => form.value.freeCancellation, (on) => {
  if (!conditionsHydrated.value) return
  if (on && form.value.cancellationType === 'non_refundable') form.value.cancellationType = 'flexible'
})

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
    // INT-3: los watchers de #34 son flush 'pre' (diferidos al scheduler), NO corren
    // sincrónico con la asignación de arriba. Si el flag se setea acá mismo, cuando los
    // callbacks corren (microtask posterior) ya ven true y el guard es INERTE: el dato
    // legacy contradictorio se auto-flippea igual que antes. El flag se enciende en el
    // nextTick DESPUÉS de la hidratación: para entonces los watchers diferidos ya corrieron
    // (y fueron bloqueados por el flag en false), así que el dato contradictorio llega
    // intacto al render y el aviso del template es alcanzable. La auto-resolución sólo
    // ocurre si el usuario INTERACTÚA después de la carga.
    await nextTick()
    conditionsHydrated.value = true

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
    await loadFiscalConfig()
    await loadInvoicePolicy()
    await loadWorkingDays()
  } catch (e) {
    toast.error('Error al cargar datos')
  } finally {
    // COR-4: la tarjeta "Plan" NO puede depender de que los siete loaders de arriba hayan salido
    // bien. Cuando `loadPlan()` era el último `await` del `try`, cualquier fallo previo (amenities,
    // moneda, PIN, automatización, fiscal, política de facturas, días hábiles) lo salteaba,
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
  touchedFields.value = new Set(Object.keys(HOTEL_RULES))
  fieldErrors.value = validateAll(form.value as Record<string, unknown>, HOTEL_RULES)
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
  const keys = ['name','country','address','phone','email','timezone','currency','checkIn','checkOut',
    'freeCancellation','depositRequired','depositPercent','weekendSurcharge',
    'accommodationType','starRating','ownerName','ownerTaxId','phone2','website',
    'province','municipality','locality','postalCode','latitude','longitude',
    'cancellationType','cleaningType',
    'depositType','depositFixed','advanceType','advanceAmount','releaseHours','defaultPaymentMethod',
    'requestReviews','taxName','taxRate',
    'wifiNetwork','wifiPassword','logo']
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

// ════════════════════════════════════════════════════════════════════════════
// Mapa de ubicación (Google Maps embed)
// ════════════════════════════════════════════════════════════════════════════
// Google Maps por iframe embed (`output=embed`): no requiere API key ni facturación.
//
// Contrapartida asumida: un iframe es de otro origen, así que NO puede avisarnos dónde hizo clic
// el usuario — se pierden el marcador arrastrable y el clic-para-fijar que tenía Leaflet. Para
// compensar, la posición se fija por tres vías sin salir de la pantalla: pegar el enlace/coordenadas
// de Google Maps, escribir lat/long a mano, o "usar mi ubicación".
//
// Si algún día se carga una Maps JavaScript API key, conviene volver al mapa interactivo real:
// ahí sí se recupera el clic sobre el mapa.

/** Centro por defecto cuando el hotel todavía no tiene coordenadas. */
const DEFAULT_LAT = 18.4861
const DEFAULT_LNG = -69.9312

const mapLat = computed(() => Number(form.value.latitude) || DEFAULT_LAT)
const mapLng = computed(() => Number(form.value.longitude) || DEFAULT_LNG)

const googleMapsEmbedUrl = computed(
  () => `https://www.google.com/maps?q=${mapLat.value},${mapLng.value}&z=16&output=embed`,
)
const googleMapsLinkUrl = computed(
  () => `https://www.google.com/maps/search/?api=1&query=${mapLat.value},${mapLng.value}`,
)

const mapsPaste = ref('')

function applyMapsPaste() {
  const parsed = parseLatLng(mapsPaste.value)
  if (!parsed) return          // se escribe de a poco: no molestar hasta que haya un par válido
  form.value.latitude = parsed.lat
  form.value.longitude = parsed.lng
  mapsPaste.value = ''
  syncMarkerFromForm()
  toast.success('Ubicación actualizada desde Google Maps')
  reverseGeocode(parsed.lat, parsed.lng)
}

// ─── Mapa interactivo (sólo si hay API key configurada en Admin → Integraciones) ─────
const mapEl = ref<HTMLElement | null>(null)
const mapsInteractive = ref(false)
let gmap: google.maps.Map | null = null
let gmarker: google.maps.Marker | null = null
let geocoder: google.maps.Geocoder | null = null

function setCoords(lat: number, lng: number) {
  form.value.latitude = Number(lat.toFixed(6))
  form.value.longitude = Number(lng.toFixed(6))
}

/**
 * Último valor que el autocompletado escribió en cada campo. Sirve para NO pisar lo que el usuario
 * tipeó a mano: solo se sobrescribe un campo vacío o uno cuyo contenido lo puso el geocoding
 * anterior. Si el usuario corrigió "Municipio" y después mueve el pin, su corrección se respeta.
 */
const geocodedValues = ref<Partial<Record<AddressField, string>>>({})

/** Descarta respuestas viejas: si el usuario arrastra el pin dos veces seguidas, la primera
 *  respuesta puede llegar después de la segunda y dejaría una dirección que no corresponde. */
let geocodeSeq = 0

/**
 * Reverse geocoding: dado un punto, pregunta qué dirección hay ahí y completa
 * Provincia/Municipio/Localidad/Código Postal.
 *
 * GH-33 — cadena de proveedores Google → Nominatim (OpenStreetMap):
 *
 *  1. La "Geocoding API" es un producto SEPARADO de la "Maps JavaScript API" en Google Cloud:
 *     la key que dibuja el mapa NO habilita el geocoding, y la request vuelve `REQUEST_DENIED`.
 *     Ese es el escenario reportado: el mapa interactivo funciona, el pin se mueve, lat/lng se
 *     actualizan… y los cuatro campos quedaban vacíos (en `main` además con un catch mudo, sin
 *     ningún mensaje). Por eso NINGUNA falla de Google termina el flujo: cae a Nominatim
 *     (gratis, sin key) antes de rendirse.
 *  2. Sin key de Google directamente no hay SDK ni Geocoder: mismo fallback de Nominatim para
 *     las otras vías de coordenadas (pegar enlace de Maps, "usar mi ubicación").
 *  3. Si los DOS proveedores fallan, recién ahí el aviso visible (`geocodeErrorMessage`) —
 *     nunca silencio, nunca bloquea: los campos siguen editables a mano.
 *
 * El mapeo de componentes vive en `utils/address-components.ts` (con sus cadenas de fallback,
 * porque el esquema de Google no calza 1:1 con ninguna división administrativa nacional).
 * Es MEJOR ESFUERZO y los campos siguen siendo editables.
 */
async function reverseGeocode(lat: number, lng: number) {
  const seq = ++geocodeSeq
  const maps = await loadGoogleMaps()

  // 1) Google Geocoding (si hay SDK cargado).
  if (maps) {
    try {
      geocoder ??= new maps.Geocoder()
      const { results } = await geocoder.geocode({ location: { lat, lng } })
      if (seq !== geocodeSeq) return       // llegó tarde: el pin ya está en otro lado
      const result = results?.[0]
      if (!result) throw new Error('ZERO_RESULTS')

      const mapped = mapAddressComponents(result.address_components)
      if (unresolvedFields(mapped).length === Object.keys(ADDRESS_FIELD_LABELS).length) {
        // Google respondió, pero sin NINGÚN componente aprovechable para estos cuatro campos.
        // Antes de rendirse, probar el fallback: a veces OSM tiene lo que Google no trae.
        throw new Error('ZERO_RESULTS')
      }
      applyGeocodedValues(mapped, 'Google')
      return
    } catch {
      if (seq !== geocodeSeq) return       // respuesta vieja: ni fallback ni aviso
      // Google caído (REQUEST_DENIED, librería sin cargar, red): sigue al fallback.
    }
  }

  // 2) Nominatim (OpenStreetMap): gratis, sin API key. Se llama UNA vez por dragend/click/
  //    pegado (no por frame), así el rate limit del proveedor (1 req/s) no se satura arrastrando.
  try {
    const mapped = await reverseGeocodeNominatim(lat, lng)
    if (seq !== geocodeSeq) return
    applyGeocodedValues(mapped, 'OpenStreetMap')
  } catch (err) {
    if (seq !== geocodeSeq) return
    // Nada de silencio: el usuario tiene que saber por qué los campos siguen vacíos y qué hacer.
    const { variant, title, detail } = geocodeErrorMessage(err)
    if (variant === 'warning') toast.warning(title, detail)
    else toast.error(title, detail)
  }
}

/**
 * Aplica los valores geocodificados (de Google o Nominatim) a los campos del formulario.
 * Respeta lo que el usuario escribió a mano: solo pisa campos vacíos o los que puso
 * el propio autocompletado previo.
 */
function applyGeocodedValues(mapped: { province: string; municipality: string; locality: string; postalCode: string }, source: string) {
  const pending = unresolvedFields(mapped)
  const kept: string[] = []

  for (const field of Object.keys(ADDRESS_FIELD_LABELS) as AddressField[]) {
    const value = mapped[field]
    if (!value) continue
    const current = String(form.value[field] ?? '').trim()
    // Solo se pisa lo vacío o lo que puso el propio autocompletado.
    if (current && current !== (geocodedValues.value[field] ?? '')) {
      kept.push(ADDRESS_FIELD_LABELS[field])
      continue
    }
    form.value[field] = value
    geocodedValues.value[field] = value
  }

  if (pending.length === Object.keys(ADDRESS_FIELD_LABELS).length) {
    toast.warning(
      `${source} no devolvió datos de dirección para ese punto`,
      'Completá Provincia, Municipio, Localidad y Código Postal a mano.',
    )
    return
  }

  const notas = [
    pending.length ? `${source} no devolvió: ${pending.map((f) => ADDRESS_FIELD_LABELS[f]).join(', ')}.` : '',
    kept.length ? `Se respetó lo que escribiste en: ${kept.join(', ')}.` : '',
  ].filter(Boolean).join(' ')

  if (pending.length) {
    toast.warning('Dirección completada parcialmente', `${notas} Revisá y completá a mano.`)
  } else {
    toast.success('Dirección completada automáticamente', notas || 'Revisá los campos antes de guardar.')
  }
}

async function initInteractiveMap() {
  if (gmap || !mapEl.value) return
  const maps = await loadGoogleMaps()
  if (!maps) return                      // sin key o key inválida → queda el iframe
  mapsInteractive.value = true
  await nextTick()                       // el div estaba en v-show: necesita estar medido
  const center = { lat: mapLat.value, lng: mapLng.value }
  gmap = new maps.Map(mapEl.value, { center, zoom: 16, mapTypeControl: true, streetViewControl: false })
  gmarker = new maps.Marker({ position: center, map: gmap, draggable: true })
  gmarker.addListener('dragend', () => {
    const p = gmarker!.getPosition()
    if (p) {
      setCoords(p.lat(), p.lng())
      reverseGeocode(p.lat(), p.lng())
    }
  })
  gmap.addListener('click', (e: google.maps.MapMouseEvent) => {
    if (!e.latLng) return
    setCoords(e.latLng.lat(), e.latLng.lng())
    gmarker!.setPosition(e.latLng)
    reverseGeocode(e.latLng.lat(), e.latLng.lng())
  })
}

/** Recentra el mapa cuando las coordenadas cambian por otra vía (pegar enlace, geolocalización). */
function syncMarkerFromForm() {
  if (!gmap || !gmarker) return
  const pos = { lat: mapLat.value, lng: mapLng.value }
  gmarker.setPosition(pos)
  gmap.setCenter(pos)
}

// El mapa se crea al entrar a la pestaña: antes el contenedor no tiene tamaño y Google lo
// renderiza en gris.
watch(activeTab, async (val) => {
  if (val === 'location') {
    await nextTick()
    await initInteractiveMap()
  }
})

function useMyLocation() {
  if (!navigator.geolocation) {
    toast.error('Geolocalización no disponible')
    return
  }
  navigator.geolocation.getCurrentPosition(
    (pos) => {
      form.value.latitude = pos.coords.latitude
      form.value.longitude = pos.coords.longitude
      syncMarkerFromForm()
      toast.success('Ubicación actualizada')
      reverseGeocode(pos.coords.latitude, pos.coords.longitude)
    },
    () => toast.error('No se pudo obtener tu ubicación'),
  )
}

// Temporadas y tarifas se mudaron a su propia página: pages/tarifas/index.vue (config/tarifas).
</script>
