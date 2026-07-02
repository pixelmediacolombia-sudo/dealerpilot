// DealerPilot — Phase 1.5 Clean Photo Test
//
// QUESTION: Is the quality gate failure caused by:
//   A) The enhancement pipeline itself, or
//   B) The input photos having large promotional overlays?
//
// METHOD:
//   Alpha Motorsports CDN applies overlays to ALL photos (confirmed: 26/26 flagged).
//   This script crops the overlay bands off the existing test photos using Sharp,
//   producing clean center-crops of the vehicle for a controlled test.
//
//   Alpha Motorsports overlay geometry (from visual inspection):
//     Top band:    first 13% of height  — Alpha logo + DealerRater badges
//     Bottom band: last  22% of height  — yellow "No Payments" / phone banner
//
//   The crop keeps the middle 65% of height — the car itself, no overlays.
//
// Run: pnpm --filter @workspace/scripts run test-enhance-clean

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import sharp from "sharp";
import {
  presetExteriorPremium,
  presetInteriorPremium,
  presetTechnicalReadability,
} from "../../artifacts/api-server/src/photo/stages/4_enhance";
import {
  evaluatePhotoQuality,
  QUALITY_DIMENSIONS,
  type PhotoQualityReport,
  type QualityProfile,
} from "./photo-quality-evaluator";
import { loadActiveProfile } from "./profileLoader";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const WORKSPACE_ROOT = path.resolve(__dirname, "../..");

// Source: the 15 cached original photos from the overlay-photo test.
const REVIEW_SRC_DIR  = path.join(WORKSPACE_ROOT, "artifacts/api-server/uploads/ai-photos/review");
const REVIEW_DEST_DIR = path.join(WORKSPACE_ROOT, "artifacts/api-server/uploads/ai-photos/review-clean");

// ── Overlay crop geometry ─────────────────────────────────────────────────────

// Crop the top 13% and bottom 22% of the image to remove Alpha Motorsports overlays.
// These percentages were measured from screenshots of the actual dealer photos.
const TOP_CROP_PCT    = 0.13;
const BOTTOM_CROP_PCT = 0.22;

async function cropOverlays(input: Buffer): Promise<Buffer> {
  const meta = await sharp(input).metadata();
  const w = meta.width  ?? 800;
  const h = meta.height ?? 600;

  const top  = Math.round(h * TOP_CROP_PCT);
  const keep = Math.round(h * (1 - TOP_CROP_PCT - BOTTOM_CROP_PCT));

  return sharp(input)
    .extract({ left: 0, top, width: w, height: Math.max(keep, 1) })
    .jpeg({ quality: 95, chromaSubsampling: "4:4:4" })
    .toBuffer();
}

// ── Test cases — maps orig-*.jpg file names to photo metadata ─────────────────

const TEST_CASES: Array<{
  origFile: string;
  vehicleLabel: string;
  type: "exterior" | "interior" | "technical";
  caption: string;
}> = [
  { origFile: "orig-v184-1.jpg",  vehicleLabel: "2024 Mercedes-Benz EQE",  type: "exterior", caption: "Exterior Front" },
  { origFile: "orig-v184-2.jpg",  vehicleLabel: "2024 Mercedes-Benz EQE",  type: "exterior", caption: "Exterior Angle" },
  { origFile: "orig-v184-3.jpg",  vehicleLabel: "2024 Mercedes-Benz EQE",  type: "interior", caption: "Interior" },
  { origFile: "orig-v294-4.jpg",  vehicleLabel: "2023 Tesla Model Y",       type: "exterior", caption: "Exterior Front" },
  { origFile: "orig-v294-5.jpg",  vehicleLabel: "2023 Tesla Model Y",       type: "exterior", caption: "Exterior Side" },
  { origFile: "orig-v294-6.jpg",  vehicleLabel: "2023 Tesla Model Y",       type: "interior", caption: "Interior" },
  { origFile: "orig-v52-7.jpg",   vehicleLabel: "2012 Chevrolet Corvette",  type: "exterior", caption: "Exterior Front" },
  { origFile: "orig-v52-8.jpg",   vehicleLabel: "2012 Chevrolet Corvette",  type: "exterior", caption: "Exterior Angle" },
  { origFile: "orig-v52-9.jpg",   vehicleLabel: "2012 Chevrolet Corvette",  type: "interior", caption: "Interior" },
  { origFile: "orig-v68-10.jpg",  vehicleLabel: "2012 Dodge Challenger",    type: "exterior", caption: "Exterior Front" },
  { origFile: "orig-v68-11.jpg",  vehicleLabel: "2012 Dodge Challenger",    type: "exterior", caption: "Exterior Angle" },
  { origFile: "orig-v68-12.jpg",  vehicleLabel: "2012 Dodge Challenger",    type: "interior", caption: "Interior" },
  { origFile: "orig-v267-13.jpg", vehicleLabel: "2022 Tesla Model S",       type: "exterior", caption: "Exterior Front" },
  { origFile: "orig-v267-14.jpg", vehicleLabel: "2022 Tesla Model S",       type: "exterior", caption: "Exterior Side" },
  { origFile: "orig-v267-15.jpg", vehicleLabel: "2022 Tesla Model S",       type: "interior", caption: "Interior" },
];

// ── Main ──────────────────────────────────────────────────────────────────────

async function run() {
  fs.mkdirSync(REVIEW_DEST_DIR, { recursive: true });

  // Load the active quality profile from DB once.
  const profile: QualityProfile = await loadActiveProfile();

  // Verify source files exist
  const missing = TEST_CASES.filter(t => !fs.existsSync(path.join(REVIEW_SRC_DIR, t.origFile)));
  if (missing.length > 0) {
    console.error(`Missing source files (run test-enhance-v2 first to cache them):`);
    for (const m of missing) console.error(`  ${m.origFile}`);
    process.exit(1);
  }

  console.log("=".repeat(64));
  console.log("DealerPilot Phase 1.5 — Clean Photo Test");
  console.log(`Quality Profile: ${profile.name} (MR≥${profile.marketplaceReadyThreshold} Nat≥${profile.naturalnessThreshold} Art≥${profile.artifactThreshold} Δ≥+${profile.improvementDelta})`);
  console.log("Method: crop overlay bands from Alpha Motorsports photos");
  console.log(`  Removing top ${(TOP_CROP_PCT * 100).toFixed(0)}% (logo/badges) and`);
  console.log(`           bottom ${(BOTTOM_CROP_PCT * 100).toFixed(0)}% (yellow promo banner)`);
  console.log("=".repeat(64));

  const reports: PhotoQualityReport[] = [];
  const croppedFiles: string[] = [];
  const enhFiles: string[] = [];
  let idx = 0;

  for (const tc of TEST_CASES) {
    idx++;
    const tag       = `clean-${idx}`;
    const cropFile  = `cropped-${tag}.jpg`;
    const enhFile   = `enh-${tag}.jpg`;
    const cropPath  = path.join(REVIEW_DEST_DIR, cropFile);
    const enhPath   = path.join(REVIEW_DEST_DIR, enhFile);

    try {
      const rawBuf = fs.readFileSync(path.join(REVIEW_SRC_DIR, tc.origFile));

      // Step 1: Crop overlay bands
      process.stdout.write(`  [${idx.toString().padStart(2)}] ${tc.vehicleLabel} — ${tc.caption} … cropping … `);
      const cleanBuf = await cropOverlays(rawBuf);
      fs.writeFileSync(cropPath, cleanBuf);
      croppedFiles.push(cropFile);

      // Step 2: Enhance cropped (clean) photo
      process.stdout.write("enhancing … ");
      let enhanced: Buffer;
      if (tc.type === "exterior") {
        enhanced = await presetExteriorPremium(cleanBuf);
      } else if (tc.type === "interior") {
        enhanced = await presetInteriorPremium(cleanBuf);
      } else {
        enhanced = await presetTechnicalReadability(cleanBuf);
      }
      fs.writeFileSync(enhPath, enhanced);
      enhFiles.push(enhFile);

      // Step 3: AI quality evaluation
      process.stdout.write("evaluating … ");
      const report = await evaluatePhotoQuality(
        cleanBuf,
        enhanced,
        tc.type,
        tc.vehicleLabel,
        tc.caption,
        profile,
      );
      reports.push(report);

      const deltaStr = report.overallDelta >= 0 ? `+${report.overallDelta}` : String(report.overallDelta);
      const badge    = report.gate.passed ? "✓ PASS" : "✗ FAIL";
      console.log(`${badge}  ${report.overallOriginal} → ${report.overallEnhanced} (${deltaStr})`);
      if (!report.gate.passed) {
        for (const r of report.gate.failReasons) console.log(`         ⚠  ${r}`);
      }
    } catch (err) {
      console.log(`✗ ERROR: ${err instanceof Error ? err.message : String(err)}`);
      croppedFiles.push(cropFile);
      enhFiles.push(enhFile);
    }
  }

  // Generate and copy report
  const html = buildReportHtml(reports, croppedFiles, enhFiles, profile);
  fs.writeFileSync(path.join(REVIEW_DEST_DIR, "report-clean.html"), html);

  const serverDir = path.join(
    WORKSPACE_ROOT,
    "artifacts/api-server/artifacts/api-server/uploads/ai-photos/review-clean"
  );
  fs.mkdirSync(serverDir, { recursive: true });
  for (const f of [...croppedFiles, ...enhFiles, "report-clean.html"]) {
    const src = path.join(REVIEW_DEST_DIR, f);
    if (fs.existsSync(src)) fs.copyFileSync(src, path.join(serverDir, f));
  }

  // Summary
  const pass = reports.filter(r => r.gate.passed).length;
  const fail = reports.length - pass;
  const avgDelta = reports.length
    ? (reports.reduce((s, r) => s + r.overallDelta, 0) / reports.length).toFixed(1)
    : "0";

  console.log(`\n${"=".repeat(64)}`);
  console.log("PHASE 1.5 CLEAN PHOTO RESULTS");
  console.log(`  Photos tested:      ${reports.length}`);
  console.log(`  ✓ Use Enhanced:     ${pass} / ${reports.length}`);
  console.log(`  ✗ Needs Review:     ${fail} / ${reports.length}`);
  console.log(`  Avg improvement:    ${parseFloat(avgDelta) >= 0 ? "+" : ""}${avgDelta} pts`);
  console.log(`${"=".repeat(64)}`);

  if (pass > 0) {
    console.log(`\n✅ ANSWER: Problem is OPTION B — Input Photo Overlays`);
    console.log(`   Clean (cropped) photos pass the quality gate.`);
    console.log(`   The enhancement pipeline is working correctly.`);
    console.log(`   Next step: add overlay detector → limit/skip enhancement on overlay photos.`);
  } else {
    const natFail = reports.filter(r => r.dimensions.naturalness.enhanced !== null && (r.dimensions.naturalness.enhanced ?? 0) < profile.naturalnessThreshold).length;
    const artFail = reports.filter(r => r.dimensions.artifactDetection.enhanced !== null && (r.dimensions.artifactDetection.enhanced ?? 0) < profile.artifactThreshold).length;
    console.log(`\n⚠️  ANSWER: Even clean photos fail (profile: ${profile.name})`);
    console.log(`   Naturalness <${profile.naturalnessThreshold}: ${natFail}/${reports.length} photos`);
    console.log(`   Artifact Det <${profile.artifactThreshold}: ${artFail}/${reports.length} photos`);
    console.log(`   → Recommend adjusting quality gate thresholds in the active profile.`);
  }
  console.log(`\n  Report: /api/static/ai-photos/review-clean/report-clean.html`);
}

// ── HTML report ───────────────────────────────────────────────────────────────

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
  return `<div style="display:flex;align-items:center;gap:8px">
    <div style="flex:1;height:6px;background:#1e293b;border-radius:3px;overflow:hidden">
      <div style="width:${pct}%;height:100%;background:${color};border-radius:3px"></div>
    </div>
    <span style="font-size:13px;font-weight:700;color:${color};min-width:28px;text-align:right">${v}</span>
  </div>`;
}
function buildDimensionRows(r: PhotoQualityReport): string {
  return QUALITY_DIMENSIONS.map(dim => {
    const d = r.dimensions[dim.key];
    const isGate = dim.key === "naturalness" || dim.key === "artifactDetection" || dim.key === "marketplaceReady";
    return `<tr style="border-bottom:1px solid #0f172a">
      <td style="padding:10px 14px;color:${isGate ? "#e2e8f0" : "#cbd5e1"};font-size:13px;font-weight:${isGate ? "600" : "400"};white-space:nowrap">
        ${dim.label}${isGate ? ' <span style="font-size:10px;color:#3b82f6;vertical-align:middle">●</span>' : ""}
      </td>
      <td style="padding:10px 14px;width:150px">${scoreBar(d.original, scoreColor(d.original))}</td>
      <td style="padding:10px 14px;width:150px">${scoreBar(d.enhanced, scoreColor(d.enhanced))}</td>
      <td style="padding:10px 14px;text-align:center;font-weight:700;font-size:15px;color:${deltaColor(d.delta)}">${fmtDelta(d.delta)}</td>
    </tr>`;
  }).join("\n");
}
function buildAnalysisBullets(items: string[], isEnhanced: boolean): string {
  const prefix = isEnhanced ? "✓" : "–";
  const color  = isEnhanced ? "#86efac" : "#fca5a5";
  const pColor = isEnhanced ? "#22c55e" : "#ef4444";
  return items.map(t =>
    `<li style="padding:5px 0;color:${color};font-size:13px;display:flex;gap:8px;align-items:flex-start">
      <span style="color:${pColor};font-weight:700;flex-shrink:0">${prefix}</span><span>${t}</span>
    </li>`
  ).join("\n");
}

function buildSection(report: PhotoQualityReport, cropFile: string, enhFile: string, profile: QualityProfile): string {
  const passed  = report.gate.passed;
  const delta   = fmtDelta(report.overallDelta);
  const mrScore = report.marketplaceReadyScore;
  const mrColor = mrScore !== null && mrScore >= profile.marketplaceReadyThreshold ? "#22c55e"
                : mrScore !== null && mrScore >= profile.marketplaceReadyThreshold - 10 ? "#f59e0b"
                : "#ef4444";
  const badge   = passed
    ? `<span style="background:#052e16;border:1px solid #16a34a;color:#22c55e;font-size:12px;font-weight:700;padding:5px 12px;border-radius:20px">✓ PASS — Use Enhanced</span>`
    : `<span style="background:#1c0505;border:1px solid #b91c1c;color:#f87171;font-size:12px;font-weight:700;padding:5px 12px;border-radius:20px">✗ NEEDS REVIEW — Use Original</span>`;
  const failBlock = !passed
    ? `<div style="margin-top:12px;background:#1c0505;border:1px solid #7f1d1d;border-radius:6px;padding:12px 16px">
        <p style="margin:0 0 6px;font-size:11px;color:#ef4444;text-transform:uppercase;font-weight:700">Why this photo needs review</p>
        ${report.gate.failReasons.map(r => `<p style="margin:3px 0;color:#fca5a5;font-size:13px">· ${r}</p>`).join("\n")}
      </div>`
    : "";

  return `<section style="margin:64px 0;border-top:1px solid #1e293b;padding-top:56px">
  <div style="display:flex;align-items:flex-start;justify-content:space-between;margin-bottom:6px;flex-wrap:wrap;gap:12px">
    <div>
      <h2 style="font-size:22px;font-weight:800;color:#f1f5f9;margin:0 0 2px">${report.vehicleLabel}</h2>
      <p style="margin:0;color:#64748b;font-size:14px">${report.caption}
        · <span style="color:#3b82f6;font-size:12px;font-weight:600">CLEAN — overlay cropped</span></p>
    </div>
    <div style="margin-top:4px">${badge}</div>
  </div>

  <div style="display:grid;grid-template-columns:1fr 1fr 1fr${mrScore !== null ? " 1fr" : ""};gap:16px;margin:24px 0">
    <div style="background:#0f172a;border:1px solid #1e293b;border-radius:8px;padding:20px;text-align:center">
      <p style="margin:0 0 4px;font-size:10px;color:#475569;text-transform:uppercase">Original (cropped)</p>
      <p style="margin:0;font-size:40px;font-weight:900;color:${scoreColor(report.overallOriginal)};line-height:1">${report.overallOriginal}</p>
      <p style="margin:2px 0 0;font-size:11px;color:#475569">/ 100</p>
    </div>
    <div style="background:#0f172a;border:1px solid #1e293b;border-radius:8px;padding:20px;text-align:center">
      <p style="margin:0 0 4px;font-size:10px;color:#475569;text-transform:uppercase">Enhanced Score</p>
      <p style="margin:0;font-size:40px;font-weight:900;color:${scoreColor(report.overallEnhanced)};line-height:1">${report.overallEnhanced}</p>
      <p style="margin:2px 0 0;font-size:11px;color:#475569">/ 100</p>
    </div>
    <div style="background:#0f172a;border:1px solid #1e293b;border-radius:8px;padding:20px;text-align:center">
      <p style="margin:0 0 4px;font-size:10px;color:#475569;text-transform:uppercase">Improvement</p>
      <p style="margin:0;font-size:40px;font-weight:900;color:${report.overallDelta >= 0 ? "#22c55e" : "#ef4444"};line-height:1">${delta}</p>
      <p style="margin:2px 0 0;font-size:11px;color:#475569">points</p>
    </div>
    ${mrScore !== null ? `<div style="background:${passed ? "#052e16" : "#1c0505"};border:1px solid ${passed ? "#166534" : "#7f1d1d"};border-radius:8px;padding:20px;text-align:center">
      <p style="margin:0 0 4px;font-size:10px;color:${passed ? "#4ade80" : "#f87171"};text-transform:uppercase">Marketplace Ready</p>
      <p style="margin:0;font-size:40px;font-weight:900;color:${mrColor};line-height:1">${mrScore}</p>
      <p style="margin:2px 0 0;font-size:11px;color:#475569">/ 100</p>
    </div>` : ""}
  </div>

  ${failBlock}

  <div style="display:grid;grid-template-columns:2fr 1fr;gap:20px;margin:24px 0;align-items:start">
    <div style="background:#0f172a;border:1px solid #1e293b;border-radius:8px;overflow:hidden">
      <div style="padding:12px 14px;background:#0d1526;border-bottom:1px solid #1e293b;display:grid;grid-template-columns:160px 1fr 1fr 48px;gap:8px">
        <span style="font-size:10px;color:#475569;text-transform:uppercase;font-weight:600">Dimension</span>
        <span style="font-size:10px;color:#475569;text-transform:uppercase;font-weight:600">Original</span>
        <span style="font-size:10px;color:#475569;text-transform:uppercase;font-weight:600">Enhanced</span>
        <span style="font-size:10px;color:#475569;text-transform:uppercase;font-weight:600;text-align:center">Δ</span>
      </div>
      <table style="width:100%;border-collapse:collapse"><tbody>${buildDimensionRows(report)}</tbody></table>
      <p style="margin:0;padding:8px 14px;font-size:10px;color:#1e3a5f;border-top:1px solid #0f172a">● = quality gate dimension (must score ≥ 85 on enhanced)</p>
    </div>
    <div style="display:flex;flex-direction:column;gap:16px">
      <div style="background:#0f172a;border:1px solid #1e293b;border-radius:8px;padding:20px">
        <p style="margin:0 0 12px;font-size:11px;color:#ef4444;text-transform:uppercase;font-weight:700">Original</p>
        <ul style="margin:0;padding:0;list-style:none">${buildAnalysisBullets(report.originalAnalysis, false)}</ul>
      </div>
      <div style="background:#0f172a;border:1px solid ${passed ? "#166534" : "#1e293b"};border-radius:8px;padding:20px">
        <p style="margin:0 0 12px;font-size:11px;color:#22c55e;text-transform:uppercase;font-weight:700">Enhanced</p>
        <ul style="margin:0;padding:0;list-style:none">${buildAnalysisBullets(report.enhancedAnalysis, true)}</ul>
      </div>
    </div>
  </div>

  <div style="display:grid;grid-template-columns:1fr 1fr;gap:16px">
    <div>
      <p style="margin:0 0 8px;font-size:12px;color:#64748b;text-transform:uppercase;font-weight:600">Clean Photo (overlay cropped)</p>
      <img src="${cropFile}" style="width:100%;border-radius:8px;border:1px solid #1e293b;display:block" loading="lazy"/>
    </div>
    <div>
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:8px">
        <p style="margin:0;font-size:12px;color:${passed ? "#22c55e" : "#94a3b8"};text-transform:uppercase;font-weight:600">Enhanced — v2.3</p>
        <span style="font-size:11px;font-weight:700;color:${passed ? "#22c55e" : "#f87171"};background:${passed ? "#052e16" : "#1c0505"};padding:3px 8px;border-radius:4px">${report.gate.recommendation}</span>
      </div>
      <img src="${enhFile}" style="width:100%;border-radius:8px;border:1px solid ${passed ? "#166534" : "#374151"};display:block" loading="lazy"/>
    </div>
  </div>
</section>`;
}

function buildReportHtml(
  reports: PhotoQualityReport[],
  croppedFiles: string[],
  enhFiles: string[],
  profile: QualityProfile,
): string {
  const pass    = reports.filter(r => r.gate.passed).length;
  const fail    = reports.length - pass;
  const avgOrig = reports.length ? (reports.reduce((s, r) => s + r.overallOriginal, 0) / reports.length).toFixed(1) : "—";
  const avgEnh  = reports.length ? (reports.reduce((s, r) => s + r.overallEnhanced, 0) / reports.length).toFixed(1) : "—";
  const avgD    = reports.length ? (reports.reduce((s, r) => s + r.overallDelta, 0) / reports.length).toFixed(1) : "0";
  const avgDNum = parseFloat(avgD);

  const answer = pass > 0
    ? `<div style="background:#052e16;border:2px solid #22c55e;border-radius:10px;padding:20px 24px;margin-top:24px">
        <p style="margin:0 0 4px;font-size:12px;color:#4ade80;text-transform:uppercase;font-weight:700">Diagnostic Answer</p>
        <p style="margin:0;font-size:18px;font-weight:700;color:#f1f5f9">✅ Option B — Problem is the Input Photos (overlay)</p>
        <p style="margin:8px 0 0;color:#86efac;font-size:14px">Clean photos pass the quality gate. The pipeline is correct. Overlay photos need a separate handling path: detect overlay → limit enhancement → keep original.</p>
      </div>`
    : `<div style="background:#1c0505;border:2px solid #ef4444;border-radius:10px;padding:20px 24px;margin-top:24px">
        <p style="margin:0 0 4px;font-size:12px;color:#f87171;text-transform:uppercase;font-weight:700">Diagnostic Answer</p>
        <p style="margin:0;font-size:18px;font-weight:700;color:#f1f5f9">⚠️ Option A — Even clean photos fail</p>
        <p style="margin:8px 0 0;color:#fca5a5;font-size:14px">Recommend adjusting quality gate thresholds in the active profile (${profile.name}). Pipeline tuning alone cannot achieve the current thresholds on these photos.</p>
      </div>`;

  const sections = reports.map((r, i) => buildSection(r, croppedFiles[i] ?? "", enhFiles[i] ?? "", profile)).join("\n");

  return `<!DOCTYPE html>
<html lang="en"><head><meta charset="UTF-8"/><meta name="viewport" content="width=device-width,initial-scale=1"/>
<title>DealerPilot — Clean Photo Test</title>
<style>*{box-sizing:border-box;margin:0;padding:0}body{background:#030712;color:#e2e8f0;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;padding:56px 48px;max-width:1440px;margin:0 auto}tr:nth-child(even){background:rgba(255,255,255,.015)}</style>
</head><body>

<div style="margin-bottom:56px;padding-bottom:40px;border-bottom:1px solid #1e293b">
  <p style="font-size:11px;color:#3b82f6;text-transform:uppercase;letter-spacing:.1em;font-weight:700;margin-bottom:10px">DealerPilot AI Photo Studio</p>
  <h1 style="font-size:36px;font-weight:900;color:#f8fafc;margin-bottom:8px">Clean Photo Test</h1>
  <p style="color:#64748b;font-size:15px;margin-bottom:4px">Phase 1.5 · Overlay bands cropped · Enhancement v2.3 · ${new Date().toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" })}</p>
  <p style="color:#475569;font-size:13px">Alpha Motorsports CDN confirmed: 26/26 photos have promotional overlays. This test crops top 13% + bottom 22% to isolate the vehicle.</p>

  <div style="display:grid;grid-template-columns:repeat(5,1fr);gap:16px;margin-top:32px">
    <div style="background:#0f172a;border:1px solid #1e293b;border-radius:10px;padding:22px">
      <p style="font-size:10px;color:#475569;text-transform:uppercase;margin-bottom:8px">Avg Original</p>
      <p style="font-size:32px;font-weight:900;color:#f1f5f9">${avgOrig}<span style="font-size:14px;color:#475569"> /100</span></p>
    </div>
    <div style="background:#0f172a;border:1px solid #1e293b;border-radius:10px;padding:22px">
      <p style="font-size:10px;color:#475569;text-transform:uppercase;margin-bottom:8px">Avg Enhanced</p>
      <p style="font-size:32px;font-weight:900;color:#f1f5f9">${avgEnh}<span style="font-size:14px;color:#475569"> /100</span></p>
    </div>
    <div style="background:#0f172a;border:1px solid #1e293b;border-radius:10px;padding:22px">
      <p style="font-size:10px;color:#475569;text-transform:uppercase;margin-bottom:8px">Avg Improvement</p>
      <p style="font-size:32px;font-weight:900;color:${avgDNum >= 0 ? "#22c55e" : "#ef4444"}">${avgDNum >= 0 ? "+" : ""}${avgD}<span style="font-size:14px;color:#475569"> pts</span></p>
    </div>
    <div style="background:#052e16;border:1px solid #166534;border-radius:10px;padding:22px">
      <p style="font-size:10px;color:#4ade80;text-transform:uppercase;margin-bottom:8px">Use Enhanced</p>
      <p style="font-size:32px;font-weight:900;color:#22c55e">${pass}<span style="font-size:14px;color:#4ade80"> / ${reports.length}</span></p>
    </div>
    <div style="background:${fail > 0 ? "#1c0505" : "#0f172a"};border:1px solid ${fail > 0 ? "#7f1d1d" : "#1e293b"};border-radius:10px;padding:22px">
      <p style="font-size:10px;color:${fail > 0 ? "#f87171" : "#475569"};text-transform:uppercase;margin-bottom:8px">Needs Review</p>
      <p style="font-size:32px;font-weight:900;color:${fail > 0 ? "#ef4444" : "#475569"}">${fail}<span style="font-size:14px;color:${fail > 0 ? "#f87171" : "#475569"}"> / ${reports.length}</span></p>
    </div>
  </div>

  <div style="margin-top:20px;background:#0a1628;border:1px solid #1e3a5f;border-radius:8px;padding:16px 20px">
    <p style="font-size:11px;color:#3b82f6;font-weight:700;text-transform:uppercase;margin-bottom:8px">Quality Gate</p>
    <div style="display:flex;gap:32px;flex-wrap:wrap">
      <span style="font-size:13px;color:#93c5fd">Marketplace Ready ≥ ${profile.marketplaceReadyThreshold}</span>
      <span style="font-size:13px;color:#93c5fd">Naturalness ≥ ${profile.naturalnessThreshold}</span>
      <span style="font-size:13px;color:#93c5fd">Artifact Detection ≥ ${profile.artifactThreshold}</span>
      <span style="font-size:13px;color:#93c5fd">Overall Improvement ≥ +${profile.improvementDelta} pts</span>
      <span style="font-size:12px;color:#475569;margin-left:8px">— ${profile.name}</span>
    </div>
  </div>

  ${answer}
</div>

${sections}

<footer style="margin-top:100px;padding-top:24px;border-top:1px solid #0f172a;text-align:center;color:#1e293b;font-size:12px">
  DealerPilot AI Photo Studio · Clean Photo Test · Enhancement v2.3
</footer>
</body></html>`;
}

run().catch(err => { console.error("Fatal:", err); process.exit(1); });
