// ============================================================
// MANUAL APP UPDATES
// ============================================================
function updateAppStatus() {
  if (State.updateListenerAttached) return;
  State.updateListenerAttached = true;

  bindAppUpdateControls();

  window.electronAPI?.onAppUpdateStatus?.((data) => {
    renderAppUpdateState(data);
  });

  window.electronAPI?.onAppUpdateProgress?.((data) => {
    renderAppUpdateProgress(data);
  });

  loadAppUpdateState();
}

function bindAppUpdateControls() {
  $("appUpdateCheckBtn")?.addEventListener("click", checkAppUpdate);
  $("appUpdateBtn")?.addEventListener("click", updateAppManually);
}

async function loadAppUpdateState() {
  if (!window.electronAPI?.getAppUpdateState) return;

  try {
    const state = await window.electronAPI.getAppUpdateState();
    renderAppUpdateState(state);
  } catch (error) {
    renderAppUpdateState({
      status: "error",
      message: error.message,
    });
  }
}

async function checkAppUpdate() {
  if (!window.electronAPI?.checkAppUpdate) return;

  renderAppUpdateState({ status: "checking" });

  try {
    const state = await window.electronAPI.checkAppUpdate();
    if (state?.status && state.status !== "checked") {
      renderAppUpdateState(state);
    }
  } catch (error) {
    renderAppUpdateState({
      status: "error",
      message: error.message,
    });
  }
}

async function updateAppManually() {
  if (!window.electronAPI?.updateApp) return;

  renderAppUpdateState({ status: "downloading" });
  renderAppUpdateProgress({ percent: 0, speed: 0 });

  try {
    await window.electronAPI.updateApp();
  } catch (error) {
    renderAppUpdateState({
      status: "error",
      message: error.message,
    });
  }
}

function renderAppUpdateState(data = {}) {
  const currentEl = $("appUpdateCurrentVersion");
  const latestEl = $("appUpdateLatestVersion");
  const statusEl = $("appUpdateStatus");
  const checkBtn = $("appUpdateCheckBtn");
  const updateBtn = $("appUpdateBtn");
  const progressWrap = $("appUpdateProgressWrap");
  const progressBar = $("appUpdateProgressBar");
  const progressText = $("appUpdateProgressText");
  const speedText = $("appUpdateSpeedText");

  if (data.currentVersion && currentEl) {
    currentEl.textContent = `Current: v${data.currentVersion}`;
  }

  if (latestEl) {
    latestEl.textContent = data.latestVersion
      ? `Latest: v${data.latestVersion}`
      : "Latest: not checked";
  }

  const status = data.status || "idle";
  const busy = ["checking", "downloading", "installing"].includes(status);
  const canUpdate = status === "available" || status === "downloaded";

  if (checkBtn) {
    checkBtn.disabled = busy;
    checkBtn.textContent = status === "checking" ? "Checking..." : "Check";
  }

  if (updateBtn) {
    updateBtn.disabled = busy || !canUpdate;
    updateBtn.textContent = status === "installing" ? "Installing..." : "Update App";
  }

  if (statusEl) {
    statusEl.classList.toggle("is-error", status === "error");
    statusEl.classList.toggle("is-ready", canUpdate);
    statusEl.textContent = getAppUpdateStatusText(data);
  }

  if (progressWrap) {
    progressWrap.classList.toggle("hidden", !["downloading", "installing", "downloaded"].includes(status));
  }

  if (status !== "downloading" && progressBar && progressText && speedText) {
    progressBar.style.width = status === "downloaded" || status === "installing" ? "100%" : "0%";
    progressText.textContent = status === "downloaded" || status === "installing" ? "100%" : "0%";
    speedText.textContent = "";
  }
}

function renderAppUpdateProgress(data = {}) {
  const progressWrap = $("appUpdateProgressWrap");
  const progressBar = $("appUpdateProgressBar");
  const progressText = $("appUpdateProgressText");
  const speedText = $("appUpdateSpeedText");

  const percent = Math.max(0, Math.min(100, Number(data.percent || 0)));

  progressWrap?.classList.remove("hidden");
  if (progressBar) progressBar.style.width = `${percent}%`;
  if (progressText) progressText.textContent = `${percent.toFixed(1)}%`;
  if (speedText) speedText.textContent = formatBytesPerSecond(data.speed || 0);
}

function getAppUpdateStatusText(data = {}) {
  switch (data.status) {
    case "checking":
      return "Checking GitHub for a new release...";
    case "available":
      return "Update available. Click Update App to download and install it.";
    case "none":
      return data.message || "App is up to date.";
    case "downloading":
      return "Downloading update...";
    case "downloaded":
      return data.message || "Update downloaded. Click Update App to install.";
    case "installing":
      return "Installing update...";
    case "error":
      return data.message ? `Update failed: ${data.message}` : "Update failed.";
    default:
      return "Click Check to look for a launcher update.";
  }
}

function formatBytesPerSecond(bytesPerSecond) {
  const value = Number(bytesPerSecond || 0);
  if (value <= 0) return "";
  if (value >= 1024 * 1024) return `${(value / 1024 / 1024).toFixed(1)} MB/s`;
  return `${Math.round(value / 1024)} KB/s`;
}
