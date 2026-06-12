// ============================================================
// INITIALIZATION
// ============================================================
document.addEventListener("DOMContentLoaded", () => {
  initSystemIdleState();
  loadAppVersion();
  bindWindowControls();
  bindCrudControls();
  bindOwnerSettings();
  initSidebarClock();
  loadOwnerSettingsDisplay();
  loadPcSpecsDisplay();
  loadGames();
  loadMaps();
  listRoom();

  // Check for updates
  setTimeout(updateAppStatus, 0);
  setTimeout(checkForUpdates, 2000);
  setInterval(checkForUpdates, 24 * 60 * 60 * 1000);

  // Global key handlers
  document.addEventListener("keydown", handleGlobalKeys);
  window.addEventListener("beforeunload", handleBeforeUnload);
  document.addEventListener("visibilitychange", () => {
    restartSidebarClock();
    restartPlayTimer();
  });

  // Modal backdrop clicks
  $("hostModal")?.addEventListener("click", (e) => {
    if (e.target === e.currentTarget) closeHostModal();
  });
});

async function initSystemIdleState() {
  const applyIdleState = (state) => {
    State.systemIdle = !!state?.idle;
    restartSidebarClock();
    restartPlayTimer();
  };

  window.electronAPI?.onSystemIdleState?.(applyIdleState);

  try {
    const state = await window.electronAPI?.getSystemIdleState?.();
    if (state) applyIdleState(state);
  } catch (error) {
    console.error("Failed to load system idle state:", error);
  }
}

async function loadAppVersion() {
  const versionEl = $("appVersion");
  if (!versionEl || !window.electronAPI?.getAppVersion) return;

  try {
    const version = await window.electronAPI.getAppVersion();
    if (version) versionEl.textContent = `v${version}`;
  } catch (error) {
    console.error("Failed to load app version:", error);
  }
}

