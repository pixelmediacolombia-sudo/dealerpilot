import { Router, type IRouter } from "express";
import crypto from "crypto";
import { z } from "zod/v4";
import { pool } from "@workspace/db";

const router: IRouter = Router();

const ALPHA_DEALER_ID = 1;
const ALPHA_USERNAME = "alpha.manassas";
const ALPHA_PASSWORD = "Alpha2026";
const SESSION_TTL_MS = 12 * 60 * 60 * 1000;

const sessions = new Map<string, { userId: number; expiresAt: number }>();
let authSchemaReady: Promise<void> | null = null;

type DealerUserRow = {
  id: number;
  dealer_id: number;
  username: string;
  password_hash: string;
  display_name: string;
  role: string;
  status: string;
};

function hashPassword(password: string, salt = crypto.randomBytes(16).toString("hex")) {
  const hash = crypto.pbkdf2Sync(password, salt, 120_000, 32, "sha256").toString("hex");
  return `pbkdf2_sha256$120000$${salt}$${hash}`;
}

function verifyPassword(password: string, stored: string): boolean {
  const [scheme, iterationsRaw, salt, expected] = stored.split("$");
  if (scheme !== "pbkdf2_sha256" || !iterationsRaw || !salt || !expected) return false;
  const iterations = Number(iterationsRaw);
  const hash = crypto.pbkdf2Sync(password, salt, iterations, 32, "sha256").toString("hex");
  const actualBuffer = Buffer.from(hash, "hex");
  const expectedBuffer = Buffer.from(expected, "hex");
  return actualBuffer.length === expectedBuffer.length && crypto.timingSafeEqual(actualBuffer, expectedBuffer);
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
        created_at timestamptz not null default now(),
        updated_at timestamptz not null default now()
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
    if (!verifyPassword(ALPHA_PASSWORD, existing.password_hash) || existing.dealer_id !== ALPHA_DEALER_ID) {
      const updated = await pool.query<DealerUserRow>(
        `update dealer_users
         set dealer_id = $1,
             password_hash = $2,
             display_name = coalesce(nullif(display_name, ''), 'Alpha Manassas'),
             role = coalesce(nullif(role, ''), 'admin'),
             status = 'Active',
             updated_at = now()
         where id = $3
         returning *`,
        [ALPHA_DEALER_ID, hashPassword(ALPHA_PASSWORD), existing.id],
      );
      return updated.rows[0]!;
    }
    return existing;
  }

  const created = await pool.query<DealerUserRow>(
    `insert into dealer_users (dealer_id, username, password_hash, display_name, role, status)
     values ($1, $2, $3, 'Alpha Manassas', 'admin', 'Active')
     returning *`,
    [ALPHA_DEALER_ID, ALPHA_USERNAME, hashPassword(ALPHA_PASSWORD)],
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

const LoginBody = z.object({
  username: z.string().min(1),
  password: z.string().min(1),
});

router.post("/auth/login", async (req, res) => {
  const parsed = LoginBody.safeParse(req.body ?? {});
  if (!parsed.success) {
    res.status(400).json({ error: "username and password are required" });
    return;
  }

  await ensureAlphaUser();

  const username = parsed.data.username.trim().toLowerCase();
  const userResult = await pool.query<DealerUserRow>(
    "select * from dealer_users where username = $1 limit 1",
    [username],
  );
  const user = userResult.rows[0];

  if (!user || user.status !== "Active" || !verifyPassword(parsed.data.password, user.password_hash)) {
    res.status(401).json({ error: "Invalid username or password" });
    return;
  }

  await pool.query("update dealer_users set last_login_at = now(), updated_at = now() where id = $1", [user.id]);

  const token = crypto.randomBytes(32).toString("hex");
  const expiresAt = Date.now() + SESSION_TTL_MS;
  sessions.set(token, { userId: user.id, expiresAt });

  res.json({ token, expiresAt: new Date(expiresAt).toISOString(), user: safeUser(user) });
});

router.get("/auth/me", async (req, res) => {
  await ensureAlphaUser();
  const auth = req.get("authorization") ?? "";
  const token = auth.startsWith("Bearer ") ? auth.slice("Bearer ".length).trim() : "";
  const session = token ? sessions.get(token) : null;
  if (!session || session.expiresAt <= Date.now()) {
    if (token) sessions.delete(token);
    res.status(401).json({ user: null });
    return;
  }

  const userResult = await pool.query<DealerUserRow>(
    "select * from dealer_users where id = $1 limit 1",
    [session.userId],
  );
  const user = userResult.rows[0];

  if (!user || user.status !== "Active") {
    sessions.delete(token);
    res.status(401).json({ user: null });
    return;
  }

  res.json({ user: safeUser(user), expiresAt: new Date(session.expiresAt).toISOString() });
});

router.post("/auth/logout", (req, res) => {
  const auth = req.get("authorization") ?? "";
  const token = auth.startsWith("Bearer ") ? auth.slice("Bearer ".length).trim() : "";
  if (token) sessions.delete(token);
  res.json({ ok: true });
});

export default router;
