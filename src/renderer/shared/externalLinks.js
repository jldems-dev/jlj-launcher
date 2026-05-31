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

