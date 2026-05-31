const PC_SPEC_FIELD_IDS = {
  pcIp: "pcIp",
  pcName: "pcNameInput",
  windowsVersion: "pcWindowsVersion",
  ram: "pcRam",
  ramUsage: "pcRamUsage",
  cpu: "pcCpu",
  gpu: "pcGpu",
  vram: "pcVram",
  networkSpeed: "pcNetworkSpeed",
  storage: "pcStorage",
  motherboard: "pcMotherboard",
  monitor: "pcMonitor",
  notes: "pcNotes",
};

let cachedPcSpecs = [];

function bindOwnerSettings() {
  $("savePcSpecButton")?.addEventListener("click", savePcSpecFromSettings);
  $("clearPcSpecButton")?.addEventListener("click", clearPcSpecForm);

  $("ownerSettingsModal")?.addEventListener("click", (e) => {
    if (e.target === e.currentTarget) closeOwnerSettings();
  });
}

async function loadOwnerSettingsDisplay() {
  try {
    const gcashNumber = window.electronAPI?.getGcashNumber
      ? await window.electronAPI.getGcashNumber()
      : "";

    renderGcashNumber(gcashNumber);
    return gcashNumber;
  } catch (error) {
    console.error("Failed to load GCash number:", error);
    renderGcashNumber("");
    return "";
  }
}

function renderGcashNumber(gcashNumber) {
  const panel = $("sidebarGcash");
  const numberEl = $("sidebarGcashNumber");
  if (!panel || !numberEl) return;

  const value = String(gcashNumber || "").trim();
  numberEl.textContent = value;
  panel.style.display = value ? "flex" : "none";
}

async function loadPcSpecsDisplay() {
  try {
    if (!window.electronAPI?.getPcSpecs) {
      throw new Error("PC specs API is unavailable");
    }

    cachedPcSpecs = await window.electronAPI.getPcSpecs();
    renderPcInfoPage(cachedPcSpecs);
    renderPcSpecList(cachedPcSpecs);
    return cachedPcSpecs;
  } catch (error) {
    console.error("Failed to load PC specs:", error);
    cachedPcSpecs = [];
    renderPcInfoPage([]);
    renderPcSpecList([]);
    return [];
  }
}

function renderPcInfoPage(pcSpecs) {
  const container = $("pcInfoList");
  if (!container) return;

  if (!pcSpecs.length) {
    container.innerHTML = '<div class="pc-info-empty">No PC information configured.</div>';
    return;
  }

  container.innerHTML = pcSpecs.map(renderPcInfoCard).join("");
}

function renderPcInfoCard(pc) {
  const pcName = escapeHtml(pc.pcName || pc.pcIp || "Unnamed PC");
  const windowsVersion = escapeHtml(pc.windowsVersion || "Windows version not set");
  const ramExtra = pc.ramUsage ? `(Used: ${pc.ramUsage})` : "";
  const vramExtra = pc.vram ? `(VRAM: ${pc.vram})` : "";
  const networkSpeed = pc.networkSpeed || "Not set";
  const details = [
    pc.storage ? `Storage: ${pc.storage}` : "",
    pc.motherboard ? `Motherboard: ${pc.motherboard}` : "",
    pc.monitor ? `Monitor: ${pc.monitor}` : "",
    pc.notes || "",
  ].filter(Boolean);

  return `
    <div class="pc-info-card" data-pc-ip="${escapeHtml(pc.pcIp)}">
      <div class="page-pcname">
        <div>${pcName}</div>
        <div class="page-windows">${windowsVersion}</div>
        <div class="page-pc-ip">${escapeHtml(pc.pcIp)}</div>
      </div>
      <div class="pc-specs">
        ${renderSpecItem("assets/icons/hard-drive.svg", "RAM", pc.ram || "Not set", ramExtra)}
        ${renderSpecItem("assets/icons/cpu.svg", "CPU", pc.cpu || "Not set", "")}
        ${renderSpecItem("assets/icons/image.svg", "GPU", pc.gpu || "Not set", vramExtra)}
        ${renderSpecItem("assets/icons/wifi.svg", "Network", networkSpeed, "")}
        ${details.length ? renderSpecItem("assets/icons/database.svg", "Details", details.join(" | "), "") : ""}
      </div>
    </div>
  `;
}

function renderSpecItem(icon, label, value, extra) {
  return `
    <div class="spec-item">
      <div class="spec-label">
        <img src="${icon}" alt="">
        <span>${label}: <span class="spec-value">${escapeHtml(value)}</span></span>
      </div>
      <span class="spec-extra">${extra ? escapeHtml(extra) : ""}</span>
    </div>
  `;
}

function renderPcSpecList(pcSpecs) {
  const list = $("pcSpecList");
  if (!list) return;

  if (!pcSpecs.length) {
    list.innerHTML = '<div class="pc-spec-list-empty">No saved PCs yet.</div>';
    return;
  }

  list.innerHTML = pcSpecs
    .map(
      (pc) => `
        <div class="pc-spec-row">
          <div class="pc-spec-row-main">
            <div class="pc-spec-row-title">${escapeHtml(pc.pcName || pc.pcIp)}</div>
            <div class="pc-spec-row-meta">${escapeHtml(pc.pcIp)}${pc.windowsVersion ? ` | ${escapeHtml(pc.windowsVersion)}` : ""}</div>
          </div>
          <div class="pc-spec-row-actions">
            <button class="btn pc-row-btn" type="button" onclick="editPcSpec('${escapeJsArg(pc.pcIp)}')">Edit</button>
            <button class="btn btn-danger pc-row-btn" type="button" onclick="deletePcSpecFromSettings('${escapeJsArg(pc.pcIp)}')">Delete</button>
          </div>
        </div>
      `,
    )
    .join("");
}

async function openOwnerSettings() {
  if (!State.isOwnerLoggedIn) {
    showToast("Owner login required", "error");
    return;
  }

  await loadPcSpecsDisplay();
  $("ownerSettingsModal")?.classList.add("active");
}

function closeOwnerSettings() {
  $("ownerSettingsModal")?.classList.remove("active");
}

function getPcSpecFormData() {
  return Object.fromEntries(
    Object.entries(PC_SPEC_FIELD_IDS).map(([field, id]) => [
      field,
      $(id)?.value.trim() || "",
    ]),
  );
}

function setPcSpecFormData(pcSpec = {}) {
  Object.entries(PC_SPEC_FIELD_IDS).forEach(([field, id]) => {
    const input = $(id);
    if (input) input.value = pcSpec[field] || "";
  });
  const originalIp = $("pcOriginalIp");
  if (originalIp) originalIp.value = pcSpec.pcIp || "";
}

function clearPcSpecForm() {
  setPcSpecFormData({});
  $("pcIp")?.focus();
}

function editPcSpec(pcIp) {
  const pcSpec = cachedPcSpecs.find((pc) => pc.pcIp === pcIp);
  if (!pcSpec) return;

  setPcSpecFormData(pcSpec);
  $("pcNameInput")?.focus();
}

async function savePcSpecFromSettings() {
  if (!State.isOwnerLoggedIn) {
    showToast("Owner login required", "error");
    closeOwnerSettings();
    return;
  }

  const pcSpec = getPcSpecFormData();
  const originalPcIp = $("pcOriginalIp")?.value.trim() || "";

  if (!pcSpec.pcIp) {
    showToast("PC IP is required", "info");
    $("pcIp")?.focus();
    return;
  }

  try {
    if (!window.electronAPI?.savePcSpec) {
      throw new Error("PC specs API is unavailable");
    }

    await window.electronAPI.savePcSpec(pcSpec, originalPcIp);
    clearPcSpecForm();
    await loadPcSpecsDisplay();
    showToast("PC information saved", "success");
  } catch (error) {
    console.error("Failed to save PC specs:", error);
    showToast("Failed to save PC information", "error");
  }
}

async function deletePcSpecFromSettings(pcIp) {
  if (!pcIp) return;

  try {
    if (!window.electronAPI?.deletePcSpec) {
      throw new Error("PC specs API is unavailable");
    }

    await window.electronAPI.deletePcSpec(pcIp);
    if ($("pcOriginalIp")?.value === pcIp) clearPcSpecForm();
    await loadPcSpecsDisplay();
    showToast("PC information deleted", "success");
  } catch (error) {
    console.error("Failed to delete PC specs:", error);
    showToast("Failed to delete PC information", "error");
  }
}

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function escapeJsArg(value) {
  return String(value ?? "").replace(/\\/g, "\\\\").replace(/'/g, "\\'");
}
