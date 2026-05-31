// ============================================================
// UPDATES
// ============================================================
async function checkForUpdates() {
  if (!window.electronAPI?.checkGameUpdates) return; 
  try {
    const result = await window.electronAPI.checkGameUpdates(); 
    if (result.games) State.allGames = result.games;
    if (result.updatesFound > 0) applyFilters();
  } catch (e) {
    console.error("Update check failed:", e);
  }
}

