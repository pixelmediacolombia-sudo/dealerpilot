// Visual review script for AI Photo Enhancement v2.
// Processes real vehicle images through the three v2 presets and saves
// before/after pairs in uploads/ai-photos/review/ for visual comparison.
//
// Run: pnpm --filter @workspace/scripts run test-enhance-v2
//
// Outputs:
//   uploads/ai-photos/review/review.html   — side-by-side comparison page
//   uploads/ai-photos/review/orig-*.jpg    — original images
//   uploads/ai-photos/review/enh-*.jpg     — enhanced images
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import sharp from "sharp";
import { presetExteriorPremium, presetInteriorPremium, presetTechnicalReadability } from "../../artifacts/api-server/src/photo/stages/4_enhance";

// Resolve relative to THIS file's location so the output path is correct
// regardless of which directory the script is run from.
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const WORKSPACE_ROOT = path.resolve(__dirname, "../..");

// The API server's CWD when built is artifacts/api-server/, so static files
// are served from that directory's subtree. We write to the workspace root
// equivalent so both the review script and the static server agree.
const REVIEW_DIR = path.join(WORKSPACE_ROOT, "artifacts/api-server/uploads/ai-photos/review");

// Five vehicles, three photos each (exterior, interior, technical best-effort)
// VehicleId | year | make | model | notes
// Real CDN URLs from the database (positions 0-4 of each vehicle)
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

async function fetchBuffer(url: string): Promise<Buffer> {
  const res = await fetch(url, { signal: AbortSignal.timeout(20_000) });
  if (!res.ok) throw new Error(`HTTP ${res.status} fetching ${url}`);
  return Buffer.from(await res.arrayBuffer());
}

interface ProcessedPhoto {
  vehicleLabel: string;
  caption: string;
  type: "exterior" | "interior" | "technical";
  origFile: string;
  enhFile: string;
  origSizeKb: number;
  enhSizeKb: number;
  origSharpness: number;
  enhSharpness: number;
}

async function measureSharpness(buf: Buffer): Promise<number> {
  const stats = await sharp(buf).stats();
  const channels = stats.channels.slice(0, 3);
  return channels.reduce((s, c) => s + c.stdev, 0) / channels.length;
}

async function run() {
  fs.mkdirSync(REVIEW_DIR, { recursive: true });

  const results: ProcessedPhoto[] = [];
  let idx = 0;

  for (const vehicle of TEST_CASES) {
    console.log(`\n── ${vehicle.label} ──`);

    for (const photo of vehicle.photos) {
      idx++;
      const tag = `v${vehicle.vehicleId}-${idx}`;
      const origFile = `orig-${tag}.jpg`;
      const enhFile  = `enh-${tag}.jpg`;

      try {
        process.stdout.write(`  [${idx}] ${photo.caption} … `);
        const buf = await fetchBuffer(photo.url);

        // Save original
        fs.writeFileSync(path.join(REVIEW_DIR, origFile), buf);

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

        const [origSharpness, enhSharpness] = await Promise.all([
          measureSharpness(buf),
          measureSharpness(enhanced),
        ]);

        results.push({
          vehicleLabel: vehicle.label,
          caption: photo.caption,
          type: photo.type,
          origFile,
          enhFile,
          origSizeKb: Math.round(buf.length / 1024),
          enhSizeKb: Math.round(enhanced.length / 1024),
          origSharpness: parseFloat(origSharpness.toFixed(1)),
          enhSharpness: parseFloat(enhSharpness.toFixed(1)),
        });

        const ratio = (enhSharpness / origSharpness).toFixed(2);
        console.log(`✓  sharpness ${origSharpness.toFixed(1)} → ${enhSharpness.toFixed(1)} (ratio ${ratio})`);
      } catch (err) {
        console.log(`✗  FAILED: ${err instanceof Error ? err.message : String(err)}`);
      }
    }
  }

  // Generate comparison HTML
  const html = buildHtml(results);
  fs.writeFileSync(path.join(REVIEW_DIR, "review.html"), html);

  console.log(`\n✅  Review complete — ${results.length} photos processed`);
  console.log(`    HTML: artifacts/api-server/uploads/ai-photos/review/review.html`);
  console.log(`    Static: /api/static/ai-photos/review/review.html`);
}

function buildHtml(results: ProcessedPhoto[]): string {
  const rows = results.map((r) => {
    const sharpnessRatio = r.origSharpness > 0 ? (r.enhSharpness / r.origSharpness) : 1;
    const sharpnessOk = sharpnessRatio >= 0.75;
    const badge = sharpnessOk
      ? `<span style="color:#22c55e">✓ ${(sharpnessRatio * 100).toFixed(0)}% sharpness retained</span>`
      : `<span style="color:#ef4444">⚠ sharpness dropped to ${(sharpnessRatio * 100).toFixed(0)}%</span>`;

    return `
  <section style="margin:40px 0; border-top:1px solid #333; padding-top:32px;">
    <h2 style="margin:0 0 4px; font-size:18px; color:#f1f5f9">${r.vehicleLabel}</h2>
    <p style="margin:0 0 16px; color:#94a3b8; font-size:13px">${r.caption} · preset: ${r.type} · ${badge}</p>
    <div style="display:grid; grid-template-columns:1fr 1fr; gap:16px;">
      <div>
        <p style="margin:0 0 6px; font-size:12px; color:#64748b; text-transform:uppercase; letter-spacing:.05em">Original · ${r.origSizeKb} KB · sharpness ${r.origSharpness}</p>
        <img src="${r.origFile}" style="width:100%; border-radius:8px; border:1px solid #1e293b;" loading="lazy"/>
      </div>
      <div>
        <p style="margin:0 0 6px; font-size:12px; color:#64748b; text-transform:uppercase; letter-spacing:.05em">Enhanced v2 · ${r.enhSizeKb} KB · sharpness ${r.enhSharpness}</p>
        <img src="${r.enhFile}" style="width:100%; border-radius:8px; border:1px solid #334155;" loading="lazy"/>
      </div>
    </div>
  </section>`;
  }).join("");

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8"/>
  <title>AI Photo Enhancement v2 — Visual Review</title>
  <style>
    *{box-sizing:border-box;margin:0;padding:0}
    body{background:#0f172a;color:#e2e8f0;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;padding:40px;max-width:1400px;margin:0 auto}
    h1{font-size:24px;font-weight:700;margin-bottom:8px}
    .sub{color:#64748b;font-size:14px;margin-bottom:0}
  </style>
</head>
<body>
  <h1>AI Photo Enhancement v2 — Visual Review</h1>
  <p class="sub">5 vehicles · exterior_premium / interior_premium / technical_readability presets · ${new Date().toISOString().slice(0,10)}</p>
  ${rows}
</body>
</html>`;
}

run().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});
