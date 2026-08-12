import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

const dealersSchema = read("lib/db/src/schema/dealers.ts");
const dealersRoute = read("artifacts/api-server/src/routes/dealers.ts");
const apiSpec = read("lib/api-spec/openapi.yaml");
const migration = read("lib/db/migrations/0005_dealer_plans.sql");
const sidebar = read("artifacts/dashboard/src/shared/layout/Sidebar.tsx");
const router = read("artifacts/dashboard/src/app/router.tsx");
const connectionCenter = read("artifacts/dashboard/src/features/connection/pages/ConnectionCenter.tsx");

test("dealer plan is persisted and exposed as basic or complete", () => {
  assert.match(dealersSchema, /plan: text\("plan"\)\.notNull\(\)\.default\("complete"\)/);
  assert.match(dealersRoute, /plan: dealer\.plan === "basic" \? "basic" : "complete"/);
  assert.match(dealersRoute, /plan: z\.enum\(\["basic", "complete"\]\)\.optional\(\)/);
  assert.match(apiSpec, /required: \[id, name, plan, status, totalVehiclesImported, createdAt\]/);
  assert.match(apiSpec, /plan: \{ type: string, enum: \[basic, complete\], default: complete \}/);
  assert.match(migration, /ADD COLUMN IF NOT EXISTS plan text NOT NULL DEFAULT 'complete'/);
  assert.match(migration, /CHECK \(plan IN \('basic', 'complete'\)\)/);
});

test("basic plan removes Page from desktop and mobile navigation", () => {
  assert.match(sidebar, /const isBasicPlan = dealer\?\.plan === "basic"/);
  assert.match(sidebar, /item\.path === "\/pages"/);
  assert.match(sidebar, /visibleNavItems\.map/);
  assert.match(sidebar, /isBasicPlan \? "grid-cols-6" : "grid-cols-7"/);
});

test("basic plan redirects direct Page access and hides Page service health", () => {
  assert.match(router, /if \(dealer\.plan === "basic"\) return <Redirect to="\/listings" \/>/);
  assert.match(router, /<Route path="\/pages" component=\{PageRoute\} \/>/);
  assert.match(connectionCenter, /service\.key === "facebookPage"/);
  assert.match(connectionCenter, /visibleServices\.map/);
});
