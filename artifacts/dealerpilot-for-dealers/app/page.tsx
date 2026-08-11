import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "DealerPilot para dealers | Operación comercial en un solo lugar",
  description:
    "DealerPilot conecta inventario, Marketplace y conversaciones con compradores en una operación clara para dealers.",
  alternates: { canonical: "/", languages: { "es-US": "/", "en-US": "/en" } },
};

type Locale = "es" | "en";

const copy = {
  es: {
    language: "ES",
    otherLanguage: "EN",
    dealer: "Alpha MotorSports",
    location: "Manassas",
    nav: ["Resumen", "Inventario", "Marketplace", "Mensajes", "Estudio"],
    title: "Tu operación de ventas, en un solo lugar.",
    intro:
      "DealerPilot convierte el inventario, las publicaciones y las conversaciones en una operación ordenada para que tu equipo sepa qué sigue.",
    primaryCta: "Ver cómo funciona",
    secondaryCta: "Conocer los planes",
    welcome: "Buenos días, Alpha",
    ready: "Operación lista",
    attention: "3 oportunidades requieren atención",
    attentionText: "DealerPilot ordena el trabajo y te muestra el siguiente paso.",
    next: "Siguiente acción",
    nextTitle: "Publicar el próximo vehículo",
    nextText: "Fotos, precio y descripción ya preparados",
    view: "Abrir centro de mando",
    metrics: ["Listos", "Publicados", "Compradores", "Alertas"],
    activity: "Actividad de la operación",
    activityText: "Rendimiento de publicaciones y conversaciones",
    marketplace: "Marketplace",
    marketplaceText: "Estado de publicación",
    published: "Publicado",
    scheduled: "Programado",
    review: "En revisión",
    actionTitle: "Acciones próximas",
    actionItems: ["Publicar 3 vehículos recomendados", "Responder 7 compradores activos", "Retirar 1 anuncio de vehículo vendido"],
    workflowEyebrow: "Un flujo conectado",
    workflowTitle: "La operación se siente como un tablero, no como diez pestañas.",
    workflowText: "Cada módulo responde una pregunta concreta del día: qué está listo, qué necesita atención y qué puede avanzar ahora.",
    modulesTitle: "Todo el trabajo del dealer, con la misma lógica visual.",
    modulesText: "Inventario, publicación, compradores y marca viven dentro de un mismo sistema operativo.",
    modules: [
      ["01", "Centro de mando", "Empieza el día con prioridades, alertas y el próximo paso."],
      ["02", "Inventario", "Precio, millaje, fotos y salud de cada unidad, en contexto."],
      ["03", "Marketplace", "Pasa de listo para publicar a anuncio activo con menos pasos."],
      ["04", "Mensajes", "Responde compradores relacionando cada conversación con su vehículo."],
      ["05", "Estudio de fotos", "Prepara galerías consistentes y portadas que venden."],
      ["06", "Dealer DNA", "Mantén el tono, las reglas y los datos propios de tu negocio."],
    ],
    extensionsEyebrow: "Extensiones de DealerPilot",
    extensionsTitle: "Automatización con contexto y control.",
    extensions: [
      ["01", "Publisher", "Publica inventario en Facebook Marketplace con fotos y datos preparados."],
      ["02", "Messenger AI", "Prepara respuestas usando el vehículo real, el dealer y la intención del comprador."],
      ["03", "Page Publisher", "Mantiene separada la página comercial del Marketplace del vendedor."],
    ],
    trustTitle: "Ayuda donde sirve. Decisión humana donde importa.",
    trust: ["Tu inventario es la referencia", "El equipo conserva el control", "Cada canal tiene su función"],
    pricingEyebrow: "Planes claros para operar",
    pricingTitle: "Empieza con el flujo que tu dealer necesita hoy.",
    pricingText: "Sin paquetes confusos. Elige publicar o publicar y contestar con IA.",
    plans: [
      ["Marketplace", "$97", "Publica inventario con orden y visibilidad.", ["Publicación en Facebook Marketplace", "Cola de vehículos listos", "Inventario y estados centralizados"]],
      ["Marketplace + IA", "$150", "Publica y responde compradores con contexto real.", ["Todo lo incluido en Marketplace", "Respuestas sugeridas por IA", "Seguimiento de conversaciones"]],
    ],
    choose: "Elegir plan",
    footer: "DealerPilot · Operación comercial para dealers independientes",
  },
  en: {
    language: "EN",
    otherLanguage: "ES",
    dealer: "Alpha MotorSports",
    location: "Manassas",
    nav: ["Overview", "Inventory", "Marketplace", "Messages", "Studio"],
    title: "Your sales operation, in one place.",
    intro:
      "DealerPilot turns inventory, listings, and buyer conversations into a clear operating system for your team.",
    primaryCta: "See how it works",
    secondaryCta: "View plans",
    welcome: "Good morning, Alpha",
    ready: "Operation ready",
    attention: "3 opportunities need attention",
    attentionText: "DealerPilot sorts the work and shows your next move.",
    next: "Next action",
    nextTitle: "Publish the next vehicle",
    nextText: "Photos, price, and description are ready",
    view: "Open command center",
    metrics: ["Ready", "Published", "Buyers", "Alerts"],
    activity: "Operation activity",
    activityText: "Listing and conversation performance",
    marketplace: "Marketplace",
    marketplaceText: "Publishing status",
    published: "Published",
    scheduled: "Scheduled",
    review: "In review",
    actionTitle: "Upcoming actions",
    actionItems: ["Publish 3 recommended vehicles", "Reply to 7 active buyers", "Remove 1 sold vehicle listing"],
    workflowEyebrow: "One connected workflow",
    workflowTitle: "Your operation feels like a command center, not ten browser tabs.",
    workflowText: "Every module answers a concrete daily question: what is ready, what needs attention, and what can move forward now.",
    modulesTitle: "Every dealer workflow, with the same visual logic.",
    modulesText: "Inventory, publishing, buyers, and brand live inside one operating system.",
    modules: [["01", "Command center", "Start the day with priorities, alerts, and the next move."], ["02", "Inventory", "Price, mileage, photos, and unit health in context."], ["03", "Marketplace", "Move from ready to publish to active listing with fewer steps."], ["04", "Messages", "Reply to buyers with the vehicle in context."], ["05", "Photo studio", "Prepare consistent galleries and selling cover photos."], ["06", "Dealer DNA", "Keep your business tone, rules, and data consistent."]],
    extensionsEyebrow: "DealerPilot extensions",
    extensionsTitle: "Context-aware automation with control.",
    extensions: [["01", "Publisher", "Publish inventory to Facebook Marketplace with prepared photos and data."], ["02", "Messenger AI", "Prepare replies using the real vehicle, dealer, and buyer intent."], ["03", "Page Publisher", "Keep the commercial page separate from the seller Marketplace flow."]],
    trustTitle: "Help where it matters. Human decisions where they count.",
    trust: ["Your inventory is the source of truth", "Your team stays in control", "Every channel has a job"],
    pricingEyebrow: "Plans built for operations",
    pricingTitle: "Start with the workflow your dealer needs today.",
    pricingText: "No confusing bundles. Choose publishing or publishing plus AI replies.",
    plans: [["Marketplace", "$97", "Publish inventory with order and visibility.", ["Facebook Marketplace publishing", "Ready-to-publish queue", "Centralized inventory and statuses"]], ["Marketplace + AI", "$150", "Publish and reply to buyers with real context.", ["Everything in Marketplace", "AI-suggested replies", "Conversation follow-up"]]],
    choose: "Choose plan",
    footer: "DealerPilot · Commercial operations for independent dealers",
  },
} as const;

function MiniChart() {
  return (
    <svg className="landingChart" viewBox="0 0 620 170" role="img" aria-label="Activity trend">
      <defs><linearGradient id="chartFill" x1="0" x2="0" y1="0" y2="1"><stop offset="0" stopColor="#7658d6" stopOpacity=".28" /><stop offset="1" stopColor="#7658d6" stopOpacity="0" /></linearGradient></defs>
      <path d="M0 145 C55 145 72 123 112 130 S164 99 208 110 S259 66 300 88 S347 103 382 72 S430 77 466 50 S528 82 563 36 S599 40 620 18 V170 H0 Z" fill="url(#chartFill)" />
      <path d="M0 145 C55 145 72 123 112 130 S164 99 208 110 S259 66 300 88 S347 103 382 72 S430 77 466 50 S528 82 563 36 S599 40 620 18" fill="none" stroke="#7658d6" strokeWidth="4" strokeLinecap="round" />
      {[0, 1, 2, 3].map((line) => <path key={line} d={`M0 ${35 + line * 35} H620`} stroke="#e8eaf3" strokeWidth="1" />)}
    </svg>
  );
}

function Brand() { return <a className="landingBrand" href="#inicio"><span className="landingBrandMark">DP</span><span>DealerPilot</span></a>; }

export function DealerLanding({ locale = "es" }: { locale?: Locale }) {
  const t = copy[locale];
  return (
    <main className="gymoveLanding">
      <aside className="landingSidebar">
        <Brand />
        <div className="landingDealer"><span className="onlineDot" /> <span>{t.dealer}</span><small>{t.location}</small></div>
        <p className="landingNavLabel">WORKSPACE</p>
        <nav className="landingNav" aria-label="Product navigation">
          {t.nav.map((item, index) => <a className={index === 0 ? "active" : ""} href={index === 0 ? "#inicio" : index === 1 ? "#modulos" : index === 2 ? "#precios" : "#extensiones"} key={item}><span className={`navGlyph glyph-${index}`} />{item}</a>)}
        </nav>
        <div className="sidebarBottom"><span className="miniGear">⚙</span><span>DealerPilot v4</span></div>
      </aside>

      <div className="landingMain">
        <header className="landingTopbar">
          <div className="mobileBrand"><Brand /></div>
          <div className="topbarContext"><span className="topbarPin">⌖</span><strong>{t.dealer}</strong><span>{t.location}</span></div>
          <div className="topbarStatus"><span className="onlineDot" /> {t.ready}</div>
          <div className="topbarActions"><a href={locale === "es" ? "/en" : "/"}>{t.otherLanguage}</a><span>/</span><a className="current" href={locale === "es" ? "/" : "/en"}>{t.language}</a><span className="topbarAvatar">OP</span></div>
        </header>

        <div className="landingContent">
          <section className="landingHero" id="inicio">
            <div className="heroIntro">
              <p className="landingEyebrow"><span /> {t.welcome}</p>
              <h1>{t.title}</h1>
              <p>{t.intro}</p>
              <div className="landingActions"><a className="landingPrimary" href="#flujo">{t.primaryCta}<span>→</span></a><a className="landingSecondary" href="#precios">{t.secondaryCta}<span>↗</span></a></div>
            </div>
            <div className="heroPreview">
              <div className="previewTop"><div><span className="previewLogo">DP</span><strong>Command center</strong></div><span className="previewReady"><i /> {t.ready}</span></div>
              <div className="previewBody"><p className="previewKicker">TODAY AT YOUR DEALER</p><h2>{t.attention}</h2><p>{t.attentionText}</p><div className="previewMetrics">{["5", "18", "7", "2"].map((value, index) => <div key={value}><strong className={index === 0 ? "violetNumber" : ""}>{value}</strong><span>{t.metrics[index]}</span></div>)}</div><div className="previewNext"><span className="numberBadge">1</span><div><strong>{t.nextTitle}</strong><small>{t.nextText}</small></div><span className="nextTag">{t.next}</span></div><div className="previewAlert"><span>✓</span><div><strong>Vehicle sold detected</strong><small>Remember to remove its Marketplace listing.</small></div></div></div>
            </div>
          </section>

          <section className="kpiGrid" aria-label="DealerPilot metrics">
            <article className="kpiCard kpiPurple"><span className="kpiIcon">↗</span><div><strong>94</strong><span>Eligible vehicles</span></div><small>+12% this month</small></article>
            <article className="kpiCard kpiBlue"><span className="kpiIcon">▣</span><div><strong>30</strong><span>Live listings</span></div><small>+8 published today</small></article>
            <article className="kpiCard kpiPink"><span className="kpiIcon">♡</span><div><strong>27</strong><span>Active buyers</span></div><small>7 need a reply</small></article>
            <article className="kpiCard kpiGreen"><span className="kpiIcon">✓</span><div><strong>98%</strong><span>Operation health</span></div><small>All systems ready</small></article>
          </section>

          <section className="dashboardGrid" id="flujo">
            <article className="landingPanel chartPanel"><div className="panelHeading"><div><p className="panelEyebrow">{t.activity}</p><h2>{t.activityText}</h2></div><select aria-label="Activity range" defaultValue="week"><option value="week">This week</option><option value="month">This month</option></select></div><MiniChart /><div className="chartLegend"><span><i className="legendViolet" />Listings</span><span><i className="legendBlue" />Buyer conversations</span><strong>+24.8%</strong></div></article>
            <article className="landingPanel statusPanel"><div className="panelHeading"><div><p className="panelEyebrow">{t.marketplace}</p><h2>{t.marketplaceText}</h2></div><span className="panelMore">···</span></div><div className="statusRows"><div><span className="statusBullet publishedBullet" /><div><strong>{t.published}</strong><small>30 vehicles live</small></div><b>70%</b></div><div><span className="statusBullet scheduledBullet" /><div><strong>{t.scheduled}</strong><small>12 vehicles queued</small></div><b>20%</b></div><div><span className="statusBullet reviewBullet" /><div><strong>{t.review}</strong><small>4 need a final check</small></div><b>10%</b></div></div><a className="panelLink" href="#precios">{t.view} <span>→</span></a></article>
          </section>

          <section className="actionStrip"><div><span className="actionBolt">✦</span><div><strong>{t.actionTitle}</strong><p>{t.actionItems[0]}</p></div></div><div className="actionList">{t.actionItems.slice(1).map((item, index) => <span key={item}><b>{index + 2}</b>{item}</span>)}</div><a href="#modulos">View all <span>→</span></a></section>

          <section className="contentSection workflowSection"><div className="sectionIntro"><p className="landingEyebrow"><span /> {t.workflowEyebrow}</p><h2>{t.workflowTitle}</h2><p>{t.workflowText}</p></div><div className="workflowSteps">{[["01", "Inventory", "Organize every vehicle before it becomes a task."], ["02", "Publish", "Move ready inventory through the right channel."], ["03", "Follow up", "Keep buyer conversations connected to the sale."]].map(([number, title, text]) => <article key={number}><span>{number}</span><h3>{title}</h3><p>{text}</p><i>→</i></article>)}</div></section>

          <section className="contentSection" id="modulos"><div className="sectionIntro centered"><p className="landingEyebrow"><span /> {t.modulesTitle}</p><h2>{t.modulesTitle}</h2><p>{t.modulesText}</p></div><div className="moduleGrid">{t.modules.map(([number, title, text], index) => <article className="moduleCard" key={number}><span className={`moduleIcon moduleIcon-${index}`}>{["⌘", "▦", "↗", "◌", "▧", "✦"][index]}</span><small>{number}</small><h3>{title}</h3><p>{text}</p><a href="#extensiones">Explore module <span>→</span></a></article>)}</div></section>

          <section className="contentSection extensionSection" id="extensiones"><div className="sectionIntro"><p className="landingEyebrow"><span /> {t.extensionsEyebrow}</p><h2>{t.extensionsTitle}</h2></div><div className="extensionGrid">{t.extensions.map(([number, title, text]) => <article key={number}><span>{number}</span><div><h3>{title}</h3><p>{text}</p></div><b>↗</b></article>)}</div></section>

          <section className="trustBanner"><div><p className="landingEyebrow"><span /> {t.trustTitle}</p><h2>{t.trustTitle}</h2></div><div className="trustItems">{t.trust.map((item, index) => <div key={item}><span>0{index + 1}</span><strong>{item}</strong><p>Built into every DealerPilot workflow.</p></div>)}</div></section>

          <section className="pricingSection" id="precios"><div className="sectionIntro centered"><p className="landingEyebrow"><span /> {t.pricingEyebrow}</p><h2>{t.pricingTitle}</h2><p>{t.pricingText}</p></div><div className="pricingGrid">{t.plans.map(([name, price, description, features], index) => <article className={`priceCard ${index === 1 ? "featured" : ""}`} key={name}>{index === 1 && <span className="popularTag">MOST POPULAR</span>}<div className="priceTop"><h3>{name}</h3><span className="priceIcon">{index === 0 ? "↗" : "✦"}</span></div><p>{description}</p><strong className="price">{price}<small>/month</small></strong><ul>{features.map((feature) => <li key={feature}><span>✓</span>{feature}</li>)}</ul><a href="#inicio" className={index === 1 ? "landingPrimary" : "landingSecondary"}>{t.choose}<span>→</span></a></article>)}</div></section>

          <footer className="landingFooter"><Brand /><span>{t.footer}</span><a href="#inicio">Back to top ↑</a></footer>
        </div>
      </div>
    </main>
  );
}

export default function Home() { return <DealerLanding />; }
