import crypto from "node:crypto";
import { and, desc, eq } from "drizzle-orm";
import {
  db,
  dealerMetaConnectionsTable,
  type DealerMetaConnection,
} from "@workspace/db";

const KEY_VERSION = "v1";
const ALGORITHM = "aes-256-gcm";

function envValue(name: string, env: NodeJS.ProcessEnv = process.env): string | null {
  const value = env[name]?.trim();
  return value ? value : null;
}

function encryptionKey(env: NodeJS.ProcessEnv = process.env): Buffer {
  const raw = envValue("META_TOKEN_ENCRYPTION_KEY", env);
  if (!raw) throw new Error("META_TOKEN_ENCRYPTION_KEY is required to store Meta tokens securely");

  const hex = /^[0-9a-f]{64}$/i.test(raw) ? Buffer.from(raw, "hex") : null;
  const base64 = !hex ? Buffer.from(raw, "base64") : null;
  const key = hex ?? base64;
  if (!key || key.length !== 32) {
    throw new Error("META_TOKEN_ENCRYPTION_KEY must encode exactly 32 bytes as hex or base64");
  }
  return key;
}

export function encryptMetaToken(token: string, env: NodeJS.ProcessEnv = process.env): string {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv(ALGORITHM, encryptionKey(env), iv);
  const ciphertext = Buffer.concat([cipher.update(token, "utf8"), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return [KEY_VERSION, iv.toString("base64url"), authTag.toString("base64url"), ciphertext.toString("base64url")].join(".");
}

export function decryptMetaToken(payload: string, env: NodeJS.ProcessEnv = process.env): string {
  const [version, ivText, authTagText, ciphertextText] = payload.split(".");
  if (version !== KEY_VERSION || !ivText || !authTagText || !ciphertextText) {
    throw new Error("Unsupported Meta token ciphertext format");
  }
  const decipher = crypto.createDecipheriv(ALGORITHM, encryptionKey(env), Buffer.from(ivText, "base64url"));
  decipher.setAuthTag(Buffer.from(authTagText, "base64url"));
  return Buffer.concat([
    decipher.update(Buffer.from(ciphertextText, "base64url")),
    decipher.final(),
  ]).toString("utf8");
}

export type ResolvedMetaPageConnection = {
  dealerId: number;
  pageId: string;
  pageAccessToken: string;
  graphApiVersion: string;
  businessId: string | null;
  pageName: string | null;
  scopes: string[];
  expiresAt: Date | null;
};

export function readBootstrapMetaPageConfig(
  env: NodeJS.ProcessEnv = process.env,
): { pageId: string; pageAccessToken: string } | null {
  const pageId = envValue("META_BOOTSTRAP_PAGE_ID", env) || envValue("META_PAGE_ID", env);
  const pageAccessToken = envValue("META_BOOTSTRAP_PAGE_ACCESS_TOKEN", env) || envValue("META_PAGE_ACCESS_TOKEN", env);
  if (!pageId || !pageAccessToken) return null;
  return { pageId, pageAccessToken };
}

export async function getMetaPageConnection(
  dealerId: number,
  env: NodeJS.ProcessEnv = process.env,
): Promise<ResolvedMetaPageConnection | null> {
  const [connection] = await db
    .select()
    .from(dealerMetaConnectionsTable)
    .where(and(
      eq(dealerMetaConnectionsTable.dealerId, dealerId),
      eq(dealerMetaConnectionsTable.status, "active"),
    ))
    .limit(1);
  if (!connection) return null;

  return {
    dealerId,
    pageId: connection.pageId,
    pageAccessToken: decryptMetaToken(connection.accessTokenCiphertext, env),
    graphApiVersion: envValue("META_GRAPH_API_VERSION", env) || "v23.0",
    businessId: connection.businessId,
    pageName: connection.pageName,
    scopes: connection.scopes ?? [],
    expiresAt: connection.expiresAt,
  };
}

export async function getMetaPageConnectionSummary(dealerId: number) {
  const [connection] = await db
    .select({
      pageId: dealerMetaConnectionsTable.pageId,
      pageName: dealerMetaConnectionsTable.pageName,
      scopes: dealerMetaConnectionsTable.scopes,
      status: dealerMetaConnectionsTable.status,
      lastValidatedAt: dealerMetaConnectionsTable.lastValidatedAt,
      expiresAt: dealerMetaConnectionsTable.expiresAt,
      lastError: dealerMetaConnectionsTable.lastError,
    })
    .from(dealerMetaConnectionsTable)
    .where(eq(dealerMetaConnectionsTable.dealerId, dealerId))
    .orderBy(desc(dealerMetaConnectionsTable.updatedAt))
    .limit(1);
  if (!connection) return null;
  return {
    ...connection,
    scopes: connection.scopes ?? [],
    lastValidatedAt: connection.lastValidatedAt?.toISOString() ?? null,
    expiresAt: connection.expiresAt?.toISOString() ?? null,
  };
}

export async function recordMetaPageValidation(
  dealerId: number,
  patch: { pageName?: string | null; lastError: string | null; valid: boolean },
): Promise<void> {
  await db
    .update(dealerMetaConnectionsTable)
    .set({
      ...(patch.pageName !== undefined ? { pageName: patch.pageName } : {}),
      status: patch.valid ? "active" : "error",
      lastValidatedAt: new Date(),
      lastError: patch.lastError,
      updatedAt: new Date(),
    })
    .where(eq(dealerMetaConnectionsTable.dealerId, dealerId));
}

export async function persistValidatedMetaPageConnection(
  dealerId: number,
  config: { pageId: string; pageAccessToken: string },
  validation: {
    pageName: string | null;
    grantedPermissions: string[];
    tokenExpiresAt: string | null;
  },
  env: NodeJS.ProcessEnv = process.env,
): Promise<void> {
  const now = new Date();
  const values = {
    dealerId,
    pageId: config.pageId,
    pageName: validation.pageName,
    accessTokenCiphertext: encryptMetaToken(config.pageAccessToken, env),
    tokenKeyVersion: KEY_VERSION,
    scopes: [...new Set(validation.grantedPermissions)],
    status: "active",
    lastValidatedAt: now,
    expiresAt: validation.tokenExpiresAt ? new Date(validation.tokenExpiresAt) : null,
    lastError: null,
    updatedAt: now,
  };

  await db
    .insert(dealerMetaConnectionsTable)
    .values(values)
    .onConflictDoUpdate({
      target: [dealerMetaConnectionsTable.dealerId, dealerMetaConnectionsTable.pageId],
      set: {
        pageName: values.pageName,
        accessTokenCiphertext: values.accessTokenCiphertext,
        tokenKeyVersion: values.tokenKeyVersion,
        scopes: values.scopes,
        status: values.status,
        lastValidatedAt: values.lastValidatedAt,
        expiresAt: values.expiresAt,
        lastError: values.lastError,
        updatedAt: values.updatedAt,
      },
    });
}

/**
 * One-time bridge for the Alpha deployment. It imports the old global env
 * values into the dealer connection row and is intentionally never used to
 * resolve a different dealer's credentials.
 */
export async function ensureLegacyAlphaMetaConnection(
  dealerId: number,
  env: NodeJS.ProcessEnv = process.env,
): Promise<DealerMetaConnection | null> {
  const [existing] = await db
    .select()
    .from(dealerMetaConnectionsTable)
    .where(eq(dealerMetaConnectionsTable.dealerId, dealerId))
    .limit(1);
  if (existing) return existing;

  const config = readBootstrapMetaPageConfig(env);
  if (!config) return null;

  const [created] = await db
    .insert(dealerMetaConnectionsTable)
    .values({
      dealerId,
      pageId: config.pageId,
      businessId: envValue("META_BOOTSTRAP_BUSINESS_ID", env) || envValue("META_BUSINESS_ID", env),
      pageName: envValue("META_BOOTSTRAP_PAGE_NAME", env),
      accessTokenCiphertext: encryptMetaToken(config.pageAccessToken, env),
      tokenKeyVersion: KEY_VERSION,
      scopes: (envValue("META_PAGE_SCOPES", env) || "")
        .split(",")
        .map((scope) => scope.trim())
        .filter(Boolean),
      status: "active",
      lastValidatedAt: new Date(),
    })
    .returning();
  return created ?? null;
}
