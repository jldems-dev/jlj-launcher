// ============================================================
// EXTERNAL LINKS
// ============================================================
function openExternal(url) {
  showToast(`Opening ${url}...`, "info");
  if (window.electronAPI?.openExternal) {
    window.electronAPI.openExternal(url);
  } else {
    window.open(url, "_blank");
  }
}

async function openMultipleRobloxInstances() {
  try {
    showToast("Opening Multiple Roblox Instances...", "info");

    if (!window.electronAPI?.openMultipleRobloxInstances) {
      throw new Error("Launcher API is unavailable");
    }

    await window.electronAPI.openMultipleRobloxInstances();
  } catch (err) {
    showToast(err.message || "Failed to open Multiple Roblox Instances", "error");
  }
}

