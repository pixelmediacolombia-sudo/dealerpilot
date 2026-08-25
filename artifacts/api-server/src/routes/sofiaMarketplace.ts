import crypto from "node:crypto";
import { Router, type Request, type Response } from "express";
// The explicit extension keeps the Node strip-types contract test runnable;
// esbuild resolves the same source file for the production bundle.
import {
  buildMarketplaceTurnDecision,
  validateMarketplaceEnvelope,
  type MarketplaceEnvelope,
  type TurnDecision,
// @ts-ignore Node's strip-types contract test needs the explicit extension.
} from "../sofia/marketplaceTurn.ts";

type RawBodyRequest = Request & { rawBody?: Buffer };

const idempotentResults = new Map<string, TurnDecision>();
const MAX_IDEMPOTENT_RESULTS = 10_000;

function configuredSecret(): string | null {
  const value = process.env["SOFIA_MARKETPLACE_HMAC_SECRET"]?.trim();
  return value || null;
}

function hasValidSignature(rawBody: Buffer, signature: string | undefined, secret: string): boolean {
  const value = String(signature || "").trim().replace(/^sha256=/i, "");
  if (!/^[a-f0-9]{64}$/i.test(value)) return false;
  const expected = crypto.createHmac("sha256", secret).update(rawBody).digest("hex");
  return crypto.timingSafeEqual(Buffer.from(expected, "hex"), Buffer.from(value, "hex"));
}

function readBody(req: RawBodyRequest): { raw: Buffer; body: unknown } | null {
  if (Buffer.isBuffer(req.body)) {
    try {
      return { raw: req.body, body: JSON.parse(req.body.toString("utf8")) };
    } catch {
      return null;
    }
  }
  const body = req.body;
  if (!body || typeof body !== "object") return null;
  return { raw: Buffer.from(JSON.stringify(body)), body };
}

function mode(): "shadow" | "manual_approval" | "auto_send" {
  const value = process.env["SOFIA_MARKETPLACE_MODE"]?.trim().toLowerCase();
  return value === "manual_approval" || value === "auto_send" ? value : "shadow";
}

function idempotencyKey(envelope: MarketplaceEnvelope): string {
  return `${envelope.dealer.dealer_id}:${envelope.idempotency_key}`;
}

export function createSofiaMarketplaceRouter(): Router {
  const router = Router();
  router.post("/sofia/v1/marketplace/turn", (req: RawBodyRequest, res: Response) => {
    const secret = configuredSecret();
    if (!secret) {
      res.status(503).json({ error: "sofia_marketplace_hmac_not_configured" });
      return;
    }
    const parsed = readBody(req);
    if (!parsed) {
      res.status(400).json({ error: "invalid_json" });
      return;
    }
    if (!hasValidSignature(parsed.raw, req.header("X-1987-Signature"), secret)) {
      res.status(401).json({ error: "invalid_signature" });
      return;
    }
    const errors = validateMarketplaceEnvelope(parsed.body);
    if (errors.length > 0) {
      res.status(400).json({ error: "invalid_marketplace_envelope", details: errors });
      return;
    }

    const envelope = parsed.body as MarketplaceEnvelope;
    const key = idempotencyKey(envelope);
    const prior = idempotentResults.get(key);
    if (prior) {
      res.setHeader("X-Sofia-Mode", mode());
      res.json(prior);
      return;
    }

    const decision = buildMarketplaceTurnDecision(envelope);
    idempotentResults.set(key, decision);
    if (idempotentResults.size > MAX_IDEMPOTENT_RESULTS) {
      const oldest = idempotentResults.keys().next().value;
      if (oldest) idempotentResults.delete(oldest);
    }
    // Shadow/manual modes intentionally return a proposal only. This endpoint
    // never sends to Facebook or exposes a page credential.
    res.setHeader("X-Sofia-Mode", mode());
    res.json(decision);
  });
  return router;
}

export default createSofiaMarketplaceRouter();
