import { Router, type IRouter, type Request, type NextFunction, type Response } from "express";
import crypto from "crypto";
import { z } from "zod/v4";
import { pool } from "@workspace/db";

const router: IRouter = Router();

const ALPHA_DEALER_ID = 1;
const ALPHA_USERNAME = "alpha.manassas";
const ALPHA_INITIAL_PASSWORD = process.env.ALPHA_INITIAL_PASSWORD;
const SESSION_TTL_MS = 12 * 60 * 60 * 1000;
const MAX_LOGIN_FAILURES = 5;
const LOGIN_LOCK_MS = 15 * 60 * 1000;
const SCRYPT_COST = 32_768;
const SCRYPT_BLOCK_SIZE = 8;
const SCRYPT_PARALLELIZATION = 1;
const SCRYPT_KEY_LENGTH = 64;

const sessions = new Map<string, { userId: number; expiresAt: number; issuedAt: number }>();
const loginFailures = new Map<string, { count: number; lockedUntil: number }>();
let authSchemaReady: Promise<void> | null = null;

type DealerUserRow = {
  id: number;
  dealer_id: number;
  username: string;
  password_hash: string;
  display_name: string;
  role: string;
  status: string;
  failed_login_count: number | null;
  locked_until: Date | null;
  password_changed_at: Date | null;
};

function hashPassword(password: string, salt = crypto.randomBytes(16).toString("hex")) {
  const hash = crypto.scryptSync(password, Buffer.from(salt, "hex"), SCRYPT_KEY_LENGTH, {
    N: SCRYPT_COST,
    r: SCRYPT_BLOCK_SIZE,
    p: SCRYPT_PARALLELIZATION,
    maxmem: 64 * 1024 * 1024,
  }).toString("hex");
  return `scrypt$${SCRYPT_COST}$${SCRYPT_BLOCK_SIZE}$${SCRYPT_PARALLELIZATION}$${salt}$${hash}`;
}

function verifyPassword(password: string, stored: string): boolean {
  try {
    const parts = stored.split("$");
    const [scheme, ...rest] = parts;
    if (scheme === "scrypt") {
      const [costRaw, blockSizeRaw, parallelizationRaw, salt, expected] = rest;
      const cost = Number(costRaw);
      const blockSize = Number(blockSizeRaw);
      const parallelization = Number(parallelizationRaw);
      if (!cost || !blockSize || !parallelization || !salt || !expected || !/^[0-9a-f]+$/i.test(salt) || !/^[0-9a-f]+$/i.test(expected)) return false;
      const hash = crypto.scryptSync(password, Buffer.from(salt, "hex"), SCRYPT_KEY_LENGTH, {
        N: cost,
        r: blockSize,
        p: parallelization,
        maxmem: 64 * 1024 * 1024,
      }).toString("hex");
      return safeEqualHex(hash, expected);
    }

  // Existing Alpha users may still have the original PBKDF2 record. Keep it
  // readable for one migration window and upgrade it after the next login.
    const [iterationsRaw, salt, expected] = rest;
    if (scheme !== "pbkdf2_sha256" || !iterationsRaw || !salt || !expected) return false;
    const iterations = Number(iterationsRaw);
    if (!Number.isInteger(iterations) || iterations <= 0) return false;
    const hash = crypto.pbkdf2Sync(password, salt, iterations, 32, "sha256").toString("hex");
    return safeEqualHex(hash, expected);
  } catch {
    return false;
  }
}

function safeEqualHex(actual: string, expected: string): boolean {
  const actualBuffer = Buffer.from(actual, "hex");
  const expectedBuffer = Buffer.from(expected, "hex");
  return actualBuffer.length === expectedBuffer.length && crypto.timingSafeEqual(actualBuffer, expectedBuffer);
}

function needsPasswordRehash(stored: string): boolean {
  return !stored.startsWith(`scrypt$${SCRYPT_COST}$${SCRYPT_BLOCK_SIZE}$${SCRYPT_PARALLELIZATION}$`);
}

async function ensureAuthSchema() {
  authSchemaReady ??= (async () => {
    await pool.query(`
      create table if not exists dealer_users (
        id serial primary key,
        dealer_id integer not null references dealers(id),
        username text not null unique,
        password_hash text not null,
        display_name text not null,
        role text not null default 'admin',
        status text not null default 'Active',
        last_login_at timestamptz,
        failed_login_count integer not null default 0,
        locked_until timestamptz,
        password_changed_at timestamptz,
        created_at timestamptz not null default now(),
        updated_at timestamptz not null default now()
      )
    `);
    await pool.query("alter table dealer_users add column if not exists failed_login_count integer not null default 0");
    await pool.query("alter table dealer_users add column if not exists locked_until timestamptz");
    await pool.query("alter table dealer_users add column if not exists password_changed_at timestamptz");
    await pool.query(`
      create table if not exists auth_events (
        id serial primary key,
        user_id integer references dealer_users(id),
        username text,
        event_type text not null,
        success boolean not null default false,
        ip_address text,
        user_agent text,
        details jsonb not null default '{}'::jsonb,
        created_at timestamptz not null default now()
      )
    `);
  })().catch((err) => {
    authSchemaReady = null;
    throw err;
  });
  return authSchemaReady;
}

async function ensureAlphaUser() {
  await ensureAuthSchema();
  const dealer = await pool.query("select id from dealers where id = $1 limit 1", [ALPHA_DEALER_ID]);
  if (!dealer.rows[0]) throw new Error("Alpha Motorsport dealer_id=1 was not found");

  const existingResult = await pool.query<DealerUserRow>(
    "select * from dealer_users where username = $1 limit 1",
    [ALPHA_USERNAME],
  );
  const existing = existingResult.rows[0];

  if (existing) {
    if (existing.dealer_id !== ALPHA_DEALER_ID || existing.status !== "Active") {
      const updated = await pool.query<DealerUserRow>(
        `update dealer_users
         set dealer_id = $1,
             display_name = coalesce(nullif(display_name, ''), 'Alpha Manassas'),
             role = coalesce(nullif(role, ''), 'admin'),
             status = 'Active',
             updated_at = now()
         where id = $2
         returning *`,
        [ALPHA_DEALER_ID, existing.id],
      );
      return updated.rows[0]!;
    }
    return existing;
  }

  if (!ALPHA_INITIAL_PASSWORD) {
    throw new Error("ALPHA_INITIAL_PASSWORD is required before creating the Alpha user");
  }
  const created = await pool.query<DealerUserRow>(
    `insert into dealer_users (dealer_id, username, password_hash, display_name, role, status)
     values ($1, $2, $3, 'Alpha Manassas', 'admin', 'Active')
     returning *`,
    [ALPHA_DEALER_ID, ALPHA_USERNAME, hashPassword(ALPHA_INITIAL_PASSWORD)],
  );
  return created.rows[0]!;
}

function safeUser(user: DealerUserRow) {
  return {
    id: user.id,
    dealerId: user.dealer_id,
    username: user.username,
    displayName: user.display_name,
    role: user.role,
    status: user.status,
  };
}

function clientIp(req: Request) {
  return String(req.headers["x-forwarded-for"] ?? req.ip ?? "").split(",")[0]?.trim() || "unknown";
}

function failureKey(req: Request, username: string) {
  return `${clientIp(req)}:${username}`;
}

function passwordPolicyErrors(password: string, username: string) {
  const errors: string[] = [];
  const lowered = password.toLowerCase();
  const normalizedUsername = username.toLowerCase();
  if (password.length < 14) errors.push("Use at least 14 characters.");
  if (!/[a-z]/.test(password)) errors.push("Add a lowercase letter.");
  if (!/[A-Z]/.test(password)) errors.push("Add an uppercase letter.");
  if (!/[0-9]/.test(password)) errors.push("Add a number.");
  if (!/[^A-Za-z0-9]/.test(password)) errors.push("Add a symbol.");
  if (normalizedUsername && lowered.includes(normalizedUsername)) {
    errors.push("Do not include the username.");
  }
  if (/dealerpilot|alpha|manassas|password|facebook|marketplace/i.test(password)) {
    errors.push("Avoid company, dealer, or common password words.");
  }
  return errors;
}

async function auditAuthEvent(
  req: Request,
  eventType: string,
  success: boolean,
  username: string,
  userId: number | null,
  details: Record<string, unknown> = {},
) {
  await ensureAuthSchema();
  await pool.query(
    `insert into auth_events (user_id, username, event_type, success, ip_address, user_agent, details)
     values ($1, $2, $3, $4, $5, $6, $7::jsonb)`,
    [
      userId,
      username || null,
      eventType,
      success,
      clientIp(req),
      req.get("user-agent") ?? null,
      JSON.stringify(details),
    ],
  );
}

function removeUserSessions(userId: number) {
  for (const [token, session] of sessions.entries()) {
    if (session.userId === userId) sessions.delete(token);
  }
}

async function recordLoginFailure(req: Request, username: string, user: DealerUserRow | null) {
  const key = failureKey(req, username);
  const current = loginFailures.get(key);
  const count = (current?.count ?? 0) + 1;
  const lockedUntil = count >= MAX_LOGIN_FAILURES ? Date.now() + LOGIN_LOCK_MS : 0;
  loginFailures.set(key, { count, lockedUntil });

  if (user) {
    await pool.query(
      `update dealer_users
       set failed_login_count = $1,
           locked_until = case when $1 >= $2 then now() + ($3::text || ' milliseconds')::interval else locked_until end,
           updated_at = now()
       where id = $4`,
      [count, MAX_LOGIN_FAILURES, LOGIN_LOCK_MS, user.id],
    );
  }

  await auditAuthEvent(req, "login_failed", false, username, user?.id ?? null, {
    count,
    locked: lockedUntil > 0,
  });
}

async function authenticatedUser(req: Request) {
  await ensureAlphaUser();
  const auth = req.get("authorization") ?? "";
  const token = auth.startsWith("Bearer ") ? auth.slice("Bearer ".length).trim() : "";
  const session = token ? sessions.get(token) : null;
  if (!session || session.expiresAt <= Date.now()) {
    if (token) sessions.delete(token);
    return null;
  }

  const userResult = await pool.query<DealerUserRow>(
    "select * from dealer_users where id = $1 limit 1",
    [session.userId],
  );
  const user = userResult.rows[0];
  if (!user || user.status !== "Active") {
    sessions.delete(token);
    return null;
  }

  const passwordChangedAt = user.password_changed_at?.getTime() ?? 0;
  if (passwordChangedAt > session.issuedAt) {
    sessions.delete(token);
    return null;
  }

  return { token, session, user };
}

export type AuthenticatedDealerUser = ReturnType<typeof safeUser>;

export async function requireAuthenticatedUser(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  const authContext = await authenticatedUser(req);
  if (!authContext) {
    res.status(401).json({ error: "Authentication required" });
    return;
  }

  res.locals.authUser = safeUser(authContext.user);
  next();
}

const LoginBody = z.object({
  username: z.string().min(1),
  password: z.string().min(1),
});

const ChangePasswordBody = z.object({
  currentPassword: z.string().min(1),
  newPassword: z.string().min(1),
});

router.post("/auth/login", async (req, res) => {
  const parsed = LoginBody.safeParse(req.body ?? {});
  if (!parsed.success) {
    res.status(400).json({ error: "username and password are required" });
    return;
  }

  await ensureAlphaUser();

  const username = parsed.data.username.trim().toLowerCase();
  const memoryLock = loginFailures.get(failureKey(req, username));
  if (memoryLock?.lockedUntil && memoryLock.lockedUntil > Date.now()) {
    await auditAuthEvent(req, "login_locked", false, username, null, { source: "memory" });
    res.status(429).json({ error: "Too many failed attempts. Try again later." });
    return;
  }

  const userResult = await pool.query<DealerUserRow>(
    "select * from dealer_users where username = $1 limit 1",
    [username],
  );
  const user = userResult.rows[0];
  if (user?.locked_until && user.locked_until.getTime() > Date.now()) {
    await auditAuthEvent(req, "login_locked", false, username, user.id, { source: "database" });
    res.status(429).json({ error: "Too many failed attempts. Try again later." });
    return;
  }

  if (!user || user.status !== "Active" || !verifyPassword(parsed.data.password, user.password_hash)) {
    await recordLoginFailure(req, username, user ?? null);
    res.status(401).json({ error: "Invalid username or password" });
    return;
  }

  if (needsPasswordRehash(user.password_hash)) {
    await pool.query(
      "update dealer_users set password_hash = $1, updated_at = now() where id = $2",
      [hashPassword(parsed.data.password), user.id],
    );
  }

  await pool.query(
    "update dealer_users set last_login_at = now(), failed_login_count = 0, locked_until = null, updated_at = now() where id = $1",
    [user.id],
  );
  loginFailures.delete(failureKey(req, username));

  const token = crypto.randomBytes(32).toString("hex");
  const issuedAt = Date.now();
  const expiresAt = Date.now() + SESSION_TTL_MS;
  sessions.set(token, { userId: user.id, expiresAt, issuedAt });
  await auditAuthEvent(req, "login_success", true, username, user.id);

  res.json({ token, expiresAt: new Date(expiresAt).toISOString(), user: safeUser(user) });
});

router.get("/auth/me", async (req, res) => {
  const authContext = await authenticatedUser(req);
  if (!authContext) {
    res.status(401).json({ user: null });
    return;
  }

  res.json({
    user: safeUser(authContext.user),
    expiresAt: new Date(authContext.session.expiresAt).toISOString(),
  });
});

router.post("/auth/change-password", async (req, res) => {
  const authContext = await authenticatedUser(req);
  if (!authContext) {
    res.status(401).json({ error: "Session expired" });
    return;
  }

  const parsed = ChangePasswordBody.safeParse(req.body ?? {});
  if (!parsed.success) {
    res.status(400).json({ error: "currentPassword and newPassword are required" });
    return;
  }

  const { user } = authContext;
  if (!verifyPassword(parsed.data.currentPassword, user.password_hash)) {
    await auditAuthEvent(req, "password_change_failed", false, user.username, user.id, { reason: "invalid_current" });
    res.status(401).json({ error: "Current password is incorrect" });
    return;
  }

  if (verifyPassword(parsed.data.newPassword, user.password_hash)) {
    res.status(400).json({ error: "New password must be different from the current password" });
    return;
  }

  const policyErrors = passwordPolicyErrors(parsed.data.newPassword, user.username);
  if (policyErrors.length > 0) {
    res.status(400).json({ error: "Password is not strong enough", details: policyErrors });
    return;
  }

  await pool.query(
    `update dealer_users
     set password_hash = $1,
         password_changed_at = now(),
         failed_login_count = 0,
         locked_until = null,
         updated_at = now()
     where id = $2`,
    [hashPassword(parsed.data.newPassword), user.id],
  );
  removeUserSessions(user.id);
  await auditAuthEvent(req, "password_changed", true, user.username, user.id);

  res.json({ ok: true, message: "Password changed. Please sign in again." });
});

router.post("/auth/logout", async (req, res) => {
  const auth = req.get("authorization") ?? "";
  const token = auth.startsWith("Bearer ") ? auth.slice("Bearer ".length).trim() : "";
  const session = token ? sessions.get(token) : null;
  if (token) {
    sessions.delete(token);
    if (session) await auditAuthEvent(req, "logout", true, "", session.userId);
  }
  res.json({ ok: true });
});

export default router;
