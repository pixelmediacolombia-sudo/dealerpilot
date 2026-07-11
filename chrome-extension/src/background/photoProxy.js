(function () {
  async function fetchImageAsBase64(url) {
    console.log("[PHOTO] background received request — url:", url);

    if (!url || url.startsWith("/") || url.startsWith("./")) {
      const err = `[PHOTO] RELATIVE URL DETECTED — cannot fetch "${url}" from service worker. ` +
        "The payload endpoint must return absolute URLs (https://...). " +
        "Fix: prepend the backend base URL before returning image URLs in the payload response.";
      console.error(err);
      throw new Error(err);
    }

    let response;
    try {
      response = await fetch(url);
    } catch (fetchErr) {
      const errMsg = `[PHOTO] fetch() threw exception for "${url}": ${fetchErr && fetchErr.message ? fetchErr.message : String(fetchErr)}`;
      console.error(errMsg, fetchErr);
      throw new Error(errMsg);
    }

    const contentType = response.headers.get("content-type") || "image/jpeg";
    if (!response.ok) {
      const errMsg = `[PHOTO] Image fetch failed: HTTP ${response.status} ${response.statusText} — ${url}`;
      console.error(errMsg);
      throw new Error(errMsg);
    }

    if (!contentType.toLowerCase().startsWith("image/")) {
      const errMsg = `[PHOTO] proxy returned invalid Content-Type ${contentType} for ${url}`;
      console.error(errMsg);
      throw new Error(errMsg);
    }

    const arrayBuffer = await response.arrayBuffer();
    const uint8Array = new Uint8Array(arrayBuffer);
    let binary = "";
    const chunkSize = 32768;
    for (let i = 0; i < uint8Array.length; i += chunkSize) {
      binary += String.fromCharCode.apply(null, uint8Array.subarray(i, i + chunkSize));
    }
    return { base64: btoa(binary), type: contentType };
  }

  globalThis.DealerPilotPhotoProxy = { fetchImageAsBase64 };
})();
