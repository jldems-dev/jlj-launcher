// ============================================================
// UI UTILITIES
// ============================================================
function setLoadingButton(btn, loading, loadingText = "Loading...") {
  if (!btn) return;

  if (loading) {
    btn.dataset.originalHtml = btn.innerHTML;
    btn.disabled = true;
    btn.innerHTML = `
      <svg width="16" height="16" fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="2" class="spin">
        <path d="M12 2v4m0 12v4M4.93 4.93l2.83 2.83m8.48 8.48l2.83 2.83M2 12h4m12 0h4M4.93 19.07l2.83-2.83m8.48-8.48l2.83-2.83"/>
      </svg>
      ${loadingText}
    `;
  } else {
    btn.disabled = false;
    btn.innerHTML = btn.dataset.originalHtml || btn.innerHTML;
  }
}

function switchTab(element, tab) {
  $$(".nav-item").forEach((item) => item.classList.remove("active"));
  element?.classList.add("active");
}

function forceReload() {
  showToast("Reloading launcher...", "info");
  setTimeout(() => window.location.reload(), 1000);
}

// ============================================================
// GLOBAL EVENT HANDLERS
// ============================================================
function handleGlobalKeys(e) {
  if (e.key === "Escape") {
    $("searchInput")?.blur();
    closeLoginModal();
    closeOwnerSettings();
    closeAddGameModal();
    closeDeleteModal();
    closeHostModal();
    closePowerConfirmModal();
  }
  if (e.ctrlKey && e.key === "f") {
    e.preventDefault();
    $("searchInput")?.focus();
  }
}

function handleBeforeUnload() {
  if (State.currentlyPlaying) {
    stopPlaying();
  }
}
