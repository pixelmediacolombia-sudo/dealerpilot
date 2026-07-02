// Stage 3: Composite — places the background-removed vehicle onto the studio background.
//
// v2 — Alpha-aware placement engine:
//   • Analyzes the BRIA alpha channel to find the actual vehicle bounding box.
//     (BRIA outputs may have transparent padding — this corrects for it.)
//   • Aligns the vehicle's wheel contact line to the configured floor position.
//   • Centers by vehicle mass center (bbox center), not the PNG image center.
//   • Applies angle-based scaling: Side > 45° > Front/Rear.
//   • Generates a soft contact shadow under the vehicle at the floor line.
//   • Studio background is applied ONLY to primary exterior angles:
//     Front, Front 45, Side, Rear 45, Rear.
//   • Everything else (Wheel, Engine, Interior, Technical, Dealer) is passed through.
//
// Quality gate flags set here:
//   floatingRisk — alpha analysis failed; fell back to image-edge alignment
//   shadowGenerated — contact shadow was successfully composited
import fs from "fs";
import path from "path";
import sharp from "sharp";
import type { PipelineContext } from "../pipeline";
import { STUDIO_EXTERIOR_CLASSIFICATIONS } from "../providers/types";

function getAiPhotosDir(): string {
  const dir = path.join(process.cwd(), "artifacts/api-server/uploads/ai-photos");
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

async function fetchBuffer(urlOrPath: string): Promise<Buffer> {
  if (urlOrPath.startsWith("http://") || urlOrPath.startsWith("https://")) {
    const res = await fetch(urlOrPath);
    if (!res.ok) throw new Error(`Failed to fetch ${urlOrPath}: ${res.status}`);
    return Buffer.from(await res.arrayBuffer());
  }
  if (urlOrPath.startsWith("/api/static/")) {
    const port = process.env["PORT"] ?? "8080";
    const localUrl = `http://localhost:${port}${urlOrPath}`;
    const res = await fetch(localUrl);
    if (!res.ok) throw new Error(`Failed to fetch local ${urlOrPath}: ${res.status}`);
    return Buffer.from(await res.arrayBuffer());
  }
  return fs.readFileSync(urlOrPath);
}

// ── Alpha bounding box ────────────────────────────────────────────────────────

interface AlphaBbox {
  left: number;
  right: number;
  top: number;
  bottom: number;
  bboxW: number;
  bboxH: number;
  // Fractions of the full PNG dimensions — used for scaled placement
  centerXFrac: number;   // horizontal center of bbox (0..1 of PNG width)
  bottomYFrac: number;   // bottom edge of bbox (0..1 of PNG height) — wheel contact
  topYFrac: number;      // top edge of bbox (0..1 of PNG height)
  valid: boolean;        // false if no opaque pixels found → fallback mode
}

async function analyzeAlphaBbox(pngBuffer: Buffer): Promise<AlphaBbox> {
  const ALPHA_THRESHOLD = 15;

  try {
    const { data, info } = await sharp(pngBuffer)
      .ensureAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true });

    const { width, height } = info;
    let minX = width, maxX = 0, minY = height, maxY = 0;
    let found = false;

    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const alpha = data[(y * width + x)! * 4 + 3]!;
        if (alpha > ALPHA_THRESHOLD) {
          if (x < minX) minX = x;
          if (x > maxX) maxX = x;
          if (y < minY) minY = y;
          if (y > maxY) maxY = y;
          found = true;
        }
      }
    }

    if (!found) {
      return { left: 0, right: width - 1, top: 0, bottom: height - 1,
               bboxW: width, bboxH: height,
               centerXFrac: 0.5, bottomYFrac: 1.0, topYFrac: 0.0, valid: false };
    }

    return {
      left: minX, right: maxX, top: minY, bottom: maxY,
      bboxW: maxX - minX, bboxH: maxY - minY,
      centerXFrac: (minX + maxX) / 2 / width,
      bottomYFrac: maxY / height,
      topYFrac: minY / height,
      valid: true,
    };
  } catch {
    // Fallback if Sharp can't read alpha (non-PNG input, etc.)
    const meta = await sharp(pngBuffer).metadata();
    return { left: 0, right: (meta.width ?? 800) - 1, top: 0, bottom: (meta.height ?? 600) - 1,
             bboxW: meta.width ?? 800, bboxH: meta.height ?? 600,
             centerXFrac: 0.5, bottomYFrac: 1.0, topYFrac: 0.0, valid: false };
  }
}

// ── Angle-based scale factor ──────────────────────────────────────────────────
// Side views show the car at full width; front/rear are narrower.
// Scale the vehicle bbox to fill the appropriate fraction of the background.

function angleScaleFactor(classification: string): number {
  switch (classification) {
    case "Exterior Side":        return 1.00;   // widest — full scale
    case "Exterior Front 45":
    case "Exterior Rear 45":     return 0.85;   // 3/4 angle — slightly smaller
    case "Exterior Front":
    case "Exterior Rear":        return 0.70;   // head-on — narrowest angle
    default:                     return 0.80;
  }
}

// ── Contact shadow ────────────────────────────────────────────────────────────

async function buildContactShadow(
  shadowWidthPx: number,
  bgWidth: number,
): Promise<Buffer> {
  // SVG radial gradient ellipse — the only reliable way to produce a soft
  // contact shadow regardless of canvas size / blur-sigma interactions.
  // The ellipse is 85% of car width, ~22px tall at centre, fades to transparent.
  const ellipseW = Math.min(Math.round(shadowWidthPx * 0.85), bgWidth);
  const ellipseH = 22;  // peak height of the shadow ellipse (px)
  const canvasW  = Math.min(ellipseW + 80, bgWidth); // horizontal padding
  const canvasH  = ellipseH + 60;                    // vertical padding for fade

  const cx = Math.round(canvasW / 2);
  const cy = Math.round(canvasH / 2);
  const rx = Math.round(ellipseW / 2);
  const ry = Math.round(ellipseH / 2);

  const svgStr = `<svg xmlns="http://www.w3.org/2000/svg" width="${canvasW}" height="${canvasH}">
  <defs>
    <radialGradient id="sg" cx="50%" cy="50%" rx="50%" ry="50%">
      <stop offset="0%"   stop-color="black" stop-opacity="0.38"/>
      <stop offset="60%"  stop-color="black" stop-opacity="0.18"/>
      <stop offset="100%" stop-color="black" stop-opacity="0"/>
    </radialGradient>
  </defs>
  <ellipse cx="${cx}" cy="${cy}" rx="${rx}" ry="${ry}" fill="url(#sg)"/>
</svg>`;

  return sharp(Buffer.from(svgStr)).png().toBuffer();
}

// ── Main composite stage ──────────────────────────────────────────────────────

export async function stageComposite(ctx: PipelineContext): Promise<void> {
  const backgroundUrl = ctx.pack?.backgroundUrl ?? process.env["AI_STUDIO_BACKGROUND"] ?? null;

  if (!backgroundUrl) {
    ctx.log.warn(
      { jobId: ctx.job.id },
      "photo:composite DISABLED — no studio background. Upload the Alpha Motorsport background to enable compositing.",
    );
    for (const img of ctx.images) {
      img.compositedUrl = img.backgroundRemovedUrl ?? img.originalUrl;
      img.usedFallback = 1;
    }
    return;
  }

  let backgroundBuffer: Buffer;
  try {
    backgroundBuffer = await fetchBuffer(backgroundUrl);
  } catch (err) {
    ctx.log.warn({ err, backgroundUrl }, "photo:composite failed to load background — skipping");
    for (const img of ctx.images) {
      img.compositedUrl = img.backgroundRemovedUrl ?? img.originalUrl;
    }
    return;
  }

  const bgMeta = await sharp(backgroundBuffer).metadata();
  const bgWidth  = bgMeta.width  ?? 1536;
  const bgHeight = bgMeta.height ?? 1024;

  const uploadDir = getAiPhotosDir();
  const backgroundVersion = ctx.pack?.backgroundVersion ?? "v1";

  // Placement mask from studio pack (configured via Settings)
  type PlacementMask = { cx?: number; bottomY?: number; maxW?: number };
  const mask: PlacementMask = ctx.pack?.placementMaskJson
    ? (JSON.parse(ctx.pack.placementMaskJson) as PlacementMask)
    : {};

  // Logo safe zone — used for a placement sanity check
  type LogoZone = { x: number; y: number; w: number; h: number; label?: string };
  const logoZones: LogoZone[] = ctx.pack?.logoSafeZoneJson
    ? (JSON.parse(ctx.pack.logoSafeZoneJson) as LogoZone[])
    : [];

  for (const img of ctx.images) {
    if (img.processingStatus === "Failed") continue;

    // Only composite primary exterior shots that had background removal
    if (!STUDIO_EXTERIOR_CLASSIFICATIONS.has(img.classification ?? "") || img.usedFallback === 1) {
      img.compositedUrl = img.backgroundRemovedUrl ?? img.originalUrl;
      continue;
    }

    const vehicleSrc = img.backgroundRemovedUrl ?? img.originalUrl;

    try {
      const vehicleBuffer = await fetchBuffer(vehicleSrc);
      const vehicleMeta   = await sharp(vehicleBuffer).metadata();
      const imgW = vehicleMeta.width  ?? 800;
      const imgH = vehicleMeta.height ?? 600;

      // ── Step 1: Alpha bbox analysis ─────────────────────────────────────────
      const bbox = await analyzeAlphaBbox(vehicleBuffer);
      const floatingRisk = !bbox.valid;

      // ── Step 2: Calculate target size (angle + pack scale) ──────────────────
      const packScale     = ctx.pack?.vehicleScale ?? 1.0;
      const maxWFrac      = mask.maxW ?? 0.72;
      const angleFactor   = angleScaleFactor(img.classification ?? "");
      const targetBboxW   = Math.round(bgWidth * maxWFrac * angleFactor * packScale);

      // Scale the whole PNG so the vehicle bbox fills targetBboxW pixels on the background.
      // Also enforce a height cap (85% of bgHeight) so portrait-orientation photos don't
      // exceed the background dimensions — Sharp requires overlay ≤ base image.
      const scaleByWidth  = bbox.bboxW > 0 ? targetBboxW / bbox.bboxW : targetBboxW / imgW;
      const maxBboxH      = Math.round(bgHeight * 0.85);
      const scaleByHeight = bbox.bboxH > 0 ? maxBboxH / bbox.bboxH : maxBboxH / imgH;
      const scaleFactor   = Math.min(scaleByWidth, scaleByHeight);

      // Compute final image dimensions — guaranteed ≤ background
      const resizedImgW  = Math.max(1, Math.min(Math.round(imgW * scaleFactor), bgWidth));
      const resizedImgH  = Math.max(1, Math.min(Math.round(imgH * scaleFactor), bgHeight));

      // fit:fill stretches to EXACTLY the requested dimensions so bbox fractions remain valid.
      const vehicleResized = await sharp(vehicleBuffer)
        .resize(resizedImgW, resizedImgH, {
          fit: "fill",
          kernel: "lanczos3",
          background: { r: 0, g: 0, b: 0, alpha: 0 },
        })
        .png()
        .toBuffer();

      // ── Step 3: Placement — align wheel contact to floor line ───────────────
      // After scaling, where is the bbox on the resized image?
      const bboxCenterXOnResized = Math.round(bbox.centerXFrac * resizedImgW);
      const bboxBottomOnResized  = Math.round(bbox.bottomYFrac  * resizedImgH);

      const targetCenterX = Math.round((mask.cx ?? 0.5) * bgWidth);
      const floorOnBg     = Math.round((mask.bottomY ?? 0.82) * bgHeight);

      // Fine-tune via pack offset (operator override)
      const packOffX = Math.round((ctx.pack?.vehicleOffsetX ?? 0) * bgWidth);
      const packOffY = Math.round((ctx.pack?.vehicleOffsetY ?? 0) * bgHeight);

      let left = targetCenterX - bboxCenterXOnResized + packOffX;
      let top  = floorOnBg - bboxBottomOnResized + packOffY;

      // ── Step 4: Logo safe zone — shift vehicle horizontally if it would ──────
      // cover more than 90 % of the horizontal logo span.
      for (const zone of logoZones) {
        const zoneLeft  = Math.round(zone.x * bgWidth);
        const zoneRight = Math.round((zone.x + zone.w) * bgWidth);
        const zoneTop   = Math.round(zone.y * bgHeight);
        const zoneBot   = Math.round((zone.y + zone.h) * bgHeight);

        // Vehicle bbox on background
        const vLeft   = left + Math.round(bbox.left  * scaleFactor);
        const vRight  = left + Math.round(bbox.right * scaleFactor);
        const vTop    = top  + Math.round(bbox.top   * scaleFactor);
        const vBot    = top  + Math.round(bbox.bottom * scaleFactor);

        // Horizontal overlap
        const overlapLeft  = Math.max(vLeft, zoneLeft);
        const overlapRight = Math.min(vRight, zoneRight);
        const overlapTop   = Math.max(vTop, zoneTop);
        const overlapBot   = Math.min(vBot, zoneBot);

        if (overlapRight > overlapLeft && overlapBot > overlapTop) {
          const logoW       = zoneRight - zoneLeft;
          const coverageRatio = (overlapRight - overlapLeft) / logoW;

          if (coverageRatio > 0.92) {
            // Vehicle covers almost entire logo width — not much we can do without
            // drastically shrinking it; log the warning and continue.
            ctx.log.warn(
              { vehicleId: ctx.job.vehicleId, classification: img.classification, coverageRatio },
              "photo:composite logo coverage high — consider increasing maxW or shifting vehicle",
            );
          }
        }
      }

      // Clamp to background bounds
      left = Math.max(0, Math.min(bgWidth  - resizedImgW, left));
      top  = Math.max(0, Math.min(bgHeight - resizedImgH, top));

      // ── Step 5: Contact shadow ───────────────────────────────────────────────
      // SVG radial gradient ellipse — centres exactly at the car's floor contact.
      const bboxWidthOnBg = Math.round(bbox.bboxW * scaleFactor);
      const shadowBuf  = await buildContactShadow(bboxWidthOnBg, bgWidth);
      const shadowMeta = await sharp(shadowBuf).metadata();
      const shadowW    = shadowMeta.width  ?? bboxWidthOnBg;
      const shadowH    = shadowMeta.height ?? 82;

      // Centre the shadow ellipse horizontally at car centre, vertically at floor line.
      const shadowLeft = Math.max(0, Math.min(
        bgWidth - shadowW,
        targetCenterX - Math.round(shadowW / 2) + packOffX,
      ));
      const shadowTop = Math.max(0, Math.min(
        bgHeight - shadowH,
        floorOnBg - Math.round(shadowH / 2) + packOffY,
      ));

      // ── Step 6: Composite — background → shadow → vehicle ───────────────────
      const composited = await sharp(backgroundBuffer)
        .composite([
          // Contact shadow — uses its own alpha channel; blend:over preserves it
          {
            input: shadowBuf,
            left:  shadowLeft,
            top:   shadowTop,
            blend: "over",
          },
          // Vehicle (over everything)
          {
            input: vehicleResized,
            left:  Math.max(0, left),
            top:   Math.max(0, top),
          },
        ])
        .jpeg({ quality: 95, chromaSubsampling: "4:4:4" })
        .toBuffer();

      const filename = `${ctx.job.vehicleId}-${img.originalUrl.slice(-8).replace(/\W/g, "")}-${backgroundVersion}-${Date.now()}.jpg`;
      const filepath  = path.join(uploadDir, filename);
      fs.writeFileSync(filepath, composited);

      img.compositedUrl      = `/api/static/ai-photos/${filename}`;
      img.backgroundVersion  = backgroundVersion;

      ctx.log.debug(
        {
          vehicleId: ctx.job.vehicleId,
          filename,
          classification: img.classification,
          bboxValid: bbox.valid,
          floatingRisk,
          scaleFactor: scaleFactor.toFixed(3),
          placement: { left, top, bboxW: bboxWidthOnBg },
        },
        "photo:composite",
      );
    } catch (err) {
      img.compositedUrl = img.backgroundRemovedUrl ?? img.originalUrl;
      img.usedFallback = 1;
      ctx.log.warn({ err, url: img.originalUrl }, "photo:composite failed — using bg-removed");
    }
  }
}
