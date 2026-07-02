// Stage 3: Composite v3.1 — clean bbox-crop approach.
//
// ALGORITHM:
//   1. Analyse alpha channel to find the exact vehicle bounding box.
//   2. CROP the background-removed PNG to just the vehicle bbox (eliminates all
//      transparent padding math and makes placement trivially correct).
//   3. Scale the cropped vehicle so its HEIGHT equals the target fraction of
//      the canvas height (40–50 %, driven by body style × angle matrix).
//      Width is clamped to safe horizontal margins.
//   4. Place:
//        top  = floorOnBg − vehicleH  (wheels touch floor line)
//        left = targetCenterX − vehicleW/2 (horizontal centre)
//   5. Logo zone avoidance: if vehicle roof would intrude into the logo band,
//      nudge vehicle down.  If floor-clamped, reduce scale instead.
//   6. Composite order: background → floor reflection → contact shadow → vehicle.
//
// FLOOR REFLECTION:
//   Lower 20 % of the scaled vehicle, flipped vertically, alpha-faded 28 % → 0 %,
//   placed just below the floor contact line.
//
// CONTACT SHADOW:
//   SVG radial gradient ellipse at the wheel contact line.
//
// NON-STUDIO SHOTS: passed through unchanged.
import fs from "fs";
import path from "path";
import sharp from "sharp";
import type { PipelineContext } from "../pipeline";
import { STUDIO_EXTERIOR_CLASSIFICATIONS } from "../providers/types";

// ── Constants ─────────────────────────────────────────────────────────────────

/** Horizontal safe margin — vehicle stays inside this band */
const MARGIN_X_FRAC = 0.05;

/** Default logo protection band (upper fraction of canvas).
 *  The vehicle roof must NOT appear above this line.
 *  Alpha Motorsport logo occupies roughly the upper 22 % of the background. */
const DEFAULT_LOGO_BOTTOM_FRAC = 0.22;

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
  left: number; top: number; right: number; bottom: number;
  bboxW: number; bboxH: number;
  valid: boolean;
}

async function analyzeAlphaBbox(pngBuffer: Buffer): Promise<AlphaBbox> {
  const THRESHOLD = 15;
  try {
    const { data, info } = await sharp(pngBuffer).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    const { width, height } = info;
    let minX = width, maxX = 0, minY = height, maxY = 0, found = false;
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        if (data[(y * width + x) * 4 + 3]! > THRESHOLD) {
          if (x < minX) minX = x; if (x > maxX) maxX = x;
          if (y < minY) minY = y; if (y > maxY) maxY = y;
          found = true;
        }
      }
    }
    if (!found) return { left: 0, top: 0, right: width - 1, bottom: height - 1, bboxW: width, bboxH: height, valid: false };
    return { left: minX, top: minY, right: maxX, bottom: maxY, bboxW: maxX - minX, bboxH: maxY - minY, valid: true };
  } catch {
    const meta = await sharp(pngBuffer).metadata();
    const w = meta.width ?? 800; const h = meta.height ?? 600;
    return { left: 0, top: 0, right: w - 1, bottom: h - 1, bboxW: w, bboxH: h, valid: false };
  }
}

// ── Body style → target height fraction ───────────────────────────────────────
// Vehicle HEIGHT as fraction of canvas height (40–50 %).

function bodyStyleHeightFrac(bodyStyle: string): number {
  const s = (bodyStyle ?? "OTHER").toUpperCase();
  if (s === "CONVERTIBLE")                    return 0.40;
  if (s === "COUPE")                          return 0.42;
  if (s === "SEDAN" || s === "SALOON")        return 0.44;
  if (s === "HATCHBACK")                      return 0.45;
  if (s === "TRUCK" || s === "PICKUP")        return 0.46;
  if (s === "SUV"   || s === "CROSSOVER")     return 0.48;
  if (s === "VAN"   || s === "MINIVAN")       return 0.48;
  return 0.44;
}

// Angle modifier — adjusts apparent height based on perspective.
function angleModifier(classification: string): number {
  if (classification === "Exterior Side")                                   return 1.00;
  if (classification === "Exterior Front 45" || classification === "Exterior Rear 45") return 0.93;
  return 0.87; // Front / Rear head-on
}

// ── Contact shadow ────────────────────────────────────────────────────────────

async function buildContactShadow(carWidthPx: number, bgWidth: number): Promise<Buffer> {
  const ellipseW = Math.min(Math.round(carWidthPx * 0.80), bgWidth);
  const ellipseH = 18;
  const canvasW  = Math.min(ellipseW + 80, bgWidth);
  const canvasH  = ellipseH + 64;
  const svgStr = `<svg xmlns="http://www.w3.org/2000/svg" width="${canvasW}" height="${canvasH}">
  <defs>
    <radialGradient id="sg" cx="50%" cy="50%" rx="50%" ry="50%">
      <stop offset="0%"   stop-color="black" stop-opacity="0.42"/>
      <stop offset="55%"  stop-color="black" stop-opacity="0.18"/>
      <stop offset="100%" stop-color="black" stop-opacity="0"/>
    </radialGradient>
  </defs>
  <ellipse cx="${Math.round(canvasW / 2)}" cy="${Math.round(canvasH / 2)}"
           rx="${Math.round(ellipseW / 2)}" ry="${Math.round(ellipseH / 2)}"
           fill="url(#sg)"/>
</svg>`;
  return sharp(Buffer.from(svgStr)).png().toBuffer();
}

// ── Floor reflection ──────────────────────────────────────────────────────────
// Lower 20 % of the (already-cropped, already-scaled) vehicle — flipped
// vertically and faded from 28 % → 0 % alpha, placed below the floor line.

async function buildFloorReflection(scaledVehicle: Buffer, vW: number, vH: number): Promise<Buffer> {
  const stripH = Math.max(8, Math.round(vH * 0.20));

  // Extract the bottom strip of the scaled vehicle, flip it
  const bottomStrip = await sharp(scaledVehicle)
    .extract({ left: 0, top: vH - stripH, width: vW, height: stripH })
    .flip()
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });

  const { data, info } = bottomStrip;
  const { width, height } = info;

  // Fade: 72/255 ≈ 28 % at y=0 (nearest to floor), 0 at y=height
  for (let y = 0; y < height; y++) {
    const fade = Math.round(72 * (1 - y / height));
    for (let x = 0; x < width; x++) {
      const idx = (y * width + x) * 4;
      data[idx + 3] = Math.min(data[idx + 3]!, fade);
    }
  }

  return sharp(Buffer.from(data), { raw: { width, height, channels: 4 } }).png().toBuffer();
}

// ── Main composite stage ──────────────────────────────────────────────────────

export async function stageComposite(ctx: PipelineContext): Promise<void> {
  const backgroundUrl = ctx.pack?.backgroundUrl ?? process.env["AI_STUDIO_BACKGROUND"] ?? null;

  if (!backgroundUrl) {
    ctx.log.warn({ jobId: ctx.job.id }, "photo:composite DISABLED — no studio background configured.");
    for (const img of ctx.images) { img.compositedUrl = img.backgroundRemovedUrl ?? img.originalUrl; img.usedFallback = 1; }
    return;
  }

  let backgroundBuffer: Buffer;
  try {
    backgroundBuffer = await fetchBuffer(backgroundUrl);
  } catch (err) {
    ctx.log.warn({ err, backgroundUrl }, "photo:composite failed to load background — skipping");
    for (const img of ctx.images) { img.compositedUrl = img.backgroundRemovedUrl ?? img.originalUrl; }
    return;
  }

  const bgMeta   = await sharp(backgroundBuffer).metadata();
  const bgW      = bgMeta.width  ?? 1536;
  const bgH      = bgMeta.height ?? 1024;
  const uploadDir = getAiPhotosDir();
  const bgVersion = ctx.pack?.backgroundVersion ?? "v1";

  // Placement mask from pack
  type PlacementMask = { cx?: number; bottomY?: number };
  const mask: PlacementMask = ctx.pack?.placementMaskJson
    ? (JSON.parse(ctx.pack.placementMaskJson) as PlacementMask)
    : {};

  // Logo safe zone — vehicle roof must stay BELOW this line
  type LogoZone = { x: number; y: number; w: number; h: number };
  const rawZones: LogoZone[] = ctx.pack?.logoSafeZoneJson
    ? (JSON.parse(ctx.pack.logoSafeZoneJson) as LogoZone[])
    : [];
  const logoBottomFrac = rawZones.length > 0
    ? Math.max(...rawZones.map((z) => z.y + z.h))
    : DEFAULT_LOGO_BOTTOM_FRAC;

  const floorOnBg     = Math.round((mask.bottomY ?? 0.76) * bgH);
  const targetCenterX = Math.round((mask.cx ?? 0.5) * bgW);
  const logoBottomPx  = Math.round(logoBottomFrac * bgH);

  // Safe horizontal band
  const marginX = Math.round(MARGIN_X_FRAC * bgW);
  const safeW   = bgW - 2 * marginX;

  const packOffX = Math.round((ctx.pack?.vehicleOffsetX ?? 0) * bgW);
  const packOffY = Math.round((ctx.pack?.vehicleOffsetY ?? 0) * bgH);

  const bodyStyle = ctx.vehicleBodyStyle ?? "OTHER";

  for (const img of ctx.images) {
    if (img.processingStatus === "Failed") continue;

    // Non-studio shots pass through
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

      // ── Step 1: Find vehicle bounding box ────────────────────────────────────
      const bbox = await analyzeAlphaBbox(vehicleBuffer);

      // ── Step 2: Crop vehicle to its bbox (removes transparent padding) ────────
      const cropL = Math.max(0, bbox.left   - 2);
      const cropT = Math.max(0, bbox.top    - 2);
      const cropW = Math.min(imgW - cropL, bbox.bboxW + 4);
      const cropH = Math.min(imgH - cropT, bbox.bboxH + 4);

      const vehicleCropped = bbox.valid
        ? await sharp(vehicleBuffer).extract({ left: cropL, top: cropT, width: cropW, height: cropH }).png().toBuffer()
        : vehicleBuffer;

      const croppedW = bbox.valid ? cropW : imgW;
      const croppedH = bbox.valid ? cropH : imgH;

      // ── Step 3: Target dimensions (height-first, width-clamped) ──────────────
      const targetH = Math.round(bodyStyleHeightFrac(bodyStyle) * angleModifier(img.classification ?? "") * bgH);
      const aspectR = croppedW / croppedH;
      let   targetW = Math.round(targetH * aspectR);

      // Clamp width to safe horizontal band
      if (targetW > safeW) {
        targetW = safeW;
      }
      // Recalculate actual height to maintain aspect ratio after width clamp
      const finalH = Math.min(targetH, Math.round(targetW / aspectR));
      const finalW = Math.min(targetW, Math.round(finalH * aspectR));

      // ── Step 4: Resize cropped vehicle ───────────────────────────────────────
      const vehicleScaled = await sharp(vehicleCropped)
        .resize(finalW, finalH, { fit: "fill", kernel: "lanczos3", background: { r: 0, g: 0, b: 0, alpha: 0 } })
        .png()
        .toBuffer();

      // ── Step 5: Placement — wheels at floor line, centred horizontally ────────
      let top  = floorOnBg - finalH + packOffY;
      let left = targetCenterX - Math.round(finalW / 2) + packOffX;

      // ── Step 6: Logo zone avoidance ──────────────────────────────────────────
      // Vehicle roof is at `top` — it must NOT be above logoBottomPx.
      if (top < logoBottomPx) {
        // Nudge vehicle down to respect logo zone
        top = logoBottomPx;
        // After nudge: check the vehicle still fits above the canvas bottom
        if (top + finalH > bgH) {
          // Can't fit at this scale — reduce scale to fit between logo zone and canvas bottom
          const maxH = bgH - logoBottomPx;
          const reducedH = Math.min(maxH, finalH);
          const reducedW = Math.round(reducedH * aspectR);
          const reducedScaled = await sharp(vehicleCropped)
            .resize(reducedW, reducedH, { fit: "fill", kernel: "lanczos3", background: { r: 0, g: 0, b: 0, alpha: 0 } })
            .png()
            .toBuffer();
          top  = bgH - reducedH;
          left = Math.max(0, Math.min(bgW - reducedW, targetCenterX - Math.round(reducedW / 2) + packOffX));
          // Floor reflection + contact shadow for reduced scale
          const reflBuf  = await buildFloorReflection(reducedScaled, reducedW, reducedH);
          const shadowBuf = await buildContactShadow(reducedW, bgW);
          const shadowMeta = await sharp(shadowBuf).metadata();
          const sW = shadowMeta.width ?? reducedW;
          const sH = shadowMeta.height ?? 64;
          const sLeft = Math.max(0, Math.min(bgW - sW, targetCenterX - Math.round(sW / 2) + packOffX));
          const sTop  = Math.max(0, Math.min(bgH - sH, (top + reducedH) - Math.round(sH / 2)));
          const cLeft = Math.max(0, left);
          const cTop  = Math.max(0, top);
          const reflTop = Math.min(bgH - reducedH, top + reducedH);
          const composited = await sharp(backgroundBuffer)
            .composite([
              { input: reflBuf,      left: cLeft, top: Math.max(0, reflTop) },
              { input: shadowBuf,    left: sLeft,  top: sTop, blend: "over" },
              { input: reducedScaled,left: cLeft,  top: cTop },
            ])
            .jpeg({ quality: 95, chromaSubsampling: "4:4:4" })
            .toBuffer();
          const filename = `${ctx.job.vehicleId}-${img.originalUrl.slice(-8).replace(/\W/g, "")}-${bgVersion}-${Date.now()}.jpg`;
          fs.writeFileSync(path.join(uploadDir, filename), composited);
          img.compositedUrl     = `/api/static/ai-photos/${filename}`;
          img.backgroundVersion = bgVersion;
          img.logoObscured      = false; // we made room
          ctx.log.debug({ vehicleId: ctx.job.vehicleId, filename, classification: img.classification, reason: "logo-nudge+scale-reduce" }, "photo:composite v3");
          continue;
        }
      }

      // ── Step 7: Clamp left/right (horizontal safe margins) ───────────────────
      left = Math.max(marginX, Math.min(bgW - marginX - finalW, left));

      // ── Step 8: Ensure image fits within canvas (clamp top) ──────────────────
      // top should be >= 0 in all normal cases since we've ensured finalH <= bgH - logoBottomPx
      top  = Math.max(0, Math.min(bgH - finalH, top));
      left = Math.max(0, Math.min(bgW - finalW, left));

      // ── Step 9: Floor reflection ─────────────────────────────────────────────
      const reflBuf  = await buildFloorReflection(vehicleScaled, finalW, finalH);
      const floorContactPx = top + finalH; // absolute Y on background where wheels meet floor
      const reflTop  = Math.min(bgH - finalH, floorContactPx);

      // ── Step 10: Contact shadow ───────────────────────────────────────────────
      const shadowBuf  = await buildContactShadow(finalW, bgW);
      const shadowMeta = await sharp(shadowBuf).metadata();
      const sW = shadowMeta.width  ?? finalW;
      const sH = shadowMeta.height ?? 64;
      const sLeft = Math.max(0, Math.min(bgW - sW, targetCenterX - Math.round(sW / 2) + packOffX));
      const sTop  = Math.max(0, Math.min(bgH - sH, floorContactPx - Math.round(sH / 2)));

      // ── Step 11: Composite ────────────────────────────────────────────────────
      const composited = await sharp(backgroundBuffer)
        .composite([
          { input: reflBuf,       left: Math.max(0, left), top: Math.max(0, reflTop) },
          { input: shadowBuf,     left: sLeft,              top: sTop, blend: "over" },
          { input: vehicleScaled, left: Math.max(0, left), top: Math.max(0, top) },
        ])
        .jpeg({ quality: 95, chromaSubsampling: "4:4:4" })
        .toBuffer();

      const filename = `${ctx.job.vehicleId}-${img.originalUrl.slice(-8).replace(/\W/g, "")}-${bgVersion}-${Date.now()}.jpg`;
      fs.writeFileSync(path.join(uploadDir, filename), composited);
      img.compositedUrl     = `/api/static/ai-photos/${filename}`;
      img.backgroundVersion = bgVersion;
      img.logoObscured      = top < logoBottomPx; // true only if clamping forced it

      ctx.log.debug({
        vehicleId: ctx.job.vehicleId, filename,
        classification: img.classification, bodyStyle,
        targetH, finalH, finalW,
        placement: { left, top, floorContactPx, logoBottomPx },
        logoObscured: img.logoObscured,
      }, "photo:composite v3");

    } catch (err) {
      img.compositedUrl = img.backgroundRemovedUrl ?? img.originalUrl;
      img.usedFallback = 1;
      ctx.log.warn({ err, url: img.originalUrl }, "photo:composite failed — using bg-removed");
    }
  }
}
