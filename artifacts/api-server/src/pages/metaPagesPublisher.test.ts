import assert from "node:assert/strict";
import test from "node:test";
import { MetaPagesPublisher, readMetaPagesConfig, validateMetaPageConnection } from "./metaPagesPublisher";

test("readMetaPagesConfig requires the Page id and access token", () => {
  assert.equal(readMetaPagesConfig({}), null);
  assert.deepEqual(
    readMetaPagesConfig({
      META_PAGE_ID: "page-123",
      META_PAGE_ACCESS_TOKEN: "secret",
      META_GRAPH_API_VERSION: "v99.0",
    }),
    { pageId: "page-123", pageAccessToken: "secret", graphApiVersion: "v99.0" },
  );
});

test("MetaPagesPublisher uploads unpublished photos and creates one Page post", async () => {
  const calls: Array<{ url: string; body: URLSearchParams }> = [];
  let photoNumber = 0;
  const fetchMock: typeof fetch = async (input, init) => {
    const url = String(input);
    const body = init?.body instanceof URLSearchParams ? init.body : new URLSearchParams(String(init?.body ?? ""));
    calls.push({ url, body });
    if (url.endsWith("/photos")) {
      photoNumber += 1;
      return new Response(JSON.stringify({ id: `photo-${photoNumber}` }), { status: 200 });
    }
    return new Response(JSON.stringify({ id: "page-post-1", permalink_url: "https://facebook.com/page-post-1" }), { status: 200 });
  };

  const result = await new MetaPagesPublisher(
    { pageId: "page-123", pageAccessToken: "secret", graphApiVersion: "v23.0" },
    fetchMock,
  ).publishVehicle({
    message: "2026 Honda Civic",
    imageUrls: ["https://cdn.example.com/one.jpg", "https://cdn.example.com/two.jpg"],
  });

  assert.deepEqual(result, { postId: "page-post-1", postUrl: "https://facebook.com/page-post-1" });
  assert.equal(calls.length, 3);
  assert.equal(calls[0]?.body.get("published"), "false");
  assert.equal(calls[2]?.body.get("message"), "2026 Honda Civic");
  assert.equal(calls[2]?.body.get("attached_media"), JSON.stringify([
    { media_fbid: "photo-1" },
    { media_fbid: "photo-2" },
  ]));
});

test("validateMetaPageConnection checks the Page and required publish permission", async () => {
  const fetchMock: typeof fetch = async (input) => {
    const url = String(input);
    if (url.includes("debug_token")) {
      return new Response(JSON.stringify({ data: { is_valid: true, scopes: ["pages_show_list", "pages_manage_posts"] } }), { status: 200 });
    }
    return new Response(JSON.stringify({ id: "page-123", name: "Alpha Motorsport" }), { status: 200 });
  };

  const result = await validateMetaPageConnection(
    { pageId: "page-123", pageAccessToken: "secret", graphApiVersion: "v23.0" },
    [],
    { META_APP_ID: "app", META_APP_SECRET: "secret" },
    fetchMock,
  );

  assert.equal(result.ok, true);
  assert.equal(result.pageName, "Alpha Motorsport");
  assert.deepEqual(result.missingPermissions, []);
  assert.equal(result.permissionSource, "debug_token");
});

test("validateMetaPageConnection reports missing publish permission", async () => {
  const fetchMock: typeof fetch = async (input) => {
    const url = String(input);
    if (url.includes("debug_token")) {
      return new Response(JSON.stringify({ data: { is_valid: true, scopes: ["pages_show_list"] } }), { status: 200 });
    }
    return new Response(JSON.stringify({ id: "page-123", name: "Alpha Motorsport" }), { status: 200 });
  };

  const result = await validateMetaPageConnection(
    { pageId: "page-123", pageAccessToken: "secret", graphApiVersion: "v23.0" },
    [],
    { META_APP_ID: "app", META_APP_SECRET: "secret" },
    fetchMock,
  );

  assert.equal(result.ok, false);
  assert.deepEqual(result.missingPermissions, ["pages_manage_posts"]);
});

test("MetaPagesPublisher rejects non-public image URLs", async () => {
  const publisher = new MetaPagesPublisher({ pageId: "page-123", pageAccessToken: "secret", graphApiVersion: "v23.0" });
  await assert.rejects(
    publisher.publishVehicle({ message: "Vehicle", imageUrls: ["http://localhost/image.jpg"] }),
    /publicly reachable HTTPS/,
  );
});
