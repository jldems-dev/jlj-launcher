// ============================================================
// UPDATE / AUTO-UPDATER
// ============================================================
function updateAppStatus() {
  if (State.updateListenerAttached) return;
  State.updateListenerAttached = true;

  const panel = $("updatePanel");
  const bar = $("updateProgressBar");
  const percentText = $("updatePercent");
  const speedText = $("updateSpeed");
  const statusText = $("updateStatusText");
  const restartBtn = $("restartBtn");

  if (!window.electronAPI) return;

  window.electronAPI.onUpdateStatus((data) => { 
    switch (data.status) {
      case "available":
        restartBtn?.classList.add("hidden");
        panel?.classList.add("hidden");
        break;

      case "ready":
        restartBtn?.classList.add("hidden");
        panel?.classList.add("hidden");
        break;

      case "error":
        restartBtn?.classList.add("hidden");
        panel?.classList.add("hidden");
        break;
    }
  });
  window.electronAPI.onUpdateProgress((data) => {
    const percent = data.percent || 0;
    bar.style.width = `${percent}%`;
    percentText.textContent = `${percent}%`;
    speedText.textContent = `${Math.round((data.speed || 0) / 1024)} KB/s`;
    panel?.classList.add("hidden");
  });
  window.electronAPI.onInstallProgress((data) => {
    const percent = data.percent || 0;
    bar.style.width = `${percent}%`;
    percentText.textContent = `${percent}%`;
    speedText.textContent = "";
    statusText.textContent = "Installing update...";
    panel?.classList.add("hidden");
  });
}

