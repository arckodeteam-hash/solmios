<template>
  <Teleport to="body">
    <Transition name="modal-fade">
      <div class="fixed inset-0 z-50 flex items-center justify-center p-2 sm:p-4">
        <div class="absolute inset-0 bg-navy/40 backdrop-blur-sm"></div>
        <div class="modal-panel relative bg-white rounded-[20px] border-2 border-navy shadow-2xl w-full max-w-5xl max-h-[95vh] sm:max-h-[92vh] overflow-hidden flex flex-col">

          <!-- Header -->
          <div class="p-5 border-b border-border shrink-0 bg-gradient-to-r from-navy to-navy/90">
            <div class="flex items-center justify-between mb-4">
              <div class="flex items-center gap-3 min-w-0">
                <h3 class="text-lg font-black text-white leading-tight truncate" data-testid="wizard-title">{{ isEdit ? 'Editar' : 'Nueva' }} Reserva</h3>
                <div class="hidden md:flex gap-1.5">
                  <!-- Solo los estados que SÍ son un cambio de estado. 'checked_in' y 'cancelled'
                       mueven cosas reales (folio y habitación uno; penalidad, reembolso y depósito
                       el otro) y viven en POST /checkin y en el modal de cancelación. Acá eran
                       botones muertos: el servidor los rechaza y se perdía el resto de la edición. -->
                  <button v-for="s in ['confirmed','pending']" :key="s" @click="form.status=s"
                    class="px-2.5 py-1 rounded-full text-[10px] font-bold border cursor-pointer transition-all"
                    :class="form.status===s ? stBtnActive(s) : 'border-white/20 text-white/60 hover:text-white'">
                    {{ stLabel(s) }}
                  </button>
                </div>
              </div>
              <button @click="emit('close')" class="w-8 h-8 rounded-lg bg-white/10 flex items-center justify-center text-white cursor-pointer hover:bg-white/20 shrink-0">
                <span class="w-4 h-4 block" v-html="ICON_X"></span>
              </button>
            </div>
            <!-- Wizard progress -->
            <div class="flex items-center justify-between mb-2">
              <span class="text-xs font-bold text-white">Paso {{ wizardStep }} de {{ WIZARD_STEPS.length }}</span>
              <span class="text-xs font-bold text-white/60">{{ WIZARD_STEPS[wizardStep-1].label }}</span>
            </div>
            <div class="h-1.5 bg-white/15 rounded-full overflow-hidden">
              <div class="h-full bg-white rounded-full transition-all" :style="{ width: (wizardStep / WIZARD_STEPS.length * 100) + '%' }"></div>
            </div>
          </div>

          <!-- Body scrollable -->
          <div class="flex-1 overflow-y-auto p-4 sm:p-6">

            <!-- ═══ PASO 1: HUÉSPED ═══ -->
            <div v-if="wizardStep === 1" class="space-y-4">
              <!-- Buscador de huésped existente -->
              <div>
                  <label for="wiz-guest-search" class="block text-[11px] font-bold text-navy uppercase tracking-wide mb-1">Buscar huésped existente</label>
                  <div class="relative">
                    <input id="wiz-guest-search" name="guestSearch" :value="guestSearch" @input="onGuestSearchInput" type="text" maxlength="100" placeholder="Nombre, documento o email…" class="w-full px-3.5 py-2.5 pr-9 rounded-xl border border-border text-sm bg-surface/60 focus:bg-white focus:outline-none focus:ring-2 focus:ring-teal/20 focus:border-teal transition" @blur="blurGuestSearch" />
                    <span v-if="guestSearching" class="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 border-2 border-teal border-t-transparent rounded-full animate-spin"></span>
                    <ul v-if="guestSearchOpen && guestResults.length" class="absolute z-40 mt-1 w-full max-h-48 overflow-auto bg-white border border-border rounded-xl shadow-lg">
                      <li v-for="g in guestResults" :key="g.id" @mousedown.prevent="selectGuest(g)" class="px-3 py-2 text-sm cursor-pointer hover:bg-teal/10">
                        <div class="font-bold text-navy">{{ g.name }}</div>
                        <div class="text-[11px] text-text-muted">{{ g.document || 'Sin documento' }} · {{ g.email || g.phone || 'Sin contacto' }}</div>
                      </li>
                    </ul>
                  </div>
                  <p v-if="guestSearching" class="text-[11px] text-teal mt-1 font-semibold">Buscando…</p>
                  <p v-else-if="selectedGuestId" class="text-[11px] text-teal mt-1 font-semibold">Huésped existente: se reutiliza (no se crea uno nuevo)</p>
                  <p v-else class="text-[10px] text-text-muted mt-1">Evita duplicar huéspedes ya registrados</p>
                </div>

              <div>
                  <label for="wiz-name" class="block text-[11px] font-bold text-navy uppercase tracking-wide mb-1">Nombre completo <span class="text-coral">*</span></label>
                  <input id="wiz-name" name="name" v-model="form.name" type="text" maxlength="80" required aria-required="true" :aria-invalid="!!nameError" placeholder="Nombre y apellido" :disabled="guestSearching" class="w-full px-3.5 py-2.5 rounded-xl border text-sm bg-surface/60 focus:bg-white focus:outline-none focus:ring-2 transition disabled:opacity-50 disabled:cursor-not-allowed" :class="nameError ? 'border-coral ring-2 ring-coral/20' : 'border-border focus:ring-navy/20 focus:border-navy'" />
                  <p v-if="nameError" class="text-[10px] text-coral font-semibold mt-1">{{ nameError }}</p>
                </div>

              <div class="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                    <label for="wiz-email" class="block text-[11px] font-bold text-navy uppercase tracking-wide mb-1">Email <span class="text-coral">*</span></label>
                    <input id="wiz-email" name="email" v-model="form.email" type="email" maxlength="100" :aria-invalid="!!(contactError || emailError)" placeholder="correo@ejemplo.com" :disabled="guestSearching" class="w-full px-3.5 py-2.5 rounded-xl border text-sm bg-surface/60 focus:bg-white focus:outline-none focus:ring-2 transition disabled:opacity-50 disabled:cursor-not-allowed" :class="(contactError || emailError) ? 'border-coral ring-2 ring-coral/20' : 'border-border focus:ring-cyan/20 focus:border-cyan'" />
                    <p v-if="emailError" class="text-[10px] text-coral font-semibold mt-1">{{ emailError }}</p>
                  </div>
                <div>
                    <label class="block text-[11px] font-bold text-navy uppercase tracking-wide mb-1">Teléfono <span class="text-coral">*</span></label>
                    <PhoneInput v-model="form.phone" :country="form.country" :disabled="guestSearching" />
                  </div>
                <p v-if="contactError" class="sm:col-span-2 text-[10px] text-coral font-semibold -mt-2">{{ contactError }}</p>
                <p v-else class="sm:col-span-2 text-[10px] text-text-muted -mt-2">* Se requiere al menos un email o teléfono de contacto</p>
              </div>

              <div class="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                    <label class="block text-[11px] font-bold text-navy uppercase tracking-wide mb-1">País</label>
                    <SearchSelect v-model="form.country" :options="countries" placeholder="Buscar..." :disabled="guestSearching" />
                  </div>
                <div>
                    <label class="block text-[11px] font-bold text-navy uppercase tracking-wide mb-1">Nacionalidad</label>
                    <SearchSelect v-model="form.nationality" :options="nationalities" placeholder="Buscar..." :disabled="guestSearching" />
                  </div>
                <div>
                    <label for="wiz-language" class="block text-[11px] font-bold text-navy uppercase tracking-wide mb-1">Idioma</label>
                    <select id="wiz-language" name="language" v-model="form.language" :disabled="guestSearching" class="w-full px-3.5 py-2.5 rounded-xl border border-border text-sm bg-surface/60 cursor-pointer focus:bg-white focus:outline-none focus:ring-2 focus:ring-blue/20 focus:border-blue transition disabled:opacity-50 disabled:cursor-not-allowed">
                      <option v-for="l in languages" :key="l.v" :value="l.v">{{ l.l }}</option>
                    </select>
                  </div>
              </div>
            </div>

            <!-- ═══ PASO 2: DETALLES ═══ -->
            <div v-if="wizardStep === 2" class="space-y-4">
              <div class="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                    <label for="wiz-address" class="block text-[11px] font-bold text-navy uppercase tracking-wide mb-1">Dirección</label>
                    <input id="wiz-address" name="address" v-model="form.address" type="text" maxlength="150" placeholder="Calle, número..." class="w-full px-3.5 py-2.5 rounded-xl border border-border text-sm bg-surface/60 focus:bg-white focus:outline-none focus:ring-2 focus:ring-cyan/20 focus:border-cyan transition" />
                  </div>
                <div>
                    <label for="wiz-city" class="block text-[11px] font-bold text-navy uppercase tracking-wide mb-1">Ciudad</label>
                    <input id="wiz-city" name="city" v-model="form.city" type="text" maxlength="60" class="w-full px-3.5 py-2.5 rounded-xl border border-border text-sm bg-surface/60 focus:bg-white focus:outline-none focus:ring-2 focus:ring-teal/20 focus:border-teal transition" />
                  </div>
              </div>

              <div class="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                    <label for="wiz-province" class="block text-[11px] font-bold text-navy uppercase tracking-wide mb-1">Provincia</label>
                    <input id="wiz-province" name="province" v-model="form.province" type="text" maxlength="60" class="w-full px-3.5 py-2.5 rounded-xl border border-border text-sm bg-surface/60 focus:bg-white focus:outline-none focus:ring-2 focus:ring-purple/20 focus:border-purple transition" />
                  </div>
                <div>
                    <label for="wiz-sex" class="block text-[11px] font-bold text-navy uppercase tracking-wide mb-1">Sexo</label>
                    <select id="wiz-sex" name="sex" v-model="form.sex" class="w-full px-3.5 py-2.5 rounded-xl border border-border text-sm bg-surface/60 cursor-pointer focus:bg-white focus:outline-none focus:ring-2 focus:ring-gold/20 focus:border-gold transition">
                      <option value="">—</option>
                      <option value="male">Masculino</option>
                      <option value="female">Femenino</option>
                      <option value="other">Otro</option>
                    </select>
                  </div>
                <div>
                    <label for="wiz-birthdate" class="block text-[11px] font-bold text-navy uppercase tracking-wide mb-1">Nacimiento</label>
                    <input id="wiz-birthdate" name="birthDate" v-model="form.birthDate" type="date" class="w-full px-3.5 py-2.5 rounded-xl border border-border text-sm bg-surface/60 focus:bg-white focus:outline-none focus:ring-2 focus:ring-coral/20 focus:border-coral transition" />
                  </div>
              </div>

              <div class="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                    <label for="wiz-document-type" class="block text-[11px] font-bold text-navy uppercase tracking-wide mb-1">Tipo documento</label>
                    <select id="wiz-document-type" name="documentType" v-model="form.documentType" class="w-full px-3.5 py-2.5 rounded-xl border border-border text-sm bg-surface/60 cursor-pointer focus:bg-white focus:outline-none focus:ring-2 focus:ring-navy/20 focus:border-navy transition">
                      <option v-for="d in docTypes" :key="d.v" :value="d.v">{{ d.l }}</option>
                    </select>
                  </div>
                <div>
                    <label for="wiz-document" class="block text-[11px] font-bold text-navy uppercase tracking-wide mb-1">N° documento</label>
                    <input id="wiz-document" name="document" v-model="form.document" type="text" maxlength="30" placeholder="000-0000000-0" class="w-full px-3.5 py-2.5 rounded-xl border border-border text-sm bg-surface/60 focus:bg-white focus:outline-none focus:ring-2 focus:ring-blue/20 focus:border-blue transition" />
                  </div>
                <div>
                    <label for="wiz-document-issue-date" class="block text-[11px] font-bold text-navy uppercase tracking-wide mb-1">Exp. documento</label>
                    <input id="wiz-document-issue-date" name="documentIssueDate" v-model="form.documentIssueDate" type="date" class="w-full px-3.5 py-2.5 rounded-xl border border-border text-sm bg-surface/60 focus:bg-white focus:outline-none focus:ring-2 focus:ring-purple/20 focus:border-purple transition" />
                  </div>
              </div>

              <div class="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                    <label for="wiz-communicate-client" class="block text-[11px] font-bold text-navy uppercase tracking-wide mb-1">Comunicar al cliente</label>
                    <select id="wiz-communicate-client" name="communicateClient" v-model="form.communicateClient" class="w-full px-3.5 py-2.5 rounded-xl border border-border text-sm bg-surface/60 cursor-pointer focus:bg-white focus:outline-none focus:ring-2 focus:ring-teal/20 focus:border-teal transition">
                      <option value="none">No enviar bono</option>
                      <option value="email_confirmation">Enviar email de confirmación</option>
                      <option value="email_presaless">Enviar email preventa</option>
                    </select>
                  </div>
                <div>
                    <label for="wiz-guest-notes" class="block text-[11px] font-bold text-navy uppercase tracking-wide mb-1">Observaciones</label>
                    <input id="wiz-guest-notes" name="guestNotes" v-model="form.guestNotes" type="text" maxlength="300" placeholder="Notas para el bono..." class="w-full px-3.5 py-2.5 rounded-xl border border-border text-sm bg-surface/60 focus:bg-white focus:outline-none focus:ring-2 focus:ring-navy/20 focus:border-navy transition" />
                  </div>
              </div>

              <!-- Acompañantes -->
              <div class="pt-3 border-t border-border">
                <div class="flex items-center gap-2 mb-3">
                  <span class="w-4 h-4 text-navy" v-html="ICON_USERS"></span>
                  <h4 class="text-[11px] font-black text-navy uppercase tracking-wide">Acompañantes</h4>
                  <button type="button" @click="addCompanion" class="ml-auto text-[11px] font-bold text-cyan hover:underline cursor-pointer">+ agregar</button>
                </div>
                <p v-if="!form.companions.length" class="text-[11px] text-text-muted italic">Sin acompañantes adicionales</p>
                <div v-for="(c, i) in form.companions" :key="i" class="grid grid-cols-2 sm:grid-cols-12 gap-2 mb-2 items-center">
                  <input v-model="c.name" :aria-label="'Nombre del acompañante ' + (i+1)" type="text" maxlength="80" placeholder="Nombre completo" class="col-span-2 sm:col-span-5 px-3 py-2 rounded-full border border-border text-sm bg-surface/60 focus:bg-white focus:outline-none focus:ring-2 focus:ring-navy/20 focus:border-navy transition" />
                  <select v-model="c.documentType" :aria-label="'Tipo de documento del acompañante ' + (i+1)" class="col-span-1 sm:col-span-3 px-2 py-2 rounded-full border border-border text-xs bg-surface/60 cursor-pointer">
                    <option value="dni">DNI</option><option value="passport">Pasaporte</option><option value="other">Otro</option>
                  </select>
                  <input v-model="c.documentNumber" :aria-label="'N° de documento del acompañante ' + (i+1)" type="text" maxlength="30" placeholder="N° documento" class="col-span-1 sm:col-span-3 px-2 py-2 rounded-full border border-border text-xs bg-surface/60" />
                  <button type="button" @click="removeCompanion(i)" class="col-span-2 sm:col-span-1 flex items-center justify-center w-6 h-6 mx-auto text-coral hover:bg-coral/10 rounded-full cursor-pointer" v-html="ICON_X"></button>
                </div>
              </div>

              <!-- OTA (condicional) -->
              <div v-if="form.source!=='direct'" class="pt-3 border-t border-border">
                <div class="flex items-center gap-2 mb-3">
                  <span class="w-4 h-4 text-navy" v-html="ICON_GLOBE"></span>
                  <h4 class="text-[11px] font-black text-navy uppercase tracking-wide">Datos del Canal</h4>
                </div>
                <div class="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div>
                      <label for="wiz-commission" class="block text-[11px] font-bold text-navy uppercase tracking-wide mb-1">Comisión (%)</label>
                      <input id="wiz-commission" name="commission" v-model.number="form.commission" type="number" min="0" max="50" class="w-full px-3.5 py-2.5 rounded-xl border border-border text-sm bg-surface/60 focus:bg-white transition" />
                    </div>
                  <div>
                      <label for="wiz-ext-locator" class="block text-[11px] font-bold text-navy uppercase tracking-wide mb-1">Locator OTA</label>
                      <input id="wiz-ext-locator" name="extLocator" v-model="form.extLocator" type="text" maxlength="50" class="w-full px-3.5 py-2.5 rounded-xl border border-border text-sm bg-surface/60 focus:bg-white transition" />
                    </div>
                </div>
              </div>
            </div>

            <!-- ═══ PASO 3: EMERGENCIA ═══ -->
            <div v-if="wizardStep === 3" class="space-y-4">
              <div class="flex items-center gap-2 mb-1">
                <span class="w-4 h-4 text-coral" v-html="ICON_ALERT"></span>
                <h4 class="text-[11px] font-black text-coral uppercase tracking-wide">Contacto de Emergencia</h4>
              </div>
              <div class="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                    <label for="wiz-emergency-name" class="block text-[11px] font-bold text-navy uppercase tracking-wide mb-1">Nombre completo</label>
                    <input id="wiz-emergency-name" name="emergencyName" v-model="form.emergencyName" type="text" maxlength="80" placeholder="Contacto de emergencia" class="w-full px-3.5 py-2.5 rounded-xl border text-sm bg-surface/60 focus:bg-white focus:outline-none focus:ring-2 transition" :class="emergencyNameError ? 'border-coral ring-2 ring-coral/20' : 'border-border focus:ring-coral/20 focus:border-coral'" />
                    <p v-if="emergencyNameError" class="text-[10px] text-coral font-semibold mt-1">{{ emergencyNameError }}</p>
                  </div>
                <div>
                    <label class="block text-[11px] font-bold text-navy uppercase tracking-wide mb-1">Teléfono</label>
                    <PhoneInput v-model="form.emergencyPhone" :country="form.country" />
                  </div>
              </div>
              <div class="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                    <label for="wiz-emergency-relation" class="block text-[11px] font-bold text-navy uppercase tracking-wide mb-1">Parentesco</label>
                    <select id="wiz-emergency-relation" name="emergencyRelation" v-model="form.emergencyRelation" class="w-full px-3.5 py-2.5 rounded-xl border border-border text-sm bg-surface/60 cursor-pointer focus:bg-white focus:outline-none focus:ring-2 focus:ring-purple/20 focus:border-purple transition">
                      <option value="">Seleccionar...</option>
                      <option v-for="r in relations" :key="r" :value="r">{{ r }}</option>
                    </select>
                  </div>
                <div>
                    <label for="wiz-emergency-email" class="block text-[11px] font-bold text-navy uppercase tracking-wide mb-1">Email <span class="text-text-muted font-normal normal-case">(opcional)</span></label>
                    <input id="wiz-emergency-email" name="emergencyEmail" v-model="form.emergencyEmail" type="email" maxlength="100" placeholder="contacto@ejemplo.com" class="w-full px-3.5 py-2.5 rounded-xl border text-sm bg-surface/60 focus:bg-white focus:outline-none focus:ring-2 transition" :class="emergencyEmailFormatError ? 'border-coral ring-2 ring-coral/20' : 'border-border focus:ring-cyan/20 focus:border-cyan'" />
                    <p v-if="emergencyEmailFormatError" class="text-[10px] text-coral font-semibold mt-1">{{ emergencyEmailFormatError }}</p>
                  </div>
              </div>
            </div>

            <!-- ═══ PASO 4: ALOJAMIENTO ═══ -->
            <div v-if="wizardStep === 4" class="space-y-4">
              <div class="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                    <label for="wiz-checkin" class="block text-[11px] font-bold text-navy uppercase tracking-wide mb-1">Check-in <span class="text-coral">*</span></label>
                    <input id="wiz-checkin" name="checkIn" v-model="form.checkIn" type="date" required aria-required="true" :aria-invalid="!!checkInError" :min="isEdit ? undefined : todayISO" class="w-full px-3.5 py-2.5 rounded-xl border text-sm bg-surface/60 focus:bg-white focus:outline-none focus:ring-2 transition" :class="checkInError ? 'border-coral ring-2 ring-coral/20' : 'border-border focus:ring-teal/20 focus:border-teal'" />
                    <p v-if="checkInError" class="text-[10px] text-coral font-semibold mt-1">{{ checkInError }}</p>
                  </div>
                <div>
                    <label for="wiz-checkout" class="block text-[11px] font-bold text-navy uppercase tracking-wide mb-1">Check-out <span class="text-coral">*</span></label>
                    <input id="wiz-checkout" name="checkOut" v-model="form.checkOut" type="date" required aria-required="true" :aria-invalid="!!checkOutError" class="w-full px-3.5 py-2.5 rounded-xl border text-sm bg-surface/60 focus:bg-white focus:outline-none focus:ring-2 transition" :class="checkOutError ? 'border-coral ring-2 ring-coral/20' : 'border-border focus:ring-coral/20 focus:border-coral'" />
                    <p v-if="checkOutError" class="text-[10px] text-coral font-semibold mt-1">{{ checkOutError }}</p>
                  </div>
              </div>

              <div class="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                    <label class="block text-[11px] font-bold text-navy uppercase tracking-wide mb-1">Habitación <span class="text-coral">*</span></label>
                    <SearchSelect v-model="form.roomId" :options="roomOptions" placeholder="Seleccionar..." data-testid="wiz-room-select" />
                    <p v-if="roomError" class="text-[10px] text-coral font-semibold mt-1">{{ roomError }}</p>
                  </div>
                <div>
                    <label for="wiz-regime" class="block text-[11px] font-bold text-navy uppercase tracking-wide mb-1">Régimen</label>
                    <select id="wiz-regime" name="regime" v-model="form.regime" class="w-full px-3.5 py-2.5 rounded-xl border border-border text-sm bg-surface/60 cursor-pointer focus:bg-white focus:outline-none focus:ring-2 focus:ring-purple/20 focus:border-purple transition">
                      <option value="room_only">Solo alojamiento</option>
                      <option value="breakfast">Desayuno incluido</option>
                      <option value="half_board">Media pensión</option>
                      <option value="full_board">Pensión completa</option>
                      <option value="all_inclusive">Todo incluido</option>
                    </select>
                  </div>
              </div>

              <div class="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                    <label for="wiz-adults" class="block text-[11px] font-bold text-navy uppercase tracking-wide mb-1">Adultos</label>
                    <input id="wiz-adults" name="adults" v-model.number="form.adults" type="number" min="1" max="10" class="w-full px-3.5 py-2.5 rounded-xl border border-border text-sm bg-surface/60 focus:bg-white focus:outline-none focus:ring-2 focus:ring-cyan/20 focus:border-cyan transition" />
                  </div>
                <div>
                    <label for="wiz-children" class="block text-[11px] font-bold text-navy uppercase tracking-wide mb-1">Niños</label>
                    <input id="wiz-children" name="children" v-model.number="form.children" type="number" min="0" max="10" class="w-full px-3.5 py-2.5 rounded-xl border border-border text-sm bg-surface/60 focus:bg-white focus:outline-none focus:ring-2 focus:ring-gold/20 focus:border-gold transition" />
                  </div>
                <div>
                    <label class="block text-[11px] font-bold text-navy uppercase tracking-wide mb-1">Noches</label>
                    <div class="w-full px-3.5 py-2.5 rounded-xl border border-border text-sm bg-surface font-bold text-navy">{{ nights }}</div>
                  </div>
              </div>

              <div>
                  <label for="wiz-promo-code" class="block text-[11px] font-bold text-navy uppercase tracking-wide mb-1">Código promocional</label>
                  <input id="wiz-promo-code" name="promoCode" v-model="form.promoCode" type="text" maxlength="30" placeholder="Opcional" class="w-full px-3.5 py-2.5 rounded-xl border border-border text-sm bg-surface/60 focus:bg-white focus:outline-none focus:ring-2 focus:ring-teal/20 focus:border-teal transition" :class="promoApplied ? 'border-teal' : promoError ? 'border-coral' : ''" />
                  <div v-if="promoChecking" class="text-[11px] text-text-muted mt-1">Validando código…</div>
                  <div v-else-if="promoApplied" class="text-[11px] font-bold text-teal mt-1">Código aplicado — descuento ${{ promoDiscount }}</div>
                  <div v-else-if="promoError" class="text-[11px] font-bold text-coral mt-1">{{ promoError }}</div>
                </div>

              <!-- Resumen precio -->
              <div v-if="selRoom && form.checkIn && form.checkOut" class="bg-surface rounded-2xl p-4 space-y-2">
                <div class="text-[11px] font-bold text-text-muted uppercase mb-2">Habitación {{ selRoom.number }} — {{ selRoom.type }}</div>
                <!-- Desglose por temporada (quote del backend). Sin quote → basePrice × noches como antes. -->
                <template v-if="stayQuote && seasonRows.length">
                  <div v-for="row in seasonRows" :key="row.key" class="flex justify-between text-sm">
                    <span class="text-text-secondary inline-flex items-center gap-1.5">
                      <span v-if="row.color" class="w-2 h-2 rounded-full inline-block shrink-0" :style="{ backgroundColor: row.color }"></span>
                      {{ row.label }} · {{ row.nights }} {{ row.nights === 1 ? 'noche' : 'noches' }}
                    </span>
                    <span class="font-bold text-navy">${{ row.subtotal }}</span>
                  </div>
                </template>
                <div v-else class="flex justify-between text-sm"><span class="text-text-secondary">{{ nights }} noches × ${{ selRoom.basePrice }}</span><span class="font-bold text-navy">${{ subtotal }}</span></div>
                <div v-if="quoteLoading" class="text-[11px] text-text-muted">Cotizando tarifas…</div>
                <div v-else-if="stayQuote && !stayQuote.fromRates" data-testid="no-rates-warning" class="text-[11px] font-bold text-gold">Sin tarifas cargadas para estas fechas: se usa el precio base de la habitación.</div>
                <div v-else-if="stayQuote && stayQuote.closedNights > 0" data-testid="closed-nights-warning" class="text-[11px] font-bold text-gold">{{ stayQuote.closedNights }} {{ stayQuote.closedNights === 1 ? 'noche con tarifa cerrada' : 'noches con tarifa cerrada' }} en la grilla — revisá antes de confirmar.</div>
                <div class="flex justify-between text-sm"><span class="text-text-secondary">Impuestos ({{ taxRatePct }}%)</span><span class="font-bold text-navy">${{ taxes }}</span></div>
                <div v-if="promoApplied" class="flex justify-between text-sm"><span class="text-text-secondary">Descuento ({{ form.promoCode.trim().toUpperCase() }})</span><span class="font-bold text-teal">-${{ promoDiscount }}</span></div>
                <div v-if="form.regime !== 'room_only'" class="flex justify-between text-sm"><span class="text-text-secondary">Régimen</span><span class="font-bold text-teal">{{ regimeLabel }}</span></div>
              </div>
            </div>

            <!-- ═══ PASO 5: PAGO ═══ -->
            <div v-if="wizardStep === 5" class="space-y-4">
              <div>
                  <label for="wiz-pay-method" class="block text-[11px] font-bold text-navy uppercase tracking-wide mb-1">Método de pago</label>
                  <select id="wiz-pay-method" name="payMethod" v-model="form.payMethod" class="w-full px-3.5 py-2.5 rounded-xl border border-border text-sm bg-surface/60 cursor-pointer focus:bg-white focus:outline-none focus:ring-2 focus:ring-navy/20 focus:border-navy transition">
                    <option value="transfer">Transferencia</option>
                    <option value="card">Tarjeta</option>
                    <option value="cash">Efectivo</option>
                    <option value="link">Link de pago</option>
                  </select>
                </div>

              <!-- Tarjeta de garantía -->
              <div class="pt-3 border-t border-border">
                <div class="flex items-center gap-2 mb-3">
                  <span class="w-4 h-4 text-purple" v-html="ICON_LOCK"></span>
                  <h4 class="text-[11px] font-black text-purple uppercase tracking-wide">Tarjeta de garantía</h4>
                </div>
                <div v-if="existingGuarantee" class="mb-3 rounded-xl bg-navy/5 border border-navy/15 px-3 py-2 text-[11px] leading-relaxed text-navy">
                  Ya hay una tarjeta de garantía cargada. Para verla abrí <strong>Ver reserva</strong> e ingresá el PIN. Ingresá una nueva tarjeta acá solo si querés <strong>reemplazarla</strong>.
                </div>
                <div class="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-4">
                  <div>
                      <label for="wiz-card-holder" class="block text-[11px] font-bold text-navy uppercase tracking-wide mb-1">Titular de la tarjeta</label>
                      <input id="wiz-card-holder" name="cardHolder" v-model="form.cardHolder" type="text" maxlength="80" placeholder="Nombre como aparece en la tarjeta" class="w-full px-3.5 py-2.5 rounded-xl border border-border text-sm bg-surface/60 focus:bg-white focus:outline-none focus:ring-2 focus:ring-purple/20 focus:border-purple transition" />
                    </div>
                  <div>
                      <label for="wiz-card-brand" class="block text-[11px] font-bold text-navy uppercase tracking-wide mb-1">Tipo</label>
                      <select id="wiz-card-brand" name="cardBrand" v-model="form.cardBrand" class="w-full px-3.5 py-2.5 rounded-xl border border-border text-sm bg-surface/60 cursor-pointer focus:bg-white focus:outline-none focus:ring-2 focus:ring-gold/20 focus:border-gold transition">
                        <option value="visa">Visa</option>
                        <option value="mastercard">Mastercard</option>
                        <option value="amex">Amex</option>
                        <option value="discover">Discover</option>
                        <option value="other">Otra</option>
                      </select>
                    </div>
                </div>
                <div class="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-4">
                  <div>
                      <label for="wiz-card-number" class="block text-[11px] font-bold text-navy uppercase tracking-wide mb-1">N° tarjeta</label>
                      <input id="wiz-card-number" name="cardNumber" v-model="form.cardNumber" type="text" maxlength="19" placeholder="XXXX XXXX XXXX XXXX" @input="formatCardNumber" class="w-full px-3.5 py-2.5 rounded-xl border border-border text-sm font-mono bg-surface/60 focus:bg-white focus:outline-none focus:ring-2 focus:ring-navy/20 focus:border-navy transition" />
                    </div>
                  <div>
                      <label for="wiz-card-cvv" class="block text-[11px] font-bold text-navy uppercase tracking-wide mb-1">CVV</label>
                      <input id="wiz-card-cvv" name="cardCvv" v-model="form.cardCvv" type="text" maxlength="4" placeholder="XXX" class="w-full px-3.5 py-2.5 rounded-xl border border-border text-sm font-mono bg-surface/60 focus:bg-white focus:outline-none focus:ring-2 focus:ring-coral/20 focus:border-coral transition" />
                    </div>
                </div>
                <div>
                    <label for="wiz-card-expiry" class="block text-[11px] font-bold text-navy uppercase tracking-wide mb-1">Caducidad</label>
                    <input id="wiz-card-expiry" name="cardExpiry" v-model="form.cardExpiry" @input="formatExpiry" type="text" inputmode="numeric" maxlength="7" placeholder="MM/AAAA" class="w-full px-3.5 py-2.5 rounded-xl border border-border text-sm font-mono bg-surface/60 focus:bg-white focus:outline-none focus:ring-2 focus:ring-purple/20 focus:border-purple transition" />
                  </div>
              </div>

              <!-- Anticipo -->
              <div class="pt-3 border-t border-border">
                <div class="flex items-center gap-2 mb-3">
                  <span class="w-4 h-4 text-teal" v-html="ICON_PERCENT"></span>
                  <h4 class="text-[11px] font-black text-teal uppercase tracking-wide">Anticipo y total</h4>
                </div>
                <div class="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-4">
                  <div>
                      <label for="wiz-deposit-percentage" class="block text-[11px] font-bold text-navy uppercase tracking-wide mb-1">% de anticipo</label>
                      <input id="wiz-deposit-percentage" name="depositPercentage" v-model.number="form.depositPercentage" type="number" min="0" max="100" class="w-full px-3.5 py-2.5 rounded-xl border border-border text-sm bg-surface/60 focus:bg-white focus:outline-none focus:ring-2 focus:ring-teal/20 focus:border-teal transition" />
                    </div>
                  <div>
                      <label for="wiz-deposit-status" class="block text-[11px] font-bold text-navy uppercase tracking-wide mb-1">Estado</label>
                      <select id="wiz-deposit-status" name="depositStatus" v-model="form.depositStatus" class="w-full px-3.5 py-2.5 rounded-xl border border-border text-sm bg-surface/60 cursor-pointer focus:bg-white focus:outline-none focus:ring-2 focus:ring-gold/20 focus:border-gold transition">
                        <option value="unpaid">Sin pagar</option>
                        <option value="partial">Parcial</option>
                        <option value="paid">Pagado</option>
                      </select>
                    </div>
                </div>
                <div v-if="selRoom && form.checkIn && form.checkOut" class="bg-surface rounded-2xl border border-border p-4 space-y-1.5 text-sm">
                  <!-- Precio manual (pactado): reemplaza el alojamiento cotizado; impuestos y promo
                       se siguen calculando encima. Sin checkbox → precio de temporada del backend. -->
                  <label class="flex items-center gap-2 text-[11px] font-bold text-navy uppercase tracking-wide cursor-pointer select-none" data-testid="manual-price-toggle">
                    <input type="checkbox" v-model="manualPrice" class="accent-teal w-3.5 h-3.5 cursor-pointer" />
                    Precio pactado manual
                  </label>
                  <input v-if="manualPrice" data-testid="manual-price-input" v-model.number="manualSubtotal" type="number" min="0" step="0.01"
                    class="w-full px-3 py-2 rounded-lg border border-border text-sm text-navy font-bold focus:border-teal focus:outline-none" placeholder="Alojamiento pactado para toda la estadía ($)" />
                  <div v-if="manualPrice && stayQuote && !quoteLoading" data-testid="current-rate-hint" class="text-[11px] text-text-muted">Tarifa vigente para esas fechas: ${{ stayQuote.subtotal }} <span v-if="!stayQuote.fromRates">(precio base, sin tarifas cargadas)</span></div>
                  <template v-if="!manualPrice && stayQuote && seasonRows.length">
                    <div v-for="row in seasonRows" :key="row.key" class="flex justify-between">
                      <span class="text-text-secondary inline-flex items-center gap-1.5">
                        <span v-if="row.color" class="w-2 h-2 rounded-full inline-block shrink-0" :style="{ backgroundColor: row.color }"></span>
                        {{ row.label }} · {{ row.nights }} {{ row.nights === 1 ? 'noche' : 'noches' }}
                      </span>
                      <span class="font-bold text-navy">${{ row.subtotal }}</span>
                    </div>
                  </template>
                  <div v-else class="flex justify-between"><span class="text-text-secondary">{{ nights }} noches × ${{ manualPrice ? (subtotal / Math.max(nights, 1)).toFixed(0) : selRoom.basePrice }}</span><span class="font-bold text-navy">${{ subtotal }}</span></div>
                  <div v-if="stayQuote && !stayQuote.fromRates && !quoteLoading" data-testid="no-rates-warning" class="text-[11px] font-bold text-gold">Sin tarifas cargadas para estas fechas: se usa el precio base de la habitación.</div>
                  <div class="flex justify-between"><span class="text-text-secondary">Impuestos ({{ taxRatePct }}%)</span><span class="font-bold text-navy">${{ taxes }}</span></div>
                  <div v-if="promoApplied" class="flex justify-between"><span class="text-text-secondary">Descuento ({{ form.promoCode.trim().toUpperCase() }})</span><span class="font-bold text-teal">-${{ promoDiscount }}</span></div>
                  <div class="border-t border-border pt-1.5 flex justify-between items-center">
                    <span class="font-black text-navy">Total Reserva</span>
                    <span class="font-black text-navy text-lg">${{ total }}</span>
                  </div>
                  <div class="flex justify-between"><span class="text-text-secondary">Anticipo ({{ form.depositPercentage }}%)</span><span class="font-bold text-teal">${{ form.deposit }}</span></div>
                  <div class="flex justify-between"><span class="text-text-secondary">Pendiente de pago</span><span class="font-black" :class="pend > 0 ? 'text-coral' : 'text-teal'">${{ pend }}</span></div>
                </div>
                <div v-else class="text-xs text-text-muted text-center py-3">Seleccioná habitación y fechas para ver el desglose</div>
              </div>

              <!-- Cerradura (solo edición) -->
              <div v-if="isEdit" class="pt-3 border-t border-border">
                <div class="flex items-center justify-between mb-2">
                  <div class="flex items-center gap-2">
                    <span class="w-4 h-4 text-cyan" v-html="ICON_KEY"></span>
                    <span class="text-[11px] font-black text-navy uppercase tracking-wide">Cerradura</span>
                  </div>
                  <button @click="generateLockCode" class="text-xs font-bold text-teal hover:underline cursor-pointer">
                    {{ lockCode ? 'Regenerar' : '+ Generar código' }}
                  </button>
                </div>
                <div v-if="lockCode" class="text-center py-3 bg-surface rounded-2xl border-2 border-dashed border-teal">
                  <div class="text-[10px] font-bold text-text-muted uppercase">Código de acceso</div>
                  <div class="text-2xl font-black text-teal tracking-wider mt-1">{{ lockCode }}</div>
                </div>
                <div v-else class="text-xs text-text-muted text-center py-2">Sin código generado</div>
              </div>
            </div>
          </div>

          <!-- Error de validación / disponibilidad (visible para el usuario) -->
          <div v-if="err" data-testid="wizard-error" class="px-4 py-3 bg-coral/10 border-t border-b border-coral/30 text-sm font-bold text-coral flex items-center gap-2 shrink-0">
            <span class="w-4 h-4 shrink-0" v-html="ICON_ALERT"></span><span>{{ err }}</span>
          </div>

          <!-- Footer -->
          <div class="p-4 sm:p-5 border-t border-border shrink-0 flex flex-wrap items-center justify-between gap-3">
            <div class="text-sm font-extrabold text-navy">Total: <span class="text-lg">${{ total }}</span></div>
            <div class="flex items-center gap-3 sm:gap-4 flex-wrap">
              <button @click="emit('close')" class="px-5 py-2.5 border border-border rounded-xl text-sm font-bold text-text-secondary cursor-pointer hover:bg-surface transition">Cancelar</button>
              <button v-if="wizardStep > 1" @click="wizardStep--" class="px-5 py-2.5 border border-border rounded-xl text-sm font-bold text-text-secondary cursor-pointer hover:bg-surface transition">Atrás</button>
              <button v-if="wizardStep < WIZARD_STEPS.length" @click="goNextStep" :disabled="wizardStep === 1 && guestSearching"
                class="px-6 py-2.5 bg-navy text-white rounded-xl text-sm font-bold cursor-pointer hover:bg-navy-light transition disabled:opacity-50 disabled:cursor-not-allowed">Siguiente</button>
              <button v-else @click="save" :disabled="saving || !isOnline" data-testid="wizard-submit-btn"
                :title="!isOnline ? 'Sin conexión: no se puede guardar la reserva' : ''"
                class="px-6 py-2.5 bg-teal text-white rounded-xl text-sm font-black cursor-pointer hover:opacity-90 disabled:opacity-50 disabled:cursor-not-allowed transition">
                {{ saving ? 'Guardando...' : (isEdit ? 'Actualizar Reserva' : 'Crear Reserva') }}
              </button>
            </div>
          </div>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>

<script setup lang="ts">
// components/features/ReservationWizardModal.vue — Wizard de 5 pasos para crear/editar una
// reserva (Huésped → Detalles → Emergencia → Alojamiento → Pago). Compartido entre
// pages/reservations/index.vue y ReservationCalendar.vue: antes cada uno tenía su propio
// formulario (el del Calendario era una sola pantalla, más pobre — sin reutilización de
// huésped existente ni sync de acompañantes). `editId`/`prefill` deciden si abre vacío,
// precargado con datos de una reserva existente, o con habitación/fechas ya elegidas
// (celda clickeada del Calendario).
import { ref, computed, watch, nextTick, onMounted, onBeforeUnmount } from 'vue'
import { pushModal, popModal } from '@/composables/useModalStack'
import { useAuthStore } from '@/stores/auth.store'
import { useToast } from '@/composables/useToast'
import { useOnline } from '@/composables/useOnline'
import { ReservationService } from '@/services/Reservation.service'
import { BillingService } from '@/services/Billing.service'
import { CompanionsService } from '@/services/Companions.service'
import { PaymentsService } from '@/services/Payments.service'
import { TTLockService } from '@/services/TTLock.service'
import { PromoCodeService } from '@/services/PromoCode.service'
import SearchSelect from '@/components/ui/SearchSelect.vue'
import PhoneInput from '@/components/ui/PhoneInput.vue'
import { COUNTRIES, NATIONALITIES, LANGUAGES, DOC_TYPES, nationalityToCountryName, countryNameToNationality } from '@/data/locales'
import type { Guest, StayQuote } from '@/types'

const props = defineProps<{
  editId?: string | null
  prefill?: { roomId?: string; checkIn?: string; checkOut?: string; guestId?: string; source?: string; adults?: number; children?: number } | null
  rooms: any[]
}>()
const emit = defineEmits<{
  (e: 'close'): void
  (e: 'saved'): void
}>()

const { isOnline } = useOnline()
const auth = useAuthStore()
const toast = useToast()
const hid = computed(() => (auth.user?.hotelId && auth.user.hotelId !== 'platform' ? auth.user.hotelId : undefined))

const isEdit = computed(() => !!props.editId)

const MS_PER_DAY = 86_400_000

// ── Wizard ──
const WIZARD_STEPS = [
  { n: 1, label: 'Huésped' },
  { n: 2, label: 'Detalles' },
  { n: 3, label: 'Emergencia' },
  { n: 4, label: 'Alojamiento' },
  { n: 5, label: 'Pago' },
]
const wizardStep = ref(1)

const SVG_OPEN = '<svg viewBox="0 0 24 24" class="w-full h-full" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">'
const ICON_X = `${SVG_OPEN}<path d="M18 6 6 18"/><path d="m6 6 12 12"/></svg>`
const ICON_GLOBE = `${SVG_OPEN}<circle cx="12" cy="12" r="10"/><path d="M12 2a14.5 14.5 0 0 0 0 20 14.5 14.5 0 0 0 0-20"/><path d="M2 12h20"/></svg>`
const ICON_ALERT = `${SVG_OPEN}<path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3"/><path d="M12 9v4"/><path d="M12 17h.01"/></svg>`
const ICON_USERS = `${SVG_OPEN}<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>`
const ICON_PERCENT = `${SVG_OPEN}<line x1="19" x2="5" y1="5" y2="19"/><circle cx="6.5" cy="6.5" r="2.5"/><circle cx="17.5" cy="17.5" r="2.5"/></svg>`
const ICON_LOCK = `${SVG_OPEN}<rect width="18" height="11" x="3" y="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>`
const ICON_KEY = `${SVG_OPEN}<path d="m15.5 7.5 2.3 2.3a1 1 0 0 0 1.4 0l2.1-2.1a1 1 0 0 0 0-1.4L19 4a5 5 0 1 0-7 7l1 1"/><path d="m21 2-9.6 9.6"/><circle cx="7.5" cy="15.5" r="5.5"/></svg>`

const saving = ref(false)
const err = ref('')
const lockCode = ref('')
const existingGuarantee = ref(false)
// Habitación que tenía la reserva al abrirla en edición. Se usa para NO tratar la propia reserva
// como bloqueante en el check de disponibilidad: si la reserva ocupa la hab X en [a, b), el
// endpoint /api/habitaciones marca X como unavailable en esa ventana (no distingue "propia" de
// "ajena"). Sin este bypass el wizard de edición no dejaba avanzar al paso 5 aunque el usuario no
// tocara las fechas, porque la propia reserva aparecía como bloqueante.
const originalRoomId = ref('')

// ── Form completo ──
const form = ref({
  // Cliente (naming canónico guests)
  name: '', email: '', phone: '',
  language: 'Español', country: 'República Dominicana', nationality: 'Dominicana',
  address: '', city: '', province: '',
  sex: '', birthDate: '',
  documentType: 'dni', document: '', documentIssueDate: '',
  communicateClient: 'none', guestNotes: '',
  // Contacto emergencia
  emergencyName: '', emergencyPhone: '', emergencyRelation: '', emergencyEmail: '',
  // Alojamiento
  checkIn: '', checkOut: '', roomId: '', adults: 2, children: 0,
  regime: 'room_only', promoCode: '',
  // Canal / OTA
  source: 'direct', commission: 0, commissionAmount: 0, extLocator: '', otaNotes: '',
  // Tarjeta
  cardHolder: '', cardBrand: 'visa', cardNumber: '', cardCvv: '', cardExpMonth: '', cardExpYear: '', cardExpiry: '',
  // Anticipo / Pago
  depositPercentage: 100, deposit: 0, depositStatus: 'unpaid', payMethod: 'transfer',
  // Otros
  status: 'pending', notes: '', autoSendEnabled: true,
  companions: [] as { id?: string; name: string; documentNumber: string; documentType?: string; nationality?: string }[],
})

// ── Datos para dropdowns ──
const languages = LANGUAGES
const countries = COUNTRIES
const nationalities = NATIONALITIES
const docTypes = DOC_TYPES
const relations = ['Familiar', 'Amigo/a', 'Empleado/a', 'Agente de viajes', 'Otro']

// País y nacionalidad se sincronizan entre sí mientras ninguno de los dos haya sido
// elegido a mano: el primero que el usuario complete propone el otro (mismo dato en
// COUNTRY_DATA), pero apenas toca el campo restante, ese campo queda "suyo" y deja de
// seguir al otro — evita que un huésped con nacionalidad ≠ país de residencia (caso
// común) se vea forzado a coincidir. `formReady` evita que la carga programática de
// una reserva existente (loadForEdit) dispare el sync como si fuera el usuario.
let syncingPaisNacionalidad = false
const formReady = ref(false)
const countryTouched = ref(false)
const nationalityTouched = ref(false)
watch(() => form.value.country, (val) => {
  if (!formReady.value) return
  if (syncingPaisNacionalidad) { syncingPaisNacionalidad = false; return }
  countryTouched.value = true
  if (nationalityTouched.value || !val) return
  const mapped = countryNameToNationality(val)
  if (mapped && mapped !== form.value.nationality) {
    syncingPaisNacionalidad = true
    form.value.nationality = mapped
  }
})
watch(() => form.value.nationality, (val) => {
  if (!formReady.value) return
  if (syncingPaisNacionalidad) { syncingPaisNacionalidad = false; return }
  nationalityTouched.value = true
  if (countryTouched.value || !val) return
  const mapped = nationalityToCountryName(val)
  if (mapped && mapped !== form.value.country) {
    syncingPaisNacionalidad = true
    form.value.country = mapped
  }
})

// #648 — disponibilidad por rango de fechas. `dateFilteredRooms` guarda el resultado de
// `RoomService.list({ checkIn, checkOut })` (cada cuarto anotado con `available`/
// `unavailableReason`, ver backend/src/shared/usecases/habitaciones-availability.ts). `null`
// mientras no haya fechas completas o el fetch no corrió todavía: en ese caso se usa
// `props.rooms` tal cual, IGUAL que antes del fix.
const dateFilteredRooms = ref<any[] | null>(null)
const roomsForSelect = computed(() => dateFilteredRooms.value ?? props.rooms)

let roomsAvailDebounceId: ReturnType<typeof setTimeout> | null = null
async function refreshRoomsAvailability() {
  const { checkIn, checkOut } = form.value
  if (!hid.value || !checkIn || !checkOut || checkOut <= checkIn) {
    dateFilteredRooms.value = null
    return
  }
  try {
    const { RoomService } = await import('@/services/Room.service')
    const { rooms } = await RoomService.list({ hotelId: hid.value, checkIn, checkOut })
    dateFilteredRooms.value = rooms
  } catch {
    // Sin disponibilidad anotada, mejor mostrar el listado completo (comportamiento previo)
    // que romper el selector de habitación.
    dateFilteredRooms.value = null
  }
}
watch([() => form.value.checkIn, () => form.value.checkOut], () => {
  if (roomsAvailDebounceId) clearTimeout(roomsAvailDebounceId)
  roomsAvailDebounceId = setTimeout(refreshRoomsAvailability, 300)
}, { immediate: true })

const selRoom = computed(() => roomsForSelect.value.find((r: any) => r.id === form.value.roomId))
// Opciones del selector de habitación (buscador dinámico): value=id, label='número — tipo ($precio/n)'.
// Cuartos ocupados esas fechas quedan deshabilitados (no ocultos) con el motivo en el label —
// SearchSelect.vue soporta `disabled` por opción (#648).
const roomOptions = computed(() => roomsForSelect.value.map((r: any) => ({
  value: String(r.id),
  label: r.available === false ? `${r.number} — ${r.type} (${r.unavailableReason || 'Ocupada esas fechas'})` : `${r.number} — ${r.type} ($${r.basePrice}/n)`,
  disabled: r.available === false,
})))
const nights = computed(() => {
  if (!form.value.checkIn || !form.value.checkOut) return 0
  return Math.max(1, Math.round((new Date(form.value.checkOut).getTime() - new Date(form.value.checkIn).getTime()) / MS_PER_DAY))
})
// Tasa real del hotel (GET /api/facturas/tax-rate — misma fuente que usa la factura final).
const taxRatePct = ref(0)

// ── Precio por temporada ────────────────────────────────────────────────────────────────
// Antes el wizard cotizaba `basePrice × noches` acá en el frontend e ignoraba la grilla de
// temporadas: una reserva manual para fechas de temporada alta se creaba al precio base. Ahora
// cotiza el backend (`POST /api/reservas/quote`) con la MISMA cadena que el motor público
// (season_assignments → room_rates → fallback basePrice) y muestra el desglose por temporada.
// Al guardar, el backend recalcula autoritativo (`priceFrom:'rates'`) — el quote de acá es UX,
// nunca la fuente de verdad. Si el operador fija precio manual, se manda `priceFrom:'manual'`
// y el total tal cual (comportamiento histórico: precio pactado).
const stayQuote = ref<StayQuote | null>(null)
const quoteLoading = ref(false)
const manualPrice = ref(false)
const manualSubtotal = ref<number | null>(null)

async function refreshQuote() {
  const { roomId, checkIn, checkOut, adults } = form.value
  if (!roomId || !checkIn || !checkOut || checkOut <= checkIn) { stayQuote.value = null; return }
  quoteLoading.value = true
  try {
    stayQuote.value = await ReservationService.stayQuote({ roomId: String(roomId), checkIn, checkOut, guests: Number(adults) || 2 })
  } catch {
    // Sin quote, se cotiza basePrice × noches como antes — no se rompe el alta.
    stayQuote.value = null
  } finally {
    quoteLoading.value = false
  }
}
let quoteDebounceId: ReturnType<typeof setTimeout> | null = null
watch([() => form.value.checkIn, () => form.value.checkOut, () => form.value.roomId, () => form.value.adults], () => {
  if (quoteDebounceId) clearTimeout(quoteDebounceId)
  quoteDebounceId = setTimeout(refreshQuote, 300)
}, { immediate: true })

const subtotal = computed(() => {
  if (manualPrice.value && manualSubtotal.value !== null) return Number(manualSubtotal.value) || 0
  if (stayQuote.value) return stayQuote.value.subtotal
  return selRoom.value ? selRoom.value.basePrice * nights.value : 0
})
const taxes = computed(() => Math.round(subtotal.value * (taxRatePct.value / 100)))

/** Desglose por temporada para el resumen: [{label, color, nights, subtotal}] en orden de aparición. */
const seasonRows = computed(() => {
  const q = stayQuote.value
  if (!q) return []
  const rows: { key: string; label: string; color: string | null; nights: number; subtotal: number; fromRate: boolean }[] = []
  for (const n of q.nights) {
    const key = n.season ?? '__base__'
    const label = n.season ? (n.seasonLabel ?? n.season) : 'Tarifa base'
    const last = rows[rows.length - 1]
    if (last && last.key === key) { last.nights++; last.subtotal += n.price }
    else rows.push({ key, label, color: n.seasonColor, nights: 1, subtotal: n.price, fromRate: n.fromRate })
  }
  return rows
})
/** `true` cuando TODAS las noches son de la misma temporada (o todas base) — permite "N × $X". */
const singleSeason = computed(() => seasonRows.value.length === 1)

// FIX 2026-07-31 — el campo "Código promocional" no aplicaba ningún descuento (solo se
// guardaba como texto). Preview vía POST /api/promo-codes/preview (sin permiso promo:view,
// hotelId sale del token). El backend re-valida de forma autoritativa al crear la reserva
// (connectors/reservas-promocodes.ts) — este preview es solo UX, nunca la fuente de verdad.
const promoDiscount = ref(0)
const promoChecking = ref(false)
const promoError = ref('')
const promoApplied = ref(false)
let promoDebounceId: ReturnType<typeof setTimeout> | null = null

function promoReasonLabel(reason?: string): string {
  const m: Record<string, string> = {
    not_found: 'Código no válido.',
    inactive: 'Código inactivo.',
    expired: 'Código vencido.',
    max_uses_reached: 'Código agotado.',
    min_amount_not_met: 'No alcanza el monto mínimo para este código.',
  }
  return m[reason || ''] || 'No se pudo aplicar el código.'
}

async function checkPromoCode() {
  const code = form.value.promoCode.trim()
  if (!code || !subtotal.value) {
    promoDiscount.value = 0
    promoApplied.value = false
    promoError.value = ''
    return
  }
  promoChecking.value = true
  try {
    const res = await PromoCodeService.preview(code, subtotal.value)
    if (res.valid) {
      promoDiscount.value = res.discount
      promoApplied.value = true
      promoError.value = ''
    } else {
      promoDiscount.value = 0
      promoApplied.value = false
      promoError.value = promoReasonLabel(res.reason)
    }
  } catch {
    promoDiscount.value = 0
    promoApplied.value = false
    promoError.value = 'No se pudo validar el código'
  } finally {
    promoChecking.value = false
  }
}

watch([() => form.value.promoCode, subtotal], () => {
  if (promoDebounceId) clearTimeout(promoDebounceId)
  promoDebounceId = setTimeout(checkPromoCode, 400)
})

const total = computed(() => Math.max(0, subtotal.value + taxes.value - promoDiscount.value))
const pend = computed(() => Math.max(0, total.value - (form.value.deposit || 0)))

// ── Validación del wizard ──
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
const step1Attempted = ref(false)
const step4Attempted = ref(false)
const emergencyAttempted = ref(false)

const emailFormatError = computed(() => {
  const e = form.value.email.trim()
  if (!e) return ''
  return EMAIL_RE.test(e) ? '' : 'Formato de email inválido'
})
const emergencyEmailFormatError = computed(() => {
  const e = form.value.emergencyEmail.trim()
  if (!e) return ''
  return EMAIL_RE.test(e) ? '' : 'Formato de email inválido'
})
const nameError = computed(() => step1Attempted.value && !form.value.name.trim() ? 'El nombre es obligatorio' : '')
const contactError = computed(() => step1Attempted.value && !form.value.email.trim() && !form.value.phone.trim() ? 'Ingresá al menos un email o teléfono' : '')
const emailError = computed(() => step1Attempted.value ? emailFormatError.value : '')

// Contacto de emergencia: 100% opcional COMO GRUPO — pero si se completa cualquier otro
// dato del bloque (teléfono, parentesco o email), el nombre pasa a ser obligatorio (no
// tiene sentido un contacto de emergencia sin nombre para llamar).
const emergencyHasOtherData = computed(() => !!(form.value.emergencyPhone?.trim() || form.value.emergencyRelation || form.value.emergencyEmail?.trim()))
const emergencyNameMissing = computed(() => emergencyHasOtherData.value && !form.value.emergencyName?.trim())
const emergencyNameError = computed(() => emergencyAttempted.value && emergencyNameMissing.value ? 'El nombre es obligatorio si completás algún otro dato de emergencia' : '')

// #648 — si la habitación elegida quedó marcada no disponible (cambiaron las fechas después de
// elegirla, o la anotación llegó recién), se lo decimos ANTES de que el backend la rechace con 409.
const selectedRoomUnavailable = computed(() => {
  if (!form.value.roomId) return false
  // En edición: la habitación ORIGINAL de la reserva no se considera "no disponible" aunque el
  // endpoint /api/habitaciones la marque así — es la propia reserva la que la ocupa en la ventana.
  // Sin esto, cualquier edición (cambiar adults, datos del huésped, etc.) queda trabada en el paso
  // 4 porque el wizard cree que la habitación ya no está disponible. Cambiar a OTRA habitación sí
  // valida la disponibilidad normal.
  if (isEdit.value && form.value.roomId === originalRoomId.value) return false
  const sel = roomsForSelect.value.find((r: any) => r.id === form.value.roomId)
  return sel?.available === false
})
const roomError = computed(() => {
  if (!step4Attempted.value) return ''
  if (!form.value.roomId) return 'Seleccioná una habitación'
  if (selectedRoomUnavailable.value) return 'Esa habitación no está disponible esas fechas: elegí otra'
  return ''
})
// #663 — el check-in en el pasado no bloqueaba (checkout<checkin y mismo día sí funcionaban,
// faltaba el chequeo obvio). Solo aplica al CREAR: una reserva existente puede tener legítimamente
// checkIn pasado (ya hizo check-in, se está editando otro dato) y no hay que bloquear ese guardado.
const todayISO = new Date().toISOString().slice(0, 10)
const checkInError = computed(() => {
  if (!step4Attempted.value) return ''
  if (!form.value.checkIn) return 'Seleccioná la fecha de check-in'
  if (!isEdit.value && form.value.checkIn < todayISO) return 'El check-in no puede ser anterior a hoy'
  return ''
})
const checkOutError = computed(() => {
  if (!step4Attempted.value) return ''
  if (!form.value.checkOut) return 'Seleccioná la fecha de check-out'
  if (form.value.checkIn && form.value.checkOut <= form.value.checkIn) return 'Debe ser posterior al check-in'
  return ''
})

function isStep1Valid() {
  return !!form.value.name.trim() && (!!form.value.email.trim() || !!form.value.phone.trim()) && !emailFormatError.value
}
function isStep4Valid() {
  return !!form.value.roomId && !!form.value.checkIn && !!form.value.checkOut && form.value.checkOut > form.value.checkIn && !selectedRoomUnavailable.value
    && (isEdit.value || form.value.checkIn >= todayISO)
}

function goToStep(n: number) {
  if (n <= wizardStep.value) { wizardStep.value = n; return }
  if (n > 1) {
    step1Attempted.value = true
    if (!isStep1Valid()) { toast.error('Completá los campos obligatorios de Huésped'); return }
  }
  if (n > 3) {
    emergencyAttempted.value = true
    if (emergencyNameMissing.value) { toast.error('El nombre es obligatorio si completás algún otro dato de emergencia'); return }
  }
  if (n > 4) {
    step4Attempted.value = true
    if (!isStep4Valid()) { toast.error('Completá los campos obligatorios de Alojamiento'); return }
  }
  wizardStep.value = n
}

function goNextStep() {
  if (wizardStep.value < WIZARD_STEPS.length) goToStep(wizardStep.value + 1)
}

const regimeLabel = computed(() => {
  const m: Record<string, string> = {
    room_only: 'Sólo alojamiento', breakfast: 'Desayuno incluido',
    half_board: 'Media pensión', full_board: 'Pensión completa', all_inclusive: 'Todo incluido',
  }
  return m[form.value.regime] || form.value.regime
})

function stLabel(s: string) { const m: any = { pending: 'Pendiente', confirmed: 'Confirmada', checked_in: 'Check-in', checked_out: 'Check-out', cancelled: 'Cancelada' }; return m[s] || s }
function stBtnActive(s: string) { const m: any = { pending: 'border-gold bg-gold text-white', confirmed: 'border-blue-500 bg-blue-500 text-white', checked_in: 'border-teal bg-teal text-white', cancelled: 'border-coral bg-coral text-white' }; return m[s] || '' }

function formatCardNumber() {
  let v = form.value.cardNumber.replace(/\D/g, '').substring(0, 16)
  form.value.cardNumber = v.replace(/(.{4})/g, '$1 ').trim()
}

// Caducidad como MM/AAAA (ej: 12/2024). Inserta la '/' automáticamente y sincroniza mes/año.
function formatExpiry() {
  const digits = form.value.cardExpiry.replace(/\D/g, '').slice(0, 6)
  let month = digits.slice(0, 2)
  if (month.length === 2) {
    if (Number(month) === 0) month = '01'
    else if (Number(month) > 12) month = '12'
  }
  const year = digits.slice(2)
  form.value.cardExpiry = year.length ? `${month}/${year}` : month
  form.value.cardExpMonth = month.length === 2 ? month : ''
  form.value.cardExpYear = year.length === 4 ? year : ''
}

function calcDepositFromPercentage() {
  form.value.deposit = Math.round(total.value * (form.value.depositPercentage || 0) / 100)
}

// #667 — el anticipo solo se recalculaba en el evento @input del % (nunca al cargar el default
// 100%, ni cuando `total` cambia por otro motivo: elegir habitación/fechas después, promo code
// aplicado). Resultado real reportado: con el 100% de fábrica sin tocar, "Anticipo" mostraba $0
// mientras "Total" ya tenía un valor. `formReady` evita pisar el depósito real cargado en edición
// (loadForEdit) — solo se auto-recalcula tras cambios genuinos del usuario o de las fechas/precio.
watch([total, () => form.value.depositPercentage], () => {
  if (!formReady.value) return
  calcDepositFromPercentage()
})

function resetForm() {
  form.value = {
    name: '', email: '', phone: '',
    language: 'Español', country: 'República Dominicana', nationality: 'Dominicana',
    address: '', city: '', province: '',
    sex: '', birthDate: '',
    documentType: 'dni', document: '', documentIssueDate: '',
    communicateClient: 'none', guestNotes: '',
    emergencyName: '', emergencyPhone: '', emergencyRelation: '', emergencyEmail: '',
    checkIn: '', checkOut: '', roomId: '', adults: 2, children: 0,
    regime: 'room_only', promoCode: '',
    source: 'direct', commission: 0, commissionAmount: 0, extLocator: '', otaNotes: '',
    cardHolder: '', cardBrand: 'visa', cardNumber: '', cardCvv: '', cardExpMonth: '', cardExpYear: '', cardExpiry: '',
    depositPercentage: 100, deposit: 0, depositStatus: 'unpaid', payMethod: 'transfer',
    status: 'pending', notes: '', autoSendEnabled: true, companions: [],
  }
  existingGuarantee.value = false
  originalRoomId.value = ''
  selectedGuestId.value = null
  guestSearch.value = ''
  guestResults.value = []
  manualPrice.value = false
  manualSubtotal.value = null
  stayQuote.value = null
  guestSearchOpen.value = false
  guestSearching.value = false
  promoDiscount.value = 0
  promoApplied.value = false
  promoError.value = ''
}

// Buscador de huésped existente: evita duplicar huéspedes al crear reserva.
// `guestSearching` bloquea el resto del Paso 1 (y el botón Siguiente) mientras la
// búsqueda está en vuelo: evita que el staff arranque a tipear un huésped "nuevo"
// antes de saber si ya existe.
const guestSearch = ref('')
const guestResults = ref<Guest[]>([])
const guestSearchOpen = ref(false)
const guestSearching = ref(false)
const selectedGuestId = ref<string | null>(null)
let guestSearchTimer: ReturnType<typeof setTimeout> | null = null

async function onGuestSearchInput(e: Event) {
  guestSearch.value = (e.target as HTMLInputElement).value
  selectedGuestId.value = null
  if (guestSearchTimer) clearTimeout(guestSearchTimer)
  const q = guestSearch.value.trim()
  if (q.length < 2) { guestResults.value = []; guestSearchOpen.value = false; guestSearching.value = false; return }
  guestSearching.value = true
  guestSearchTimer = setTimeout(async () => {
    try {
      const { GuestService } = await import('@/services/Guest.service')
      const r = await GuestService.list({ hotelId: hid.value!, search: q })
      guestResults.value = r.guests.slice(0, 8)
      guestSearchOpen.value = true
    } catch {
      guestResults.value = []
      guestSearchOpen.value = false
    } finally {
      guestSearching.value = false
    }
  }, 300)
}

function selectGuest(g: Guest) {
  selectedGuestId.value = g.id
  guestSearch.value = g.name || ''
  guestSearchOpen.value = false
  const f = form.value
  f.name = g.name || ''
  f.email = g.email || ''
  f.phone = g.phone || ''
  f.documentType = g.documentType || 'dni'
  f.document = g.document || ''
  f.documentIssueDate = g.documentIssueDate || ''
  f.nationality = g.nationality || 'Dominicana'
  f.country = g.country || g.nationality || 'República Dominicana'
  f.language = g.language || 'Español'
  f.sex = g.sex || ''
  f.birthDate = g.birthDate || ''
  f.address = g.address || ''
  f.city = g.city || ''
  f.province = g.province || ''
  f.guestNotes = g.notes || ''
  f.communicateClient = (g.communicateClient as string) || 'none'
}

function blurGuestSearch() {
  setTimeout(() => { guestSearchOpen.value = false }, 150)
}

// Acompañantes (companions): alta/edición inline en el form. La sync con el backend
// ya existe en save() (create/update/delete diff) — estas funciones solo manejan la UI.
function addCompanion() {
  form.value.companions.push({ name: '', documentNumber: '', documentType: 'passport', nationality: form.value.nationality || '' })
}
function removeCompanion(i: number) {
  form.value.companions.splice(i, 1)
}

async function save() {
  err.value = ''
  // Validación de campos obligatorios (igual que MisterPlan): nombre, habitación,
  // fechas coherentes y al menos un contacto. La disponibilidad de la habitación la valida el backend.
  step1Attempted.value = true
  step4Attempted.value = true
  if (!isStep1Valid()) {
    wizardStep.value = 1
    err.value = 'Completá los campos obligatorios de Huésped: ' + [nameError.value, contactError.value, emailFormatError.value].filter(Boolean).join(', ') + '.'
    return
  }
  if (!isStep4Valid()) {
    wizardStep.value = 4
    err.value = 'Completá los campos obligatorios de Alojamiento: ' + [roomError.value, checkInError.value, checkOutError.value].filter(Boolean).join(', ') + '.'
    return
  }
  saving.value = true
  try {
    // 1. Crear/actualizar huésped
    const guestPayload = {
      name: form.value.name,
      email: form.value.email,
      phone: form.value.phone,
      nationality: form.value.nationality,
      language: form.value.language,
      country: form.value.country,
      sex: form.value.sex,
      birthDate: form.value.birthDate,
      address: form.value.address,
      city: form.value.city,
      province: form.value.province,
      documentType: form.value.documentType,
      document: form.value.document,
      documentIssueDate: form.value.documentIssueDate,
      notes: form.value.guestNotes,
      communicateClient: form.value.communicateClient,
    }

    let guestId: string | undefined = undefined
    try {
      const { GuestService } = await import('@/services/Guest.service')
      if (props.editId) {
        // Editar: ya tiene guestId
        const existing = await ReservationService.getById(props.editId)
        if (existing?.guestId) {
          await GuestService.update(existing.guestId, guestPayload)
          guestId = existing.guestId
        }
      } else if (selectedGuestId.value) {
        // Huésped existente seleccionado del buscador: reutilizar (no crear nuevo).
        await GuestService.update(selectedGuestId.value, guestPayload)
        guestId = selectedGuestId.value
      } else {
        // Crear nuevo guest
        const newGuest = await GuestService.create({ hotelId: hid.value!, ...guestPayload })
        guestId = newGuest?.id
      }
    } catch { /* fallback: guest opcional */ }

    // 2. Crear/actualizar reserva
    const reservationPayload: any = {
      roomId: form.value.roomId,
      guestId,
      checkIn: form.value.checkIn,
      checkOut: form.value.checkOut,
      channel: form.value.source,
      source: form.value.source,
      // FIX 2026-07-31 — el payload nunca mandaba promoCode: el backend jamás se enteraba
      // del código (validate/incrementUses en connectors/reservas-promocodes.ts) aunque el
      // wizard ya mostrara el descuento en el resumen. Solo se manda si quedó validado.
      promoCode: promoApplied.value ? form.value.promoCode.trim().toUpperCase() : undefined,
      // Precio por temporada: sin edición manual el backend recalcula el alojamiento con la
      // grilla (priceFrom:'rates', fuente de verdad server-side); con precio manual se manda el
      // total pactado tal cual (priceFrom:'manual', comportamiento histórico). Manual tildado
      // SIN valor cargado cuenta como 'rates' (coincide con el subtotal que se está mostrando).
      // taxesAmount / promoDiscountAmount son los aditamentos NO-lodging que el total lleva arriba.
      priceFrom: (manualPrice.value && manualSubtotal.value !== null) ? 'manual' : 'rates',
      taxesAmount: taxes.value,
      promoDiscountAmount: promoApplied.value ? promoDiscount.value : 0,
      totalAmount: total.value,
      status: form.value.status,
      notes: form.value.notes,
      adults: form.value.adults,
      children: form.value.children,
      deposit: form.value.deposit,
      paymentMethod: form.value.payMethod,
      commission: form.value.commission,
      commissionAmount: Math.round(total.value * form.value.commission / 100),
      externalLocator: form.value.extLocator,
      otaNotes: form.value.otaNotes,
      autoSendEnabled: !!form.value.autoSendEnabled,
    }

    // Tarjeta de garantía: se guarda solo si se ingresó un número válido (nueva o reemplazo).
    // Nunca se envía el número completo ni el CVV (PCI) — solo últimos 4 + datos parciales.
    const cardDigits = (form.value.cardNumber || '').replace(/\D/g, '')
    if (form.value.cardHolder && cardDigits.length >= 12) {
      reservationPayload.cardHolder = form.value.cardHolder
      reservationPayload.cardBrand = form.value.cardBrand
      reservationPayload.cardLast4 = cardDigits.slice(-4)
      reservationPayload.cardExpMonth = form.value.cardExpMonth
      reservationPayload.cardExpYear = form.value.cardExpYear
      reservationPayload.hasGuaranteeCard = true
    }

    let reservationId = props.editId
    if (props.editId) {
      await ReservationService.update(props.editId, reservationPayload)
    } else {
      const created: any = await ReservationService.create({
        hotelId: hid.value!,
        ...reservationPayload,
      } as any)
      reservationId = created?.id || created?.reservationId
    }

    // 3. Sincronizar companions
    if (reservationId) {
      const existing = await CompanionsService.listByReservation(reservationId)
      const existingIds = new Set(existing.data.map(c => c.id).filter((id): id is string => Boolean(id)))
      for (const c of form.value.companions) {
        if (c.id && existingIds.has(c.id)) {
          await CompanionsService.update(c.id, { name: c.name, documentNumber: c.documentNumber, documentType: c.documentType, nationality: c.nationality })
          existingIds.delete(c.id)
        } else if (c.name) {
          await CompanionsService.create(reservationId, { name: c.name, documentNumber: c.documentNumber, documentType: c.documentType || 'passport', nationality: c.nationality })
        }
      }
      for (const id of existingIds) { await CompanionsService.remove(id) }
    }

    toast.success(props.editId ? 'Reserva actualizada' : 'Reserva creada')
    emit('saved')
  } catch (e: any) {
    err.value = e.message || 'Error al guardar'
  }
  saving.value = false
}

// ── Acciones ──
async function generateLockCode() {
  if (!props.editId) { toast.error('Guarda la reserva primero'); return }
  try {
    const code = await TTLockService.generateCode(props.editId)
    lockCode.value = code.code || ''
    toast.success(`Código generado: ${lockCode.value}`)
  } catch (e: any) { toast.error(e.message || 'Sin cerradura asignada') }
}

async function createPaymentRequest() {
  if (!props.editId) { toast.error('Guarda la reserva primero'); return }
  if (pend.value <= 0) { toast.info('Sin monto pendiente'); return }
  try {
    await PaymentsService.create({ reservationId: props.editId, amount: pend.value, sentTo: form.value.email, sentVia: 'email' })
    toast.success('Requerimiento de pago creado')
  } catch (e: any) { toast.error(e.message || 'Error') }
}

function sendPayLink(ch: string) {
  const g = form.value.name
  const a = pend.value; const e = form.value.email; const p = form.value.phone
  if (ch === 'email' && e) { window.open(`mailto:${e}?subject=${encodeURIComponent('Pago pendiente - ' + g)}&body=${encodeURIComponent('Hola ' + g + ', tu reserva tiene $' + a + ' pendientes.')}`); toast.success('Email abierto') }
  else if (ch === 'whatsapp' && p) { window.open(`https://wa.me/${p.replace(/\D/g, '')}?text=${encodeURIComponent('Hola ' + g + ', pago pendiente: $' + a)}`); toast.success('WhatsApp abierto') }
  else { toast.error('Falta email/teléfono') }
}

// ── Carga inicial: reserva existente (editId) o prellenado desde el Calendario (prefill) ──
async function loadForEdit(id: string) {
  try {
    const ext = await ReservationService.getById(id)
    const f = form.value
    f.checkIn = ext.checkIn
    f.checkOut = ext.checkOut
    f.roomId = ext.roomId || ''
    // Trackear la habitación original para el bypass de selectedRoomUnavailable (ver comentario
    // de la ref originalRoomId arriba).
    originalRoomId.value = ext.roomId || ''
    f.adults = ext.adults || 2
    f.children = ext.children || 0
    f.status = ext.status
    f.source = ext.source || 'direct'
    f.notes = ext.notes || ''
    f.payMethod = ext.paymentMethod || 'transfer'
    existingGuarantee.value = !!ext.hasGuaranteeCard
    f.deposit = ext.deposit || 0
    f.depositPercentage = ext.depositPercentage ?? 100
    f.depositStatus = ext.depositStatus || 'unpaid'
    // Precio PACTADO de la reserva: en edición se muestra el total existente (no la tarifa
    // vigente) para no pisarlo al guardar — antes el wizard mandaba basePrice × noches y
    // editar una reserva a $150 la dejaba en el precio base sin que nadie lo pidiera.
    // El operador puede desmarcarlo para repreciar a tarifa vigente (temporadas incl.).
    manualPrice.value = true
    manualSubtotal.value = Number(ext.totalAmount) || 0
    f.commission = ext.commission || 0
    f.extLocator = ext.externalLocator || ''
    f.otaNotes = ext.otaNotes || ''
    f.autoSendEnabled = ext.autoSendEnabled ?? true
    if (ext.guest) {
      const g = ext.guest
      f.name = g.name || ''
      f.email = g.email || ''
      f.phone = g.phone || ''
      f.language = g.language || 'Español'
      f.country = g.country || 'República Dominicana'
      f.nationality = g.nationality || 'República Dominicana'
      f.address = g.address || ''
      f.city = g.city || ''
      f.province = g.province || ''
      f.sex = g.sex || ''
      f.birthDate = g.birthDate || ''
      f.documentType = g.documentType || 'dni'
      f.document = g.document || ''
      f.documentIssueDate = g.documentIssueDate || ''
      f.guestNotes = g.notes || ''
      f.communicateClient = g.communicateClient || 'none'
    }
    if (ext.emergencyContact) {
      f.emergencyName = ext.emergencyContact.name || ''
      f.emergencyPhone = ext.emergencyContact.phone || ''
      f.emergencyRelation = ext.emergencyContact.relation || ''
      f.emergencyEmail = ext.emergencyContact.email || ''
    }
    form.value.companions = (ext.companions || []).map((c: any) => ({
      id: c.id, name: c.name || '', documentNumber: c.documentNumber || '',
      documentType: c.documentType, nationality: c.nationality,
    }))
    if (ext.lockCodes?.length) lockCode.value = ext.lockCodes[0].code || ''
  } catch (e) {
    console.warn('[ReservationWizardModal/loadForEdit]', e)
    toast.info('Algunos datos de la reserva no se pudieron cargar')
  }
}

watch(() => props.editId, async (id) => {
  formReady.value = false
  err.value = ''
  lockCode.value = ''
  resetForm()
  step1Attempted.value = false
  step4Attempted.value = false
  emergencyAttempted.value = false
  wizardStep.value = 1
  if (id) {
    await loadForEdit(id)
  } else if (props.prefill) {
    if (props.prefill.roomId) form.value.roomId = props.prefill.roomId
    if (props.prefill.checkIn) form.value.checkIn = props.prefill.checkIn
    if (props.prefill.checkOut) form.value.checkOut = props.prefill.checkOut
    // Duplicar reserva (#631): traer además los datos de la reserva origen — canal, ocupación
    // y el huésped. Cargamos el guest completo por id para REUTILIZARLO (selectGuest marca
    // selectedGuestId + llena el form con sus datos reales): así el guardado hace update del
    // guest con sus propios datos, no lo pisa con campos vacíos.
    if (props.prefill.adults != null) form.value.adults = props.prefill.adults
    if (props.prefill.children != null) form.value.children = props.prefill.children
    if (props.prefill.source) form.value.source = props.prefill.source
    if (props.prefill.guestId) {
      try {
        const { GuestService } = await import('@/services/Guest.service')
        const g = await GuestService.get(props.prefill.guestId)
        if (g) selectGuest(g)
      } catch (e) {
        console.warn('[ReservationWizardModal/prefill] no se pudo cargar el huésped a duplicar', e)
      }
    }
  }
  // Recién ahora se activa el sync país↔nacionalidad: lo anterior fue carga
  // programática (reset o datos de la reserva), no una elección del usuario.
  await nextTick()
  countryTouched.value = false
  nationalityTouched.value = false
  formReady.value = true
}, { immediate: true })

// El padre monta/desmonta este componente con v-if: su sola existencia ES el modal
// abierto, así que el bloqueo de scroll del body va en el ciclo de vida del componente
// (mismo patrón que AppModal.vue) — sin esto, la rueda del mouse sobre el modal también
// scrollea la página de atrás.
onMounted(() => { document.body.style.overflow = 'hidden'; pushModal() })
onBeforeUnmount(() => { document.body.style.overflow = ''; popModal() })

// Silencioso a propósito: sin tasa configurada, taxRatePct queda en 0 y el wizard
// simplemente no desglosa impuesto — mejor eso que romper la apertura del modal.
BillingService.taxRate().then((r) => { taxRatePct.value = r }).catch(() => {})
</script>

<style scoped>
.modal-fade-enter-active, .modal-fade-leave-active { transition: opacity 0.2s ease; }
.modal-fade-enter-active .modal-panel, .modal-fade-leave-active .modal-panel { transition: transform 0.2s ease, opacity 0.2s ease; }
.modal-fade-enter-from, .modal-fade-leave-to { opacity: 0; }
.modal-fade-enter-from .modal-panel, .modal-fade-leave-to .modal-panel { opacity: 0; transform: translateY(8px) scale(0.98); }
</style>
