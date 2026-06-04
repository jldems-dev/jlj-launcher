// ============================================================
// WINDOW CONTROLS
// ============================================================
function bindWindowControls() {
  $("windowMinimizeButton")?.addEventListener("click", minimizeWindow);
  $("windowMaximizeButton")?.addEventListener("click", maximizeWindow);
  $("windowCloseButton")?.addEventListener("click", closeWindow);
}

function minimizeWindow() {
  window.electronAPI?.minimize
    ? window.electronAPI.minimize()
    : showToast("Minimized", "info");
}

function maximizeWindow() {
  window.electronAPI?.maximize
    ? window.electronAPI.maximize()
    : showToast("Maximized", "info");
}

// ============================================================
// EXIT CONFIRMATION MODAL
// ============================================================
function openExitModal() {
  // Remove any existing exit modal first
  closeExitModal();
  
  const overlay = document.createElement("div");
  overlay.id = "exitModalOverlay";
  overlay.className = "exit-modal-overlay";
  
  const isPlaying = State.currentlyPlaying !== null;
  const gameName = isPlaying ? findGameById(State.currentlyPlaying.id)?.title : "";
  
  overlay.innerHTML = `
    <div class="exit-modal">
      <div class="exit-modal-header">
        <div class="exit-icon">
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"></path>
            <polyline points="16 17 21 12 16 7"></polyline>
            <line x1="21" y1="12" x2="9" y2="12"></line>
          </svg>
        </div>
        <h3>Exit Launcher?</h3>
      </div>
      
      <div class="exit-modal-body">
        ${isPlaying ? `
          <div class="exit-warning">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#ff6b6b" stroke-width="2">
              <circle cx="12" cy="12" r="10"></circle>
              <line x1="12" y1="8" x2="12" y2="12"></line>
              <line x1="12" y1="16" x2="12.01" y2="16"></line>
            </svg>
            <span><strong>${gameName}</strong> is currently running. Play time will be saved.</span>
          </div>
        ` : ""}
        <p class="exit-message">Are you sure you want to close JLJGAMINGHOUSE Launcher?</p>
      </div>
      
      <div class="exit-modal-actions">
        <button class="exit-btn exit-btn-cancel" onclick="closeExitModal()">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <line x1="18" y1="6" x2="6" y2="18"></line>
            <line x1="6" y1="6" x2="18" y2="18"></line>
          </svg>
          Cancel
        </button>
        <button class="exit-btn exit-btn-confirm" onclick="confirmExit()">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"></path>
            <polyline points="16 17 21 12 16 7"></polyline>
            <line x1="21" y1="12" x2="9" y2="12"></line>
          </svg>
          Exit Launcher
        </button>
      </div>
    </div>
  `;
  
  document.body.appendChild(overlay);
  
  // Trigger animation
  requestAnimationFrame(() => {
    overlay.classList.add("active");
  });
  
  // Close on backdrop click
  overlay.addEventListener("click", (e) => {
    if (e.target === overlay) closeExitModal();
  });
  
  // Close on Escape
  const escHandler = (e) => {
    if (e.key === "Escape") {
      closeExitModal();
      document.removeEventListener("keydown", escHandler);
    }
  };
  document.addEventListener("keydown", escHandler);
}

function closeExitModal() {
  const overlay = $("exitModalOverlay");
  if (!overlay) return;
  
  overlay.classList.remove("active");
  setTimeout(() => overlay.remove(), 300);
}

async function confirmExit() {
  localStorage.clear();
  closeExitModal();
  
  if (State.currentlyPlaying) {
    await stopPlaying();
  }
  
  if (window.electronAPI?.close) {
    window.electronAPI.close();
  } else {
    showToast("Closing...", "info");
    document.body.style.transition = "opacity 0.5s ease";
    document.body.style.opacity = "0";
    
    setTimeout(() => {
      document.body.innerHTML = `
        <div style="
          display:flex;
          justify-content:center;
          align-items:center;
          height:100vh;
          background: #0a0a0f;
          color: #888;
          font-size: 16px;
          font-family: 'Poppins', sans-serif;
          opacity: 0;
          animation: fadeIn 0.5s ease forwards;
        ">
          <div style="text-align: center;">
            <div style="
              width: 40px;
              height: 40px;
              border: 2px solid #333;
              border-top-color: #6366f1;
              border-radius: 50%;
              margin: 0 auto 16px;
              animation: spin 0.8s linear infinite;
            "></div>
            <p>JLJGAMINGHOUSE Closed</p>
          </div>
        </div>
        <style>
          @keyframes fadeIn { to { opacity: 1; } }
          @keyframes spin { to { transform: rotate(360deg); } }
        </style>
      `;
    }, 500);
  }
 
}

// ============================================================
// UPDATED closeWindow FUNCTION
// ============================================================
function closeWindow() {
  openExitModal();
}

// ============================================================
// PC POWER CONFIRMATION
// ============================================================
const POWER_ACTIONS = {
  restart: {
    title: "Restart PC?",
    message: "This will restart this Windows PC now. Make sure all active work is saved before continuing.",
    buttonText: "Restart PC",
    icon: `
      <path stroke-linecap="round" stroke-linejoin="round" d="M4 4v6h6"></path>
      <path stroke-linecap="round" stroke-linejoin="round" d="M20 20v-6h-6"></path>
      <path stroke-linecap="round" stroke-linejoin="round" d="M20 9a8 8 0 00-13.66-4.66L4 6.68"></path>
      <path stroke-linecap="round" stroke-linejoin="round" d="M4 15a8 8 0 0013.66 4.66L20 17.32"></path>
    `,
  },
  shutdown: {
    title: "Shutdown PC?",
    message: "This will shut down this Windows PC now. Make sure all active work is saved before continuing.",
    buttonText: "Shutdown PC",
    icon: `
      <path stroke-linecap="round" stroke-linejoin="round" d="M12 2v10"></path>
      <path stroke-linecap="round" stroke-linejoin="round" d="M18.36 6.64a9 9 0 11-12.72 0"></path>
    `,
  },
};

function openPowerConfirmModal(action) {
  const config = POWER_ACTIONS[action];
  if (!config) return;

  closePowerConfirmModal();

  const overlay = document.createElement("div");
  overlay.id = "powerConfirmModalOverlay";
  overlay.className = "exit-modal-overlay";
  overlay.innerHTML = `
    <div class="exit-modal">
      <div class="exit-modal-header">
        <div class="exit-icon">
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            ${config.icon}
          </svg>
        </div>
        <h3>${config.title}</h3>
      </div>

      <div class="exit-modal-body">
        <div class="exit-warning">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#ff6b6b" stroke-width="2">
            <circle cx="12" cy="12" r="10"></circle>
            <line x1="12" y1="8" x2="12" y2="12"></line>
            <line x1="12" y1="16" x2="12.01" y2="16"></line>
          </svg>
          <span>This action affects the whole PC.</span>
        </div>
        <p class="exit-message">${config.message}</p>
      </div>

      <div class="exit-modal-actions">
        <button class="exit-btn exit-btn-cancel" onclick="closePowerConfirmModal()">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <line x1="18" y1="6" x2="6" y2="18"></line>
            <line x1="6" y1="6" x2="18" y2="18"></line>
          </svg>
          Cancel
        </button>
        <button class="exit-btn exit-btn-confirm" onclick="confirmPowerAction('${action}')">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            ${config.icon}
          </svg>
          ${config.buttonText}
        </button>
      </div>
    </div>
  `;

  document.body.appendChild(overlay);
  requestAnimationFrame(() => overlay.classList.add("active"));

  overlay.addEventListener("click", (e) => {
    if (e.target === overlay) closePowerConfirmModal();
  });
}

function closePowerConfirmModal() {
  const overlay = $("powerConfirmModalOverlay");
  if (!overlay) return;

  overlay.classList.remove("active");
  setTimeout(() => overlay.remove(), 300);
}

async function confirmPowerAction(action) {
  try {
    if (action === "restart") {
      await window.electronAPI.restartPc();
      return;
    }

    if (action === "shutdown") {
      await window.electronAPI.shutdownPc();
    }
  } catch (error) {
    console.error(`Failed to ${action} PC:`, error);
    showToast(`Failed to ${action} PC`, "error");
    closePowerConfirmModal();
  }
}

