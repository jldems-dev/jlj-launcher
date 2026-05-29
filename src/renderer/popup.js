const { ipcRenderer } = require("electron");

const typeConfig = {
  warning: {
    icon: `
      <img
        src="../../assets/icons/alert-triangle.svg"
      >
    `,
  },
  error: {
    icon: `
      <img
        src="../../assets/icons/x-circle.svg"
      >
    `,
  },
  info: {
    icon: `
      <img
        src="../../assets/icons/info.svg"
      >
    `,
  },
  success: {
    icon: `
      <img
        src="../../assets/icons/check-circle.svg"
        class="popup-icon"
      >
    `,
  },
};

ipcRenderer.on("popup-data", (_, data) => {
  const { title, message, type } = data;
  const config = typeConfig[type] || typeConfig.info;

  document.getElementById("title").innerText = title || "Notification";
  document.getElementById("message").innerText = message || "";
  document.getElementById("popup-icon").innerHTML = config.icon;
  document.getElementById("popup-time").textContent =
    new Date().toLocaleTimeString();

  const card = document.getElementById("popup-card");
  card.className = "popup-card";
  card.classList.add(type || "info");

  if (type === "error" || type === "warning" || type === "info") {
    playAlertSound();
  }
});

document.getElementById("closeBtn").addEventListener("click", () => {
  window.close();
});

document.addEventListener("keydown", (e) => {
  if (e.key === "Enter" || e.key === "Escape") {
    window.close();
  }
});

function playAlertSound() {
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.frequency.value = 800;
    osc.type = "sine";
    gain.gain.setValueAtTime(0.3, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.5);
    osc.start();
    osc.stop(ctx.currentTime + 0.5);
  } catch (e) {
    console.error("Sound error:", e);
  }
}
