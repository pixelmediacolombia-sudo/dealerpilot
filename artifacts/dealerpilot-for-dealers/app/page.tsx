import type { Metadata } from "next";
import { LandingMotion } from "./LandingMotion";

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
    nav: ["Inicio", "Cómo funciona", "Secciones", "Herramientas", "Precios"],
    title: "Tu operación de ventas, en un solo lugar.",
    intro:
      "Ordena inventario, publicaciones y conversaciones para que tu equipo sepa exactamente qué hacer después.",
    primaryCta: "Ver cómo funciona",
    secondaryCta: "Conocer los planes",
    welcome: "Una operación más clara",
    commandCenter: "Centro de mando",
    ready: "Operación lista",
    attention: "3 oportunidades requieren atención",
    attentionText: "DealerPilot ordena el trabajo y te muestra el siguiente paso.",
    next: "Siguiente acción",
    nextTitle: "Publicar el próximo vehículo",
    nextText: "Fotos, precio y descripción ya preparados",
    view: "Abrir centro de mando",
    metrics: ["Listos", "Publicados", "Compradores", "Alertas"],
    previewLabel: "HOY EN TU DEALER",
    sold: "Vehículo vendido detectado",
    soldText: "Retira su publicación para mantener el inventario al día.",
    workflowEyebrow: "Un flujo conectado",
    workflowTitle: "La operación se siente como un tablero, no como diez pestañas.",
    workflowText: "Cada módulo responde una pregunta concreta del día: qué está listo, qué necesita atención y qué puede avanzar ahora.",
    workflowSteps: [
      ["01", "Organiza", "Deja cada vehículo completo antes de convertirlo en una tarea."],
      ["02", "Publica", "Mueve el inventario listo por el canal que corresponde."],
      ["03", "Da seguimiento", "Mantén cada conversación conectada con la venta."],
    ],
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
    extensionsEyebrow: "Herramientas de DealerPilot",
    extensionsTitle: "Automatización con el contexto de tu operación.",
    exploreTools: "Ver herramientas",
    extensions: [
      ["01", "Publisher", "Publica inventario en Facebook Marketplace con fotos y datos preparados."],
      ["02", "Messenger AI", "Prepara respuestas usando el vehículo real, el dealer y la intención del comprador."],
      ["03", "Pages", "Publica vehículos directamente desde la página de Facebook de tu dealer."],
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
    nav: ["Overview", "How it works", "Sections", "Tools", "Pricing"],
    title: "Your sales operation, in one place.",
    intro:
      "Organize inventory, listings, and buyer conversations so your team always knows what to do next.",
    primaryCta: "See how it works",
    secondaryCta: "View plans",
    welcome: "A clearer operation",
    commandCenter: "Command center",
    ready: "Operation ready",
    attention: "3 opportunities need attention",
    attentionText: "DealerPilot sorts the work and shows your next move.",
    next: "Next action",
    nextTitle: "Publish the next vehicle",
    nextText: "Photos, price, and description are ready",
    view: "Open command center",
    metrics: ["Ready", "Published", "Buyers", "Alerts"],
    previewLabel: "TODAY AT YOUR DEALER",
    sold: "Sold vehicle detected",
    soldText: "Remove its listing to keep inventory up to date.",
    workflowEyebrow: "One connected workflow",
    workflowTitle: "Your operation feels like a command center, not ten browser tabs.",
    workflowText: "Every module answers a concrete daily question: what is ready, what needs attention, and what can move forward now.",
    workflowSteps: [["01", "Organize", "Complete every vehicle before it becomes a task."], ["02", "Publish", "Move ready inventory through the right channel."], ["03", "Follow up", "Keep buyer conversations connected to the sale."]],
    modulesTitle: "Every dealer workflow, with the same visual logic.",
    modulesText: "Inventory, publishing, buyers, and brand live inside one operating system.",
    modules: [["01", "Command center", "Start the day with priorities, alerts, and the next move."], ["02", "Inventory", "Price, mileage, photos, and unit health in context."], ["03", "Marketplace", "Move from ready to publish to active listing with fewer steps."], ["04", "Messages", "Reply to buyers with the vehicle in context."], ["05", "Photo studio", "Prepare consistent galleries and selling cover photos."], ["06", "Dealer DNA", "Keep your business tone, rules, and data consistent."]],
    extensionsEyebrow: "DealerPilot tools",
    extensionsTitle: "Context-aware automation with control.",
    exploreTools: "Explore tools",
    extensions: [["01", "Publisher", "Publish inventory to Facebook Marketplace with prepared photos and data."], ["02", "Messenger AI", "Prepare replies using the real vehicle, dealer, and buyer intent."], ["03", "Pages", "Publish vehicles directly from your dealership's Facebook Page."]],
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

function Brand() { return <a className="landingBrand" href="#inicio"><span className="landingBrandMark">DP</span><span>DealerPilot</span></a>; }

export function DealerLanding({ locale = "es" }: { locale?: Locale }) {
  const t = copy[locale];
  return (
    <main className="gymoveLanding">
      <div className="landingMain">
        <header className="landingTopbar">
          <Brand />
          <nav className="topbarSections" aria-label="Landing page sections">
            {t.nav.map((item, index) => <a className={index === 0 ? "active" : ""} href={index === 0 ? "#inicio" : index === 1 ? "#flujo" : index === 2 ? "#modulos" : index === 3 ? "#herramientas" : "#precios"} key={item}>{item}</a>)}
          </nav>
          <div className="topbarActions"><a href={locale === "es" ? "/en" : "/"}>{t.otherLanguage}</a><span>/</span><a className="current" href={locale === "es" ? "/" : "/en"}>{t.language}</a><span className="topbarAvatar">OP</span></div>
        </header>

        <div className="landingContent">
          <LandingMotion />
          <section className="landingHero motion-reveal" id="inicio">
            <div className="heroIntro">
              <p className="landingEyebrow"><span /> {t.welcome}</p>
              <h1>{t.title}</h1>
              <p>{t.intro}</p>
              <div className="landingActions"><a className="landingPrimary" href="#flujo">{t.primaryCta}<span>→</span></a><a className="landingSecondary" href="#precios">{t.secondaryCta}<span>↗</span></a></div>
            </div>
            <div className="heroPreview">
              <div className="previewTop"><div><span className="previewLogo">DP</span><strong>{t.commandCenter}</strong></div><span className="previewReady"><i /> {t.ready}</span></div>
              <div className="previewBody"><p className="previewKicker">{t.previewLabel}</p><h2>{t.attention}</h2><p>{t.attentionText}</p><div className="previewMetrics">{["5", "18", "7", "2"].map((value, index) => <div key={value}><strong className={index === 0 ? "violetNumber" : ""}>{value}</strong><span>{t.metrics[index]}</span></div>)}</div><div className="previewNext"><span className="numberBadge">1</span><div><strong>{t.nextTitle}</strong><small>{t.nextText}</small></div><span className="nextTag">{t.next}</span></div><div className="previewAlert"><span>✓</span><div><strong>{t.sold}</strong><small>{t.soldText}</small></div></div></div>
            </div>
          </section>

          <section className="contentSection workflowSection motion-reveal" id="flujo"><div className="sectionIntro"><p className="landingEyebrow"><span /> {t.workflowEyebrow}</p><h2>{t.workflowTitle}</h2><p>{t.workflowText}</p></div><div className="workflowSteps">{t.workflowSteps.map(([number, title, text]) => <article key={number}><span>{number}</span><h3>{title}</h3><p>{text}</p><i>→</i></article>)}</div></section>

          <section className="contentSection motion-reveal" id="modulos"><div className="sectionIntro centered"><p className="landingEyebrow"><span /> {t.modulesTitle}</p><h2>{t.modulesTitle}</h2><p>{t.modulesText}</p></div><div className="moduleGrid">{t.modules.map(([number, title, text], index) => <article className="moduleCard" key={number}><span className={`moduleIcon moduleIcon-${index}`}>{["⌘", "▦", "↗", "◌", "▧", "✦"][index]}</span><small>{number}</small><h3>{title}</h3><p>{text}</p><a href="#herramientas">{t.exploreTools} <span>→</span></a></article>)}</div></section>

          <section className="contentSection extensionSection motion-reveal" id="herramientas"><div className="sectionIntro"><p className="landingEyebrow"><span /> {t.extensionsEyebrow}</p><h2>{t.extensionsTitle}</h2></div><div className="extensionGrid">{t.extensions.map(([number, title, text]) => <article key={number}><span>{number}</span><div><h3>{title}</h3><p>{text}</p></div><b>↗</b></article>)}</div></section>

          <section className="trustBanner motion-reveal"><div><p className="landingEyebrow"><span /> {t.trustTitle}</p><h2>{t.trustTitle}</h2></div><div className="trustItems">{t.trust.map((item, index) => <div key={item}><span>0{index + 1}</span><strong>{item}</strong><p>Built into every DealerPilot workflow.</p></div>)}</div></section>

          <section className="pricingSection motion-reveal" id="precios"><div className="sectionIntro centered"><p className="landingEyebrow"><span /> {t.pricingEyebrow}</p><h2>{t.pricingTitle}</h2><p>{t.pricingText}</p></div><div className="pricingGrid">{t.plans.map(([name, price, description, features], index) => <article className={`priceCard ${index === 1 ? "featured" : ""}`} key={name}>{index === 1 && <span className="popularTag">MOST POPULAR</span>}<div className="priceTop"><h3>{name}</h3><span className="priceIcon">{index === 0 ? "↗" : "✦"}</span></div><p>{description}</p><strong className="price">{price}<small>/month</small></strong><ul>{features.map((feature) => <li key={feature}><span>✓</span>{feature}</li>)}</ul><a href="#inicio" className={index === 1 ? "landingPrimary" : "landingSecondary"}>{t.choose}<span>→</span></a></article>)}</div></section>

          <footer className="landingFooter"><Brand /><span>{t.footer}</span><a href="#inicio">Back to top ↑</a></footer>
        </div>
      </div>
    </main>
  );
}

export default function Home() { return <DealerLanding />; }
