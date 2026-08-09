import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "DealerPilot for dealers | Less manual work, more opportunities",
  description:
    "See how DealerPilot helps a dealership organize inventory, publish vehicles, respond to buyers, and follow up from one place.",
  alternates: { canonical: "/en", languages: { "es-US": "/", "en-US": "/en" } },
};

const sections = [
  {
    number: "01",
    title: "Command center",
    promise: "Start the day knowing what needs attention.",
    items: ["Daily priorities", "Next recommended vehicle", "Alerts and recent activity"],
  },
  {
    number: "02",
    title: "Inventory",
    promise: "Keep every vehicle visible, organized, and ready to sell.",
    items: ["Complete catalog", "Details, price, mileage, and photos", "Health and status of every unit"],
  },
  {
    number: "03",
    title: "Marketplace",
    promise: "Move from a ready vehicle to a live listing in fewer steps.",
    items: ["Sales copy prepared", "Publishing queue and schedule", "Control of active listings"],
  },
  {
    number: "04",
    title: "Photo studio",
    promise: "Present inventory with a more consistent image.",
    items: ["Quality review", "Cover photo selection", "Gallery order and preparation"],
  },
  {
    number: "05",
    title: "Sales and buyers",
    promise: "Reply with context before an opportunity goes cold.",
    items: ["Conversations in one place", "Suggested replies", "Leads and next steps"],
  },
  {
    number: "06",
    title: "Dealer DNA",
    promise: "Make every reply sound like your dealership.",
    items: ["Dealership voice", "Financing programs", "Store details and rules"],
  },
  {
    number: "07",
    title: "Marketplace intelligence",
    promise: "Choose what to publish first and avoid competing with yourself.",
    items: ["Opportunity by vehicle", "Demand signals", "Duplicate listing control"],
  },
  {
    number: "08",
    title: "Connections and settings",
    promise: "Check that everything is ready before your team starts.",
    items: ["Connection status", "Dealership locations", "Operating preferences"],
  },
];

const assistants = [
  {
    label: "PUBLISHING",
    title: "Marketplace publisher",
    text: "Takes an approved vehicle, prepares its photos and details, and guides the operator until the listing is live.",
    guardrail: "Your dealership keeps the final review and control.",
  },
  {
    label: "BUYERS",
    title: "Messenger assistant",
    text: "Recognizes buyer conversations and suggests replies using real vehicle and dealership information.",
    guardrail: "It replies automatically only when your dealership enables it.",
  },
  {
    label: "BRAND",
    title: "Dealership page publisher",
    text: "Prepares posts for the dealership's business page from the same inventory, with a human review before publishing.",
    guardrail: "Your business page stays separate from Marketplace.",
  },
];

const outcomes = [
  ["Fewer screen changes", "Inventory, listings, and buyers stay in one connected flow."],
  ["More consistency", "The team works from the same information and priorities."],
  ["Better follow-up", "Pending opportunities and vehicles that need action stay visible."],
];

export default function Home() {
  return (
    <main>
      <nav className="topbar" aria-label="Main navigation">
        <a className="brand" href="#home" aria-label="DealerPilot, home">
          <span className="brandMark">DP</span>
          <span>DealerPilot</span>
        </a>
        <div className="navLinks">
          <a href="#how-it-helps">How it helps</a>
          <a href="#included">What's included</a>
          <a href="#tools">Tools</a>
        </div>
        <div className="languageSwitch" aria-label="Change language">
          <a href="/en" className="active" aria-current="page">EN</a><span>/</span><a href="/" lang="es">ES</a>
        </div>
        <a className="navCta" href="#demo">Request demo</a>
      </nav>

      <section className="hero section" id="home">
        <div className="heroCopy">
          <p className="eyebrow"><span /> Built for independent dealerships</p>
          <h1>Your sales operation, in one place.</h1>
          <p className="heroLead">
            DealerPilot helps your team organize inventory, prepare listings, respond to buyers, and follow up without scattered spreadsheets or repetitive work.
          </p>
          <div className="heroActions">
            <a className="primaryButton" href="#demo">Request a demo <span aria-hidden="true">→</span></a>
            <a className="textLink" href="#how-it-helps">See the daily flow <span aria-hidden="true">↓</span></a>
          </div>
          <p className="quietNote">Designed for the real pace of an independent dealership.</p>
        </div>

        <div className="productFrame" aria-label="Example of the DealerPilot command center">
          <div className="frameTop">
            <div className="miniBrand"><span>DP</span> Command center</div>
            <span className="status"><i /> Operation ready</span>
          </div>
          <div className="frameBody">
            <p className="frameLabel">TODAY AT YOUR DEALERSHIP</p>
            <h2>3 opportunities need attention</h2>
            <p>DealerPilot organizes the work and shows your next step.</p>
            <div className="metrics">
              <div className="metric primaryMetric"><strong>5</strong><span>Ready</span></div>
              <div className="metric"><strong>18</strong><span>Live</span></div>
              <div className="metric"><strong>7</strong><span>Buyers</span></div>
              <div className="metric"><strong>2</strong><span>Alerts</span></div>
            </div>
            <div className="nextAction">
              <span className="vehicleDot">1</span>
              <div><strong>Publish the next vehicle</strong><small>Photos, price, and description are ready</small></div>
              <span className="actionPill">Next</span>
            </div>
            <div className="soldAlert">
              <span aria-hidden="true">✓</span>
              <div><strong>Sold vehicle detected</strong><small>DealerPilot reminds you to remove its Marketplace listing.</small></div>
            </div>
          </div>
        </div>
      </section>

      <section className="outcomeStrip" aria-label="Main benefits">
        {outcomes.map(([title, text]) => (
          <article key={title}><strong>{title}</strong><p>{text}</p></article>
        ))}
      </section>

      <section className="section flowSection" id="how-it-helps">
        <header className="sectionHeading">
          <p className="eyebrow"><span /> A day with DealerPilot</p>
          <h2>From inventory to buyer conversations, without losing the thread.</h2>
          <p>Each part of the work connects to the next, so your team knows what to do and why.</p>
        </header>
        <div className="flowGrid">
          {[
            ["1", "Inventory arrives", "DealerPilot gathers the details and shows what is missing."],
            ["2", "The vehicle gets ready", "It organizes photos and helps create a clear, complete listing."],
            ["3", "The buyer gets a reply", "Every conversation starts with real vehicle information."],
            ["4", "The loop gets closed", "After a sale, it warns you if the listing is still live."],
          ].map(([number, title, text]) => (
            <article className="flowStep" key={number}>
              <span>{number}</span><h3>{title}</h3><p>{text}</p>
            </article>
          ))}
        </div>
      </section>

      <section className="section featureSection" id="included">
        <header className="sectionHeading splitHeading">
          <div><p className="eyebrow"><span /> Everything included</p><h2>A clear view for every part of the business.</h2></div>
          <p>No technical language to learn. Each section answers a practical question from your daily operation.</p>
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

      <section className="section assistantsSection" id="tools">
        <header className="sectionHeading splitHeading">
          <div><p className="eyebrow"><span /> Tools that work with your team</p><h2>3 assistants, each with one clear responsibility.</h2></div>
          <p>They work in your team's browser and help on the pages you already use. The operator stays in control.</p>
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
          <p className="eyebrow"><span /> One detail that prevents confusion</p>
          <h2>When a car sells, the work does not end on the lot.</h2>
          <p>DealerPilot detects the status change in inventory. If the vehicle is still live on Marketplace, your team sees a clear reminder to remove the listing and stop messages about a sold unit.</p>
        </div>
        <div className="soldExample">
          <div className="soldVehicle"><span>SOLD</span><strong>2021 Toyota Camry SE</strong><small>VIN ending in 4821</small></div>
          <div className="reminder"><span aria-hidden="true">!</span><div><strong>Remove from Marketplace</strong><p>This vehicle is sold, but its listing is still active.</p></div></div>
          <button type="button">View pending listing <span aria-hidden="true">→</span></button>
        </div>
      </section>

      <section className="section trustSection">
        <header className="sectionHeading"><p className="eyebrow"><span /> Control for your dealership</p><h2>Help where it saves time. Human decisions where they matter.</h2></header>
        <div className="trustGrid">
          <article><span>01</span><h3>Your inventory is the source</h3><p>Listings, photos, and replies start with the real information for each vehicle.</p></article>
          <article><span>02</span><h3>Your team stays in control</h3><p>Publishing and automatic replies are enabled based on how your dealership works.</p></article>
          <article><span>03</span><h3>Each channel has one job</h3><p>Marketplace, buyer messages, and the business page stay separate to prevent mix-ups.</p></article>
        </div>
      </section>

      <section className="ctaSection" id="demo">
        <div><p className="eyebrow lightEyebrow"><span /> Next step</p><h2>See DealerPilot with your dealership's workflow.</h2><p>A short demo is enough to see how DealerPilot fits your inventory, listings, and sales team.</p></div>
        <a href="mailto:?subject=I%20want%20a%20DealerPilot%20demo&body=Hello%2C%20I%20want%20to%20learn%20about%20DealerPilot%20for%20my%20dealership.">Request a demo <span aria-hidden="true">→</span></a>
      </section>

      <footer><a className="brand" href="#home"><span className="brandMark">DP</span><span>DealerPilot</span></a><p>More sales. Less manual work.</p><a href="#home">Back to top ↑</a></footer>
    </main>
  );
}
