const chromeStateLabels = {
  unconfigured: "Not configured",
  audit: "Audit mode",
  enabled: "Enabled",
  disabled: "Disabled",
  error: "Enforcement error",
  unsupported: "Unsupported Windows configuration",
  needsElevation: "Administrator approval required",
};

let chromeBusy = false;
let chromePolicy;

function renderChromePolicy(result) {
  chromePolicy = result;
  $("chromeStatus").textContent = chromeStateLabels[result.state];
  $("chromeDetail").textContent = result.detail || "";
  $("chromeSync").textContent = result.sync ? new Date(result.sync).toLocaleString() : "Never";
  if (result.paths) renderChromePaths(result.paths);
  if (result.config && result.managed) {
    $("chromeSample").value = result.config.sample || "";
    $("chromeInstall").checked = result.config.install;
    $("chromeExecution").checked = result.config.execution;
    $("chromePortable").checked = result.config.portable;
  }
}

function renderChromePaths(detected) {
  const paths = detected.length ? detected : ["No verified Chrome files found in the scanned locations."];
  $("chromePaths").replaceChildren(...paths.map((path) => {
    const item = document.createElement("li");
    item.textContent = path;
    return item;
  }));
}

function updateChromeButtons() {
  const active = chromePolicy?.state === "audit" || chromePolicy?.state === "enabled" || chromePolicy?.managed;
  $("chromeRefresh").disabled = chromeBusy;
  $("chromeAudit").disabled = chromeBusy || active || (!chromePolicy?.requiresElevation && !["unconfigured", "disabled"].includes(chromePolicy?.state));
  $("chromeEnable").disabled = chromeBusy || chromePolicy?.state !== "audit";
  $("chromeDisable").disabled = chromeBusy || !active;
  for (const id of ["chromeSample", "chromeInstall", "chromeExecution", "chromePortable"]) {
    $(id).disabled = chromeBusy || active;
  }
}

async function updateChromeProtection(action, options) {
  if (chromeBusy || !State.isOwnerLoggedIn) return;
  chromeBusy = true;
  updateChromeButtons();
  try {
    const result = await window.electronAPI.chromeProtection(action, options);
    if (!result.cancelled) renderChromePolicy(result);
  } catch (error) {
    $("chromeDetail").textContent = error.message;
  } finally {
    chromeBusy = false;
    updateChromeButtons();
  }
}

function refreshChromeProtection() {
  return updateChromeProtection("status");
}

function bindChromeProtection() {
  $("chromeRefresh").addEventListener("click", () => updateChromeProtection("status", { elevate: true }));
  $("chromeAudit").addEventListener("click", () => updateChromeProtection("audit", {
    sample: $("chromeSample").value.trim(),
    install: $("chromeInstall").checked,
    execution: $("chromeExecution").checked,
    portable: $("chromePortable").checked,
  }));
  $("chromeEnable").addEventListener("click", () => updateChromeProtection("enable"));
  $("chromeDisable").addEventListener("click", () => updateChromeProtection("disable"));
  updateChromeButtons();
}
