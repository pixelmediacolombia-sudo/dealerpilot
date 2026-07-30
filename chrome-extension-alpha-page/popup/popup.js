(function () {
  const backendInput = document.getElementById("backendUrl");
  const saveBackendButton = document.getElementById("saveBackend");
  const loadVehiclesButton = document.getElementById("loadVehicles");
  const prepareDraftButton = document.getElementById("prepareDraft");
  const searchInput = document.getElementById("search");
  const vehicleSelect = document.getElementById("vehicleSelect");
  const status = document.getElementById("status");

  function setStatus(message, tone = "") {
    status.textContent = message;
    status.className = tone;
  }

  function optionLabel(vehicle) {
    const price = vehicle.price ? `$${Number(vehicle.price).toLocaleString("en-US")}` : "no price";
    const stock = vehicle.stockNumber ? ` | ${vehicle.stockNumber}` : "";
    return `#${vehicle.id} ${vehicle.label} | ${price}${stock}`;
  }

  async function loadVehicles() {
    loadVehiclesButton.disabled = true;
    try {
      const query = encodeURIComponent(searchInput.value.trim());
      const data = await globalThis.DealerPilotAlphaApiClient.apiGet(
        `/api/alpha-page-publisher/vehicles?limit=30&search=${query}`,
      );
      vehicleSelect.innerHTML = "";
      for (const vehicle of data.vehicles || []) {
        const option = document.createElement("option");
        option.value = String(vehicle.id);
        option.textContent = optionLabel(vehicle);
        vehicleSelect.appendChild(option);
      }
      setStatus(`${data.vehicles?.length || 0} vehicles loaded for ${data.target.pageName}.`, "ok");
    } catch (error) {
      setStatus(error.message || String(error), "err");
    } finally {
      loadVehiclesButton.disabled = false;
    }
  }

  async function prepareDraft() {
    const vehicleId = Number(vehicleSelect.value);
    if (!Number.isInteger(vehicleId) || vehicleId <= 0) {
      setStatus("Choose a vehicle first.", "err");
      return;
    }

    prepareDraftButton.disabled = true;
    try {
      const backendUrl = await globalThis.DealerPilotAlphaApiClient.getBackendUrl();
      const payload = await globalThis.DealerPilotAlphaApiClient.apiGet(
        `/api/alpha-page-publisher/vehicles/${vehicleId}/payload`,
      );
      if (payload.readiness?.ready === false) {
        setStatus(`Vehicle is not ready: ${payload.readiness.missing.join(", ")}`, "err");
        return;
      }

      await chrome.storage.local.set({
        pendingAlphaPagePost: {
          payload,
          backendUrl,
          autoFill: true,
          preparedAt: new Date().toISOString(),
        },
      });

      const response = await chrome.runtime.sendMessage({
        type: "OPEN_ALPHA_COMPOSER",
        composerUrl: payload.target.composerUrl,
      });
      if (!response?.ok) throw new Error(response?.error || "Could not open Business Suite composer");
      setStatus("Business Suite composer opened. Draft fill will start there.", "ok");
    } catch (error) {
      setStatus(error.message || String(error), "err");
    } finally {
      prepareDraftButton.disabled = false;
    }
  }

  async function init() {
    backendInput.value = await globalThis.DealerPilotAlphaApiClient.getBackendUrl();
    await loadVehicles();
  }

  saveBackendButton.addEventListener("click", async () => {
    try {
      const url = await globalThis.DealerPilotAlphaApiClient.setBackendUrl(backendInput.value);
      backendInput.value = url;
      setStatus("Backend saved.", "ok");
    } catch (error) {
      setStatus(error.message || String(error), "err");
    }
  });
  loadVehiclesButton.addEventListener("click", loadVehicles);
  prepareDraftButton.addEventListener("click", prepareDraft);
  searchInput.addEventListener("keydown", (event) => {
    if (event.key === "Enter") loadVehicles();
  });

  init().catch((error) => setStatus(error.message || String(error), "err"));
})();
