import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "DealerPilot para dealers | Menos trabajo manual, más oportunidades",
  description:
    "Conoce cómo DealerPilot ayuda a un dealer a organizar inventario, publicar vehículos, atender compradores y dar seguimiento desde un solo lugar.",
  alternates: { canonical: "/", languages: { "es-US": "/", "en-US": "/en" } },
};

const sections = [
  {
    number: "01",
    title: "Centro de mando",
    promise: "Empieza el día sabiendo qué requiere atención.",
    items: ["Prioridades del día", "Próximo vehículo recomendado", "Alertas y actividad reciente"],
  },
  {
    number: "02",
    title: "Inventario",
    promise: "Mantén cada vehículo visible, ordenado y listo para vender.",
    items: ["Catálogo completo", "Datos, precio, millaje y fotos", "Salud y estado de cada unidad"],
  },
  {
    number: "03",
    title: "Marketplace",
    promise: "Pasa de vehículo listo a anuncio publicado con menos pasos.",
    items: ["Textos de venta preparados", "Cola y calendario de publicación", "Control de anuncios activos"],
  },
  {
    number: "04",
    title: "Estudio de fotos",
    promise: "Presenta el inventario con una imagen más consistente.",
    items: ["Revisión de calidad", "Selección de portada", "Orden y preparación de galerías"],
  },
  {
    number: "05",
    title: "Ventas y compradores",
    promise: "Responde con contexto y evita que una oportunidad se enfríe.",
    items: ["Conversaciones reunidas", "Respuestas sugeridas", "Leads y próximos pasos"],
  },
  {
    number: "06",
    title: "Dealer DNA",
    promise: "Haz que cada respuesta suene como tu negocio.",
    items: ["Tono del dealer", "Programas de financiamiento", "Reglas y datos de la tienda"],
  },
  {
    number: "07",
    title: "Inteligencia de mercado",
    promise: "Decide qué publicar primero y evita competir contigo mismo.",
    items: ["Oportunidad por vehículo", "Señales de demanda", "Control de anuncios duplicados"],
  },
  {
    number: "08",
    title: "Conexiones y ajustes",
    promise: "Comprueba que todo esté listo antes de operar.",
    items: ["Estado de conexiones", "Ubicaciones del dealer", "Preferencias de operación"],
  },
];

const assistants = [
  {
    label: "PUBLICACIÓN",
    title: "DealerPilot AI Publisher",
    plainName: "Publicador de Marketplace",
    where: "Facebook Marketplace del vendedor",
    text: "Toma de la cola un vehículo aprobado, abre el formulario de Marketplace, carga las fotos y completa los datos del anuncio.",
    steps: ["Recibe el vehículo listo", "Completa fotos y datos", "Continúa según el modo elegido"],
    guardrail: "Se detiene ante inicios de sesión, verificaciones o bloqueos de Facebook. El dealer define el nivel de automatización.",
  },
  {
    label: "COMPRADORES",
    title: "DealerPilot Messenger AI",
    plainName: "Asistente de mensajes",
    where: "Conversaciones de Facebook Marketplace",
    text: "Identifica al comprador, el vehículo y la intención del mensaje. Luego prepara una respuesta usando los datos reales del inventario y del dealer.",
    steps: ["Detecta la conversación", "Propone una respuesta", "Registra el seguimiento"],
    guardrail: "Puede dejar la respuesta para revisión o enviarla cuando la respuesta automática está habilitada.",
  },
  {
    label: "MARCA",
    title: "DealerPilot Page Publisher",
    plainName: "Publicador de la página comercial",
    where: "Meta Business Suite",
    text: "Convierte un vehículo del inventario en un borrador para la página comercial, con texto y hasta diez fotos preparados.",
    steps: ["Elige el vehículo", "Prepara texto y fotos", "El equipo revisa y publica"],
    guardrail: "La publicación final siempre es humana y esta página se mantiene separada del Marketplace personal del vendedor.",
  },
];

const outcomes = [
  ["Menos cambios de pantalla", "Inventario, publicaciones y compradores viven en un mismo flujo."],
  ["Más consistencia", "El equipo trabaja con la misma información y las mismas prioridades."],
  ["Mejor seguimiento", "Las oportunidades pendientes y los vehículos que requieren acción son visibles."],
];

const plans = [
  {
    name: "Marketplace",
    price: "$97",
    description: "Para dealers que quieren mantener su inventario publicándose con orden.",
    features: ["Publicación en Facebook Marketplace", "Cola de vehículos listos", "Inventario y estado centralizados", "Controles de revisión antes de publicar"],
  },
  {
    name: "Marketplace + IA",
    price: "$150",
    description: "Para equipos que quieren publicar y contestar compradores con contexto real.",
    features: ["Todo lo incluido en Marketplace", "Respuestas sugeridas por IA", "Seguimiento de conversaciones", "Datos del dealer y del vehículo en cada respuesta"],
    featured: true,
  },
];

export default function Home() {
  return (
    <main>
      <nav className="topbar" aria-label="Navegación principal">
        <a className="brand" href="#inicio" aria-label="DealerPilot, inicio">
          <span className="brandMark">DP</span>
          <span>DealerPilot</span>
        </a>
        <div className="navLinks">
          <a href="#como-ayuda">Cómo funciona</a>
          <a href="#incluye">Secciones</a>
          <a href="#precios">Precios</a>
          <a href="#herramientas">Extensiones</a>
        </div>
        <div className="languageSwitch" aria-label="Cambiar idioma">
          <a href="/en" lang="en">EN</a><span>/</span><a href="/" className="active" aria-current="page">ES</a>
        </div>
      </nav>

      <section className="hero section" id="inicio">
        <div className="heroCopy reveal reveal-delay-1">
          <p className="eyebrow"><span /> Para dealers de vehículos</p>
          <h1>Tu operación de ventas, en un solo lugar.</h1>
          <p className="heroLead">
            DealerPilot conecta el inventario, las publicaciones y las conversaciones con compradores. Tu equipo ve qué vehículo necesita atención, qué se puede publicar y cuál es el siguiente paso para avanzar una venta.
          </p>
          <div className="heroActions">
            <a className="primaryButton" href="#como-ayuda">Ver cómo funciona <span aria-hidden="true">→</span></a>
            <a className="textLink" href="#herramientas">Conocer las 3 extensiones <span aria-hidden="true">→</span></a>
          </div>
          <p className="quietNote">Pensado para el ritmo real de un dealer independiente.</p>
        </div>

        <div className="productFrame reveal reveal-delay-2" aria-label="Ejemplo del centro de mando de DealerPilot">
          <div className="frameTop">
            <div className="miniBrand"><span>DP</span> Centro de mando</div>
            <span className="status"><i /> Operación lista</span>
          </div>
          <div className="frameBody">
            <p className="frameLabel">HOY EN TU DEALER</p>
            <h2>3 oportunidades requieren atención</h2>
            <p>DealerPilot ordena el trabajo y te muestra el siguiente paso.</p>
            <div className="metrics">
              <div className="metric primaryMetric"><strong>5</strong><span>Listos</span></div>
              <div className="metric"><strong>18</strong><span>Publicados</span></div>
              <div className="metric"><strong>7</strong><span>Compradores</span></div>
              <div className="metric"><strong>2</strong><span>Alertas</span></div>
            </div>
            <div className="nextAction">
              <span className="vehicleDot">1</span>
              <div><strong>Publicar el próximo vehículo</strong><small>Fotos, precio y descripción ya preparados</small></div>
              <span className="actionPill">Siguiente</span>
            </div>
            <div className="soldAlert">
              <span aria-hidden="true">✓</span>
              <div><strong>Vehículo vendido detectado</strong><small>Te recordamos retirar su anuncio de Marketplace.</small></div>
            </div>
          </div>
        </div>
      </section>

      <section className="outcomeStrip reveal reveal-delay-3" aria-label="Beneficios principales">
        {outcomes.map(([title, text]) => (
          <article key={title}><strong>{title}</strong><p>{text}</p></article>
        ))}
      </section>

      <section className="section flowSection reveal" id="como-ayuda">
        <header className="sectionHeading">
          <p className="eyebrow"><span /> Un día con DealerPilot</p>
          <h2>Así acompaña DealerPilot una venta, de principio a fin.</h2>
          <p>El sistema convierte el inventario en tareas concretas y mantiene conectados al vehículo, la publicación y el comprador.</p>
        </header>
        <div className="flowGrid">
          {[
            ["1", "Recibe el inventario", "Organiza precio, millaje, fotos, ubicación y estado de cada vehículo."],
            ["2", "Detecta lo pendiente", "Señala datos o fotos faltantes y muestra qué unidad está lista para avanzar."],
            ["3", "Prepara la publicación", "Ordena la galería y reúne la información necesaria para presentar bien el carro."],
            ["4", "Publica en cada canal", "Marketplace y la página comercial trabajan por rutas separadas para evitar confusiones."],
            ["5", "Atiende al comprador", "Relaciona la conversación con el vehículo y ayuda a responder con contexto real."],
            ["6", "Cierra el ciclo", "Cuando el carro se vende, cancela trabajo pendiente y recuerda retirar el anuncio activo."],
          ].map(([number, title, text]) => (
            <article className="flowStep" key={number}>
              <span>{number}</span><h3>{title}</h3><p>{text}</p>
            </article>
          ))}
        </div>
      </section>

      <section className="section featureSection reveal" id="incluye">
        <header className="sectionHeading splitHeading">
          <div><p className="eyebrow"><span /> Todo lo que incluye</p><h2>Una vista clara para cada parte del negocio.</h2></div>
          <p>No necesitas aprender palabras técnicas. Cada sección responde una pregunta concreta de la operación diaria.</p>
        </header>
        <div className="featureGrid">
          {sections.map((feature) => (
            <article className="featureCard" key={feature.number}>
              <span className="featureNumber">{feature.number}</span>
              <h3>{feature.title}</h3>
              <p>{feature.promise}</p>
              <ul>{feature.items.map((item) => <li key={item}><span aria-hidden="true">✓</span>{item}</li>)}</ul>
            </article>
          ))}
        </div>
      </section>

      <section className="section assistantsSection reveal" id="herramientas">
        <header className="sectionHeading splitHeading">
          <div><p className="eyebrow"><span /> Las extensiones de DealerPilot</p><h2>Tres extensiones, tres trabajos distintos.</h2></div>
          <p>Trabajan en el navegador junto a las páginas de Facebook que el equipo ya usa. Comparten el inventario de DealerPilot, pero cada una conserva su propio canal y sus propios controles.</p>
        </header>
        <div className="assistantGrid">
          {assistants.map((assistant, index) => (
            <article className="assistantCard" key={assistant.title}>
              <div className="assistantTop"><span className="assistantIcon">{index + 1}</span><small>{assistant.label}</small></div>
              <h3>{assistant.title}</h3>
              <p className="assistantPlainName">{assistant.plainName}</p>
              <div className="assistantWhere"><small>DÓNDE TRABAJA</small><strong>{assistant.where}</strong></div>
              <p>{assistant.text}</p>
              <ol>{assistant.steps.map((step) => <li key={step}>{step}</li>)}</ol>
              <div className="guardrail"><span aria-hidden="true">✓</span>{assistant.guardrail}</div>
            </article>
          ))}
        </div>
      </section>

      <section className="section soldSection reveal">
        <div className="soldCopy">
          <p className="eyebrow"><span /> Un detalle que evita confusiones</p>
          <h2>Cuando un carro se vende, el trabajo no termina en el lote.</h2>
          <p>DealerPilot identifica el cambio de estado en el inventario. Si ese vehículo todavía aparece publicado en Marketplace, muestra un aviso visible para que el equipo lo retire y no siga recibiendo mensajes por una unidad vendida.</p>
        </div>
        <div className="soldExample">
          <div className="soldVehicle"><span>VENDIDO</span><strong>2021 Toyota Camry SE</strong><small>VIN terminado en 4821</small></div>
          <div className="reminder"><span aria-hidden="true">!</span><div><strong>Retirar de Marketplace</strong><p>Este vehículo figura como vendido y su anuncio continúa activo.</p></div></div>
          <button type="button">Ver anuncio pendiente <span aria-hidden="true">→</span></button>
        </div>
      </section>

      <section className="section trustSection reveal">
        <header className="sectionHeading"><p className="eyebrow"><span /> Control para el dealer</p><h2>Ayuda donde sirve. Decisión humana donde importa.</h2></header>
        <div className="trustGrid">
          <article><span>01</span><h3>Tu inventario es la referencia</h3><p>Los textos, fotos y respuestas parten de la información real de cada vehículo.</p></article>
          <article><span>02</span><h3>El equipo conserva el control</h3><p>La publicación y las respuestas automáticas se habilitan según la forma de trabajar del dealer.</p></article>
          <article><span>03</span><h3>Cada canal tiene su función</h3><p>Marketplace, mensajes y página comercial se gestionan por separado para evitar cruces.</p></article>
        </div>
      </section>

      <section className="section pricingSection reveal" id="precios">
        <header className="sectionHeading splitHeading">
          <div><p className="eyebrow"><span /> Planes claros para empezar</p><h2>Elige cuánto quieres automatizar.</h2></div>
          <p>Comienza publicando con orden y suma respuestas con IA cuando tu equipo esté listo para atender más conversaciones.</p>
        </header>
        <div className="pricingGrid">
          {plans.map((plan) => (
            <article className={`pricingCard${plan.featured ? " pricingCardFeatured" : ""}`} key={plan.name}>
              {plan.featured ? <span className="recommendedTag">Recomendado</span> : null}
              <div className="pricingTop"><span className="pricingLabel">DealerPilot</span><span className="pricingCheck" aria-hidden="true">✓</span></div>
              <h3>{plan.name}</h3>
              <p className="pricingDescription">{plan.description}</p>
              <div className="price"><strong>{plan.price}</strong><span>/ mes</span></div>
              <ul>{plan.features.map((feature) => <li key={feature}><span aria-hidden="true">✓</span>{feature}</li>)}</ul>
              <a className={plan.featured ? "primaryButton" : "secondaryButton"} href="#inicio">Elegir este plan <span aria-hidden="true">→</span></a>
            </article>
          ))}
        </div>
      </section>

      <section className="ctaSection" aria-label="Resumen de DealerPilot">
        <div><p className="eyebrow lightEyebrow"><span /> El ciclo completo</p><h2>Un vehículo entra una vez. DealerPilot mantiene conectado todo lo que ocurre después.</h2><p>El inventario alimenta las publicaciones; las publicaciones generan conversaciones; las conversaciones se convierten en seguimiento; y el estado vendido cierra el ciclo para que el equipo no trabaje con información atrasada.</p></div>
        <div className="cycleSummary" aria-label="Ciclo de trabajo"><span>Inventario</span><i>→</i><span>Publicación</span><i>→</i><span>Comprador</span><i>→</i><span>Venta</span></div>
      </section>

      <footer><a className="brand" href="#inicio"><span className="brandMark">DP</span><span>DealerPilot</span></a><p>Más ventas. Menos trabajo manual.</p><a href="#inicio">Volver arriba ↑</a></footer>
    </main>
  );
}
