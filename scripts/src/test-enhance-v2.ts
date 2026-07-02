// DealerPilot — AI Photo Enhancement v2 Visual Review
// Processes real vehicle photos through the v2 presets, then runs an AI
// photography quality evaluation (10 professional dimensions) on each pair.
// Generates a DealerPilot Photo Quality Report — not an engineering metric sheet.
//
// Run: pnpm --filter @workspace/scripts run test-enhance-v2
//
// Outputs:
//   uploads/ai-photos/review/report.html   — DealerPilot Photo Quality Report
//   uploads/ai-photos/review/orig-*.jpg    — original images
//   uploads/ai-photos/review/enh-*.jpg     — enhanced images
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { presetExteriorPremium, presetInteriorPremium, presetTechnicalReadability } from "../../artifacts/api-server/src/photo/stages/4_enhance";
import { evaluatePhotoQuality, QUALITY_DIMENSIONS, type PhotoQualityReport } from "./photo-quality-evaluator";

// Resolve paths relative to this file so the script runs correctly from any CWD.
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const WORKSPACE_ROOT = path.resolve(__dirname, "../..");
const REVIEW_DIR = path.join(WORKSPACE_ROOT, "artifacts/api-server/uploads/ai-photos/review");

// ── Test vehicles ─────────────────────────────────────────────────────────────
// Five vehicles · three photos each (exterior, exterior angle, interior)
const TEST_CASES: Array<{
  vehicleId: number;
  label: string;
  photos: Array<{ url: string; type: "exterior" | "interior" | "technical"; caption: string }>;
}> = [
  {
    vehicleId: 184,
    label: "2024 Mercedes-Benz EQE",
    photos: [
      { url: "https://cdnimages.dealersgpt.com/alpha/4JGGM5DB6RA034989/800/4.jpg?v=020260205110821", type: "exterior", caption: "Exterior Front" },
      { url: "https://cdnimages.dealersgpt.com/alpha/4JGGM5DB6RA034989/800/5.jpg?v=120260205110821", type: "exterior", caption: "Exterior Angle" },
      { url: "https://cdnimages.dealersgpt.com/alpha/4JGGM5DB6RA034989/800/6.jpg?v=320260205110822", type: "interior", caption: "Interior" },
    ],
  },
  {
    vehicleId: 294,
    label: "2023 Tesla Model Y",
    photos: [
      { url: "https://cdnimages.dealersgpt.com/alpha/7SAYGDEE1PA119584/800/2.jpg?v=020260626112759", type: "exterior", caption: "Exterior Front" },
      { url: "https://cdnimages.dealersgpt.com/alpha/7SAYGDEE1PA119584/800/3.jpg?v=120260626112800", type: "exterior", caption: "Exterior Side" },
      { url: "https://cdnimages.dealersgpt.com/alpha/7SAYGDEE1PA119584/800/5.jpg?v=320260626112801", type: "interior", caption: "Interior" },
    ],
  },
  {
    vehicleId: 52,
    label: "2012 Chevrolet Corvette",
    photos: [
      { url: "https://cdnimages.dealersgpt.com/alpha/1G1YV2DW8C5106243/800/4.jpg?v=020250923183009", type: "exterior", caption: "Exterior Front" },
      { url: "https://cdnimages.dealersgpt.com/alpha/1G1YV2DW8C5106243/800/5.jpg?v=120250923183010", type: "exterior", caption: "Exterior Angle" },
      { url: "https://cdnimages.dealersgpt.com/alpha/1G1YV2DW8C5106243/800/6.jpg?v=320250923183011", type: "interior", caption: "Interior" },
    ],
  },
  {
    vehicleId: 68,
    label: "2012 Dodge Challenger",
    photos: [
      { url: "https://cdnimages.dealersgpt.com/alpha/2C3CDYBT7CH316006/800/4.jpg?v=020260508175115", type: "exterior", caption: "Exterior Front" },
      { url: "https://cdnimages.dealersgpt.com/alpha/2C3CDYBT7CH316006/800/5.jpg?v=120260508175116", type: "exterior", caption: "Exterior Angle" },
      { url: "https://cdnimages.dealersgpt.com/alpha/2C3CDYBT7CH316006/800/6.jpg?v=320260508175117", type: "interior", caption: "Interior" },
    ],
  },
  {
    vehicleId: 267,
    label: "2022 Tesla Model S",
    photos: [
      { url: "https://cdnimages.dealersgpt.com/alpha/5YJSA1E52NF477991/800/2.jpg?v=020260609153739", type: "exterior", caption: "Exterior Front" },
      { url: "https://cdnimages.dealersgpt.com/alpha/5YJSA1E52NF477991/800/3.jpg?v=120260609153741", type: "exterior", caption: "Exterior Side" },
      { url: "https://cdnimages.dealersgpt.com/alpha/5YJSA1E52NF477991/800/5.jpg?v=320260609153742", type: "interior", caption: "Interior" },
    ],
  },
];

// ── Helpers ───────────────────────────────────────────────────────────────────

async function fetchBuffer(url: string): Promise<Buffer> {
  const res = await fetch(url, { signal: AbortSignal.timeout(20_000) });
  if (!res.ok) throw new Error(`HTTP ${res.status} ${url}`);
  return Buffer.from(await res.arrayBuffer());
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function run() {
  fs.mkdirSync(REVIEW_DIR, { recursive: true });

  const reports: PhotoQualityReport[] = [];
  const origFiles: string[] = [];
  const enhFiles: string[]  = [];
  let idx = 0;

  for (const vehicle of TEST_CASES) {
    console.log(`\n── ${vehicle.label} ──`);

    for (const photo of vehicle.photos) {
      idx++;
      const tag      = `v${vehicle.vehicleId}-${idx}`;
      const origFile = `orig-${tag}.jpg`;
      const enhFile  = `enh-${tag}.jpg`;

      try {
        process.stdout.write(`  [${idx}] ${photo.caption} … downloading … `);
        const buf = await fetchBuffer(photo.url);

        // Save original
        fs.writeFileSync(path.join(REVIEW_DIR, origFile), buf);
        origFiles.push(origFile);

        // Apply preset
        let enhanced: Buffer;
        if (photo.type === "exterior") {
          enhanced = await presetExteriorPremium(buf);
        } else if (photo.type === "interior") {
          enhanced = await presetInteriorPremium(buf);
        } else {
          enhanced = await presetTechnicalReadability(buf);
        }

        fs.writeFileSync(path.join(REVIEW_DIR, enhFile), enhanced);
        enhFiles.push(enhFile);

        process.stdout.write("evaluating … ");

        const report = await evaluatePhotoQuality(
          buf,
          enhanced,
          photo.type,
          vehicle.label,
          photo.caption,
        );
        reports.push(report);

        const delta = report.overallDelta > 0 ? `+${report.overallDelta}` : String(report.overallDelta);
        console.log(`✓  overall ${report.overallOriginal} → ${report.overallEnhanced} (${delta})`);
        console.log(`       "${report.verdict}"`);
      } catch (err) {
        console.log(`✗  FAILED: ${err instanceof Error ? err.message : String(err)}`);
        origFiles.push(origFile);
        enhFiles.push(enhFile);
      }
    }
  }

  // Generate report HTML
  const html = buildReportHtml(reports, origFiles, enhFiles);
  fs.writeFileSync(path.join(REVIEW_DIR, "report.html"), html);

  // Summary stats
  const allDeltas = reports.map(r => r.overallDelta).filter(d => d !== null);
  const avgDelta  = allDeltas.length ? (allDeltas.reduce((a, b) => a + b, 0) / allDeltas.length).toFixed(2) : "N/A";
  const improved  = allDeltas.filter(d => d > 0).length;

  console.log(`\n${"─".repeat(60)}`);
  console.log(`✅  Report complete`);
  console.log(`    Photos evaluated: ${reports.length}`);
  console.log(`    Improved:         ${improved} / ${allDeltas.length}`);
  console.log(`    Avg overall delta: ${avgDelta}`);
  console.log(`    Report: /api/static/ai-photos/review/report.html`);
}

// ── HTML report builder ───────────────────────────────────────────────────────

function scoreColor(score: number | null): string {
  if (score === null) return "#475569";
  if (score >= 8)  return "#22c55e";
  if (score >= 6)  return "#eab308";
  return "#ef4444";
}

function deltaColor(delta: number | null): string {
  if (delta === null) return "#475569";
  if (delta > 0)  return "#22c55e";
  if (delta < 0)  return "#ef4444";
  return "#94a3b8";
}

function buildDimensionRows(report: PhotoQualityReport): string {
  return QUALITY_DIMENSIONS.map(dim => {
    const d = report.dimensions[dim.key];
    const origStr = d.original !== null ? String(d.original) : "—";
    const enhStr  = d.enhanced  !== null ? String(d.enhanced)  : "—";
    const deltaStr = d.delta !== null
      ? (d.delta > 0 ? `+${d.delta}` : String(d.delta))
      : "—";

    return `<tr>
      <td style="padding:8px 12px;color:#cbd5e1;font-size:13px">${dim.label}</td>
      <td style="padding:8px 12px;text-align:center;font-weight:600;color:${scoreColor(d.original)}">${origStr}</td>
      <td style="padding:8px 12px;text-align:center;font-weight:600;color:${scoreColor(d.enhanced)}">${enhStr}</td>
      <td style="padding:8px 12px;text-align:center;font-weight:700;color:${deltaColor(d.delta)}">${deltaStr}</td>
      <td style="padding:8px 16px;color:#94a3b8;font-size:12px;font-style:italic">${d.note}</td>
    </tr>`;
  }).join("\n");
}

function buildReportHtml(reports: PhotoQualityReport[], origFiles: string[], enhFiles: string[]): string {
  const sections = reports.map((report, i) => {
    const origFile = origFiles[i] ?? "";
    const enhFile  = enhFiles[i]  ?? "";
    const delta    = report.overallDelta > 0 ? `+${report.overallDelta}` : String(report.overallDelta);
    const verdictColor = report.overallDelta > 0 ? "#22c55e" : report.overallDelta < 0 ? "#ef4444" : "#94a3b8";
    const presetLabel = report.photoType === "exterior"
      ? "exterior_premium"
      : report.photoType === "interior"
      ? "interior_premium"
      : "technical_readability";

    return `
<section style="margin:56px 0;border-top:1px solid #1e293b;padding-top:48px">

  <!-- Header -->
  <div style="display:flex;align-items:baseline;justify-content:space-between;margin-bottom:4px">
    <h2 style="font-size:20px;font-weight:700;color:#f1f5f9;margin:0">${report.vehicleLabel}</h2>
    <span style="font-size:12px;color:#475569;font-family:monospace">${presetLabel}</span>
  </div>
  <p style="margin:0 0 24px;color:#64748b;font-size:14px">${report.caption}</p>

  <!-- Verdict -->
  <div style="background:#0f172a;border:1px solid #1e293b;border-left:3px solid ${verdictColor};border-radius:6px;padding:14px 20px;margin-bottom:24px">
    <span style="font-size:13px;color:#94a3b8;text-transform:uppercase;letter-spacing:.06em;font-weight:600">AI Photographer Assessment</span>
    <p style="margin:6px 0 0;color:#e2e8f0;font-size:15px">${report.verdict}</p>
  </div>

  <!-- Overall score bar -->
  <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:16px;margin-bottom:24px">
    <div style="background:#0f172a;border:1px solid #1e293b;border-radius:8px;padding:16px;text-align:center">
      <p style="margin:0 0 4px;font-size:11px;color:#475569;text-transform:uppercase;letter-spacing:.06em">Original Overall</p>
      <p style="margin:0;font-size:36px;font-weight:800;color:${scoreColor(report.overallOriginal)}">${report.overallOriginal}</p>
      <p style="margin:0;font-size:11px;color:#475569">/ 10</p>
    </div>
    <div style="background:#0f172a;border:1px solid #1e293b;border-radius:8px;padding:16px;text-align:center">
      <p style="margin:0 0 4px;font-size:11px;color:#475569;text-transform:uppercase;letter-spacing:.06em">Enhanced Overall</p>
      <p style="margin:0;font-size:36px;font-weight:800;color:${scoreColor(report.overallEnhanced)}">${report.overallEnhanced}</p>
      <p style="margin:0;font-size:11px;color:#475569">/ 10</p>
    </div>
    <div style="background:#0f172a;border:1px solid #1e293b;border-radius:8px;padding:16px;text-align:center">
      <p style="margin:0 0 4px;font-size:11px;color:#475569;text-transform:uppercase;letter-spacing:.06em">Overall Improvement</p>
      <p style="margin:0;font-size:36px;font-weight:800;color:${deltaColor(report.overallDelta)}">${delta}</p>
      <p style="margin:0;font-size:11px;color:#475569">points</p>
    </div>
  </div>

  <!-- Dimension scorecard table -->
  <div style="background:#0f172a;border:1px solid #1e293b;border-radius:8px;overflow:hidden;margin-bottom:24px">
    <table style="width:100%;border-collapse:collapse">
      <thead>
        <tr style="background:#0d1526;border-bottom:1px solid #1e293b">
          <th style="padding:10px 12px;text-align:left;font-size:11px;color:#475569;text-transform:uppercase;letter-spacing:.06em;font-weight:600">Dimension</th>
          <th style="padding:10px 12px;text-align:center;font-size:11px;color:#475569;text-transform:uppercase;letter-spacing:.06em;font-weight:600">Original</th>
          <th style="padding:10px 12px;text-align:center;font-size:11px;color:#475569;text-transform:uppercase;letter-spacing:.06em;font-weight:600">Enhanced</th>
          <th style="padding:10px 12px;text-align:center;font-size:11px;color:#475569;text-transform:uppercase;letter-spacing:.06em;font-weight:600">Δ</th>
          <th style="padding:10px 16px;text-align:left;font-size:11px;color:#475569;text-transform:uppercase;letter-spacing:.06em;font-weight:600">Photographer's Note</th>
        </tr>
      </thead>
      <tbody>
        ${buildDimensionRows(report)}
      </tbody>
    </table>
  </div>

  <!-- Side-by-side photos -->
  <div style="display:grid;grid-template-columns:1fr 1fr;gap:16px">
    <div>
      <p style="margin:0 0 8px;font-size:12px;color:#475569;text-transform:uppercase;letter-spacing:.05em;font-weight:600">Original Photo</p>
      <img src="${origFile}" style="width:100%;border-radius:8px;border:1px solid #1e293b;display:block" loading="lazy"/>
    </div>
    <div>
      <p style="margin:0 0 8px;font-size:12px;color:#475569;text-transform:uppercase;letter-spacing:.05em;font-weight:600">Enhanced Photo — v2</p>
      <img src="${enhFile}" style="width:100%;border-radius:8px;border:1px solid #334155;display:block" loading="lazy"/>
    </div>
  </div>

</section>`;
  }).join("");

  // Summary stats across all reports
  const allDeltas = reports.map(r => r.overallDelta);
  const avgOrig = reports.length ? (reports.reduce((s, r) => s + r.overallOriginal, 0) / reports.length).toFixed(1) : "—";
  const avgEnh  = reports.length ? (reports.reduce((s, r) => s + r.overallEnhanced, 0) / reports.length).toFixed(1) : "—";
  const avgDelta = allDeltas.length ? (allDeltas.reduce((a, b) => a + b, 0) / allDeltas.length).toFixed(2) : "—";
  const improved = allDeltas.filter(d => d > 0).length;

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8"/>
  <meta name="viewport" content="width=device-width,initial-scale=1"/>
  <title>DealerPilot — AI Photo Quality Report</title>
  <style>
    *{box-sizing:border-box;margin:0;padding:0}
    body{background:#030712;color:#e2e8f0;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;padding:56px 48px;max-width:1400px;margin:0 auto}
    tr:nth-child(even){background:#0a1220}
    tr:hover{background:#111827}
  </style>
</head>
<body>

  <!-- Report header -->
  <div style="margin-bottom:48px;padding-bottom:32px;border-bottom:1px solid #1e293b">
    <p style="font-size:11px;color:#3b82f6;text-transform:uppercase;letter-spacing:.1em;font-weight:700;margin-bottom:8px">DealerPilot AI Photo Studio</p>
    <h1 style="font-size:32px;font-weight:800;color:#f8fafc;margin-bottom:8px">Photo Quality Report</h1>
    <p style="color:#64748b;font-size:15px">AI Enhancement v2 · ${reports.length} photos across 5 vehicles · ${new Date().toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" })}</p>

    <!-- Summary strip -->
    <div style="display:grid;grid-template-columns:repeat(4,1fr);gap:16px;margin-top:32px">
      <div style="background:#0f172a;border:1px solid #1e293b;border-radius:8px;padding:20px">
        <p style="font-size:11px;color:#475569;text-transform:uppercase;letter-spacing:.06em;margin-bottom:6px">Avg Original Score</p>
        <p style="font-size:28px;font-weight:800;color:#f1f5f9">${avgOrig}<span style="font-size:14px;color:#475569"> / 10</span></p>
      </div>
      <div style="background:#0f172a;border:1px solid #1e293b;border-radius:8px;padding:20px">
        <p style="font-size:11px;color:#475569;text-transform:uppercase;letter-spacing:.06em;margin-bottom:6px">Avg Enhanced Score</p>
        <p style="font-size:28px;font-weight:800;color:#f1f5f9">${avgEnh}<span style="font-size:14px;color:#475569"> / 10</span></p>
      </div>
      <div style="background:#0f172a;border:1px solid #1e293b;border-radius:8px;padding:20px">
        <p style="font-size:11px;color:#475569;text-transform:uppercase;letter-spacing:.06em;margin-bottom:6px">Avg Improvement</p>
        <p style="font-size:28px;font-weight:800;color:#22c55e">+${avgDelta}<span style="font-size:14px;color:#475569"> pts</span></p>
      </div>
      <div style="background:#0f172a;border:1px solid #1e293b;border-radius:8px;padding:20px">
        <p style="font-size:11px;color:#475569;text-transform:uppercase;letter-spacing:.06em;margin-bottom:6px">Photos Improved</p>
        <p style="font-size:28px;font-weight:800;color:#f1f5f9">${improved}<span style="font-size:14px;color:#475569"> / ${reports.length}</span></p>
      </div>
    </div>
  </div>

  ${sections}

  <footer style="margin-top:80px;padding-top:24px;border-top:1px solid #0f172a;text-align:center;color:#1e293b;font-size:12px">
    DealerPilot AI Photo Studio · Enhancement v2 · Evaluated by ${reports[0]?.evalModel ?? "gpt-5-mini"}
  </footer>

</body>
</html>`;
}

run().catch(err => { console.error("Fatal:", err); process.exit(1); });
