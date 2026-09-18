import assert from "node:assert/strict";
import { test, mock } from "node:test";
import { fetchFeedXml } from "./feedSource.ts";

const xmlResponse = (body = "<inventory />", status = 200, headers = { "content-type": "application/xml" }) => ({
  ok: status >= 200 && status < 300,
  status,
  statusText: status === 200 ? "OK" : "Unauthorized",
  headers: { get: (name) => headers[name.toLowerCase()] ?? null },
  text: async () => body,
});

test("feed fetch sends runtime headers without putting them in error text", async () => {
  let request;
  const fetchMock = mock.method(globalThis, "fetch", async (url, init) => {
    request = { url, init };
    return xmlResponse();
  });

  const body = await fetchFeedXml("https://inventory.example.test/feed.xml", {
    headers: { "x-api-key": "runtime-only-test-value" },
  });

  assert.equal(body, "<inventory />");
  assert.equal(request.init.headers["x-api-key"], "runtime-only-test-value");
  assert.equal(request.init.redirect, "error");
  fetchMock.mock.restore();
});

test("feed fetch rejects non-XML responses and does not echo auth headers", async () => {
  const fetchMock = mock.method(globalThis, "fetch", async () =>
    xmlResponse("unauthorized", 401, { "content-type": "text/plain" }),
  );

  await assert.rejects(
    fetchFeedXml("https://inventory.example.test/feed.xml", {
      headers: { "x-api-key": "runtime-only-test-value" },
    }),
    (error) => {
      assert.equal(error.message, "Feed request failed: 401 Unauthorized");
      assert.doesNotMatch(error.message, /runtime-only-test-value/);
      return true;
    },
  );
  fetchMock.mock.restore();
});

test("feed fetch denies SSRF targets before calling fetch", async () => {
  const fetchMock = mock.method(globalThis, "fetch", async () => xmlResponse());
  await assert.rejects(fetchFeedXml("http://127.0.0.1/private.xml"), /host is not allowed/);
  assert.equal(fetchMock.mock.callCount(), 0);
  fetchMock.mock.restore();
});

test("feed fetch rejects redirects and empty bodies", async () => {
  const redirectMock = mock.method(globalThis, "fetch", async () =>
    xmlResponse("", 200, { "content-type": "application/xml" }),
  );
  await assert.rejects(fetchFeedXml("https://inventory.example.test/feed.xml"), /Feed response was empty/);
  redirectMock.mock.restore();

  const nonXmlMock = mock.method(globalThis, "fetch", async () =>
    xmlResponse("<html />", 200, { "content-type": "text/html" }),
  );
  await assert.rejects(fetchFeedXml("https://inventory.example.test/feed.xml"), /not XML/);
  nonXmlMock.mock.restore();
});

test("feed fetch aborts on timeout", async () => {
  const timeoutMock = mock.method(globalThis, "fetch", async (_url, init) =>
    new Promise((_, reject) => {
      init.signal.addEventListener("abort", () => reject(new Error("aborted")), { once: true });
    }),
  );
  await assert.rejects(
    fetchFeedXml("https://inventory.example.test/feed.xml", { timeoutMs: 5 }),
    /Feed request timed out/,
  );
  timeoutMock.mock.restore();
});
