import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import type { Logger } from "pino";
import { pool } from "@workspace/db";

export const SCHEMA_MIGRATION_TABLE = "dealerpilot_schema_migrations";

const MIGRATION_DIRECTORIES = [
  path.resolve(process.cwd(), "lib/db/migrations"),
  path.resolve(process.cwd(), "../lib/db/migrations"),
  path.resolve(process.cwd(), "../../lib/db/migrations"),
];

async function findMigrationDirectory(): Promise<string> {
  for (const directory of MIGRATION_DIRECTORIES) {
    try {
      const entries = await readdir(directory);
      if (entries.some((entry) => /^\d+_.+\.sql$/.test(entry))) return directory;
    } catch {
      // Try the next deployment layout.
    }
  }
  throw new Error(`Database migrations directory not found; checked ${MIGRATION_DIRECTORIES.join(", ")}`);
}

export async function runSchemaMigrations(logger: Logger): Promise<void> {
  const directory = await findMigrationDirectory();
  const migrationFiles = (await readdir(directory))
    .filter((entry) => /^\d+_.+\.sql$/.test(entry))
    .sort();
  const client = await pool.connect();
  const lockKey = "dealerpilot:schema-migrations";
  let applied = 0;

  try {
    await client.query("select pg_advisory_lock(hashtext($1))", [lockKey]);
    await client.query(`
      create table if not exists ${SCHEMA_MIGRATION_TABLE} (
        filename text primary key,
        applied_at timestamptz not null default now()
      )
    `);

    for (const filename of migrationFiles) {
      const existing = await client.query(
        `select 1 from ${SCHEMA_MIGRATION_TABLE} where filename = $1 limit 1`,
        [filename],
      );
      if (existing.rowCount) continue;

      const sql = await readFile(path.join(directory, filename), "utf8");
      logger.info({ filename }, "Database migration starting");
      await client.query("begin");
      try {
        await client.query(sql);
        await client.query(
          `insert into ${SCHEMA_MIGRATION_TABLE} (filename) values ($1)`,
          [filename],
        );
        await client.query("commit");
      } catch (error) {
        await client.query("rollback");
        logger.error({ err: error, filename }, "Database migration failed");
        throw error;
      }
      applied++;
      logger.info({ filename }, "Database migration applied");
    }

    logger.info({ directory, migrationCount: migrationFiles.length, applied }, "Database schema is ready");
  } finally {
    await client.query("select pg_advisory_unlock(hashtext($1))", [lockKey]).catch(() => undefined);
    client.release();
  }
}
