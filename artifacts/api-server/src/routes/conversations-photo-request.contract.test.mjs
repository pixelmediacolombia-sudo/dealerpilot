import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const source = readFileSync(new URL("./conversations.ts", import.meta.url), "utf8");

test("photo requests preserve the ficha and only ask for a phone when it is unavailable", () => {
  assert.match(source, /if \(requestKind === "photos" && vehicleFacts\?\.vdpUrl\)/);
  assert.match(source, /Here is the complete vehicle page with all the photos/);
  assert.match(source, /if \(requestKind === "photos"\) return buildVehiclePhotoRequestReply/);
  assert.match(source, /vehicle_link_request: vehicleFacts\.vdpUrl[\s\S]*?do not ask for a phone number/);
  assert.match(source, /sales agents can send the vehicle photos[\s\S]*?best phone number[\s\S]*?dealership phone/);
  assert.match(source, /stage === "vehicle_link_request" && vehicleFacts\?\.vdpUrl/);
});
