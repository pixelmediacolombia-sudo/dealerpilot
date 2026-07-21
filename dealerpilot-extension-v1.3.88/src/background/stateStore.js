(function () {
  async function get(keys) {
    return chrome.storage.local.get(keys);
  }

  async function set(values) {
    return chrome.storage.local.set(values);
  }

  async function remove(keys) {
    return chrome.storage.local.remove(keys);
  }

  globalThis.DealerPilotStateStore = { get, remove, set };
})();
