import assert from "node:assert/strict";
import { test } from "node:test";
import {
  checkLuckiPhotoSetDownloadable,
  clearLuckiPhotoProbeCache,
} from "./luckiPhotoReadiness.ts";

function images(count = 10) {
  return Array.from({ length: count }, (_, index) => ({
    url: `https://cdn.example.test/vehicle/photo-${index + 1}.jpg`,
  }));
}

function imageResponse() {
  return new Response(new Uint8Array([1, 2, 3]), {
    status: 200,
    headers: { "content-type": "image/jpeg" },
  });
}

test("Lucki photo preflight accepts a complete downloadable set", async () => {
  clearLuckiPhotoProbeCache();
  const result = await checkLuckiPhotoSetDownloadable(images(), {
    fetcher: async () => imageResponse(),
  });

  assert.equal(result.ready, true);
  assert.equal(result.totalPhotos, 10);
  assert.equal(result.downloadablePhotos, 10);
  assert.deepEqual(result.failedUrls, []);
});

test("Lucki photo preflight rejects a set with one unavailable photo", async () => {
  clearLuckiPhotoProbeCache();
  const result = await checkLuckiPhotoSetDownloadable(images(), {
    fetcher: async (url) => url.endsWith("photo-10.jpg")
      ? new Response(null, { status: 404 })
      : imageResponse(),
  });

  assert.equal(result.ready, false);
  assert.equal(result.downloadablePhotos, 9);
  assert.match(result.reason ?? "", /9 of 10/);
  assert.deepEqual(result.failedUrls, ["https://cdn.example.test/vehicle/photo-10.jpg"]);
});

test("Lucki photo preflight rejects fewer than ten source photos before probing", async () => {
  clearLuckiPhotoProbeCache();
  let calls = 0;
  const result = await checkLuckiPhotoSetDownloadable(images(9), {
    fetcher: async () => {
      calls++;
      return imageResponse();
    },
  });

  assert.equal(result.ready, false);
  assert.equal(result.downloadablePhotos, 0);
  assert.equal(calls, 0);
  assert.match(result.reason ?? "", /at least 10/);
});

test("Lucki photo preflight rejects non-image responses", async () => {
  clearLuckiPhotoProbeCache();
  const result = await checkLuckiPhotoSetDownloadable(images(), {
    fetcher: async (url) => url.endsWith("photo-1.jpg")
      ? new Response("not an image", { status: 200, headers: { "content-type": "text/html" } })
      : imageResponse(),
  });

  assert.equal(result.ready, false);
  assert.equal(result.downloadablePhotos, 9);
  assert.match(result.reason ?? "", /9 of 10/);
});
