// DealerPilot — Phase 1.5 Photo Quality Review
// Runs enhancement v2, then scores every photo with the AI photography evaluator.
// Generates a DealerPilot Photo Quality Report with:
//   - 0–100 scores per dimension (Original / Enhanced / Delta)
//   - AI analysis bullets in business/photo language
//   - Quality Gate pass/fail (Marketplace Ready ≥85, Naturalness ≥85, Artifact Detection ≥85, Delta ≥+5)
//   - "Use Enhanced" / "Use Original" recommendation per photo
//
// Run: pnpm --filter @workspace/scripts run test-enhance-v2

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import {
  presetExteriorPremium,
  presetInteriorPremium,
  presetTechnicalReadability,
} from "../../artifacts/api-server/src/photo/stages/4_enhance";
import {
  evaluatePhotoQuality,
  QUALITY_DIMENSIONS,
  type PhotoQualityReport,
} from "./photo-quality-evaluator";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const WORKSPACE_ROOT = path.resolve(__dirname, "../..");
const REVIEW_DIR = path.join(
  WORKSPACE_ROOT,
  "artifacts/api-server/uploads/ai-photos/review"
);

// ── Test vehicles ─────────────────────────────────────────────────────────────
const TEST_CASES: Array<{
  vehicleId: number;
  label: string;
  photos: Array<{
    url: string;
    type: "exterior" | "interior" | "technical";
    caption: string;
  }>;
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
  const enhFiles: string[] = [];
  let idx = 0;

  for (const vehicle of TEST_CASES) {
    console.log(`\n── ${vehicle.label} ──`);

    for (const photo of vehicle.photos) {
      idx++;
      const tag = `v${vehicle.vehicleId}-${idx}`;
      const origFile = `orig-${tag}.jpg`;
      const enhFile = `enh-${tag}.jpg`;

      try {
        const origPath = path.join(REVIEW_DIR, origFile);
        const enhPath  = path.join(REVIEW_DIR, enhFile);
        const cached   = fs.existsSync(origPath) && fs.existsSync(enhPath);

        process.stdout.write(`  [${idx}] ${photo.caption} … ${cached ? "(cached) " : "downloading … "}`);

        let buf: Buffer;
        if (cached) {
          buf = fs.readFileSync(origPath);
        } else {
          buf = await fetchBuffer(photo.url);
          fs.writeFileSync(origPath, buf);
        }
        origFiles.push(origFile);

        let enhanced: Buffer;
        if (cached) {
          enhanced = fs.readFileSync(enhPath);
        } else {
          if (photo.type === "exterior") {
            enhanced = await presetExteriorPremium(buf);
          } else if (photo.type === "interior") {
            enhanced = await presetInteriorPremium(buf);
          } else {
            enhanced = await presetTechnicalReadability(buf);
          }
          fs.writeFileSync(enhPath, enhanced);
        }
        enhFiles.push(enhFile);

        process.stdout.write("evaluating … ");
        const report = await evaluatePhotoQuality(buf, enhanced, photo.type, vehicle.label, photo.caption);
        reports.push(report);

        const delta = report.overallDelta >= 0 ? `+${report.overallDelta}` : String(report.overallDelta);
        const badge = report.gate.passed ? "✓ PASS" : "✗ FAIL";
        console.log(`${badge}  ${report.overallOriginal} → ${report.overallEnhanced} (${delta})  [${report.gate.recommendation}]`);
        if (!report.gate.passed) {
          for (const r of report.gate.failReasons) console.log(`       ⚠  ${r}`);
        }
      } catch (err) {
        console.log(`✗ FAILED: ${err instanceof Error ? err.message : String(err)}`);
        origFiles.push(origFile);
        enhFiles.push(enhFile);
      }
    }
  }

  const html = buildReportHtml(reports, origFiles, enhFiles);
  fs.writeFileSync(path.join(REVIEW_DIR, "report.html"), html);

  const pass = reports.filter(r => r.gate.passed).length;
  const fail = reports.length - pass;
  const avgDelta = reports.length
    ? (reports.reduce((s, r) => s + r.overallDelta, 0) / reports.length).toFixed(1)
    : "N/A";

  console.log(`\n${"─".repeat(60)}`);
  console.log(`✅  Report ready at /api/static/ai-photos/review/report.html`);
  console.log(`    Pass: ${pass}  Fail: ${fail}  Avg delta: ${avgDelta >= "0" ? "+" : ""}${avgDelta}`);
}

// ── HTML helpers ──────────────────────────────────────────────────────────────
function scoreColor(v: number | null): string {
  if (v === null) return "#475569";
  if (v >= 85) return "#22c55e";
  if (v >= 70) return "#f59e0b";
  if (v >= 55) return "#f97316";
  return "#ef4444";
}

function deltaColor(d: number | null): string {
  if (d === null) return "#475569";
  if (d > 0)  return "#22c55e";
  if (d < 0)  return "#ef4444";
  return "#64748b";
}

function fmtDelta(d: number | null): string {
  if (d === null) return "—";
  return d > 0 ? `+${d}` : String(d);
}

function scoreBar(v: number | null, color: string): string {
  if (v === null) return `<span style="color:#475569;font-size:12px">N/A</span>`;
  const pct = Math.min(100, Math.max(0, v));
  return `
    <div style="display:flex;align-items:center;gap:8px">
      <div style="flex:1;height:6px;background:#1e293b;border-radius:3px;overflow:hidden">
        <div style="width:${pct}%;height:100%;background:${color};border-radius:3px;transition:width .3s"></div>
      </div>
      <span style="font-size:13px;font-weight:700;color:${color};min-width:28px;text-align:right">${v}</span>
    </div>`;
}

function buildDimensionRows(r: PhotoQualityReport): string {
  return QUALITY_DIMENSIONS.map(dim => {
    const d = r.dimensions[dim.key];
    const origColor = scoreColor(d.original);
    const enhColor  = scoreColor(d.enhanced);
    const dColor    = deltaColor(d.delta);
    const isGateDim = dim.key === "naturalness" || dim.key === "artifactDetection" || dim.key === "marketplaceReady";

    return `<tr style="border-bottom:1px solid #0f172a">
      <td style="padding:10px 14px;color:${isGateDim ? "#e2e8f0" : "#cbd5e1"};font-size:13px;font-weight:${isGateDim ? "600" : "400"};white-space:nowrap">
        ${dim.label}${isGateDim ? ' <span style="font-size:10px;color:#3b82f6;vertical-align:middle">●</span>' : ""}
      </td>
      <td style="padding:10px 14px;width:160px">${scoreBar(d.original, origColor)}</td>
      <td style="padding:10px 14px;width:160px">${scoreBar(d.enhanced, enhColor)}</td>
      <td style="padding:10px 14px;text-align:center;font-weight:700;font-size:15px;color:${dColor}">${fmtDelta(d.delta)}</td>
    </tr>`;
  }).join("\n");
}

function buildAnalysisBullets(items: string[], isEnhanced: boolean): string {
  const prefix = isEnhanced ? "✓" : "–";
  const itemColor = isEnhanced ? "#86efac" : "#fca5a5";
  const prefixColor = isEnhanced ? "#22c55e" : "#ef4444";
  return items
    .map(t => `<li style="padding:5px 0;color:${itemColor};font-size:13px;display:flex;gap:8px;align-items:flex-start">
      <span style="color:${prefixColor};font-weight:700;flex-shrink:0;margin-top:1px">${prefix}</span>
      <span>${t}</span>
    </li>`)
    .join("\n");
}

function buildSection(report: PhotoQualityReport, origFile: string, enhFile: string): string {
  const passed = report.gate.passed;
  const deltaStr = fmtDelta(report.overallDelta);
  const deltaSign = report.overallDelta > 0;
  const mrScore = report.marketplaceReadyScore;

  const badgeHtml = passed
    ? `<span style="display:inline-flex;align-items:center;gap:6px;background:#052e16;border:1px solid #16a34a;color:#22c55e;font-size:12px;font-weight:700;padding:5px 12px;border-radius:20px;letter-spacing:.04em">
        <span style="font-size:14px">✓</span> PASS — Use Enhanced
       </span>`
    : `<span style="display:inline-flex;align-items:center;gap:6px;background:#1c0505;border:1px solid #b91c1c;color:#f87171;font-size:12px;font-weight:700;padding:5px 12px;border-radius:20px;letter-spacing:.04em">
        <span style="font-size:14px">✗</span> NEEDS REVIEW — Use Original
       </span>`;

  const mrBadgeColor = mrScore !== null && mrScore >= 85 ? "#22c55e" : mrScore !== null && mrScore >= 70 ? "#f59e0b" : "#ef4444";
  const mrBadge = mrScore !== null
    ? `<div style="text-align:center">
        <p style="margin:0 0 4px;font-size:10px;color:#475569;text-transform:uppercase;letter-spacing:.06em">Marketplace Ready</p>
        <p style="margin:0;font-size:42px;font-weight:900;color:${mrBadgeColor};line-height:1">${mrScore}</p>
        <p style="margin:2px 0 0;font-size:11px;color:#475569">/ 100</p>
      </div>`
    : "";

  const failBlock = !passed
    ? `<div style="margin-top:12px;background:#1c0505;border:1px solid #7f1d1d;border-radius:6px;padding:12px 16px">
        <p style="margin:0 0 6px;font-size:11px;color:#ef4444;text-transform:uppercase;letter-spacing:.06em;font-weight:700">Why this photo needs review</p>
        ${report.gate.failReasons.map(r => `<p style="margin:3px 0;color:#fca5a5;font-size:13px">· ${r}</p>`).join("\n")}
      </div>`
    : "";

  const presetLabel = report.photoType === "exterior"
    ? "exterior_premium" : report.photoType === "interior"
    ? "interior_premium" : "technical_readability";

  return `
<section style="margin:64px 0;border-top:1px solid #1e293b;padding-top:56px">

  <!-- Section header -->
  <div style="display:flex;align-items:flex-start;justify-content:space-between;margin-bottom:6px;flex-wrap:wrap;gap:12px">
    <div>
      <h2 style="font-size:22px;font-weight:800;color:#f1f5f9;margin:0 0 2px">${report.vehicleLabel}</h2>
      <p style="margin:0;color:#64748b;font-size:14px">${report.caption} · <span style="font-family:monospace;color:#334155;font-size:12px">${presetLabel}</span></p>
    </div>
    <div style="margin-top:4px">${badgeHtml}</div>
  </div>

  <!-- Score strip: Overall Original / Overall Enhanced / Delta / MR badge -->
  <div style="display:grid;grid-template-columns:1fr 1fr 1fr${mrScore !== null ? " 1fr" : ""};gap:16px;margin:24px 0">
    <div style="background:#0f172a;border:1px solid #1e293b;border-radius:8px;padding:20px;text-align:center">
      <p style="margin:0 0 4px;font-size:10px;color:#475569;text-transform:uppercase;letter-spacing:.06em">Original Score</p>
      <p style="margin:0;font-size:40px;font-weight:900;color:${scoreColor(report.overallOriginal)};line-height:1">${report.overallOriginal}</p>
      <p style="margin:2px 0 0;font-size:11px;color:#475569">/ 100</p>
    </div>
    <div style="background:#0f172a;border:1px solid #1e293b;border-radius:8px;padding:20px;text-align:center">
      <p style="margin:0 0 4px;font-size:10px;color:#475569;text-transform:uppercase;letter-spacing:.06em">Enhanced Score</p>
      <p style="margin:0;font-size:40px;font-weight:900;color:${scoreColor(report.overallEnhanced)};line-height:1">${report.overallEnhanced}</p>
      <p style="margin:2px 0 0;font-size:11px;color:#475569">/ 100</p>
    </div>
    <div style="background:#0f172a;border:1px solid #1e293b;border-radius:8px;padding:20px;text-align:center">
      <p style="margin:0 0 4px;font-size:10px;color:#475569;text-transform:uppercase;letter-spacing:.06em">Improvement</p>
      <p style="margin:0;font-size:40px;font-weight:900;color:${deltaSign ? "#22c55e" : "#ef4444"};line-height:1">${deltaStr}</p>
      <p style="margin:2px 0 0;font-size:11px;color:#475569">points</p>
    </div>
    ${mrScore !== null ? `<div style="background:${passed ? "#052e16" : "#1c0505"};border:1px solid ${passed ? "#166534" : "#7f1d1d"};border-radius:8px;padding:20px">${mrBadge}</div>` : ""}
  </div>

  ${failBlock}

  <!-- Dimension scorecard + AI analysis side by side -->
  <div style="display:grid;grid-template-columns:2fr 1fr;gap:20px;margin:24px 0;align-items:start">

    <!-- Scorecard table -->
    <div style="background:#0f172a;border:1px solid #1e293b;border-radius:8px;overflow:hidden">
      <div style="padding:12px 14px;background:#0d1526;border-bottom:1px solid #1e293b;display:grid;grid-template-columns:160px 1fr 1fr 48px;gap:8px">
        <span style="font-size:10px;color:#475569;text-transform:uppercase;letter-spacing:.06em;font-weight:600">Dimension</span>
        <span style="font-size:10px;color:#475569;text-transform:uppercase;letter-spacing:.06em;font-weight:600">Original</span>
        <span style="font-size:10px;color:#475569;text-transform:uppercase;letter-spacing:.06em;font-weight:600">Enhanced</span>
        <span style="font-size:10px;color:#475569;text-transform:uppercase;letter-spacing:.06em;font-weight:600;text-align:center">Δ</span>
      </div>
      <table style="width:100%;border-collapse:collapse">
        <tbody>${buildDimensionRows(report)}</tbody>
      </table>
      <p style="margin:0;padding:8px 14px;font-size:10px;color:#1e3a5f;border-top:1px solid #0f172a">
        ● = quality gate dimension (must score ≥ 85 on enhanced)
      </p>
    </div>

    <!-- AI analysis -->
    <div style="display:flex;flex-direction:column;gap:16px">
      <div style="background:#0f172a;border:1px solid #1e293b;border-radius:8px;padding:20px">
        <p style="margin:0 0 12px;font-size:11px;color:#ef4444;text-transform:uppercase;letter-spacing:.07em;font-weight:700">Original</p>
        <ul style="margin:0;padding:0;list-style:none">
          ${buildAnalysisBullets(report.originalAnalysis, false)}
        </ul>
      </div>
      <div style="background:#0f172a;border:1px solid ${passed ? "#166534" : "#1e293b"};border-radius:8px;padding:20px">
        <p style="margin:0 0 12px;font-size:11px;color:#22c55e;text-transform:uppercase;letter-spacing:.07em;font-weight:700">Enhanced</p>
        <ul style="margin:0;padding:0;list-style:none">
          ${buildAnalysisBullets(report.enhancedAnalysis, true)}
        </ul>
      </div>
    </div>

  </div>

  <!-- Before / After photos -->
  <div style="display:grid;grid-template-columns:1fr 1fr;gap:16px">
    <div>
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:8px">
        <p style="margin:0;font-size:12px;color:#64748b;text-transform:uppercase;letter-spacing:.05em;font-weight:600">Original Photo</p>
      </div>
      <img src="${origFile}" style="width:100%;border-radius:8px;border:1px solid #1e293b;display:block" loading="lazy"/>
    </div>
    <div>
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:8px">
        <p style="margin:0;font-size:12px;color:${passed ? "#22c55e" : "#94a3b8"};text-transform:uppercase;letter-spacing:.05em;font-weight:600">Enhanced Photo — v2</p>
        <span style="font-size:11px;font-weight:700;color:${passed ? "#22c55e" : "#f87171"};background:${passed ? "#052e16" : "#1c0505"};padding:3px 8px;border-radius:4px">${report.gate.recommendation}</span>
      </div>
      <img src="${enhFile}" style="width:100%;border-radius:8px;border:1px solid ${passed ? "#166534" : "#374151"};display:block" loading="lazy"/>
    </div>
  </div>

</section>`;
}

function buildReportHtml(
  reports: PhotoQualityReport[],
  origFiles: string[],
  enhFiles: string[],
): string {
  const pass = reports.filter(r => r.gate.passed).length;
  const fail = reports.length - pass;
  const avgOrig  = reports.length ? (reports.reduce((s, r) => s + r.overallOriginal, 0) / reports.length).toFixed(1) : "—";
  const avgEnh   = reports.length ? (reports.reduce((s, r) => s + r.overallEnhanced, 0) / reports.length).toFixed(1) : "—";
  const avgDelta = reports.length ? (reports.reduce((s, r) => s + r.overallDelta, 0) / reports.length).toFixed(1) : "—";
  const avgDeltaNum = parseFloat(avgDelta);

  const sections = reports.map((r, i) => buildSection(r, origFiles[i] ?? "", enhFiles[i] ?? "")).join("\n");

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8"/>
  <meta name="viewport" content="width=device-width,initial-scale=1"/>
  <title>DealerPilot — Photo Quality Report</title>
  <style>
    *{box-sizing:border-box;margin:0;padding:0}
    body{background:#030712;color:#e2e8f0;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;padding:56px 48px;max-width:1440px;margin:0 auto}
    tr:nth-child(even){background:rgba(255,255,255,.015)}
  </style>
</head>
<body>

  <!-- Report header -->
  <div style="margin-bottom:56px;padding-bottom:40px;border-bottom:1px solid #1e293b">
    <p style="font-size:11px;color:#3b82f6;text-transform:uppercase;letter-spacing:.1em;font-weight:700;margin-bottom:10px">DealerPilot AI Photo Studio</p>
    <h1 style="font-size:36px;font-weight:900;color:#f8fafc;margin-bottom:8px;letter-spacing:-.01em">Photo Quality Report</h1>
    <p style="color:#64748b;font-size:15px;margin-bottom:32px">AI Enhancement v2 · ${reports.length} photos across 5 vehicles · ${new Date().toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" })}</p>

    <!-- Summary cards -->
    <div style="display:grid;grid-template-columns:repeat(5,1fr);gap:16px">
      <div style="background:#0f172a;border:1px solid #1e293b;border-radius:10px;padding:22px">
        <p style="font-size:10px;color:#475569;text-transform:uppercase;letter-spacing:.07em;margin-bottom:8px">Avg Original</p>
        <p style="font-size:32px;font-weight:900;color:#f1f5f9">${avgOrig}<span style="font-size:14px;color:#475569"> /100</span></p>
      </div>
      <div style="background:#0f172a;border:1px solid #1e293b;border-radius:10px;padding:22px">
        <p style="font-size:10px;color:#475569;text-transform:uppercase;letter-spacing:.07em;margin-bottom:8px">Avg Enhanced</p>
        <p style="font-size:32px;font-weight:900;color:#f1f5f9">${avgEnh}<span style="font-size:14px;color:#475569"> /100</span></p>
      </div>
      <div style="background:#0f172a;border:1px solid #1e293b;border-radius:10px;padding:22px">
        <p style="font-size:10px;color:#475569;text-transform:uppercase;letter-spacing:.07em;margin-bottom:8px">Avg Improvement</p>
        <p style="font-size:32px;font-weight:900;color:${avgDeltaNum > 0 ? "#22c55e" : "#ef4444"}">${avgDeltaNum > 0 ? "+" : ""}${avgDelta}<span style="font-size:14px;color:#475569"> pts</span></p>
      </div>
      <div style="background:#052e16;border:1px solid #166534;border-radius:10px;padding:22px">
        <p style="font-size:10px;color:#4ade80;text-transform:uppercase;letter-spacing:.07em;margin-bottom:8px">Use Enhanced</p>
        <p style="font-size:32px;font-weight:900;color:#22c55e">${pass}<span style="font-size:14px;color:#4ade80"> / ${reports.length}</span></p>
      </div>
      <div style="background:${fail > 0 ? "#1c0505" : "#0f172a"};border:1px solid ${fail > 0 ? "#7f1d1d" : "#1e293b"};border-radius:10px;padding:22px">
        <p style="font-size:10px;color:${fail > 0 ? "#f87171" : "#475569"};text-transform:uppercase;letter-spacing:.07em;margin-bottom:8px">Needs Review</p>
        <p style="font-size:32px;font-weight:900;color:${fail > 0 ? "#ef4444" : "#475569"}">${fail}<span style="font-size:14px;color:${fail > 0 ? "#f87171" : "#475569"}"> / ${reports.length}</span></p>
      </div>
    </div>

    <!-- Quality gate legend -->
    <div style="margin-top:24px;background:#0a1628;border:1px solid #1e3a5f;border-radius:8px;padding:16px 20px">
      <p style="font-size:11px;color:#3b82f6;font-weight:700;text-transform:uppercase;letter-spacing:.07em;margin-bottom:8px">Quality Gate — Enhanced passes if all three meet threshold</p>
      <div style="display:flex;gap:32px;flex-wrap:wrap">
        <span style="font-size:13px;color:#93c5fd">Marketplace Ready ≥ 85</span>
        <span style="font-size:13px;color:#93c5fd">Naturalness ≥ 85</span>
        <span style="font-size:13px;color:#93c5fd">Artifact Detection ≥ 85</span>
        <span style="font-size:13px;color:#93c5fd">Overall Improvement ≥ +5 pts</span>
      </div>
    </div>
  </div>

  ${sections}

  <footer style="margin-top:100px;padding-top:24px;border-top:1px solid #0f172a;text-align:center;color:#1e293b;font-size:12px">
    DealerPilot AI Photo Studio · Enhancement v2 · Evaluated by ${reports[0]?.evalModel ?? "gpt-5-mini"}
  </footer>

</body>
</html>`;
}

run().catch(err => { console.error("Fatal:", err); process.exit(1); });
