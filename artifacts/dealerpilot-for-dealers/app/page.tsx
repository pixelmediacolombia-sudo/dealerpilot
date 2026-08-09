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
    title: "Publicador de Marketplace",
    text: "Toma un vehículo aprobado, prepara sus fotos y datos, y acompaña al operador hasta dejar el anuncio publicado.",
    guardrail: "El dealer conserva la revisión y el control final.",
  },
  {
    label: "COMPRADORES",
    title: "Asistente de mensajes",
    text: "Reconoce conversaciones de compradores y propone respuestas usando la información real del vehículo y del dealer.",
    guardrail: "Solo responde automáticamente cuando el dealer lo habilita.",
  },
  {
    label: "MARCA",
    title: "Publicador de la página del dealer",
    text: "Prepara publicaciones para la página comercial del dealer a partir del mismo inventario, con una revisión humana antes de salir.",
    guardrail: "La página comercial se mantiene separada de Marketplace.",
  },
];

const outcomes = [
  ["Menos cambios de pantalla", "Inventario, publicaciones y compradores viven en un mismo flujo."],
  ["Más consistencia", "El equipo trabaja con la misma información y las mismas prioridades."],
  ["Mejor seguimiento", "Las oportunidades pendientes y los vehículos que requieren acción son visibles."],
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
          <a href="#como-ayuda">Cómo ayuda</a>
          <a href="#incluye">Qué incluye</a>
          <a href="#herramientas">Herramientas</a>
        </div>
        <div className="languageSwitch" aria-label="Cambiar idioma">
          <a href="/en" lang="en">EN</a><span>/</span><a href="/" className="active" aria-current="page">ES</a>
        </div>
        <a className="navCta" href="#demo">Solicitar demo</a>
      </nav>

      <section className="hero section" id="inicio">
        <div className="heroCopy">
          <p className="eyebrow"><span /> Para dealers de vehículos</p>
          <h1>Tu operación de ventas, en un solo lugar.</h1>
          <p className="heroLead">
            DealerPilot ayuda a tu equipo a organizar el inventario, preparar anuncios, atender compradores y dar seguimiento sin depender de hojas sueltas ni procesos repetitivos.
          </p>
          <div className="heroActions">
            <a className="primaryButton" href="#demo">Quiero ver una demostración <span aria-hidden="true">→</span></a>
            <a className="textLink" href="#como-ayuda">Conocer el flujo diario <span aria-hidden="true">↓</span></a>
          </div>
          <p className="quietNote">Pensado para el ritmo real de un dealer independiente.</p>
        </div>

        <div className="productFrame" aria-label="Ejemplo del centro de mando de DealerPilot">
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

      <section className="outcomeStrip" aria-label="Beneficios principales">
        {outcomes.map(([title, text]) => (
          <article key={title}><strong>{title}</strong><p>{text}</p></article>
        ))}
      </section>

      <section className="section flowSection" id="como-ayuda">
        <header className="sectionHeading">
          <p className="eyebrow"><span /> Un día con DealerPilot</p>
          <h2>Del inventario a la conversación, sin perder el hilo.</h2>
          <p>Cada parte del trabajo se conecta con la siguiente para que el equipo sepa qué hacer y por qué.</p>
        </header>
        <div className="flowGrid">
          {[
            ["1", "Entra el inventario", "DealerPilot reúne la información y detecta qué falta."],
            ["2", "Se prepara la venta", "Ordena fotos y ayuda a crear un anuncio claro y completo."],
            ["3", "Se atiende al comprador", "La conversación parte de los datos reales del vehículo."],
            ["4", "Se cierra el ciclo", "Cuando se vende, avisa si el anuncio todavía sigue publicado."],
          ].map(([number, title, text]) => (
            <article className="flowStep" key={number}>
              <span>{number}</span><h3>{title}</h3><p>{text}</p>
            </article>
          ))}
        </div>
      </section>

      <section className="section featureSection" id="incluye">
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

      <section className="section assistantsSection" id="herramientas">
        <header className="sectionHeading splitHeading">
          <div><p className="eyebrow"><span /> Herramientas que trabajan contigo</p><h2>Tres asistentes, cada uno con una responsabilidad clara.</h2></div>
          <p>Se instalan en el navegador del equipo y ayudan dentro de las páginas que ya usan. El operador sigue teniendo control.</p>
        </header>
        <div className="assistantGrid">
          {assistants.map((assistant, index) => (
            <article className="assistantCard" key={assistant.title}>
              <div className="assistantTop"><span className="assistantIcon">{index + 1}</span><small>{assistant.label}</small></div>
              <h3>{assistant.title}</h3><p>{assistant.text}</p>
              <div className="guardrail"><span aria-hidden="true">✓</span>{assistant.guardrail}</div>
            </article>
          ))}
        </div>
      </section>

      <section className="section soldSection">
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

      <section className="section trustSection">
        <header className="sectionHeading"><p className="eyebrow"><span /> Control para el dealer</p><h2>Ayuda donde sirve. Decisión humana donde importa.</h2></header>
        <div className="trustGrid">
          <article><span>01</span><h3>Tu inventario es la referencia</h3><p>Los textos, fotos y respuestas parten de la información real de cada vehículo.</p></article>
          <article><span>02</span><h3>El equipo conserva el control</h3><p>La publicación y las respuestas automáticas se habilitan según la forma de trabajar del dealer.</p></article>
          <article><span>03</span><h3>Cada canal tiene su función</h3><p>Marketplace, mensajes y página comercial se gestionan por separado para evitar cruces.</p></article>
        </div>
      </section>

      <section className="ctaSection" id="demo">
        <div><p className="eyebrow lightEyebrow"><span /> Siguiente paso</p><h2>Veamos DealerPilot con el flujo de tu dealer.</h2><p>Una demostración corta es suficiente para ver cómo encaja con tu inventario, tus publicaciones y tu equipo de ventas.</p></div>
        <a href="mailto:?subject=Quiero%20una%20demostraci%C3%B3n%20de%20DealerPilot&body=Hola%2C%20quiero%20conocer%20DealerPilot%20para%20mi%20dealer.">Solicitar una demostración <span aria-hidden="true">→</span></a>
      </section>

      <footer><a className="brand" href="#inicio"><span className="brandMark">DP</span><span>DealerPilot</span></a><p>Más ventas. Menos trabajo manual.</p><a href="#inicio">Volver arriba ↑</a></footer>
    </main>
  );
}
