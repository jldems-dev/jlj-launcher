// ============================================================
// TOAST NOTIFICATIONS
// ============================================================
function showToast(message, type = "info") {
  const container = $("toastContainer");
  if (!container) return;

  const icons = { success: "✓", info: "ℹ", error: "✕" };
  const toast = document.createElement("div");
  toast.className = `toast toast-${type}`;
  toast.innerHTML = `
    <div class="toast-icon">${icons[type]}</div>
    <div style="font-weight:600;font-size:13px">${message}</div>
  `;

  container.appendChild(toast);
  requestAnimationFrame(() => toast.classList.add("show"));

  setTimeout(() => {
    toast.classList.remove("show");
    setTimeout(() => toast.remove(), 350);
  }, 3000);
}

