<template>
  <div class="bg-white min-h-screen">

    <!-- ═══ TOP BAR — oscura, editorial, un solo CTA ═══ -->
    <nav
      class="fixed top-0 inset-x-0 z-50 transition-all duration-300"
      :class="scrolled ? 'bg-[rgba(6,20,40,0.95)] backdrop-blur-xl shadow-[0_1px_24px_rgba(0,0,0,0.35)]' : 'bg-transparent'"
    >
      <div class="max-w-[1600px] pl-6 sm:pl-10 lg:pl-16 pr-6 h-[4.5rem] flex items-center justify-between">
        <router-link to="/" class="flex items-center group">
          <img :src="logoWhite" alt="SolmiOS" class="h-8 w-auto">
        </router-link>
        <div class="hidden lg:flex items-center gap-8">
          <button type="button" @click="scrollTo('solucion')" class="text-xs font-bold tracking-wide text-white/60 hover:text-white uppercase transition-colors">Módulos</button>
          <button type="button" @click="scrollTo('oferta')" class="text-xs font-bold tracking-wide text-white/60 hover:text-white uppercase transition-colors">Precios</button>
          <button type="button" @click="scrollTo('contador')" class="text-xs font-bold tracking-wide text-white/60 hover:text-white uppercase transition-colors">Fundadores</button>
          <button type="button" @click="scrollTo('faq')" class="text-xs font-bold tracking-wide text-white/60 hover:text-white uppercase transition-colors">FAQ</button>
        </div>
        <a
          href="#formulario"
          class="inline-flex items-center gap-2 font-extrabold text-xs tracking-wide uppercase px-5 py-2.5 rounded-lg border border-cyan-light/40 text-cyan-light hover:bg-cyan-light hover:text-navy-deep transition-all duration-300 whitespace-nowrap"
        >Reservar mi cupo</a>
      </div>
    </nav>

    <!-- ═══ SECCIÓN 1 — HERO — editorial oscuro, foto a sangre completa, sin card ═══ -->
    <section id="hero" class="relative w-full overflow-hidden bg-navy-deep pt-32 md:pt-40 pb-16 lg:pb-24">
      <!-- Fondo: grid + glows -->
      <div class="absolute inset-0 hero-grid opacity-[0.35] pointer-events-none"></div>
      <div class="absolute top-[-10%] right-[-5%] w-[560px] h-[560px] rounded-full bg-cyan-light/10 blur-[120px] pointer-events-none"></div>
      <div class="absolute bottom-[-20%] left-[-10%] w-[420px] h-[420px] rounded-full bg-blue/10 blur-[110px] pointer-events-none"></div>

      <!-- Foto a sangre completa hasta el borde real de la pantalla (desktop) — sin recuadro, se funde con el fondo -->
      <div class="hero-photo-fade hidden lg:block absolute inset-y-0 right-0 w-[56%] xl:w-[58%] pointer-events-none">
        <img :src="stressedManagerImage" alt="Dueño de hotel calculando cuánto pierde en comisiones" class="w-full h-full object-cover object-[72%_center]">
        <div class="absolute inset-0 bg-gradient-to-r from-navy-deep via-[rgba(6,20,40,0.15)] to-transparent"></div>
        <div class="absolute inset-x-0 top-0 h-32 bg-gradient-to-b from-navy-deep to-transparent"></div>
        <div class="absolute inset-x-0 bottom-0 h-48 bg-gradient-to-t from-navy-deep to-transparent"></div>
        <div class="absolute inset-0 bg-gradient-to-br from-cyan-light/10 via-transparent to-transparent mix-blend-overlay"></div>
        <!-- Glow inferior -->
        <div class="absolute bottom-14 left-10 right-10 h-px bg-gradient-to-r from-transparent via-cyan-light/60 to-transparent"></div>
      </div>
      <!-- Línea de tendencia decorativa -->
      <svg class="hero-line-fade hidden lg:block absolute top-24 right-14 w-[36%] h-36 pointer-events-none" viewBox="0 0 300 100" fill="none">
        <path d="M0 80 L40 65 L70 72 L100 40 L140 50 L180 20 L220 32 L260 8 L300 15" stroke="#48CAE4" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
      </svg>

      <div class="relative z-10 max-w-[1600px] pl-6 sm:pl-10 lg:pl-16 pr-6">
        <div class="lg:max-w-[36rem]">
          <div class="hero-fade-up inline-flex items-center gap-2 mb-7 px-3.5 py-1.5 rounded-full bg-cyan-light/10 border border-cyan-light/25">
            <span class="w-1.5 h-1.5 rounded-full bg-cyan-light animate-pulse"></span>
            <span class="text-[11px] font-extrabold tracking-wide text-cyan-light uppercase">Programa Hotel Fundador · Ola 1</span>
          </div>

          <h1 class="hero-fade-up hero-title text-white mb-2" style="animation-delay:.06s">Dejar de perder</h1>
          <h1 class="hero-fade-up hero-title hero-title-accent mb-6" style="animation-delay:.1s">dinero<br>todos los días.</h1>

          <p class="hero-fade-up hero-body text-white/50 mb-10" style="animation-delay:.16s">
            Su hotel ya está pagando mucho más por operar sin sistema que lo que cuesta tener el control total.
          </p>

          <!-- Comparación de costos -->
          <div class="hero-fade-up flex items-center gap-6 sm:gap-10 mb-9 flex-wrap" style="animation-delay:.2s">
            <div>
              <div class="text-[11px] font-bold tracking-wide text-white/40 uppercase mb-1.5">Lo que pierde al mes</div>
              <div class="text-4xl sm:text-5xl font-black text-white/90">$1,700</div>
              <div class="text-xs text-white/40 mt-1">USD en comisiones</div>
            </div>
            <div class="text-xl font-black text-white/20 italic">vs</div>
            <div>
              <div class="text-[11px] font-bold tracking-wide text-cyan-light/70 uppercase mb-1.5">SolmiOS cuesta</div>
              <div class="text-4xl sm:text-5xl font-black text-cyan-light">$209</div>
              <div class="text-xs text-white/40 mt-1">USD al mes</div>
            </div>
          </div>

          <!-- CTAs -->
          <div class="hero-fade-up flex flex-wrap gap-3.5" style="animation-delay:.26s">
            <a
              href="#formulario"
              class="group inline-flex flex-col items-start gap-0.5 bg-cyan-light text-navy-deep font-black text-sm px-7 py-3.5 rounded-xl hover:-translate-y-0.5 transition-all duration-300 shadow-[0_16px_40px_rgba(0,180,216,0.25)]"
            >
              <span class="inline-flex items-center gap-2">Reservar mi cupo
                <svg class="w-4 h-4 group-hover:translate-x-1 transition-transform" fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="3"><path stroke-linecap="round" stroke-linejoin="round" d="M17 8l4 4m0 0l-4 4m4-4H3"/></svg>
              </span>
              <span class="text-[10px] font-bold opacity-70 normal-case">Depósito 100% reembolsable</span>
            </a>
            <button type="button" @click="scrollTo('calculadora')"
              class="inline-flex items-center gap-2.5 border border-white/15 text-white font-semibold text-sm px-7 py-3.5 rounded-xl hover:border-white/30 hover:bg-white/5 transition-colors"
            >
              <svg class="w-8 h-8 -ml-1.5 shrink-0" fill="none" viewBox="0 0 24 24"><circle cx="12" cy="12" r="11" stroke="currentColor" stroke-width="1.3" opacity=".4"/><path d="M10 8.5l6 3.5-6 3.5V8.5z" fill="currentColor"/></svg>
              Calcular lo que pierdo<br class="hidden sm:block">en comisiones
            </button>
          </div>
        </div>

        <!-- Foto apilada (mobile/tablet) — sin recuadro, mismo criterio de fundido -->
        <div class="lg:hidden hero-fade-up relative mt-12 -mx-6" style="animation-delay:.18s">
          <img :src="stressedManagerImage" alt="Dueño de hotel calculando cuánto pierde en comisiones" class="w-full h-auto object-cover aspect-[4/3.6]">
          <div class="absolute inset-x-0 top-0 h-20 bg-gradient-to-b from-navy-deep to-transparent"></div>
          <div class="absolute inset-x-0 bottom-0 h-28 bg-gradient-to-t from-navy-deep to-transparent"></div>
        </div>

        <!-- HUD flotante: pérdidas del mes — apilada en mobile, flotante sobre la foto en desktop -->
        <div class="hero-fade-up relative z-10 -mt-14 mx-4 lg:mx-0 lg:absolute lg:mt-0 lg:top-4 lg:left-[44%] w-auto lg:w-72 rounded-2xl bg-[rgba(6,20,40,0.95)] lg:bg-[rgba(6,20,40,0.9)] backdrop-blur-xl border border-white/10 shadow-2xl p-6" style="animation-delay:.22s">
          <div class="text-xs font-extrabold tracking-wide text-white/40 uppercase mb-4">Pérdidas del mes</div>
          <div class="space-y-2.5 mb-4">
            <div v-for="l in lossBreakdown" :key="l.label" class="flex items-center justify-between text-sm">
              <span class="text-white/50">{{ l.label }}</span>
              <span class="font-bold text-white/85">${{ l.amount }}</span>
            </div>
          </div>
          <div class="border-t border-white/10 pt-3 flex items-center justify-between">
            <span class="text-sm font-extrabold text-white uppercase">Total</span>
            <span class="text-2xl font-black text-cyan-light">${{ formatMoney(heroMonthlyLoss) }}</span>
          </div>
        </div>

        <!-- Trust bar — responsive: apilada con separadores horizontales en mobile, grid en tablet, fila única con separadores verticales en desktop -->
        <div class="hero-fade-up mt-14 pt-8 border-t border-white/10 grid grid-cols-1 divide-y divide-white/10 sm:grid-cols-2 sm:gap-x-8 sm:gap-y-5 sm:divide-y-0 lg:flex lg:flex-wrap lg:divide-x lg:divide-white/10" style="animation-delay:.32s">
          <div v-for="tb in heroTrustBar" :key="tb.label" class="flex items-center gap-3 py-4 first:pt-0 sm:py-0 lg:flex-1 lg:min-w-[8rem] lg:px-4 xl:px-5 lg:first:pl-0">
            <div class="w-9 h-9 rounded-lg bg-white/5 border border-white/10 flex items-center justify-center shrink-0" v-html="tb.icon"></div>
            <span class="text-xs font-semibold text-white/50 leading-tight">{{ tb.label }}</span>
          </div>
        </div>
      </div>
    </section>

    <!-- ═══ SECCIÓN 2 — EL PROBLEMA + CALCULADORA (2 columnas, claro) ═══ -->
    <section id="problema" class="py-24 lg:py-28 px-6 bg-white">
      <div class="max-w-6xl mx-auto grid lg:grid-cols-2 gap-16">

        <!-- Columna izquierda: El Problema -->
        <div class="reveal">
          <div class="inline-flex items-center gap-2 mb-5 px-3.5 py-1.5 rounded-full bg-blue-50 border border-blue-100">
            <span class="text-[11px] font-extrabold tracking-wide text-blue uppercase">El Costo Invisible</span>
          </div>
          <h2 class="section-title text-navy mb-3">Todos los meses se le va dinero que ni siquiera ve</h2>
          <p class="text-slate-500 mb-9">No es un solo gasto grande. Son varias pérdidas pequeñas, repartidas, que juntas cuestan más de lo que parece.</p>

          <div class="stagger-grid space-y-6 mb-8">
            <div v-for="p in painPoints" :key="p.title" class="reveal flex items-start gap-4">
              <div class="w-11 h-11 rounded-full bg-blue-50 flex items-center justify-center shrink-0" v-html="p.icon"></div>
              <div>
                <h3 class="text-sm font-black text-navy mb-1">{{ p.title }}</h3>
                <p class="text-sm text-slate-500 leading-relaxed">{{ p.desc }}</p>
              </div>
            </div>
          </div>

          <div class="rounded-xl bg-blue-50/60 border border-blue-100 px-5 py-4">
            <p class="text-navy font-bold text-sm">Los cuatro problemas tienen el mismo origen: la operación de su hotel está fragmentada en herramientas que no se hablan entre sí.</p>
          </div>
        </div>

        <!-- Columna derecha: Calculadora -->
        <div id="calculadora" class="reveal" style="transition-delay:120ms">
          <div class="inline-flex items-center gap-2 mb-5 px-3.5 py-1.5 rounded-full bg-blue-50 border border-blue-100">
            <span class="text-[11px] font-extrabold tracking-wide text-blue uppercase">Calculadora</span>
          </div>
          <h2 class="section-title text-navy mb-3">¿Cuánto pierde su hotel al año?</h2>
          <p class="text-slate-500 mb-6">Complete estos tres datos y vea el estimado en segundos.</p>

          <div class="rounded-2xl border border-slate-200 shadow-card p-6 md:p-7">
            <div class="grid sm:grid-cols-3 gap-4 mb-6">
              <label class="block">
                <span class="text-xs font-bold text-navy mb-1.5 block">Habitaciones</span>
                <input v-model.number="calc.rooms" type="number" min="1" class="calc-input" placeholder="20">
              </label>
              <label class="block">
                <span class="text-xs font-bold text-navy mb-1.5 block">Reservas por mes vía OTA</span>
                <input v-model.number="calc.monthlyBookings" type="number" min="0" class="calc-input" placeholder="40">
              </label>
              <label class="block">
                <span class="text-xs font-bold text-navy mb-1.5 block">Tarifa promedio (USD)</span>
                <input v-model.number="calc.avgRate" type="number" min="0" class="calc-input" placeholder="85">
              </label>
            </div>

            <div class="grid sm:grid-cols-2 gap-4 pt-5 border-t border-slate-100">
              <div>
                <div class="text-xs text-slate-400 mb-1">Pérdida estimada por mes en comisiones (18%)</div>
                <div class="text-3xl font-black text-blue">${{ formatMoney(monthlyLoss) }}</div>
              </div>
              <div>
                <div class="text-xs text-slate-400 mb-1">Pérdida estimada por año</div>
                <div class="text-3xl font-black text-blue">${{ formatMoney(annualLoss) }}</div>
              </div>
            </div>

            <p class="text-[11px] text-slate-400 mt-5 text-center">Estimado con una comisión promedio de OTA del 18%. El monto real varía según sus canales y contratos.</p>

            <a href="#formulario" class="mt-5 w-full inline-flex items-center justify-center gap-2.5 bg-blue text-white font-bold text-sm px-7 py-3.5 rounded-xl hover:bg-navy transition-all duration-300 shadow-lg shadow-blue-200">
              Ver cómo recuperarlo
              <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="2.5"><path stroke-linecap="round" stroke-linejoin="round" d="M17 8l4 4m0 0l-4 4m4-4H3"/></svg>
            </a>
          </div>
        </div>
      </div>
    </section>

    <!-- ═══ SECCIÓN 3 — LA SOLUCIÓN ═══ -->
    <section id="solucion" class="py-24 lg:py-28 px-6 bg-white">
      <div class="max-w-6xl mx-auto">
        <div class="reveal text-center mb-16">
          <div class="inline-flex items-center gap-2 mb-5 px-3.5 py-1.5 rounded-full bg-blue-50 border border-blue-100">
            <span class="text-[11px] font-extrabold tracking-wide text-blue uppercase">La Solución</span>
          </div>
          <h2 class="section-title text-navy mb-4">Cinco piezas. No veintiséis.</h2>
          <p class="text-slate-500 max-w-xl mx-auto">SOLMI OS resuelve exactamente los problemas de arriba. Nada más.</p>
        </div>

        <div class="stagger-grid grid sm:grid-cols-2 lg:grid-cols-5 gap-5 mb-10">
          <div v-for="s in solutionCards" :key="s.name" class="reveal rounded-xl bg-white border border-slate-200 p-5 hover:shadow-card hover:-translate-y-1 transition-all duration-300">
            <!-- Mini vista previa -->
            <div class="relative h-20 rounded-lg mb-4 overflow-hidden bg-slate-50 border border-slate-100">
              <div class="h-4" :style="`background:${s.bg}22`"></div>
              <div class="p-2.5 space-y-1.5">
                <div class="h-1.5 rounded-full w-3/4" :style="`background:${s.bg}3d`"></div>
                <div class="h-1.5 rounded-full w-1/2" :style="`background:${s.bg}26`"></div>
                <div class="h-1.5 rounded-full w-2/3" :style="`background:${s.bg}26`"></div>
              </div>
              <div class="absolute bottom-2 right-2 w-6 h-6 rounded-full flex items-center justify-center" :style="`background:${s.bg}`" v-html="s.icon"></div>
            </div>
            <h3 class="text-sm font-black text-navy mb-1.5">{{ s.name }}</h3>
            <p class="text-xs text-slate-500 leading-relaxed mb-3">{{ s.desc }}</p>
            <span class="inline-flex items-center text-[11px] font-semibold text-blue bg-blue-50 px-2.5 py-1 rounded-full">{{ s.eliminates[0] }}</span>
          </div>
        </div>

        <div class="reveal text-center">
          <div class="inline-flex flex-wrap items-center justify-center gap-3 rounded-xl border border-slate-100 bg-slate-50 px-6 py-3.5">
            <span class="inline-flex items-center gap-1.5 text-xs font-bold text-blue"><span class="w-2 h-2 rounded-full bg-blue"></span>República Dominicana — Disponible ahora</span>
            <span class="hidden sm:inline text-slate-300">·</span>
            <span class="inline-flex items-center gap-1.5 text-xs font-bold text-slate-400"><span class="w-2 h-2 rounded-full bg-slate-300"></span>Otros países — Próximamente</span>
          </div>
        </div>
      </div>
    </section>

    <!-- ═══ SECCIÓN 4 — OFERTA ═══ -->
    <section id="oferta" class="py-24 lg:py-28 px-6 bg-white">
      <div class="max-w-6xl mx-auto">
        <div class="reveal">
          <div class="inline-flex items-center gap-2 mb-5 px-3.5 py-1.5 rounded-full bg-blue-50 border border-blue-100">
            <span class="text-[11px] font-extrabold tracking-wide text-blue uppercase">Programa Hotel Fundador</span>
          </div>
          <h2 class="section-title text-navy mb-3">25 hoteles fundadores. Precio congelado para siempre.</h2>
          <p class="text-slate-500 max-w-xl mb-12">No es un descuento de campaña. Es reconocimiento por confiar en SOLMI OS desde el primer día.</p>
        </div>

        <!-- Mismos 5 planes de la landing principal, con precio fundador -->
        <div class="stagger-grid grid sm:grid-cols-2 lg:grid-cols-5 gap-5 items-start mb-10">
          <div v-for="plan in founderPlans" :key="plan.name"
            class="reveal rounded-2xl border border-slate-200 bg-white overflow-hidden flex flex-col h-full"
            :class="plan.featured ? 'shadow-xl lg:-translate-y-2 ring-1 ring-purple/15' : 'hover:shadow-md transition-shadow'">
            <div class="p-6" :class="planColor(plan.color).header">
              <div v-if="plan.badge" class="inline-flex mb-3 text-[10px] font-extrabold px-3 py-1 rounded-full uppercase tracking-wider" :class="planColor(plan.color).badge">{{ plan.badge }}</div>
              <div class="text-lg font-black text-white mb-2">{{ plan.name }}</div>
              <template v-if="plan.quote">
                <div class="text-2xl font-black text-white">{{ plan.publicPrice }}</div>
              </template>
              <template v-else>
                <div class="text-xs text-white/50 line-through">Precio público {{ plan.publicPrice }}</div>
                <div class="flex items-end gap-1.5 flex-wrap">
                  <span class="text-2xl font-black text-white">{{ plan.founderPrice }}</span>
                  <span class="text-xs text-white/60 mb-1">/mes</span>
                </div>
                <div class="text-[11px] font-bold mt-1 text-white/90">{{ plan.discount }} de descuento</div>
              </template>
              <div class="text-[11px] text-white/70 mt-1">{{ plan.rooms }}</div>
            </div>
            <div class="p-6 flex flex-col flex-1">
              <div class="space-y-2.5 flex-1 mb-6">
                <div v-for="b in plan.benefits" :key="b" class="flex items-start gap-2 text-xs text-slate-600">
                  <svg class="w-3.5 h-3.5 shrink-0 mt-0.5" :class="planColor(plan.color).check" fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="2.5"><path stroke-linecap="round" stroke-linejoin="round" d="M4.5 12.75l6 6 9-13.5"/></svg>
                  {{ b }}
                </div>
              </div>
              <a :href="plan.quote ? 'mailto:ventas@solmios.com' : '#formulario'"
                class="block w-full py-2.5 rounded-xl text-center text-xs font-bold border transition-colors"
                :class="planColor(plan.color).cta">
                {{ plan.quote ? 'Contactar ventas' : 'Reservar mi cupo' }}
              </a>
            </div>
          </div>
        </div>

        <!-- Beneficios del programa fundador -->
        <div class="reveal grid md:grid-cols-2 gap-8 items-start max-w-4xl mb-8">
          <div>
            <h3 class="text-xs font-black text-blue mb-4 uppercase tracking-wide">Todo hotel fundador recibe</h3>
            <div class="space-y-2.5">
              <div v-for="b in founderBenefits" :key="b" class="flex items-start gap-2 text-sm text-slate-600">
                <svg class="w-4 h-4 shrink-0 mt-0.5 text-blue" fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="2.5"><path stroke-linecap="round" stroke-linejoin="round" d="M4.5 12.75l6 6 9-13.5"/></svg>
                {{ b }}
              </div>
            </div>
          </div>
          <div class="rounded-2xl bg-slate-50 border border-slate-100 p-6">
            <h3 class="text-sm font-black text-navy mb-3">Sin letra pequeña</h3>
            <p class="text-sm text-slate-500 leading-relaxed mb-3">No hay permanencia mínima. El pago es mensual y puede cancelar cuando quiera, sin penalidad.</p>
            <p class="text-sm text-slate-500 leading-relaxed">El precio congelado se mantiene mientras su hotel se mantenga como cliente activo de SOLMI OS.</p>
          </div>
        </div>

        <!-- Contador + Cuenta regresiva Ola 1 -->
        <div id="contador" class="reveal mt-8 rounded-3xl overflow-hidden border border-navy-deep shadow-2xl">
          <div class="relative bg-navy-deep p-7 sm:p-9">
            <div class="absolute top-[-30%] right-[-8%] w-72 h-72 rounded-full bg-cyan-light/10 blur-[100px] pointer-events-none"></div>
            <div class="absolute bottom-[-40%] left-[-5%] w-64 h-64 rounded-full bg-blue/10 blur-[100px] pointer-events-none"></div>

            <div class="relative flex flex-col lg:flex-row items-center justify-between gap-8">
              <!-- Cupos -->
              <div class="flex items-center gap-5">
                <div class="w-16 h-16 rounded-2xl bg-white/10 border border-white/15 flex items-center justify-center shrink-0">
                  <svg class="w-8 h-8 text-cyan-light" fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="1.6"><path stroke-linecap="round" stroke-linejoin="round" d="M18 18.72a9.094 9.094 0 003.741-.479 3 3 0 00-4.682-2.72m.94 3.198l.001.031c0 .225-.012.447-.037.666A11.944 11.944 0 0112 21c-2.17 0-4.207-.576-5.963-1.584A6.062 6.062 0 016 18.719m12 0a5.971 5.971 0 00-.941-3.197m0 0A5.995 5.995 0 0012 12.75a5.995 5.995 0 00-5.058 2.772m0 0a3 3 0 00-4.681 2.72 8.986 8.986 0 003.74.477m.94-3.197a5.971 5.971 0 00-.94 3.197M15 6.75a3 3 0 11-6 0 3 3 0 016 0zm6 3a2.25 2.25 0 11-4.5 0 2.25 2.25 0 014.5 0zm-13.5 0a2.25 2.25 0 11-4.5 0 2.25 2.25 0 014.5 0z"/></svg>
                </div>
                <div>
                  <div class="inline-flex items-center gap-1.5 mb-2 px-2.5 py-1 rounded-full bg-coral/20 border border-coral/30">
                    <span class="w-1.5 h-1.5 rounded-full bg-coral animate-pulse"></span>
                    <span class="text-[10px] font-black text-coral uppercase tracking-wide">Cupos casi agotados</span>
                  </div>
                  <div class="font-black text-white text-3xl sm:text-4xl leading-none">Quedan <span class="text-cyan-light">{{ slotsLeft }}</span> de {{ slotsTotal }}</div>
                  <div class="text-xs sm:text-sm text-white/50 mt-1.5">cupos de la Ola 1 · Actualizado {{ lastUpdated }}</div>
                  <div class="mt-3 w-52 h-2 rounded-full bg-white/10 overflow-hidden">
                    <div class="h-full bg-gradient-to-r from-cyan-light to-blue rounded-full transition-all duration-700" :style="{ width: slotsPercent + '%' }"></div>
                  </div>
                </div>
              </div>

              <div class="hidden lg:block w-px h-24 bg-white/10"></div>

              <!-- Cuenta regresiva -->
              <div class="text-center">
                <div class="text-[11px] font-black text-white/60 uppercase tracking-wide mb-3">La Ola 1 cierra en</div>
                <div class="flex items-center gap-2 sm:gap-3">
                  <div v-for="unit in countdown" :key="unit.label" class="flex flex-col items-center">
                    <div class="w-14 h-14 sm:w-16 sm:h-16 rounded-xl bg-white/8 border border-cyan-light/25 flex items-center justify-center font-black text-xl sm:text-2xl text-white tabular-nums shadow-inner">{{ unit.value }}</div>
                    <div class="text-[10px] text-white/40 uppercase tracking-wide mt-1.5">{{ unit.label }}</div>
                  </div>
                </div>
              </div>

              <a href="#formulario" class="shrink-0 inline-flex items-center gap-2 bg-cyan-light text-navy-deep font-black text-sm px-7 py-3.5 rounded-xl hover:-translate-y-0.5 transition-all duration-300 shadow-[0_16px_40px_rgba(0,180,216,0.25)] whitespace-nowrap">
                Reservar mi cupo
                <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="2.5"><path stroke-linecap="round" stroke-linejoin="round" d="M17 8l4 4m0 0l-4 4m4-4H3"/></svg>
              </a>
            </div>

            <div class="relative mt-7 pt-6 border-t border-white/10 flex items-center justify-center lg:justify-start gap-3">
              <div class="text-xs text-white/50">{{ slotsTaken }} de {{ slotsTotal }} cupos ya reservados</div>
              <div class="flex -space-x-2">
                <div v-for="n in slotsTotal" :key="n" class="w-6 h-6 rounded-full border-2 border-navy flex items-center justify-center" :class="n <= slotsTaken ? 'bg-cyan-light' : 'bg-white/10'">
                  <svg class="w-3 h-3" :class="n <= slotsTaken ? 'text-navy-deep' : 'text-white/30'" fill="currentColor" viewBox="0 0 24 24"><path d="M12 12a4.5 4.5 0 100-9 4.5 4.5 0 000 9zM3.75 20.25a8.25 8.25 0 0116.5 0 .75.75 0 01-.75.75H4.5a.75.75 0 01-.75-.75z"/></svg>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>

    <!-- ═══ SECCIÓN 6 — PRUEBA ═══ -->
    <section id="prueba" class="py-24 lg:py-28 px-6 bg-white">
      <div class="max-w-6xl mx-auto grid lg:grid-cols-2 gap-16 items-center mb-14">
        <div class="reveal">
          <div class="inline-flex items-center gap-2 mb-5 px-3.5 py-1.5 rounded-full bg-blue-50 border border-blue-100">
            <span class="text-[11px] font-extrabold tracking-wide text-blue uppercase">Construido dentro de un hotel real</span>
          </div>
          <h2 class="section-title text-navy mb-5">SOLMI OS nació dentro de Solmi Rooms</h2>
          <p class="text-slate-500 leading-relaxed mb-8">Antes de venderlo, lo usamos todos los días para operar nuestro propio hotel. Cada módulo se construyó para resolver un problema real que vivimos primero nosotros mismos.</p>
          <div class="grid grid-cols-4 gap-4 mb-6">
            <div v-for="m in proofMetrics" :key="m.label">
              <div class="text-2xl font-black text-blue mb-1">{{ m.value }}</div>
              <div class="text-xs text-slate-500 leading-tight">{{ m.label }}</div>
            </div>
          </div>
          <p class="text-[11px] text-slate-400 mb-6">Cifras internas de Solmi Rooms, sujetas a actualización periódica.</p>
          <button type="button" @click="scrollTo('formulario')" class="inline-flex items-center gap-2.5 bg-navy text-white font-bold text-sm px-7 py-3.5 rounded-xl hover:bg-blue transition-all duration-300 hover:-translate-y-0.5 shadow-lg">
            Ver cifras completas
            <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="2.5"><path stroke-linecap="round" stroke-linejoin="round" d="M17 8l4 4m0 0l-4 4m4-4H3"/></svg>
          </button>
        </div>
        <div class="stagger-grid grid grid-cols-2 gap-4">
          <div class="reveal">
            <img :src="heroImage" alt="Panel real de SOLMI OS usado en Solmi Rooms" class="w-full h-40 sm:h-52 object-cover rounded-xl border border-slate-200">
            <p class="text-[11px] text-slate-400 mt-2">Panel real de SOLMI OS usado en Solmi Rooms</p>
          </div>
          <div class="reveal">
            <img :src="solmiRoomsImage" alt="Solmi Rooms, el hotel donde nació SOLMI OS" class="w-full h-40 sm:h-52 object-cover rounded-xl border border-slate-200">
            <p class="text-[11px] text-slate-400 mt-2">Solmi Rooms, el hotel donde nació SOLMI OS</p>
          </div>
        </div>
      </div>

      <!-- Franja de confianza -->
      <div class="max-w-6xl mx-auto">
        <div class="reveal rounded-2xl border border-slate-200 bg-slate-50/60 px-6 py-5 flex flex-wrap items-center justify-center gap-x-8 gap-y-4">
          <span class="inline-flex items-center gap-2 text-xs font-bold text-navy"><span class="w-2 h-2 rounded-full bg-blue"></span>Ola 1 · República Dominicana</span>
          <span class="hidden md:inline text-slate-300">|</span>
          <span class="inline-flex items-center gap-2 text-xs text-slate-500 italic max-w-xs">
            <svg class="w-4 h-4 shrink-0 text-blue" fill="currentColor" viewBox="0 0 24 24"><path d="M6.75 3.75a3 3 0 00-3 3v4.5a3 3 0 003 3h1.21l-1.172 3.513a.75.75 0 001.006.94l4.615-2.153a3.001 3.001 0 002.59-3V6.75a3 3 0 00-3-3h-5.25zm10.5 0a3 3 0 00-3 3v4.5a3 3 0 003 3h.421l-.172 3.513a.75.75 0 001.006.94l4.615-2.153a3 3 0 001.13-.94V6.75a3 3 0 00-3-3h-3.75z"/></svg>
            "En menos de 24 horas estábamos operando. El soporte respondió cada duda por WhatsApp."
          </span>
          <span class="hidden md:inline text-slate-300">|</span>
          <span v-for="b in formPanelPoints" :key="b" class="inline-flex items-center gap-2 text-xs font-semibold text-slate-600">
            <svg class="w-4 h-4 shrink-0 text-blue" fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M9 12.75L11.25 15 15 9.75M21 12a9 9 0 11-18 0 9 9 0 0118 0z"/></svg>
            {{ b }}
          </span>
        </div>
      </div>
    </section>

    <!-- ═══ SECCIÓN 7 — FORMULARIO + FAQ (2 columnas, claro) ═══ -->
    <section id="formulario" class="py-24 lg:py-28 px-6 bg-slate-50">
      <div class="max-w-6xl mx-auto grid lg:grid-cols-2 gap-16">

        <!-- Formulario -->
        <div class="reveal">
          <h2 class="section-title text-navy mb-3">Reserve su cupo de Hotel Fundador</h2>
          <p class="text-slate-500 text-sm mb-7">Complete el formulario y le escribimos por WhatsApp en menos de 5 minutos.</p>

          <div class="rounded-2xl border border-slate-200 bg-white p-6 sm:p-7">
            <template v-if="!submitted">
              <form novalidate @submit.prevent="submitForm">
                <div class="space-y-4 mb-3">
                  <label class="block">
                    <span class="text-xs font-bold text-navy mb-1.5 block">Nombre completo</span>
                    <input v-model.trim="form.name" type="text" class="form-input" :class="errors.name ? 'form-input-error' : ''" placeholder="Su nombre">
                    <span v-if="errors.name" class="text-[11px] text-red-500 mt-1 block">{{ errors.name }}</span>
                  </label>
                  <label class="block">
                    <span class="text-xs font-bold text-navy mb-1.5 block">Nombre del hotel</span>
                    <input v-model.trim="form.hotel" type="text" class="form-input" :class="errors.hotel ? 'form-input-error' : ''" placeholder="Nombre de su hotel">
                    <span v-if="errors.hotel" class="text-[11px] text-red-500 mt-1 block">{{ errors.hotel }}</span>
                  </label>
                  <div class="grid sm:grid-cols-2 gap-4">
                    <label class="block">
                      <span class="text-xs font-bold text-navy mb-1.5 block">País</span>
                      <select v-model="form.country" class="form-input" :class="errors.country ? 'form-input-error' : ''">
                        <option value="" disabled>Seleccione su país</option>
                        <option v-for="c in countries" :key="c" :value="c">{{ c }}</option>
                      </select>
                      <span v-if="errors.country" class="text-[11px] text-red-500 mt-1 block">{{ errors.country }}</span>
                    </label>
                    <label class="block">
                      <span class="text-xs font-bold text-navy mb-1.5 block">Correo</span>
                      <input v-model.trim="form.email" type="email" class="form-input" :class="errors.email ? 'form-input-error' : ''" placeholder="usted@hotel.com">
                      <span v-if="errors.email" class="text-[11px] text-red-500 mt-1 block">{{ errors.email }}</span>
                    </label>
                  </div>
                  <span v-if="isWaitlist" class="text-[11px] text-gold block -mt-1">Su país aún no está soportado. Le avisaremos en cuanto esté disponible.</span>
                  <div class="grid sm:grid-cols-2 gap-4">
                    <label class="block">
                      <span class="text-xs font-bold text-navy mb-1.5 block">WhatsApp</span>
                      <input v-model.trim="form.whatsapp" type="tel" class="form-input" :class="errors.whatsapp ? 'form-input-error' : ''" placeholder="+1 809 000 0000">
                      <span v-if="errors.whatsapp" class="text-[11px] text-red-500 mt-1 block">{{ errors.whatsapp }}</span>
                    </label>
                    <label class="block" v-if="!isWaitlist">
                      <span class="text-xs font-bold text-navy mb-1.5 block">Cantidad de habitaciones</span>
                      <input v-model.number="form.rooms" type="number" min="1" class="form-input" :class="errors.rooms ? 'form-input-error' : ''" placeholder="20">
                      <span v-if="errors.rooms" class="text-[11px] text-red-500 mt-1 block">{{ errors.rooms }}</span>
                    </label>
                  </div>
                </div>

                <button type="submit"
                  class="w-full inline-flex items-center justify-center gap-2.5 bg-blue text-white font-bold text-sm px-7 py-3.5 rounded-xl hover:bg-navy transition-all duration-300 shadow-lg shadow-blue-200 mt-4">
                  {{ isWaitlist ? 'Unirme a la lista de espera' : 'Reservar mi cupo' }}
                </button>

                <p class="flex items-start gap-1.5 text-[11px] text-slate-400 mt-4 leading-relaxed">
                  <svg class="w-3.5 h-3.5 shrink-0 mt-0.5 text-slate-300" fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M16.5 10.5V6.75a4.5 4.5 0 10-9 0v3.75m-.75 11.25h10.5a2.25 2.25 0 002.25-2.25v-6.75a2.25 2.25 0 00-2.25-2.25H6.75a2.25 2.25 0 00-2.25 2.25v6.75a2.25 2.25 0 002.25 2.25z"/></svg>
                  Enviar este formulario no lo obliga a comprar. Sus datos están protegidos y solo se usan para contactarlo sobre el Programa Hotel Fundador.
                </p>
              </form>
            </template>

            <template v-else>
              <div class="text-center py-6">
                <div class="w-14 h-14 rounded-full bg-blue-50 flex items-center justify-center mx-auto mb-5">
                  <svg class="w-7 h-7 text-blue" fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="2.5"><path stroke-linecap="round" stroke-linejoin="round" d="M4.5 12.75l6 6 9-13.5"/></svg>
                </div>
                <h3 class="text-xl font-black text-navy mb-3">{{ isWaitlist ? '¡Listo! Está en la lista de espera' : '¡Cupo reservado!' }}</h3>
                <p class="text-sm text-slate-500 leading-relaxed max-w-xs mx-auto">
                  {{ isWaitlist
                    ? 'Le avisaremos por correo y WhatsApp en cuanto SOLMI OS esté disponible en su país.'
                    : 'En menos de 5 minutos le escribimos por WhatsApp para confirmar su cupo y agendar una demostración.' }}
                </p>
              </div>
            </template>
          </div>
        </div>

        <!-- FAQ -->
        <div id="faq" class="reveal" style="transition-delay:100ms">
          <div class="inline-flex items-center gap-2 mb-5 px-3.5 py-1.5 rounded-full bg-blue-50 border border-blue-100">
            <span class="text-[11px] font-extrabold tracking-wide text-blue uppercase">Preguntas Frecuentes</span>
          </div>
          <h2 class="section-title text-navy mb-7">Antes de reservar su cupo</h2>
          <div class="space-y-3">
            <div v-for="(f, i) in faqs" :key="f.q" class="rounded-xl border border-slate-200 bg-white overflow-hidden transition-colors" :class="faqOpen === i ? 'border-blue/30' : ''">
              <button type="button" @click="faqOpen = faqOpen === i ? -1 : i"
                class="w-full flex items-center justify-between gap-4 text-left px-5 py-4 hover:bg-slate-50 transition-colors">
                <span class="text-sm font-bold text-navy">{{ f.q }}</span>
                <svg class="w-4 h-4 text-blue shrink-0 transition-transform duration-300" :class="faqOpen === i ? 'rotate-45' : ''" fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="2.5"><path stroke-linecap="round" stroke-linejoin="round" d="M12 4.5v15m7.5-7.5h-15"/></svg>
              </button>
              <div v-show="faqOpen === i" class="px-5 pb-4 text-sm text-slate-500 leading-relaxed">{{ f.a }}</div>
            </div>
          </div>
        </div>
      </div>
    </section>

    <!-- ═══ BARRA STICKY ═══ -->
    <Transition name="sticky-fade">
      <div v-if="scrolled" class="fixed bottom-0 inset-x-0 z-40 bg-[rgba(6,20,40,0.95)] backdrop-blur-xl border-t border-white/10 px-6 py-3.5">
        <div class="max-w-5xl mx-auto flex items-center justify-between gap-4">
          <span class="text-xs sm:text-sm font-bold text-white">Quedan <span class="text-cyan-light">{{ slotsLeft }}</span> de {{ slotsTotal }} cupos</span>
          <a href="#formulario" class="inline-flex items-center gap-1.5 bg-blue text-white font-bold text-xs sm:text-sm px-5 py-2.5 rounded-xl hover:-translate-y-0.5 transition-all duration-300 shadow-lg whitespace-nowrap">Reservar mi cupo</a>
        </div>
      </div>
    </Transition>

    <!-- ═══ FOOTER — mínimo, claro ═══ -->
    <footer class="bg-white pt-10 pb-24 sm:pb-8 px-6 border-t border-slate-100">
      <div class="max-w-6xl mx-auto">
        <div class="reveal flex flex-col sm:flex-row items-center justify-between gap-6 mb-6">
          <span class="font-black text-lg text-navy">Solmi<span class="text-blue">OS</span></span>
          <div class="flex flex-wrap items-center justify-center gap-x-6 gap-y-2 text-sm text-slate-500">
            <a href="mailto:ventas@solmios.com" class="hover:text-blue transition-colors">ventas@solmios.com</a>
            <a href="https://wa.me/18095550000" target="_blank" rel="noopener" class="inline-flex items-center gap-1.5 hover:text-blue transition-colors">
              <svg class="w-3.5 h-3.5 text-teal" fill="currentColor" viewBox="0 0 24 24"><path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347M12.05 22h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26C2.157 6.658 6.593 2.223 12.05 2.223c2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884"/></svg>
              WhatsApp
            </a>
            <a href="#" class="underline underline-offset-2 hover:text-blue transition-colors">Contrato</a>
            <a href="#" class="underline underline-offset-2 hover:text-blue transition-colors">Política de privacidad</a>
          </div>
        </div>
        <div class="border-t border-slate-100 pt-5 flex flex-col sm:flex-row items-center justify-between gap-3">
          <div class="text-xs text-slate-400">© 2026 SolmiOS. Todos los derechos reservados.</div>
          <div class="text-xs text-slate-400">República Dominicana disponible · Otros países próximamente</div>
        </div>
      </div>
    </footer>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted } from 'vue'
import heroImage from '@/assets/hero.png'
import stressedManagerImage from '@/assets/hotel-manager-stressed.png'
import logoWhite from '@/assets/logo/logo-horizontal-white.png'
import { usePageMeta } from '@/composables/usePageMeta'
import { PUBLIC_PAGE_META } from '@/pages/public-meta'

usePageMeta(PUBLIC_PAGE_META.hotelFundador)

// Fotografía real de Unsplash (IDs verificados) — refuerza la identidad visual del hero en el resto de la página
const solmiRoomsImage = 'https://images.unsplash.com/photo-1445019980597-93fa8acb246c?w=500&q=80&auto=format&fit=crop'
const formPanelPoints = ['Migración de datos incluida', 'Soporte prioritario por WhatsApp', 'Sin permanencia mínima']

const scrolled = ref(false)
let ticking = false

function handleScroll() {
  if (ticking) return
  ticking = true
  requestAnimationFrame(() => {
    scrolled.value = window.scrollY > 560
    ticking = false
  })
}

let revealObserver: IntersectionObserver

onMounted(() => {
  window.addEventListener('scroll', handleScroll, { passive: true })
  handleScroll()

  revealObserver = new IntersectionObserver((entries) => {
    for (const entry of entries) {
      if (entry.isIntersecting) {
        entry.target.classList.add('is-visible')
        revealObserver.unobserve(entry.target)
      }
    }
  }, { threshold: 0, rootMargin: '0px 0px 80px 0px' })
  document.querySelectorAll('.reveal').forEach((el) => revealObserver.observe(el))

  countdownTimer = setInterval(() => { nowTs.value = Date.now() }, 1000)
})
onUnmounted(() => {
  window.removeEventListener('scroll', handleScroll)
  revealObserver?.disconnect()
  clearInterval(countdownTimer)
})

function scrollTo(id: string) {
  document.getElementById(id)?.scrollIntoView({ behavior: 'smooth' })
}

// ── Hero: pérdidas del mes (suman el total de $1,700 mostrado en el comparativo) ──
const lossBreakdown = [
  { label: 'Comisiones', amount: 780 },
  { label: 'Limpieza/WhatsApp', amount: 380 },
  { label: 'Errores/Overbooking', amount: 250 },
  { label: 'Procesos manuales', amount: 290 },
]

const heroMonthlyLoss = computed(() => lossBreakdown.reduce((sum, l) => sum + l.amount, 0))

const heroTrustBar = [
  { label: 'Precio congelado de por vida', icon: '<svg class="w-4 h-4 text-cyan-light" fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M12 1.5a5.25 5.25 0 00-5.25 5.25v3H6A2.25 2.25 0 003.75 12v6A2.25 2.25 0 006 20.25h12A2.25 2.25 0 0020.25 18v-6A2.25 2.25 0 0018 9.75h-.75v-3A5.25 5.25 0 0012 1.5zm3.75 8.25h-7.5v-3a3.75 3.75 0 117.5 0v3z"/></svg>' },
  { label: 'Soporte prioritario y línea directa', icon: '<svg class="w-4 h-4 text-cyan-light" fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M2.25 6.75c0 8.284 6.716 15 15 15h2.25a2.25 2.25 0 002.25-2.25v-1.372c0-.516-.351-.966-.852-1.091l-4.423-1.106a2.25 2.25 0 00-2.281.617l-.921.92a17.938 17.938 0 01-7.485-7.485l.919-.921a2.25 2.25 0 00.618-2.28L6.44 3.098a1.125 1.125 0 00-1.091-.852H3.75A1.5 1.5 0 002.25 3.75v3z"/></svg>' },
  { label: 'Acceso anticipado a nuevas funciones', icon: '<svg class="w-4 h-4 text-cyan-light" fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M3.75 13.5l10.5-11.25L12 10.5h8.25L9.75 21.75 12 13.5H3.75z"/></svg>' },
  { label: 'Voto sobre el futuro del sistema', icon: '<svg class="w-4 h-4 text-cyan-light" fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M9 12.75L11.25 15 15 9.75M21 12a9 9 0 11-18 0 9 9 0 0118 0z"/></svg>' },
  { label: 'Solo 25 cupos disponibles', icon: '<svg class="w-4 h-4 text-cyan-light" fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M6.75 3v2.25M17.25 3v2.25M3 18.75V7.5a2.25 2.25 0 012.25-2.25h13.5A2.25 2.25 0 0121 7.5v11.25m-18 0A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75m-18 0v-7.5A2.25 2.25 0 015.25 9h13.5A2.25 2.25 0 0121 11.25v7.5"/></svg>' },
]

// ── Dolores ──
const painPoints = [
  {
    title: 'Comisiones de agencias',
    desc: 'Cada reserva que llega por una OTA le cuesta entre 15% y 20% de comisión. En un hotel con buena ocupación, eso equivale a un sueldo completo cada mes.',
    icon: '<svg class="w-5 h-5 text-blue" fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="1.6"><path stroke-linecap="round" stroke-linejoin="round" d="M12 6v12m-3-2.818l.879.659c1.171.879 3.07.879 4.242 0 1.172-.879 1.172-2.303 0-3.182C13.536 12.219 12.768 12 12 12c-.725 0-1.45-.22-2.003-.659-1.106-.879-1.106-2.303 0-3.182s2.9-.879 4.006 0l.415.33M21 12a9 9 0 11-18 0 9 9 0 0118 0z"/></svg>',
  },
  {
    title: 'Limpieza por WhatsApp',
    desc: 'Coordinar a la camarera por mensajes de voz y capturas de pantalla genera habitaciones que se limpian tarde, dos veces, o nunca.',
    icon: '<svg class="w-5 h-5 text-blue" fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="1.6"><path stroke-linecap="round" stroke-linejoin="round" d="M7.5 8.25h9m-9 3.75h9m-9 3.75h5.25M6 20.25h12A2.25 2.25 0 0020.25 18V6A2.25 2.25 0 0018 3.75H6A2.25 2.25 0 003.75 6v12A2.25 2.25 0 006 20.25z"/></svg>',
  },
  {
    title: 'Excel y dependencia del dueño',
    desc: 'Si usted no está, nadie sabe qué habitación está libre o cuánto debe un huésped. Una hoja mal actualizada significa una reserva perdida o duplicada.',
    icon: '<svg class="w-5 h-5 text-blue" fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="1.6"><path stroke-linecap="round" stroke-linejoin="round" d="M15.75 6a3.75 3.75 0 11-7.5 0 3.75 3.75 0 017.5 0zM4.501 20.118a7.5 7.5 0 0114.998 0A17.933 17.933 0 0112 21.75c-2.676 0-5.216-.584-7.499-1.632z"/></svg>',
  },
  {
    title: 'Problemas con la facturación',
    desc: 'Emitir el comprobante fiscal correcto, con el NCF correcto, a tiempo para la DGII, sin ayuda de un contador presente todos los días, es un riesgo constante.',
    icon: '<svg class="w-5 h-5 text-blue" fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="1.6"><path stroke-linecap="round" stroke-linejoin="round" d="M19.5 14.25v-2.625a3.375 3.375 0 00-3.375-3.375h-1.5A1.125 1.125 0 0113.5 7.125v-1.5a3.375 3.375 0 00-3.375-3.375H8.25m0 12.75h7.5m-7.5 3H12M10.5 2.25H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 00-9-9z"/></svg>',
  },
]

// ── Calculadora ──
const calc = ref({ rooms: 20, monthlyBookings: 40, avgRate: 85 })
const COMMISSION_RATE = 0.18
const monthlyLoss = computed(() => Math.max(0, (calc.value.monthlyBookings || 0) * (calc.value.avgRate || 0) * COMMISSION_RATE))
const annualLoss = computed(() => monthlyLoss.value * 12)
function formatMoney(n: number) {
  return Math.round(n).toLocaleString('en-US')
}

// ── Solución ──
const solutionCards = [
  {
    name: 'Motor de Reservas Directas', bg: '#117A65',
    desc: 'Sus huéspedes reservan directo en su propio sitio, sin pagar comisión a ninguna agencia.',
    eliminates: ['Las comisiones'],
    icon: '<svg class="w-3.5 h-3.5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="1.5"><path stroke-linecap="round" stroke-linejoin="round" d="M13.19 8.688a4.5 4.5 0 011.242 7.244l-4.5 4.5a4.5 4.5 0 01-6.364-6.364l1.757-1.757m13.35-.622l1.757-1.757a4.5 4.5 0 00-6.364-6.364l-4.5 4.5a4.5 4.5 0 001.242 7.244"/></svg>',
  },
  {
    name: 'Housekeeping Inteligente', bg: '#6C3483',
    desc: 'Cada camarera ve sus habitaciones asignadas en su teléfono y marca el avance en tiempo real.',
    eliminates: ['WhatsApp'],
    icon: '<svg class="w-3.5 h-3.5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="1.5"><path stroke-linecap="round" stroke-linejoin="round" d="M9 12.75L11.25 15 15 9.75M21 12a9 9 0 11-18 0 9 9 0 0118 0z"/></svg>',
  },
  {
    name: 'Panel de Reservas Centralizado', bg: '#0D2B4E',
    desc: 'Vea todas sus reservas, de todos los canales, en un solo calendario. Sin dobles reservas, sin depender de que usted esté presente.',
    eliminates: ['El Excel'],
    icon: '<svg class="w-3.5 h-3.5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="1.5"><path stroke-linecap="round" stroke-linejoin="round" d="M6.75 3v2.25M17.25 3v2.25M3 18.75V7.5a2.25 2.25 0 012.25-2.25h13.5A2.25 2.25 0 0121 7.5v11.25m-18 0A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75m-18 0v-7.5A2.25 2.25 0 015.25 9h13.5A2.25 2.25 0 0121 11.25v7.5"/></svg>',
  },
  {
    name: 'Facturación Electrónica', bg: '#B7950B',
    desc: 'Cada comprobante sale con su NCF correcto, listo para la DGII, sin que usted tenga que pensarlo.',
    eliminates: ['Los problemas fiscales'],
    icon: '<svg class="w-3.5 h-3.5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="1.5"><path stroke-linecap="round" stroke-linejoin="round" d="M19.5 14.25v-2.625a3.375 3.375 0 00-3.375-3.375h-1.5A1.125 1.125 0 0113.5 7.125v-1.5a3.375 3.375 0 00-3.375-3.375H8.25m0 12.75h7.5m-7.5 3H12M10.5 2.25H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 00-9-9z"/></svg>',
  },
  {
    name: 'Un Solo Sistema', bg: '#E74C3C',
    desc: 'Reservas, limpieza, facturación y cobro conectados entre sí. Lo que pasa en una parte del hotel se refleja al instante en las demás.',
    eliminates: ['La operación fragmentada'],
    icon: '<svg class="w-3.5 h-3.5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="1.5"><path stroke-linecap="round" stroke-linejoin="round" d="M13.19 8.688a4.5 4.5 0 011.242 7.244l-4.5 4.5a4.5 4.5 0 01-6.364-6.364M2.25 12a9.75 9.75 0 1119.5 0 9.75 9.75 0 01-19.5 0z"/></svg>',
  },
]

// ── Oferta — mismos 5 planes, nombres y features que la landing principal (frontend/src/pages/landing/index.vue),
// con precio público (igual al de la landing) + precio fundador (30% off) ──
const PLAN_COLORS: Record<string, { header: string; badge: string; cta: string; check: string }> = {
  navy: { header: 'bg-navy', badge: 'bg-white/20 text-white', cta: 'bg-navy/5 text-navy border-navy/15 hover:bg-navy/10', check: 'text-navy' },
  teal: { header: 'bg-teal', badge: 'bg-white/20 text-white', cta: 'bg-teal/5 text-teal border-teal/15 hover:bg-teal/10', check: 'text-teal' },
  purple: { header: 'bg-purple', badge: 'bg-white/20 text-white', cta: 'bg-purple/5 text-purple border-purple/15 hover:bg-purple/10', check: 'text-purple' },
  gold: { header: 'bg-gold', badge: 'bg-white/20 text-white', cta: 'bg-gold/5 text-gold border-gold/15 hover:bg-gold/10', check: 'text-gold' },
  coral: { header: 'bg-coral', badge: 'bg-white/20 text-white', cta: 'bg-coral/5 text-coral border-coral/15 hover:bg-coral/10', check: 'text-coral' },
}
function planColor(color: string) {
  return PLAN_COLORS[color] ?? PLAN_COLORS.navy
}

const founderPlans = [
  {
    name: 'Essential', publicPrice: 'USD 99', founderPrice: 'USD 69', discount: '30%', rooms: 'Hasta 20 habitaciones', color: 'navy',
    benefits: ['PMS Central completo', 'Channel Manager (6+ OTAs)', 'Motor de reservas sin comisión', 'Creador de sitio web', 'Dashboard operativo', 'Facturación electrónica LATAM', 'Soporte por email'],
  },
  {
    name: 'Starter', publicPrice: 'USD 199', founderPrice: 'USD 139', discount: '30%', rooms: 'Hasta 50 habitaciones', color: 'teal',
    benefits: ['Todo lo del plan Essential', 'Recepción Digital (Check-In/Out online)', 'App SOLMI Staff para empleados', 'Housekeeping Inteligente', 'CRM y Fidelización básico', 'SOLMI Academy completa', 'Soporte prioritario'],
  },
  {
    name: 'Professional', publicPrice: 'USD 349', founderPrice: 'USD 244', discount: '30%', rooms: 'Hasta 100 habitaciones', color: 'purple', badge: 'Más Popular', featured: true,
    benefits: ['Todo lo del plan Starter', 'Recepcionista Virtual con IA', 'Revenue Manager con IA', 'Nómina Automatizada', 'Marketing Automatizado', 'Business Intelligence avanzado', 'API Abierta e integraciones', 'Soporte dedicado con SLA'],
  },
  {
    name: 'Enterprise', publicPrice: 'USD 549', founderPrice: 'USD 384', discount: '30%', rooms: 'Hasta 200 habitaciones', color: 'gold',
    benefits: ['Todo lo del plan Professional', 'Gerente Virtual con IA (briefings diarios)', 'Multipropiedad (hasta 3 propiedades)', 'Comunidad SOLMI (eventos y red)', 'App SOLMI Guest para huéspedes', 'Reportes ejecutivos consolidados', 'Account Manager dedicado', 'Onboarding premium incluido'],
  },
  {
    name: 'Ultra', publicPrice: 'A cotización', founderPrice: '', discount: '', rooms: '200+ hab. · Ilimitado', color: 'coral', badge: 'Premium', quote: true,
    benefits: ['Todos los 26 módulos sin límite', 'Multipropiedad ilimitada', 'Gerente Virtual IA personalizado', 'Integraciones a medida', 'Capacitación presencial', 'SLA < 1 hora de respuesta', 'Gerente de cuenta ejecutivo dedicado', 'Precio según volumen de propiedades'],
  },
]

const founderBenefits = [
  'Precio congelado mientras sea cliente activo',
  'Implementación y configuración incluidas',
  'Migración de sus datos actuales sin costo',
  'Soporte prioritario por WhatsApp',
  'Acceso anticipado a cada función nueva',
  'Línea directa con el equipo fundador',
  'Voto sobre qué se construye después',
  'Acceso completo a SOLMI Academy',
]

// ── Contador ──
const slotsTotal = 10
const slotsTaken = 3
const slotsLeft = computed(() => slotsTotal - slotsTaken)
const slotsPercent = computed(() => Math.round((slotsTaken / slotsTotal) * 100))
const lastUpdated = new Date().toLocaleDateString('es-DO', { day: 'numeric', month: 'long', year: 'numeric' })

// ── Cuenta regresiva Ola 1 (20 días desde el lanzamiento) ──
const FOUNDER_DEADLINE = new Date('2026-08-26T23:59:59-04:00').getTime()
const nowTs = ref(Date.now())
let countdownTimer: ReturnType<typeof setInterval>

const countdown = computed(() => {
  const remaining = Math.max(0, FOUNDER_DEADLINE - nowTs.value)
  const days = Math.floor(remaining / 86400000)
  const hours = Math.floor((remaining % 86400000) / 3600000)
  const minutes = Math.floor((remaining % 3600000) / 60000)
  const seconds = Math.floor((remaining % 60000) / 1000)
  return [
    { label: 'Días', value: String(days).padStart(2, '0') },
    { label: 'Hrs', value: String(hours).padStart(2, '0') },
    { label: 'Min', value: String(minutes).padStart(2, '0') },
    { label: 'Seg', value: String(seconds).padStart(2, '0') },
  ]
})

// ── Prueba ──
const proofMetrics = [
  { value: '92%', label: 'Ocupación promedio' },
  { value: '61%', label: 'Reservas directas' },
  { value: '15h', label: 'Ahorradas por semana' },
  { value: '-40%', label: 'Tiempo de limpieza' },
]

// ── Formulario ──
const countries = ['República Dominicana', 'Otro país']
const form = ref({ name: '', hotel: '', country: '', email: '', whatsapp: '', rooms: null as number | null })
const errors = ref<Record<string, string>>({})
const submitted = ref(false)
const isWaitlist = computed(() => !!form.value.country && form.value.country !== 'República Dominicana')

function validate() {
  const e: Record<string, string> = {}
  if (!form.value.name) e.name = 'Ingrese su nombre.'
  if (!form.value.hotel) e.hotel = 'Ingrese el nombre de su hotel.'
  if (!form.value.country) e.country = 'Seleccione su país.'
  if (!form.value.email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.value.email)) e.email = 'Ingrese un correo válido.'
  if (!form.value.whatsapp || form.value.whatsapp.replace(/\D/g, '').length < 8) e.whatsapp = 'Ingrese un número de WhatsApp válido.'
  if (!isWaitlist.value && (!form.value.rooms || form.value.rooms < 1)) e.rooms = 'Ingrese la cantidad de habitaciones.'
  errors.value = e
  return Object.keys(e).length === 0
}

function submitForm() {
  if (!validate()) return
  submitted.value = true
}

// ── FAQ ──
const faqOpen = ref(-1)
const faqs = [
  { q: 'Ya tengo Excel, ¿para qué cambiar?', a: 'Excel no le avisa cuando dos reservas chocan, no genera su factura fiscal y no le dice qué habitación está limpia en tiempo real. SOLMI OS hace ese trabajo automáticamente, en segundos.' },
  { q: 'Me parece caro', a: 'Compárelo contra lo que ya paga en comisiones: la mayoría de los hoteles recupera el costo de SOLMI OS con solo 2 o 3 reservas directas al mes.' },
  { q: 'Ya tengo otro sistema', a: 'Migramos sus datos actuales sin costo, dentro del Programa Fundador. La mayoría de los hoteles queda operando en SOLMI OS en menos de 24 horas.' },
  { q: 'No quiero contratos', a: 'No los hay. El pago es mensual y puede cancelar cuando quiera, sin penalidad ni permanencia mínima.' },
  { q: '¿Qué ocurre con mis datos?', a: 'Sus datos y los de sus huéspedes están protegidos y son exclusivamente suyos. Nunca se comparten ni se venden a terceros.' },
  { q: '¿Qué pasa cuando pago?', a: 'Su depósito reserva el cupo y es 100% reembolsable si decide no continuar. Al confirmar, comenzamos la implementación de inmediato.' },
]
</script>

<style scoped>
.hero-title {
  font-family: 'Inter', sans-serif;
  font-size: clamp(2.5rem, 4.6vw, 4rem);
  font-weight: 900;
  letter-spacing: -0.03em;
  line-height: 1.02;
}

.hero-title-accent {
  font-family: 'Inter', sans-serif;
  font-size: clamp(2.5rem, 4.6vw, 4rem);
  font-weight: 900;
  font-style: italic;
  letter-spacing: -0.03em;
  line-height: 1.02;
  color: transparent;
  -webkit-text-stroke: 1.5px #48CAE4;
  text-shadow: 0 0 30px rgba(72, 202, 228, 0.25);
}

.hero-body {
  font-family: 'DM Sans', 'Inter', sans-serif;
  font-size: 1.06rem;
  line-height: 1.7;
  max-width: 460px;
}

.section-title {
  font-family: 'Inter', sans-serif;
  font-weight: 900;
  letter-spacing: -0.02em;
  font-size: clamp(1.75rem, 2.6vw, 2.5rem);
  line-height: 1.15;
}

.hero-grid {
  background-image:
    linear-gradient(rgba(72, 202, 228, 0.08) 1px, transparent 1px),
    linear-gradient(90deg, rgba(72, 202, 228, 0.08) 1px, transparent 1px);
  background-size: 44px 44px;
  mask-image: radial-gradient(ellipse 80% 60% at 70% 20%, black, transparent 70%);
  -webkit-mask-image: radial-gradient(ellipse 80% 60% at 70% 20%, black, transparent 70%);
}

.hero-fade-up {
  opacity: 0;
  transform: translateY(22px);
  animation: heroFadeUp 0.9s cubic-bezier(0.16, 1, 0.3, 1) forwards;
}
@keyframes heroFadeUp {
  to { opacity: 1; transform: translateY(0); }
}

.hero-photo-fade {
  opacity: 0;
  transform: scale(1.045);
  animation: heroPhotoFade 1.3s cubic-bezier(0.16, 1, 0.3, 1) forwards;
  animation-delay: .15s;
}
@keyframes heroPhotoFade {
  to { opacity: 1; transform: scale(1); }
}

.hero-line-fade {
  opacity: 0;
  animation: heroLineFade 1s ease-out forwards;
  animation-delay: .55s;
}
@keyframes heroLineFade {
  to { opacity: .25; }
}

@media (prefers-reduced-motion: reduce) {
  .hero-fade-up, .hero-photo-fade, .hero-line-fade { animation: none; opacity: 1; transform: none; }
  .reveal { transition: none !important; opacity: 1 !important; transform: none !important; }
}

/* ── Animaciones de entrada al hacer scroll (resto de la página) ── */
.reveal {
  opacity: 0;
  transform: translateY(28px);
  transition: opacity .7s cubic-bezier(0.16, 1, 0.3, 1), transform .7s cubic-bezier(0.16, 1, 0.3, 1);
}
.reveal.is-visible {
  opacity: 1;
  transform: translateY(0);
}
.stagger-grid > .reveal:nth-child(1) { transition-delay: 0ms; }
.stagger-grid > .reveal:nth-child(2) { transition-delay: 80ms; }
.stagger-grid > .reveal:nth-child(3) { transition-delay: 160ms; }
.stagger-grid > .reveal:nth-child(4) { transition-delay: 240ms; }
.stagger-grid > .reveal:nth-child(5) { transition-delay: 320ms; }
.stagger-grid > .reveal:nth-child(6) { transition-delay: 400ms; }

.text-navy { color: #0D2B4E; }
.bg-navy { background-color: #0D2B4E; }
.bg-navy-deep { background-color: #061428; }
.text-teal { color: #117A65; }
.bg-teal { background-color: #117A65; }
.text-gold { color: #B7950B; }
.bg-gold { background-color: #B7950B; }
.text-gold-light { color: #D4AC0D; }
.bg-gold-light { background-color: #D4AC0D; }
.text-coral { color: #E74C3C; }
.text-purple { color: #6C3483; }
.bg-purple { background-color: #6C3483; }

.calc-input,
.form-input {
  width: 100%;
  border: 1px solid #E2E8F0;
  border-radius: 0.75rem;
  padding: 0.7rem 0.9rem;
  font-size: 0.875rem;
  color: #0D2B4E;
  background: white;
  transition: border-color 0.2s;
}
.calc-input:focus,
.form-input:focus {
  outline: none;
  border-color: #1D67E3;
}
.form-input-error {
  border-color: #EF4444;
}

.sticky-fade-enter-active,
.sticky-fade-leave-active {
  transition: transform 0.3s ease, opacity 0.3s ease;
}
.sticky-fade-enter-from,
.sticky-fade-leave-to {
  transform: translateY(100%);
  opacity: 0;
}
</style>
