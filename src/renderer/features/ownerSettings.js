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
let websiteRules = [];
let websiteEditing = { allow: null, block: null };
let pendingWebsiteImportId = null;

function bindOwnerSettings() {
  $("savePcSpecButton")?.addEventListener("click", savePcSpecFromSettings);
  $("clearPcSpecButton")?.addEventListener("click", clearPcSpecForm);
  $("saveServerUrlButton")?.addEventListener("click", saveServerUrlFromSettings);
  $("deleteServerUrlButton")?.addEventListener("click", deleteServerUrlFromSettings);
  $("openLogsButton")?.addEventListener("click", async () => {
    try { await window.electronAPI.openLogsFolder(); } catch { showToast("Could not open the logs folder", "error"); }
  });
  $("exportDiagnosticsButton")?.addEventListener("click", exportDiagnostics);
  bindWebsiteAccessControls();

  $("ownerSettingsModal")?.addEventListener("click", (e) => {
    if (e.target === e.currentTarget) closeOwnerSettings();
  });
}

function normalizeServerUrlInput(value) {
  const rawValue = String(value || "").trim();
  if (!rawValue) throw new Error("Server URL is required");

  let parsed;
  try {
    parsed = new URL(rawValue);
  } catch {
    throw new Error("Enter a valid server URL");
  }

  if (!["http:", "https:"].includes(parsed.protocol)) {
    throw new Error("Server URL must start with http:// or https://");
  }

  if (!parsed.hostname) {
    throw new Error("Server URL must include a hostname");
  }

  parsed.hash = "";
  parsed.search = "";
  return parsed.toString().replace(/\/$/, "");
}

async function loadServerUrlSetting() {
  const input = $("serverUrlInput");
  const status = $("serverUrlStatus");

  try {
    const serverUrl = window.electronAPI?.getServerUrl
      ? await window.electronAPI.getServerUrl()
      : "";

    if (input) input.value = serverUrl || "";
    if (status) status.textContent = serverUrl ? `Current server: ${serverUrl}` : "No server URL saved.";
    return serverUrl;
  } catch (error) {
    console.error("Failed to load server URL:", error);
    if (status) status.textContent = "Failed to load server URL.";
    return "";
  }
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

  await loadServerUrlSetting();
  await loadPcSpecsDisplay();
  $("ownerSettingsModal")?.classList.add("active");
  await loadWebsiteAccessSettings();
  loadDiagnostics();
}

function bindWebsiteAccessControls() {
  ["allow", "block"].forEach((action) => {
    $(`website${action === "allow" ? "Allow" : "Block"}RuleForm`)?.addEventListener("submit", (event) => {
      event.preventDefault();
      saveWebsiteRuleFromForm(action);
    });
    $(`website${action === "allow" ? "Allow" : "Block"}Search`)?.addEventListener("input", () => renderWebsiteRuleList(action));
    $(`website${action === "allow" ? "Allow" : "Block"}List`)?.addEventListener("click", (event) => handleWebsiteRuleAction(event, action));
    document.querySelector(`[data-cancel-edit="${action}"]`)?.addEventListener("click", () => resetWebsiteRuleForm(action));
  });
  $("saveWebsiteAccessSettings")?.addEventListener("click", saveWebsiteSettingsFromForm);
  $("previewWebsiteImport")?.addEventListener("click", previewWebsiteImport);
  $("exportWebsiteRules")?.addEventListener("click", exportWebsiteRules);
  $("websiteImportPreview")?.addEventListener("click", async (event) => {
    if (event.target?.id !== "applyWebsiteImport") return;
    await applyWebsiteImport();
  });
}

async function loadWebsiteAccessSettings() {
  const status = $("websiteAccessStatus");
  const feedback = $("websiteSettingsFeedback");
  if (!status) return;
  status.textContent = "Loading protection status…";
  try {
    const [accessStatus, settings, rules, logs] = await Promise.all([
      window.electronAPI.getWebsiteAccessStatus(),
      window.electronAPI.getWebsiteAccessSettings(),
      window.electronAPI.listWebsiteRules({}),
      window.electronAPI.listWebsiteAccessLogs({ limit: 20 }),
    ]);
    renderWebsiteAccessStatus(accessStatus);
    websiteRules = rules;
    renderWebsiteRuleList("allow");
    renderWebsiteRuleList("block");
    $("websiteProtectionEnabled").checked = settings.enabled;
    $("websiteProtectionMode").value = "monitoring";
    $("websiteDefaultAction").value = settings.defaultAction;
    $("websiteLogRetentionDays").value = String(settings.logRetentionDays);
    renderWebsiteLogs(logs);
    if (feedback) feedback.textContent = "";
  } catch (error) {
    status.textContent = error?.message || "Website Access Control status is unavailable.";
    if (feedback) feedback.textContent = "Could not load stored website settings.";
  }
}

function renderWebsiteAccessStatus(data) {
  const target = $("websiteAccessStatus");
  if (!target) return;
  target.replaceChildren();
  const values = [
    ["Configured", data.protectionEnabled ? "Enabled (stored only)" : "Disabled"],
    ["Service", "Not installed"],
    ["Mode", "Monitoring (stored only)"],
    ["Policy revision", String(data.policyRevision)],
    ["Last synchronization", "Not synchronized"],
    ["Recovery", "Not applicable; enforcement is unavailable"],
  ];
  values.forEach(([label, value]) => {
    const item = document.createElement("div");
    const title = document.createElement("strong");
    const content = document.createElement("span");
    title.textContent = label;
    content.textContent = value;
    item.append(title, content);
    target.append(item);
  });
}

function renderWebsiteRuleList(action) {
  const cap = action === "allow" ? "Allow" : "Block";
  const target = $(`website${cap}List`);
  const count = $(`website${cap}Count`);
  if (!target) return;
  const search = ($(`website${cap}Search`)?.value || "").trim().toLowerCase();
  const rules = websiteRules.filter((rule) => rule.action === action && rule.domain.includes(search));
  target.replaceChildren();
  if (count) count.textContent = `${rules.length} rule${rules.length === 1 ? "" : "s"}`;
  if (!rules.length) {
    const empty = document.createElement("div");
    empty.className = "website-access-empty";
    empty.textContent = search ? "No rules match this search." : `No ${action === "allow" ? "whitelist" : "blocklist"} rules yet.`;
    target.append(empty);
    return;
  }
  rules.forEach((rule) => {
    const row = document.createElement("div");
    row.className = "website-rule-row";
    row.setAttribute("role", "listitem");
    const details = document.createElement("div");
    details.className = "website-rule-details";
    const domain = document.createElement("strong");
    domain.textContent = rule.domain;
    const meta = document.createElement("span");
    meta.textContent = `${rule.enabled ? "Enabled" : "Disabled"}${rule.includeSubdomains ? " · Includes subdomains" : " · Exact domain only"}`;
    details.append(domain, meta);
    const actions = document.createElement("div");
    actions.className = "website-rule-actions";
    actions.append(
      createWebsiteRuleButton("Edit", "edit", rule.id),
      createWebsiteRuleButton(rule.enabled ? "Disable" : "Enable", "toggle", rule.id),
      createWebsiteRuleButton("Remove", "remove", rule.id, true),
    );
    row.append(details, actions);
    target.append(row);
  });
}

function createWebsiteRuleButton(label, action, id, danger = false) {
  const button = document.createElement("button");
  button.type = "button";
  button.className = danger ? "btn btn-danger website-rule-action" : "btn website-rule-action";
  button.dataset.ruleAction = action;
  button.dataset.ruleId = String(id);
  button.textContent = label;
  return button;
}

async function handleWebsiteRuleAction(event, listAction) {
  const button = event.target.closest("button[data-rule-action]");
  if (!button) return;
  const id = Number(button.dataset.ruleId);
  const rule = websiteRules.find((item) => item.id === id);
  if (!rule || rule.action !== listAction) return;
  try {
    if (button.dataset.ruleAction === "edit") {
      websiteEditing[listAction] = id;
      const cap = listAction === "allow" ? "Allow" : "Block";
      $(`website${cap}Domain`).value = rule.domain;
      $(`website${cap}Subdomains`).checked = rule.includeSubdomains;
      $(`website${cap}Submit`).textContent = `Save ${listAction === "allow" ? "whitelist" : "blocklist"} rule`;
      document.querySelector(`[data-cancel-edit="${listAction}"]`).hidden = false;
      $(`website${cap}Domain`).focus();
      return;
    }
    if (button.dataset.ruleAction === "toggle") {
      await window.electronAPI.setWebsiteRuleEnabled({ id, enabled: !rule.enabled });
    } else if (button.dataset.ruleAction === "remove") {
      if (!window.confirm(`Remove ${rule.domain} from the ${listAction === "allow" ? "whitelist" : "blocklist"}?`)) return;
      await window.electronAPI.removeWebsiteRule({ id });
      if (websiteEditing[listAction] === id) resetWebsiteRuleForm(listAction);
    }
    await refreshWebsiteRules();
  } catch (error) {
    showToast(error?.message || "Could not update website rule", "error");
  }
}

async function saveWebsiteRuleFromForm(action) {
  const cap = action === "allow" ? "Allow" : "Block";
  const input = $(`website${cap}Domain`);
  const feedback = $("websiteSettingsFeedback");
  try {
    const rule = {
      ...(websiteEditing[action] ? { id: websiteEditing[action] } : {}),
      domain: input.value,
      action,
      enabled: true,
      includeSubdomains: $(`website${cap}Subdomains`).checked,
    };
    const saved = await window.electronAPI.saveWebsiteRule(rule);
    resetWebsiteRuleForm(action);
    await refreshWebsiteRules();
    if (feedback) feedback.textContent = `Domain saved as ${saved.domain}.`;
  } catch (error) {
    if (feedback) feedback.textContent = error?.message || "Could not save this domain. Check its format and duplicates.";
    input.focus();
  }
}

function resetWebsiteRuleForm(action) {
  const cap = action === "allow" ? "Allow" : "Block";
  $(`website${cap}RuleForm`).reset();
  websiteEditing[action] = null;
  $(`website${cap}Submit`).textContent = `Add to ${action === "allow" ? "whitelist" : "blocklist"}`;
  document.querySelector(`[data-cancel-edit="${action}"]`).hidden = true;
}

async function refreshWebsiteRules() {
  websiteRules = await window.electronAPI.listWebsiteRules({});
  renderWebsiteRuleList("allow");
  renderWebsiteRuleList("block");
  renderWebsiteAccessStatus(await window.electronAPI.getWebsiteAccessStatus());
}

async function saveWebsiteSettingsFromForm() {
  const feedback = $("websiteSettingsFeedback");
  try {
    const settings = await window.electronAPI.saveWebsiteAccessSettings({
      enabled: $("websiteProtectionEnabled").checked,
      mode: "monitoring",
      defaultAction: $("websiteDefaultAction").value,
      logRetentionDays: Number($("websiteLogRetentionDays").value),
    });
    if (feedback) feedback.textContent = `Stored settings saved. Policy revision ${settings.policyRevision}. These settings do not change network traffic.`;
    renderWebsiteAccessStatus(await window.electronAPI.getWebsiteAccessStatus());
  } catch (error) {
    if (feedback) feedback.textContent = error?.message || "Could not save website settings.";
  }
}

function renderWebsiteLogs(result) {
  const target = $("websiteAccessLogs");
  if (!target) return;
  target.textContent = result?.available
    ? "No activity has been recorded."
    : "Activity logs are unavailable until a real DNS service is implemented. No DNS queries or visits have been recorded.";
}

async function previewWebsiteImport() {
  const previewTarget = $("websiteImportPreview");
  const feedback = $("websiteImportFeedback");
  pendingWebsiteImportId = null;
  previewTarget.replaceChildren();
  feedback.textContent = "Choose a versioned JSON file to validate.";
  try {
    const result = await window.electronAPI.previewWebsiteAccessImport();
    if (result.canceled) { feedback.textContent = "Import canceled."; return; }
    pendingWebsiteImportId = result.previewId;
    const summary = document.createElement("p");
    summary.textContent = `Preview: ${result.counts.add} add, ${result.counts.update} update, ${result.counts.skip} skip, ${result.counts.error} error.`;
    previewTarget.append(summary);
    result.entries.slice(0, 100).forEach((entry) => {
      const line = document.createElement("div");
      line.textContent = `${entry.domain || `Rule ${entry.index}`}: ${entry.disposition || "error"}${entry.reason ? ` — ${entry.reason}` : ""}`;
      previewTarget.append(line);
    });
    result.errors.slice(0, 100).forEach((item) => {
      const line = document.createElement("div");
      line.textContent = `Rule ${item.index}: ${item.error}`;
      previewTarget.append(line);
    });
    if (result.hasSettings) {
      const settingLine = document.createElement("div");
      settingLine.textContent = "This file also contains stored protection and log-retention settings.";
      previewTarget.append(settingLine);
    }
    if (result.counts.add + result.counts.update > 0 || result.errors.length || result.hasSettings) {
      const apply = document.createElement("button");
      apply.type = "button";
      apply.id = "applyWebsiteImport";
      apply.className = "btn btn-play";
      apply.textContent = "Confirm and apply valid rules";
      previewTarget.append(apply);
    }
    feedback.textContent = "Review this preview. Nothing has been saved yet.";
  } catch (error) {
    feedback.textContent = error?.message || "Import validation failed.";
  }
}

async function applyWebsiteImport() {
  if (!pendingWebsiteImportId) return;
  const feedback = $("websiteImportFeedback");
  if (!window.confirm("Apply the valid rules shown in this import preview? This will update the stored rules and settings only.")) return;
  try {
    const result = await window.electronAPI.applyWebsiteAccessImport(pendingWebsiteImportId);
    pendingWebsiteImportId = null;
    $("websiteImportPreview").replaceChildren();
    feedback.textContent = `${result.imported} rules imported. Network traffic was not changed.`;
    await loadWebsiteAccessSettings();
  } catch (error) {
    feedback.textContent = error?.message || "Import could not be applied. Review the file and try again.";
  }
}

async function exportWebsiteRules() {
  const feedback = $("websiteImportFeedback");
  try {
    const result = await window.electronAPI.exportWebsiteAccessConfig();
    feedback.textContent = result.canceled ? "Export canceled." : "Normalized rules exported.";
  } catch (error) {
    feedback.textContent = error?.message || "Export failed.";
  }
}

async function loadDiagnostics() {
  const panel = $("diagnosticsHealth");
  const errors = $("diagnosticsErrors");
  if (!panel || !window.electronAPI?.getDiagnostics) return;
  panel.textContent = "Loading diagnostics…";
  try {
    const info = await window.electronAPI.getDiagnostics();
    const rows = [
      ["Application", `Healthy · v${info.app.version}`],
      ["Game tracking", `${info.services.gameTracking} · ${info.services.runningGameCount ?? 0} active`],
      ["Admin server", info.services.adminSocket],
      ["Automatic updates", info.services.updateService],
      ["Database", info.storage.databaseAvailable ? "Available" : "Unavailable"],
      ["Data directory", info.storage.userDataAvailable ? "Available" : "Unavailable"],
      ["Disk space", info.system.diskAvailableBytes == null ? "Unavailable" : `${(info.system.diskAvailableBytes / 1024 ** 3).toFixed(1)} GB available`],
      ["Runtime", `Electron ${info.runtime.electron} · Node ${info.runtime.node}`],
      ["Other modules", "Spotify, scheduling, announcements and backups are not part of this app"],
    ];
    panel.innerHTML = rows.map(([label, value]) => `<div><strong>${escapeHtml(label)}</strong><span>${escapeHtml(value)}</span></div>`).join("");
    const recent = info.recentErrors || [];
    errors.innerHTML = recent.length ? `<strong>Recent errors</strong>${recent.slice(0, 10).map((entry) => `<div>${escapeHtml(entry.timestamp)} · ${escapeHtml(entry.component)}: ${escapeHtml(entry.message)}</div>`).join("")}` : "No recent errors recorded.";
  } catch {
    panel.textContent = "Diagnostics are unavailable.";
  }
}

async function exportDiagnostics() {
  const button = $("exportDiagnosticsButton");
  const status = $("diagnosticsStatus");
  if (!button) return;
  button.disabled = true;
  if (status) status.textContent = "Preparing diagnostic report…";
  try {
    const result = await window.electronAPI.exportDiagnostics();
    if (status) status.textContent = result.canceled ? "Export canceled." : "Diagnostic report exported successfully.";
    if (!result.canceled) showToast("Diagnostics exported", "success");
  } catch {
    if (status) status.textContent = "Diagnostic export failed. Check available storage and try again.";
    showToast("Diagnostic export failed", "error");
  } finally { button.disabled = false; }
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

async function saveServerUrlFromSettings() {
  if (!State.isOwnerLoggedIn) {
    showToast("Owner login required", "error");
    closeOwnerSettings();
    return;
  }

  let serverUrl;
  try {
    serverUrl = normalizeServerUrlInput($("serverUrlInput")?.value || "");
  } catch (error) {
    showToast(error.message, "info");
    $("serverUrlInput")?.focus();
    return;
  }

  try {
    if (!window.electronAPI?.saveServerUrl) {
      throw new Error("Server URL API is unavailable");
    }

    const savedServerUrl = await window.electronAPI.saveServerUrl(serverUrl);
    if ($("serverUrlInput")) $("serverUrlInput").value = savedServerUrl;
    if ($("serverUrlStatus")) $("serverUrlStatus").textContent = `Current server: ${savedServerUrl}`;
    showToast("Server URL saved", "success");
  } catch (error) {
    console.error("Failed to save server URL:", error);
    showToast(error.message || "Failed to save server URL", "error");
  }
}

async function deleteServerUrlFromSettings() {
  if (!State.isOwnerLoggedIn) {
    showToast("Owner login required", "error");
    closeOwnerSettings();
    return;
  }

  try {
    if (!window.electronAPI?.deleteServerUrl) {
      throw new Error("Server URL API is unavailable");
    }

    await window.electronAPI.deleteServerUrl();
    if ($("serverUrlInput")) $("serverUrlInput").value = "";
    if ($("serverUrlStatus")) $("serverUrlStatus").textContent = "No server URL saved.";
    showToast("Server URL deleted", "success");
  } catch (error) {
    console.error("Failed to delete server URL:", error);
    showToast("Failed to delete server URL", "error");
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
