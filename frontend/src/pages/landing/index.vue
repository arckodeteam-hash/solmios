<template>
  <div class="bg-white min-h-screen">

    <!-- ═══ NAVBAR — componente compartido del sitio (mismo header en /p/:slug) ═══ -->
    <SiteHeader :active-section="activeSection" />

    <!-- ═══ HERO — claro, moderno, mockup de producto a la derecha ═══ -->
    <section id="hero" class="relative w-full overflow-hidden pt-32 md:pt-40 pb-20 px-6 md:px-10 bg-gradient-to-b from-blue-50/60 via-white to-white">
      <!-- Glow decorativo de fondo -->
      <div class="absolute top-[-10%] right-[-10%] w-[640px] h-[640px] rounded-full bg-blue-100/70 blur-3xl pointer-events-none"></div>
      <div class="absolute bottom-[-15%] left-[-10%] w-[480px] h-[480px] rounded-full bg-teal-50 blur-3xl pointer-events-none"></div>

      <div class="relative z-10 max-w-7xl mx-auto">
        <div class="grid lg:grid-cols-[1fr_1.2fr] gap-14 lg:gap-8 items-center">

          <!-- ── Columna izquierda: copy ── -->
          <div>
            <!-- Eyebrow / badge -->
            <div class="hero-fade-up inline-flex items-center gap-2 mb-6 px-3.5 py-1.5 rounded-full bg-blue-50 border border-blue-100">
              <span class="text-[11px] font-extrabold tracking-wide text-blue uppercase">PMS para Hoteles y Alojamientos</span>
            </div>

            <!-- Título -->
            <h1 class="hero-fade-up hero-title text-navy mb-6" style="animation-delay:.06s">
              Gestiona tu hotel<br>
              con <span class="text-blue">total control</span>
            </h1>

            <!-- Subtítulo -->
            <p class="hero-fade-up hero-body text-slate-500 mb-9" style="animation-delay:.12s">
              La plataforma todo-en-uno para hoteles, hostales y alojamientos. Reservas, housekeeping, channel manager y facturación conectados en un solo sistema.
            </p>

            <!-- CTAs -->
            <div class="hero-fade-up flex flex-wrap gap-3.5 mb-12" style="animation-delay:.18s">
              <router-link
                to="/registro"
                class="group inline-flex items-center gap-2.5 bg-blue text-white font-bold text-sm px-7 py-3.5 rounded-xl hover:bg-navy transition-all duration-300 hover:-translate-y-0.5 shadow-lg shadow-blue-200"
              >
                Comenzar Gratis
                <svg class="w-4 h-4 group-hover:translate-x-1 transition-transform" fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="2.5"><path stroke-linecap="round" stroke-linejoin="round" d="M17 8l4 4m0 0l-4 4m4-4H3"/></svg>
              </router-link>
              <a
                href="#how"
                class="inline-flex items-center gap-2.5 bg-white border border-slate-200 text-navy font-semibold text-sm px-7 py-3.5 rounded-xl hover:border-slate-300 hover:bg-slate-50 transition-colors"
              >
                <svg class="w-4 h-4 text-blue" fill="currentColor" viewBox="0 0 24 24"><path d="M8 5v14l11-7z"/></svg>
                Ver Demo
              </a>
            </div>

            <!-- Feature bullets -->
            <div class="hero-fade-up flex flex-wrap gap-x-8 gap-y-5" style="animation-delay:.24s">
              <div v-for="f in heroFeatures" :key="f.title" class="flex items-center gap-3 max-w-[180px]">
                <div class="w-10 h-10 rounded-xl bg-blue-50 flex items-center justify-center shrink-0" v-html="f.icon"></div>
                <div>
                  <div class="text-sm font-bold text-navy leading-tight">{{ f.title }}</div>
                  <div class="text-xs text-slate-400 leading-tight mt-0.5">{{ f.desc }}</div>
                </div>
              </div>
            </div>
          </div>

          <!-- ── Columna derecha: mockup del dashboard ── -->
          <div class="hero-fade-up relative lg:-mr-16 xl:-mr-28" style="animation-delay:.16s">
            <img
              :src="heroImage"
              alt="Dashboard de SolmiOS"
              class="w-full rounded-2xl border border-slate-200/80 shadow-2xl shadow-slate-300/40"
            >
          </div>

        </div>

      </div>
    </section>

    <!-- ═══ TRUST STRIP — carrusel infinito full-width ═══ -->
    <section class="w-full bg-white border-y border-slate-100 py-10 overflow-hidden">
      <p class="text-center text-xs text-slate-400 mb-7 px-6">Más de 500 hoteles y alojamientos confían en SolmiOS</p>
      <div class="relative overflow-hidden">
        <!-- Degradados laterales para efecto fade -->
        <div class="absolute left-0 top-0 bottom-0 w-20 md:w-32 bg-gradient-to-r from-white to-transparent z-10 pointer-events-none"></div>
        <div class="absolute right-0 top-0 bottom-0 w-20 md:w-32 bg-gradient-to-l from-white to-transparent z-10 pointer-events-none"></div>
        <!-- Track duplicado x2 para loop continuo (translateX -50%) -->
        <div class="flex w-max marquee-track gap-14 px-7">
          <div v-for="(brand, i) in carouselBrands" :key="i" class="flex items-center gap-2.5 shrink-0">
            <svg class="w-6 h-6 text-slate-300" fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="1.5"><path stroke-linecap="round" stroke-linejoin="round" d="M2.25 21h19.5m-18-18v18m10.5-18v18m6-13.5V21M6.75 6.75h.75m-.75 3h.75m-.75 3h.75m3.75-6h.75m-.75 3h.75m-.75 3h.75M6.75 21v-3.375c0-.621.504-1.125 1.125-1.125h2.25c.621 0 1.125.504 1.125 1.125V21"/></svg>
            <span class="text-base font-black text-slate-300 uppercase tracking-wider whitespace-nowrap">{{ brand }}</span>
          </div>
        </div>
      </div>
    </section>

    <!-- ═══ FEATURES — franja de iconos, minimalista ═══ -->
    <section id="features" class="py-16 px-6 bg-white border-y border-slate-100">
      <div class="max-w-7xl mx-auto">
        <div class="text-center mb-12">
          <h2 class="text-xl md:text-2xl font-black text-navy">Funciones diseñadas para simplificar tu operación</h2>
        </div>
        <div class="flex flex-wrap items-center justify-center gap-x-1 gap-y-8">
          <template v-for="(f, i) in quickFeatures" :key="f.label">
            <div class="flex flex-col items-center gap-3 px-7 w-32">
              <div class="w-12 h-12 rounded-2xl flex items-center justify-center" :style="`background:${f.bg}`" v-html="f.icon"></div>
              <span class="text-xs font-bold text-navy text-center leading-tight">{{ f.label }}</span>
            </div>
            <div v-if="i < quickFeatures.length - 1" class="w-px h-10 bg-slate-100 hidden md:block"></div>
          </template>
        </div>
      </div>
    </section>

    <!-- ═══ BENEFITS — visual + checklist, mismo lenguaje del hero ═══ -->
    <section id="benefits" class="py-24 px-6 bg-white">
      <div class="max-w-7xl mx-auto grid lg:grid-cols-2 gap-16 items-center">
        <!-- Visual -->
        <div class="relative">
          <div class="aspect-[4/3] rounded-3xl relative overflow-hidden shadow-xl border border-slate-100">
            <img
              src="https://images.unsplash.com/photo-1566073771259-6a8506099945?w=900&q=80&auto=format&fit=crop"
              alt="Habitación tipo Airbnb gestionada con SolmiOS"
              class="w-full h-full object-cover"
              loading="lazy"
            >
          </div>
          <!-- Floating KPI card con gráfico de pastel (lado izquierdo) -->
          <div class="absolute -bottom-6 -left-4 sm:-left-6 bg-white rounded-2xl shadow-xl border border-slate-100 p-5 w-52">
            <div class="text-[11px] text-slate-400 mb-3">Ocupación por canal</div>
            <div class="flex items-center gap-4">
              <!-- Gráfico de pastel SVG: Directos 45%, OTAs 35%, Airbnb 20% -->
              <svg class="w-20 h-20 shrink-0" viewBox="0 0 36 36">
                <!-- 45% azul (Directos) -->
                <circle cx="18" cy="18" r="15.915" fill="none" stroke="#3B82F6" stroke-width="6"
                  stroke-dasharray="45 55" stroke-dashoffset="25" transform="rotate(-90 18 18)"/>
                <!-- 35% navy (OTAs) -->
                <circle cx="18" cy="18" r="15.915" fill="none" stroke="#0D2B4E" stroke-width="6"
                  stroke-dasharray="35 65" stroke-dashoffset="-20" transform="rotate(-90 18 18)"/>
                <!-- 20% teal (Airbnb) -->
                <circle cx="18" cy="18" r="15.915" fill="none" stroke="#117A65" stroke-width="6"
                  stroke-dasharray="20 80" stroke-dashoffset="-55" transform="rotate(-90 18 18)"/>
              </svg>
              <div class="space-y-1.5">
                <div class="flex items-center gap-1.5"><span class="w-2 h-2 rounded-full bg-blue-500"></span><span class="text-[10px] font-semibold text-slate-600">Directos 45%</span></div>
                <div class="flex items-center gap-1.5"><span class="w-2 h-2 rounded-full bg-navy"></span><span class="text-[10px] font-semibold text-slate-600">OTAs 35%</span></div>
                <div class="flex items-center gap-1.5"><span class="w-2 h-2 rounded-full bg-teal"></span><span class="text-[10px] font-semibold text-slate-600">Airbnb 20%</span></div>
              </div>
            </div>
          </div>
        </div>

        <!-- Copy -->
        <div>
          <div class="inline-flex items-center gap-2 mb-5 px-3.5 py-1.5 rounded-full bg-blue-50 border border-blue-100">
            <span class="text-[11px] font-extrabold tracking-wide text-blue uppercase">Por qué SolmiOS</span>
          </div>
          <h2 class="text-3xl md:text-4xl font-black text-navy mb-4">Una plataforma, infinitas ventajas</h2>
          <p class="text-slate-500 mb-8 max-w-md">Reemplaza las hojas de cálculo y herramientas sueltas por un sistema pensado para la operación diaria de tu hotel.</p>
          <div class="space-y-4 mb-9">
            <div v-for="b in benefits" :key="b" class="flex items-start gap-3">
              <svg class="w-5 h-5 shrink-0 mt-0.5" viewBox="0 0 24 24" fill="none">
                <circle cx="12" cy="12" r="10" fill="#3B82F6"/>
                <path d="M7.5 12.5l3 3 6-6.5" stroke="white" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" fill="none"/>
              </svg>
              <span class="text-sm text-slate-600">{{ b }}</span>
            </div>
          </div>
          <router-link
            to="/registro"
            class="group inline-flex items-center gap-2.5 bg-blue text-white font-bold text-sm px-7 py-3.5 rounded-xl hover:bg-navy transition-all duration-300 hover:-translate-y-0.5 shadow-lg shadow-blue-200"
          >
            Comenzar Gratis
            <svg class="w-4 h-4 group-hover:translate-x-1 transition-transform" fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="2.5"><path stroke-linecap="round" stroke-linejoin="round" d="M17 8l4 4m0 0l-4 4m4-4H3"/></svg>
          </router-link>
        </div>
      </div>
    </section>

    <!-- ═══ HOW IT WORKS ═══ -->
    <section id="how" class="py-24 px-6 bg-white">
      <div class="max-w-7xl mx-auto">
        <div class="text-center mb-16">
          <div class="inline-flex items-center gap-2 mb-5 px-3.5 py-1.5 rounded-full bg-blue-50 border border-blue-100">
            <span class="text-[11px] font-extrabold tracking-wide text-blue uppercase">Cómo Funciona</span>
          </div>
          <h2 class="text-3xl md:text-4xl font-black text-navy mb-4">3 pasos para empezar</h2>
          <p class="text-slate-500 max-w-xl mx-auto">Configura tu hotel en minutos, no en semanas. Sin instalaciones, sin contratos largos.</p>
        </div>
        <div class="relative grid md:grid-cols-3 gap-8">
          <!-- Conector horizontal entre pasos (solo desktop) -->
          <div class="hidden md:block absolute top-12 left-[16.66%] right-[16.66%] h-px">
            <div class="w-full h-full border-t-2 border-dashed border-slate-200"></div>
          </div>

          <div v-for="(step, i) in steps" :key="step.num" class="relative text-center group">
            <div class="relative inline-flex items-center justify-center mb-6">
              <!-- Círculo del icono -->
              <div class="relative w-24 h-24 rounded-3xl flex items-center justify-center shadow-lg transition-transform duration-300 group-hover:-translate-y-1.5"
                :style="`background:${step.bg};color:${step.color};box-shadow:0 12px 30px ${step.bg}40`"
                v-html="step.icon"></div>
              <!-- Badge numerado -->
              <div class="absolute -top-2 -right-2 w-8 h-8 rounded-full bg-white border-2 flex items-center justify-center text-sm font-black shadow-md"
                :style="`color:${step.bg};border-color:${step.bg}`">{{ step.num }}</div>
            </div>
            <h3 class="text-lg font-black text-navy mb-2">{{ step.title }}</h3>
            <p class="text-sm text-slate-500 leading-relaxed max-w-xs mx-auto">{{ step.desc }}</p>
          </div>
        </div>
        <div class="text-center mt-14">
          <router-link
            to="/registro"
            class="group inline-flex items-center gap-2.5 bg-blue text-white font-bold text-sm px-7 py-3.5 rounded-xl hover:bg-navy transition-all duration-300 hover:-translate-y-0.5 shadow-lg shadow-blue-200"
          >
            Empezar ahora
            <svg class="w-4 h-4 group-hover:translate-x-1 transition-transform" fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="2.5"><path stroke-linecap="round" stroke-linejoin="round" d="M17 8l4 4m0 0l-4 4m4-4H3"/></svg>
          </router-link>
        </div>
      </div>
    </section>

    <!-- ═══ INTEGRATIONS ═══ -->
    <section id="integrations" class="py-24 px-6 bg-slate-50">
      <div class="max-w-7xl mx-auto">
        <div class="text-center mb-16">
          <div class="inline-flex items-center gap-2 mb-5 px-3.5 py-1.5 rounded-full bg-blue-50 border border-blue-100">
            <span class="text-[11px] font-extrabold tracking-wide text-blue uppercase">Integraciones</span>
          </div>
          <h2 class="text-3xl md:text-4xl font-black text-navy mb-4">Conecta con tu ecosistema</h2>
          <p class="text-slate-500 max-w-xl mx-auto">APIs abiertas que se conectan con el stack que ya usas.</p>
        </div>
        <div class="grid grid-cols-2 md:grid-cols-4 gap-5">
          <div v-for="int in integrations" :key="int.name"
            class="group relative rounded-2xl p-7 flex flex-col items-center text-center border border-slate-100 bg-white overflow-hidden transition-all duration-300 cursor-pointer hover:-translate-y-1.5 hover:border-transparent hover:shadow-[0_14px_40px_rgba(13,43,78,0.10)]">
            <!-- Acento superior con color de marca -->
            <div class="absolute inset-x-0 top-0 h-1 origin-left scale-x-0 group-hover:scale-x-100 transition-transform duration-300" :style="`background:${int.color}`"></div>
            <div class="w-16 h-16 rounded-2xl flex items-center justify-center mb-4 transition-transform duration-300 group-hover:scale-110" :style="`background:${int.color}14`" v-html="int.icon"></div>
            <div class="text-sm font-bold text-navy transition-colors">{{ int.name }}</div>
            <div class="text-[10px] mt-1 text-slate-400">{{ int.cat }}</div>
          </div>
        </div>
      </div>
    </section>

    <!-- ═══ PRICING ═══ -->
    <section id="pricing" class="py-24 px-6 bg-white">
      <div class="max-w-7xl mx-auto">
        <div class="text-center mb-16">
          <div class="inline-flex items-center gap-2 mb-5 px-3.5 py-1.5 rounded-full bg-blue-50 border border-blue-100">
            <span class="text-[11px] font-extrabold tracking-wide text-blue uppercase">Precios</span>
          </div>
          <h2 class="text-3xl md:text-4xl font-black text-navy mb-4">Planes para cada hotel</h2>
          <p class="text-slate-500 max-w-xl mx-auto">Sin contratos largos. Cancela cuando quieras. Soporte incluido en todos los planes.</p>
        </div>
        <div class="grid sm:grid-cols-2 lg:grid-cols-5 gap-5 items-start">
          <div v-for="plan in plans" :key="plan.name"
            class="rounded-2xl border border-slate-200 bg-white overflow-hidden transition-all flex flex-col h-full"
            :class="plan.featured ? 'shadow-xl lg:-translate-y-2 ring-1 ring-purple/15' : 'hover:shadow-md'">
            <div class="p-6" :class="planColor(plan.color).header">
              <div v-if="plan.badge" class="inline-flex mb-3 text-[10px] font-extrabold px-3 py-1 rounded-full uppercase tracking-wider" :class="planColor(plan.color).badge">{{ plan.badge }}</div>
              <div class="text-lg font-black text-white mb-1">{{ plan.name }}</div>
              <div class="flex items-end gap-1.5 flex-wrap">
                <span class="text-2xl font-black text-white">{{ plan.price }}</span>
                <span v-if="plan.priceSuffix" class="text-xs text-white/60 mb-1">{{ plan.priceSuffix }}</span>
              </div>
              <div class="text-[11px] text-white/70 mt-1">{{ plan.rooms }}</div>
            </div>
            <div class="p-6 flex flex-col flex-1">
              <p class="text-xs text-slate-500 mb-5 min-h-10">{{ plan.desc }}</p>
              <a v-if="plan.href" :href="plan.href"
                class="block w-full py-2.5 rounded-xl text-center text-xs font-bold mb-6 border transition-colors"
                :class="planColor(plan.color).cta">
                {{ plan.cta }}
              </a>
              <!-- `?plan=` preselecciona el plan en el alta: elegir "Professional" acá y que el
                   formulario abra en el primero de la lista pierde la intención del visitante.
                   Un slug desconocido no rompe nada — el alta cae a su default. -->
              <router-link v-else :to="{ path: '/registro', query: { plan: plan.slug } }"
                class="block w-full py-2.5 rounded-xl text-center text-xs font-bold mb-6 border transition-colors"
                :class="planColor(plan.color).cta">
                {{ plan.cta }}
              </router-link>
              <div class="space-y-2.5 flex-1">
                <div v-for="feat in plan.features" :key="feat" class="flex items-start gap-2 text-xs text-slate-600">
                  <svg class="w-3.5 h-3.5 shrink-0 mt-0.5" :class="planColor(plan.color).check" fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="2.5"><path stroke-linecap="round" stroke-linejoin="round" d="M4.5 12.75l6 6 9-13.5"/></svg>
                  {{ feat }}
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>

    <!-- ═══ TESTIMONIALS ═══ -->
    <section id="testimonials" class="py-24 px-6 bg-slate-50">
      <div class="max-w-7xl mx-auto">
        <div class="text-center mb-16">
          <div class="inline-flex items-center gap-2 mb-5 px-3.5 py-1.5 rounded-full bg-blue-50 border border-blue-100">
            <span class="text-[11px] font-extrabold tracking-wide text-blue uppercase">Testimonios</span>
          </div>
          <h2 class="text-3xl md:text-4xl font-black text-navy">Hoteles que están creciendo con nosotros</h2>
        </div>
        <div class="grid md:grid-cols-3 gap-6">
          <div v-for="t in testimonials" :key="t.name" class="bg-white border border-slate-100 rounded-2xl p-8 hover:shadow-lg hover:-translate-y-1 transition-all duration-300">
            <div class="flex gap-0.5 mb-5">
              <svg v-for="i in 5" :key="i" class="w-4 h-4" fill="#D4AC0D" viewBox="0 0 20 20"><path d="M9.049 2.927c.3-.921 1.603-.921 1.902 0l1.07 3.292a1 1 0 00.95.69h3.462c.969 0 1.371 1.24.588 1.81l-2.8 2.034a1 1 0 00-.364 1.118l1.07 3.292c.3.921-.755 1.688-1.54 1.118l-2.8-2.034a1 1 0 00-1.175 0l-2.8 2.034c-.784.57-1.838-.197-1.539-1.118l1.07-3.292a1 1 0 00-.364-1.118L2.98 8.72c-.783-.57-.38-1.81.588-1.81h3.461a1 1 0 00.951-.69l1.07-3.292z"/></svg>
            </div>
            <p class="text-sm text-slate-600 leading-relaxed mb-6">"{{ t.quote }}"</p>
            <div class="flex items-center gap-3">
              <div class="w-10 h-10 rounded-full flex items-center justify-center text-sm font-black text-white" :style="`background:${t.avatarBg}`">{{ t.initials }}</div>
              <div>
                <div class="text-sm font-bold text-navy">{{ t.name }}</div>
                <div class="text-[10px] text-slate-400">{{ t.hotel }}</div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>

    <!-- ═══ CTA ═══ -->
    <section class="relative py-28 px-6 overflow-hidden bg-navy-deep">
      <!-- Glows decorativos -->
      <div class="absolute top-0 right-0 w-[480px] h-[480px] rounded-full bg-blue-600/20 blur-3xl pointer-events-none" style="transform:translate(25%,-30%)"></div>
      <div class="absolute bottom-0 left-0 w-[360px] h-[360px] rounded-full bg-blue-500/10 blur-3xl pointer-events-none" style="transform:translate(-25%,25%)"></div>
      <div class="absolute inset-0 opacity-[0.07]">
        <div class="absolute top-10 right-16 w-80 h-80 rounded-full border border-white"></div>
        <div class="absolute bottom-10 left-20 w-52 h-52 rounded-full border border-white"></div>
        <div class="absolute top-1/2 left-1/3 w-32 h-32 rounded-full border border-white"></div>
      </div>
      <div class="max-w-3xl mx-auto text-center relative z-10">
        <div class="inline-flex items-center gap-2 mb-6 px-3.5 py-1.5 rounded-full bg-white/10 border border-white/15 backdrop-blur">
          <span class="w-1.5 h-1.5 rounded-full bg-blue-400 animate-pulse"></span>
          <span class="text-[11px] font-extrabold tracking-wide text-white/90 uppercase">Prueba gratis 14 días</span>
        </div>
        <h2 class="text-3xl md:text-5xl font-black text-white mb-6 leading-tight">¿Listo para transformar<br>tu hotel?</h2>
        <p class="text-white/60 mb-10 max-w-xl mx-auto">Únete a 500+ hoteles que ya gestionan todo desde SolmiOS. Sin tarjeta de crédito, cancela cuando quieras.</p>
        <div class="flex flex-wrap gap-4 justify-center">
          <router-link to="/registro" class="group inline-flex items-center gap-2 bg-white text-blue font-bold text-sm px-8 py-4 rounded-xl hover:bg-blue-50 hover:-translate-y-0.5 transition-all duration-300 shadow-xl shadow-blue-900/30">
            Comenzar Gratis
            <svg class="w-4 h-4 group-hover:translate-x-1 transition-transform" fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="2.5"><path stroke-linecap="round" stroke-linejoin="round" d="M17 8l4 4m0 0l-4 4m4-4H3"/></svg>
          </router-link>
          <a href="mailto:ventas@solmios.com" class="inline-flex items-center gap-2 border border-white/20 text-white font-semibold text-sm px-8 py-4 rounded-xl hover:bg-white/10 transition-colors">Hablar con Ventas</a>
        </div>
        <!-- Trust mini-badges -->
        <div class="flex flex-wrap items-center justify-center gap-x-8 gap-y-3 mt-12 text-white/40">
          <span class="inline-flex items-center gap-2 text-xs font-semibold"><svg class="w-4 h-4 text-blue-400" fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="2.5"><path stroke-linecap="round" stroke-linejoin="round" d="M9 12.75L11.25 15 15 9.75M21 12a9 9 0 11-18 0 9 9 0 0118 0z"/></svg>Sin tarjeta de crédito</span>
          <span class="inline-flex items-center gap-2 text-xs font-semibold"><svg class="w-4 h-4 text-blue-400" fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="2.5"><path stroke-linecap="round" stroke-linejoin="round" d="M9 12.75L11.25 15 15 9.75M21 12a9 9 0 11-18 0 9 9 0 0118 0z"/></svg>Configuración en 24h</span>
          <span class="inline-flex items-center gap-2 text-xs font-semibold"><svg class="w-4 h-4 text-blue-400" fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="2.5"><path stroke-linecap="round" stroke-linejoin="round" d="M9 12.75L11.25 15 15 9.75M21 12a9 9 0 11-18 0 9 9 0 0118 0z"/></svg>Cancela cuando quieras</span>
        </div>
      </div>
    </section>

    <!-- ═══ FOOTER — componente compartido del sitio (mismo footer en /p/:slug) ═══ -->
    <SiteFooter />
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted, onUnmounted } from 'vue'
import heroImage from '@/assets/hero.png'
import SiteHeader from '@/components/site/SiteHeader.vue'
import SiteFooter from '@/components/site/SiteFooter.vue'

const activeSection = ref('hero') // scroll-spy: se le pasa al SiteHeader

let observer: IntersectionObserver

onMounted(() => {
  observer = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        if (entry.isIntersecting) {
          activeSection.value = entry.target.id
        }
      }
    },
    { threshold: 0.35, rootMargin: '-80px 0px -40% 0px' }
  )
  document.querySelectorAll('section[id]').forEach(s => observer.observe(s))
})

onUnmounted(() => {
  observer?.disconnect()
})


const heroFeatures = [
  { title: 'Ahorra tiempo', desc: 'Automatiza tareas y procesos', icon: '<svg class="w-5 h-5 text-blue" fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="1.5"><path stroke-linecap="round" stroke-linejoin="round" d="M12 6v6h4.5m4.5-3a9 9 0 11-18 0 9 9 0 0118 0z"/></svg>' },
  { title: 'Más reservas', desc: 'Conecta todos tus canales', icon: '<svg class="w-5 h-5 text-blue" fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="1.5"><path stroke-linecap="round" stroke-linejoin="round" d="M3 13.125C3 12.504 3.504 12 4.125 12h2.25c.621 0 1.125.504 1.125 1.125v6.75C7.5 20.496 6.996 21 6.375 21h-2.25A1.125 1.125 0 013 19.875v-6.75zM9.75 8.625c0-.621.504-1.125 1.125-1.125h2.25c.621 0 1.125.504 1.125 1.125v11.25c0 .621-.504 1.125-1.125 1.125h-2.25a1.125 1.125 0 01-1.125-1.125V8.625zM16.5 4.125c0-.621.504-1.125 1.125-1.125h2.25C20.496 3 21 3.504 21 4.125v15.75c0 .621-.504 1.125-1.125 1.125h-2.25a1.125 1.125 0 01-1.125-1.125V4.125z"/></svg>' },
  { title: 'Todo seguro', desc: 'Datos protegidos 24/7', icon: '<svg class="w-5 h-5 text-blue" fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="1.5"><path stroke-linecap="round" stroke-linejoin="round" d="M9 12.75L11.25 15 15 9.75m6-3v8.25a9 9 0 01-9 9 9 9 0 01-9-9V6.75L12 3l9 3.75z"/></svg>' },
]

const socialBrands = ['Hotel Caribe', 'Gran Hotel SD', 'Resort Playa', 'Boutique Colonial', 'Eco Lodge', 'Casa Azul', 'Villa del Mar', 'Posada Real', 'Hotel Mirador', 'Sunset Suites']
const carouselBrands = [...socialBrands, ...socialBrands]

const quickFeatures = [
  { label: 'Reservas', bg: '#EFF6FF', icon: '<svg class="w-6 h-6 text-blue-500" fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="1.5"><path stroke-linecap="round" stroke-linejoin="round" d="M6.75 3v2.25M17.25 3v2.25M3 18.75V7.5a2.25 2.25 0 012.25-2.25h13.5A2.25 2.25 0 0121 7.5v11.25m-18 0A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75m-18 0v-7.5A2.25 2.25 0 015.25 9h13.5A2.25 2.25 0 0121 11.25v7.5"/></svg>' },
  { label: 'Channel Manager', bg: '#EFF6FF', icon: '<svg class="w-6 h-6 text-blue-500" fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="1.5"><path stroke-linecap="round" stroke-linejoin="round" d="M13.19 8.688a4.5 4.5 0 011.242 7.244l-4.5 4.5a4.5 4.5 0 01-6.364-6.364l1.757-1.757m13.35-.622l1.757-1.757a4.5 4.5 0 00-6.364-6.364l-4.5 4.5a4.5 4.5 0 001.242 7.244"/></svg>' },
  { label: 'Housekeeping', bg: '#EFF6FF', icon: '<svg class="w-6 h-6 text-blue-500" fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="1.5"><path stroke-linecap="round" stroke-linejoin="round" d="M9 12.75L11.25 15 15 9.75M21 12a9 9 0 11-18 0 9 9 0 0118 0z"/></svg>' },
  { label: 'Facturación', bg: '#EFF6FF', icon: '<svg class="w-6 h-6 text-blue-500" fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="1.5"><path stroke-linecap="round" stroke-linejoin="round" d="M19.5 14.25v-2.625a3.375 3.375 0 00-3.375-3.375h-1.5A1.125 1.125 0 0113.5 7.125v-1.5a3.375 3.375 0 00-3.375-3.375H8.25m0 12.75h7.5m-7.5 3H12M10.5 2.25H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 00-9-9z"/></svg>' },
  { label: 'Reportes', bg: '#EFF6FF', icon: '<svg class="w-6 h-6 text-blue-500" fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="1.5"><path stroke-linecap="round" stroke-linejoin="round" d="M3 13.125C3 12.504 3.504 12 4.125 12h2.25c.621 0 1.125.504 1.125 1.125v6.75C7.5 20.496 6.996 21 6.375 21h-2.25A1.125 1.125 0 013 19.875v-6.75zM9.75 8.625c0-.621.504-1.125 1.125-1.125h2.25c.621 0 1.125.504 1.125 1.125v11.25c0 .621-.504 1.125-1.125 1.125h-2.25a1.125 1.125 0 01-1.125-1.125V8.625zM16.5 4.125c0-.621.504-1.125 1.125-1.125h2.25C20.496 3 21 3.504 21 4.125v15.75c0 .621-.504 1.125-1.125 1.125h-2.25a1.125 1.125 0 01-1.125-1.125V4.125z"/></svg>' },
  { label: 'Mantenimiento', bg: '#EFF6FF', icon: '<svg class="w-6 h-6 text-blue-500" fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="1.5"><path stroke-linecap="round" stroke-linejoin="round" d="M11.42 15.17L17.25 21A2.652 2.652 0 0021 17.25l-5.877-5.877M11.42 15.17l2.496-3.03c.317-.384.74-.626 1.208-.766M11.42 15.17l-4.655 5.653a2.548 2.548 0 11-3.586-3.586l6.837-5.63m5.108-.233c.55-.164 1.163-.188 1.743-.14a4.5 4.5 0 004.486-6.336l-3.276 3.277a3.004 3.004 0 01-2.25-2.25l3.276-3.276a4.5 4.5 0 00-6.336 4.486c.091 1.076-.071 2.264-.904 2.95l-.102.085m-1.745 1.437L5.909 7.5H4.5L2.25 3.75l1.5-1.5L7.5 4.5v1.409l4.26 4.26m-1.745 1.437l1.745-1.437m6.615 8.206L15.75 15.75M4.867 19.125h.008v.008h-.008v-.008z"/></svg>' },
]

const benefits = [
  'Implementación en menos de 24 horas, sin curva de aprendizaje',
  'Soporte en español, 24/7, por chat y WhatsApp',
  'Sin contratos largos: cancela cuando quieras',
  'Migración de datos gratuita desde tu sistema actual',
  'Actualizaciones y nuevas funciones sin costo adicional',
  'Cumple normativa fiscal de 6 países LATAM automáticamente',
]

const steps = [
  { num: '1', title: 'Registra tu hotel', desc: 'Crea tu cuenta en 2 minutos. Configura nombre, habitaciones y tarifas básicas.', bg: '#3B82F6', color: '#fff', icon: '<svg class="w-7 h-7" fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="1.8"><path stroke-linecap="round" stroke-linejoin="round" d="M2.25 21h19.5m-18-18v18m10.5-18v18m6-13.5V21M6.75 6.75h.75m-.75 3h.75m-.75 3h.75m3.75-6h.75m-.75 3h.75m-.75 3h.75M6.75 21v-3.375c0-.621.504-1.125 1.125-1.125h2.25c.621 0 1.125.504 1.125 1.125V21"/></svg>' },
  { num: '2', title: 'Conecta tus canales', desc: 'Vincula Booking.com, Expedia y OTAs con el Channel Manager en un clic.', bg: '#0D2B4E', color: '#fff', icon: '<svg class="w-7 h-7" fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="1.8"><path stroke-linecap="round" stroke-linejoin="round" d="M13.19 8.688a4.5 4.5 0 011.242 7.244l-4.5 4.5a4.5 4.5 0 01-6.364-6.364l1.757-1.757m13.35-.622l1.757-1.757a4.5 4.5 0 00-6.364-6.364l-4.5 4.5a4.5 4.5 0 001.242 7.244"/></svg>' },
  { num: '3', title: 'Gestiona todo', desc: 'Reservas, check-in, housekeeping y facturación desde un solo dashboard.', bg: '#117A65', color: '#fff', icon: '<svg class="w-7 h-7" fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="1.8"><path stroke-linecap="round" stroke-linejoin="round" d="M9 17.25v1.007a3 3 0 01-.879 2.122L7.5 21h9l-.621-.621A3 3 0 0115 18.257V17.25m6-12V15a2.25 2.25 0 01-2.25 2.25H5.25A2.25 2.25 0 013 15V5.25m18 0A2.25 2.25 0 0018.75 3H5.25A2.25 2.25 0 003 5.25m18 0V12a2.25 2.25 0 01-2.25 2.25H5.25A2.25 2.25 0 013 12V5.25"/></svg>' },
]

const integrations = [
  { name: 'Booking.com', cat: 'Channel Manager', color: '#003A9A', icon: '<svg class="w-9 h-9" viewBox="0 0 24 24" fill="#003A9A"><path d="M24 0H0v24h24ZM8.575 6.563h2.658c2.108 0 3.473 1.15 3.473 2.898 0 1.15-.575 1.82-.91 2.108l-.287.263.335.192c.815.479 1.318 1.389 1.318 2.395 0 1.988-1.51 3.257-3.857 3.257H7.449V7.713c0-.623.503-1.126 1.126-1.15zm1.7 1.868c-.479.024-.694.264-.694.79v1.893h1.676c.958 0 1.294-.743 1.294-1.365 0-.815-.503-1.318-1.318-1.318zm-.096 4.36c-.407.071-.598.31-.598.79v2.251h1.868c.934 0 1.509-.55 1.509-1.533 0-.934-.599-1.509-1.51-1.509zm7.737 2.394c.743 0 1.341.599 1.341 1.342a1.34 1.34 0 0 1-1.341 1.341 1.355 1.355 0 0 1-1.341-1.341c0-.743.598-1.342 1.34-1.342z"/></svg>' },
  { name: 'Expedia', cat: 'Channel Manager', color: '#191E3B', icon: '<svg class="w-9 h-9" viewBox="0 0 24 24" fill="#191E3B"><path d="M19.067 0H4.933A4.94 4.94 0 0 0 0 4.933v14.134A4.932 4.932 0 0 0 4.933 24h14.134A4.932 4.932 0 0 0 24 19.067V4.933C24.01 2.213 21.797 0 19.067 0ZM7.336 19.341c0 .19-.148.337-.337.337h-2.33a.333.333 0 0 1-.337-.337v-2.33c0-.189.148-.336.337-.336H7c.19 0 .337.147.337.337zm12.121-1.486-2.308 2.298c-.169.168-.422.053-.422-.2V9.57l-6.44 6.44a.533.533 0 0 1-.421.17H8.169a.32.32 0 0 1-.338-.338v-1.697c0-.2.053-.316.169-.422l6.44-6.44H4.058c-.253 0-.369-.253-.2-.421l2.297-2.309c.137-.137.285-.232.517-.232H18.15c.854 0 1.539.686 1.539 1.54v11.478c-.01.231-.095.368-.232.516z"/></svg>' },
  { name: 'Airbnb', cat: 'Channel Manager', color: '#FF5A5F', icon: '<svg class="w-9 h-9" viewBox="0 0 24 24" fill="#FF5A5F"><path d="M12.001 18.275c-1.353-1.697-2.148-3.184-2.413-4.457-.263-1.027-.16-1.848.291-2.465.477-.71 1.188-1.056 2.121-1.056s1.643.345 2.12 1.063c.446.61.558 1.432.286 2.465-.291 1.298-1.085 2.785-2.412 4.458zm9.601 1.14c-.185 1.246-1.034 2.28-2.2 2.783-2.253.98-4.483-.583-6.392-2.704 3.157-3.951 3.74-7.028 2.385-9.018-.795-1.14-1.933-1.695-3.394-1.695-2.944 0-4.563 2.49-3.927 5.382.37 1.565 1.352 3.343 2.917 5.332-.98 1.085-1.91 1.856-2.732 2.333-.636.344-1.245.558-1.828.609-2.679.399-4.778-2.2-3.825-4.88.132-.345.395-.98.845-1.961l.025-.053c1.464-3.178 3.242-6.79 5.285-10.795l.053-.132.58-1.116c.45-.822.635-1.19 1.351-1.643.346-.21.77-.315 1.246-.315.954 0 1.698.558 2.016 1.007.158.239.345.557.582.953l.558 1.089.08.159c2.041 4.004 3.821 7.608 5.279 10.794l.026.025.533 1.22.318.764c.243.613.294 1.222.213 1.858zm1.22-2.39c-.186-.583-.505-1.271-.9-2.094v-.03c-1.889-4.006-3.642-7.608-5.307-10.844l-.111-.163C15.317 1.461 14.468 0 12.001 0c-2.44 0-3.476 1.695-4.535 3.898l-.081.16c-1.669 3.236-3.421 6.843-5.303 10.847v.053l-.559 1.22c-.21.504-.317.768-.345.847C-.172 20.74 2.611 24 5.98 24c.027 0 .132 0 .265-.027h.372c1.75-.213 3.554-1.325 5.384-3.317 1.829 1.989 3.635 3.104 5.382 3.317h.372c.133.027.239.027.265.027 3.37.003 6.152-3.261 4.802-6.975z"/></svg>' },
  { name: 'Stripe', cat: 'Pagos', color: '#635BFF', icon: '<svg class="w-9 h-9" viewBox="0 0 24 24" fill="#635BFF"><path d="M13.976 9.15c-2.172-.806-3.356-1.426-3.356-2.409 0-.831.683-1.305 1.901-1.305 2.227 0 4.515.858 6.09 1.631l.89-5.494C18.252.975 15.697 0 12.165 0 9.667 0 7.589.654 6.104 1.872 4.56 3.147 3.757 4.992 3.757 7.218c0 4.039 2.467 5.76 6.476 7.219 2.585.92 3.445 1.574 3.445 2.583 0 .98-.84 1.545-2.354 1.545-1.875 0-4.965-.921-6.99-2.109l-.9 5.555C5.175 22.99 8.385 24 11.714 24c2.641 0 4.843-.624 6.328-1.813 1.664-1.305 2.525-3.236 2.525-5.732 0-4.128-2.524-5.851-6.594-7.305h.003z"/></svg>' },
  { name: 'SendGrid', cat: 'Emails', color: '#1A82E2', icon: '<svg class="w-9 h-9" viewBox="0 0 24 24" fill="#1A82E2"><path d="M1.5 5.25A1.5 1.5 0 0 1 3 3.75h18a1.5 1.5 0 0 1 1.5 1.5v13.5a1.5 1.5 0 0 1-1.5 1.5H3a1.5 1.5 0 0 1-1.5-1.5V5.25Zm2.4.15v.69l8.1 4.86 8.1-4.86v-.69H3.9Zm16.2 2.55-7.62 4.57a1.5 1.5 0 0 1-1.56 0L3.9 7.95v10.35h16.2V7.95Z"/></svg>' },
  { name: 'Datadog', cat: 'Monitoreo', color: '#632CA6', icon: '<svg class="w-9 h-9" viewBox="0 0 24 24" fill="#632CA6"><path d="M15.05 6.848c-.034.075-.085.125-.007.37l.004.014.013.032.032.073c.14.287.295.558.552.696.067-.011.136-.019.207-.023.242-.01.395.028.492.08.009-.048.01-.119.005-.222-.018-.364.072-.982-.626-1.308-.264-.122-.634-.084-.757.068a.302.302 0 0 1 .058.013c.186.066.06.13.027.207m1.958 3.392c-.092-.05-.52-.03-.821.005-.574.068-1.193.267-1.328.372-.247.191-.135.523.047.66.511.382.96.638 1.432.575.29-.038.546-.497.728-.914.124-.288.124-.598-.058-.698m-5.077-2.942c.162-.154-.805-.355-1.556.156-.554.378-.571 1.187-.041 1.646.053.046.096.078.137.104a4.77 4.77 0 0 1 1.396-.412c.113-.125.243-.345.21-.745-.044-.542-.455-.456-.146-.749"/><path d="m20.871 10.811-.602.115L20.488 0 .789 2.285l2.427 19.693 2.306-.334c-.184-.263-.471-.581-.96-.989-.68-.564-.44-1.522-.039-2.127.53-1.022 3.26-2.322 3.106-3.956-.056-.594-.15-1.368-.702-1.898-.02.22.017.432.017.432s-.227-.289-.34-.683c-.112-.15-.2-.199-.319-.4-.085.233-.073.503-.073.503s-.186-.437-.216-.807c-.11.166-.137.48-.137.48s-.241-.69-.186-1.062c-.11-.323-.436-.965-.343-2.424.6.421 1.924.321 2.44-.439.171-.251.288-.939-.086-2.293-.24-.868-.835-2.16-1.066-2.651l-.028.02c.122.395.374 1.223.47 1.625.293 1.218.372 1.642.234 2.204-.116.488-.397.808-1.107 1.165-.71.358-1.653-.514-1.713-.562-.69-.55-1.224-1.447-1.284-1.883-.062-.477.275-.763.445-1.153-.243.07-.514.192-.514.192s.323-.334.722-.624c.165-.109.262-.178.436-.323a9.762 9.762 0 0 0-.456.003s.42-.227.855-.392c-.318-.014-.623-.003-.623-.003s.937-.419 1.678-.727c.509-.208 1.006-.147 1.286.257.367.53.752.817 1.569.996.501-.223.653-.337 1.284-.509.554-.61.99-.688.99-.688s-.216.198-.274.51c.314-.249.66-.455.66-.455s-.134.164-.259.426l.03.043c.366-.22.797-.394.797-.394s-.123.156-.268.358c.277-.002.838.012 1.056.037 1.285.028 1.552-1.374 2.045-1.55.618-.22.894-.353 1.947.68.903.888 1.609 2.477 1.259 2.833-.294.295-.874-.115-1.516-.916a3.466 3.466 0 0 1-.716-1.562 1.533 1.533 0 0 0-.497-.85s.23.51.23.96c0 .246.03 1.165.424 1.68-.039.076-.057.374-.1.43-.458-.554-1.443-.95-1.604-1.067.544.445 1.793 1.468 2.273 2.449.453.927.186 1.777.416 1.997.065.063.976 1.197 1.15 1.767.306.994.019 2.038-.381 2.685l-1.117.174c-.163-.045-.273-.068-.42-.153.08-.143.241-.5.243-.572l-.063-.111c-.348.492-.93.97-1.414 1.245-.633.359-1.363.304-1.838.156-1.348-.415-2.623-1.327-2.93-1.566 0 0-.01.191.048.234.34.383 1.119 1.077 1.872 1.56l-1.605.177.759 5.908c-.337.048-.39.071-.757.124-.325-1.147-.946-1.895-1.624-2.332-.599-.384-1.424-.47-2.214-.314l-.05.059a2.851 2.851 0 0 1 1.863.444c.654.413 1.181 1.481 1.375 2.124.248.822.42 1.7-.248 2.632-.476.662-1.864 1.028-2.986.237.3.481.705.876 1.25.95.809.11 1.577-.03 2.106-.574.452-.464.69-1.434.628-2.456l.714-.104.258 1.834L20.871 10.81Z"/></svg>' },
  { name: 'WhatsApp', cat: 'Mensajería', color: '#25D366', icon: '<svg class="w-9 h-9" viewBox="0 0 24 24" fill="#25D366"><path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413Z"/></svg>' },
  { name: 'API Propia', cat: 'Personalizada', color: '#3B82F6', icon: '<svg class="w-9 h-9" fill="none" stroke="#3B82F6" stroke-width="1.8" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M8 7l-5 5 5 5m8-16l5 5-5 5M14 4l-4 16"/></svg>' },
]

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

// `slug` referencia al plan real de la tabla `plans` del backend (ver
// backend/scripts/create-plans-table.ts) — es lo que viaja en `/registro?plan=`.
// El resto de los campos es copy de marketing y vive solo acá.
const plans = [
  {
    name: 'Essential', slug: 'essential', price: 'USD 99', priceSuffix: '/mes', rooms: 'Hasta 20 habitaciones', color: 'navy',
    desc: 'Para micro-hoteles, posadas y apartamentos turísticos.', cta: 'Prueba gratis 30 días',
    features: ['PMS Central completo', 'Channel Manager (6+ OTAs)', 'Motor de reservas sin comisión', 'Creador de sitio web', 'Dashboard operativo', 'Facturación electrónica LATAM', 'Soporte por email'],
  },
  {
    name: 'Starter', slug: 'starter', price: 'USD 199', priceSuffix: '/mes', rooms: 'Hasta 50 habitaciones', color: 'teal',
    desc: 'Para hoteles boutique pequeños en crecimiento.', cta: 'Prueba gratis 30 días',
    features: ['Todo lo del plan Essential', 'Recepción Digital (Check-In/Out online)', 'App SOLMI Staff para empleados', 'Housekeeping Inteligente', 'CRM y Fidelización básico', 'SOLMI Academy completa', 'Soporte prioritario'],
  },
  {
    name: 'Professional', slug: 'professional', price: 'USD 349', priceSuffix: '/mes', rooms: 'Hasta 100 habitaciones', color: 'purple',
    desc: 'La solución inteligente para hoteles y apartahoteles.', cta: 'Prueba gratis 30 días', badge: 'Más Popular', featured: true,
    features: ['Todo lo del plan Starter', 'Recepcionista Virtual con IA', 'Revenue Manager con IA', 'Nómina Automatizada', 'Marketing Automatizado', 'Business Intelligence avanzado', 'API Abierta e integraciones', 'Soporte dedicado con SLA'],
  },
  {
    name: 'Enterprise', slug: 'enterprise', price: 'USD 549', priceSuffix: '/mes', rooms: 'Hasta 200 habitaciones', color: 'gold',
    desc: 'Para hoteles grandes y cadenas boutique.', cta: 'Prueba gratis 30 días',
    features: ['Todo lo del plan Professional', 'Gerente Virtual con IA (briefings diarios)', 'Multipropiedad (hasta 3 propiedades)', 'Comunidad SOLMI (eventos y red)', 'App SOLMI Guest para huéspedes', 'Reportes ejecutivos consolidados', 'Account Manager dedicado', 'Onboarding premium incluido'],
  },
  {
    name: 'Ultra', price: 'A cotización', priceSuffix: '', rooms: '200+ hab. · Ilimitado', color: 'coral',
    desc: 'Para cadenas regionales, grupos hoteleros y franquicias.', cta: 'Contactar ventas', badge: 'Premium', href: 'mailto:ventas@solmios.com',
    features: ['Todos los 26 módulos sin límite', 'Multipropiedad ilimitada', 'Gerente Virtual IA personalizado', 'Integraciones a medida', 'Capacitación presencial', 'SLA < 1 hora de respuesta', 'Gerente de cuenta ejecutivo dedicado', 'Precio según volumen de propiedades'],
  },
]

const testimonials = [
  { quote: 'Pasamos de usar 4 herramientas diferentes a solo SolmiOS. El Channel Manager nos ahorró 3 horas diarias de trabajo manual.', name: 'Juan García', hotel: 'Hotel Caribe Paradise', initials: 'JG', avatarBg: '#1D6FA4' },
  { quote: 'La facturación electrónica para DGII era un dolor de cabeza. Ahora se genera automáticamente. El soporte es excepcional.', name: 'Roberto Suárez', hotel: 'Gran Hotel Santo Domingo', initials: 'RS', avatarBg: '#117A65' },
  { quote: 'Como recepcionista, todo es muy intuitivo. El check-in toma 30 segundos. Los huéspedes quedan impresionados.', name: 'María López', hotel: 'Hotel Caribe Paradise', initials: 'ML', avatarBg: '#6C3483' },
]
</script>

<style scoped>
/* ── HERO ── */
.hero-title {
  font-family: 'Playfair Display', Georgia, serif;
  font-size: clamp(2.25rem, 3.4vw, 3.5rem);
  font-weight: 900;
  letter-spacing: -0.02em;
  line-height: 1.1;
}

.hero-body {
  font-family: 'DM Sans', 'Inter', sans-serif;
  font-size: 1.06rem;
  line-height: 1.7;
  max-width: 460px;
}

/* Animación de entrada */
.hero-fade-up {
  opacity: 0;
  transform: translateY(22px);
  animation: heroFadeUp 0.9s cubic-bezier(0.16, 1, 0.3, 1) forwards;
}
@keyframes heroFadeUp {
  to { opacity: 1; transform: translateY(0); }
}



@media (prefers-reduced-motion: reduce) {
  .hero-fade-up { animation: none; opacity: 1; transform: none; }
}

/* ── CARRUSEL INFINITO (trust strip) ── */
.marquee-track {
  animation: marqueeScroll 35s linear infinite;
  will-change: transform;
}
.marquee-track:hover {
  animation-play-state: paused;
}
@keyframes marqueeScroll {
  from { transform: translateX(0); }
  to { transform: translateX(-50%); }
}
</style>
