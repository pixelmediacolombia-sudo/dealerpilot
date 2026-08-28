import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const source = readFileSync(new URL("./migrate.ts", import.meta.url), "utf8");
const entrypoint = readFileSync(new URL("../index.ts", import.meta.url), "utf8");

test("startup runs versioned database migrations before workers and seeds", () => {
  assert.match(source, /SCHEMA_MIGRATION_TABLE = "dealerpilot_schema_migrations"/);
  assert.match(source, /create table if not exists \$\{SCHEMA_MIGRATION_TABLE\}/);
  assert.match(source, /pg_advisory_lock/);
  assert.match(source, /begin/);
  assert.match(source, /rollback/);
  assert.match(source, /insert into \$\{SCHEMA_MIGRATION_TABLE\}/);
  assert.match(entrypoint, /runSchemaMigrations\(logger\)/);
});

test("migration discovery supports the Render repository and local layouts", () => {
  assert.match(source, /process\.cwd\(\), "lib\/db\/migrations"/);
  assert.match(source, /path\.resolve\(process\.cwd\(\), "\.\.\/lib\/db\/migrations"\)/);
  assert.ok(source.includes(".filter((entry) => /^\\d+_.+\\.sql$/.test(entry))"));
});
