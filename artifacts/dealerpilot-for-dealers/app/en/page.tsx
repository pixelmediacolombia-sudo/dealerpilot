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
    title: "DealerPilot AI Publisher",
    plainName: "Marketplace publisher",
    where: "The seller's Facebook Marketplace",
    text: "Takes an approved vehicle from the queue, opens the Marketplace form, uploads the photos, and fills in the listing details.",
    steps: ["Receives the ready vehicle", "Fills photos and details", "Continues in the selected mode"],
    guardrail: "It stops for sign-ins, verification prompts, or Facebook blocks. Your dealership chooses the automation level.",
  },
  {
    label: "BUYERS",
    title: "DealerPilot Messenger AI",
    plainName: "Buyer message assistant",
    where: "Facebook Marketplace conversations",
    text: "Identifies the buyer, vehicle, and message intent, then prepares a reply using real inventory and dealership information.",
    steps: ["Detects the conversation", "Suggests a reply", "Records the follow-up"],
    guardrail: "It can leave the reply for review or send it when automatic replies are enabled.",
  },
  {
    label: "BRAND",
    title: "DealerPilot Page Publisher",
    plainName: "Business page publisher",
    where: "Meta Business Suite",
    text: "Turns an inventory vehicle into a business-page draft with the caption and up to ten photos prepared.",
    steps: ["Selects the vehicle", "Prepares copy and photos", "Your team reviews and publishes"],
    guardrail: "Final publishing stays human, and the business page remains separate from the seller's personal Marketplace.",
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
          <a href="#how-it-helps">How it works</a>
          <a href="#included">Sections</a>
          <a href="#tools">Extensions</a>
        </div>
        <div className="languageSwitch" aria-label="Change language">
          <a href="/en" className="active" aria-current="page">EN</a><span>/</span><a href="/" lang="es">ES</a>
        </div>
      </nav>

      <section className="hero section" id="home">
        <div className="heroCopy">
          <p className="eyebrow"><span /> Built for independent dealerships</p>
          <h1>Your sales operation, in one place.</h1>
          <p className="heroLead">
            DealerPilot connects inventory, listings, and buyer conversations. Your team can see which vehicle needs attention, what is ready to publish, and the next step that moves a sale forward.
          </p>
          <div className="heroActions">
            <a className="primaryButton" href="#how-it-helps">See how it works <span aria-hidden="true">→</span></a>
            <a className="textLink" href="#tools">Meet the 3 extensions <span aria-hidden="true">→</span></a>
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
          <h2>How DealerPilot supports a sale from beginning to end.</h2>
          <p>The system turns inventory into clear tasks and keeps the vehicle, listing, and buyer connected.</p>
        </header>
        <div className="flowGrid">
          {[
            ["1", "Receive inventory", "Organizes the price, mileage, photos, location, and status of every vehicle."],
            ["2", "Find what is missing", "Flags missing details or photos and shows which unit is ready to move forward."],
            ["3", "Prepare the listing", "Orders the gallery and gathers the information needed to present the vehicle well."],
            ["4", "Publish by channel", "Marketplace and the business page use separate paths to prevent mix-ups."],
            ["5", "Respond to the buyer", "Connects the conversation to the vehicle and helps your team reply with real context."],
            ["6", "Close the loop", "When the car sells, it cancels pending work and reminds the team to remove any live listing."],
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
          <div><p className="eyebrow"><span /> DealerPilot browser extensions</p><h2>3 extensions, 3 different jobs.</h2></div>
          <p>They work in the browser alongside the Facebook pages your team already uses. They share DealerPilot inventory, but each one keeps its own channel and controls.</p>
        </header>
        <div className="assistantGrid">
          {assistants.map((assistant, index) => (
            <article className="assistantCard" key={assistant.title}>
              <div className="assistantTop"><span className="assistantIcon">{index + 1}</span><small>{assistant.label}</small></div>
              <h3>{assistant.title}</h3>
              <p className="assistantPlainName">{assistant.plainName}</p>
              <div className="assistantWhere"><small>WHERE IT WORKS</small><strong>{assistant.where}</strong></div>
              <p>{assistant.text}</p>
              <ol>{assistant.steps.map((step) => <li key={step}>{step}</li>)}</ol>
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

      <section className="ctaSection" aria-label="DealerPilot summary">
        <div><p className="eyebrow lightEyebrow"><span /> The complete loop</p><h2>A vehicle enters once. DealerPilot keeps everything that happens next connected.</h2><p>Inventory feeds the listings; listings create conversations; conversations become follow-up; and the sold status closes the loop so your team does not work from outdated information.</p></div>
        <div className="cycleSummary" aria-label="Work cycle"><span>Inventory</span><i>→</i><span>Listing</span><i>→</i><span>Buyer</span><i>→</i><span>Sale</span></div>
      </section>

      <footer><a className="brand" href="#home"><span className="brandMark">DP</span><span>DealerPilot</span></a><p>More sales. Less manual work.</p><a href="#home">Back to top ↑</a></footer>
    </main>
  );
}
