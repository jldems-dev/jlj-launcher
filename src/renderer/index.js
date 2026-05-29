// ============================================================
// STATE MANAGEMENT
// ============================================================
const State = {
  isOwnerLoggedIn: false,
  currentFilter: "all",
  currentSearch: "",
  currentRows: 5,
  allGames: [],
  games: [],
  gameToDelete: null,
  currentHostGame: null,
  cachedMaps: [],
  currentlyPlaying: null,
  playTimerInterval: null,
  updateListenerAttached: false,
  cpLocked: false,
};

// ============================================================
// DOM UTILITIES
// ============================================================
const $ = (id) => document.getElementById(id);
const $$ = (sel) => document.querySelectorAll(sel); 

// ============================================================
// INITIALIZATION
// ============================================================
document.addEventListener("DOMContentLoaded", () => {
  bindWindowControls();
  bindCrudControls();
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

  // Modal backdrop clicks
  $("hostModal")?.addEventListener("click", (e) => {
    if (e.target === e.currentTarget) closeHostModal();
  });
});

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
        panel?.classList.remove("hidden");
        statusText.textContent = "Downloading update...";
        break;

      case "ready":
        percentText.textContent = "100%";
        bar.style.width = "100%";
        statusText.textContent = "Update downloaded successfully";
        restartBtn?.classList.remove("hidden");
        restartBtn.textContent = "Install Now";
        break;

      case "error":
        statusText.textContent = "Update failed: " + data.message;
        restartBtn?.classList.add("hidden");
        break;
    }
  });
  window.electronAPI.onUpdateProgress((data) => {
    panel?.classList.remove("hidden");
    const percent = data.percent || 0;
    bar.style.width = `${percent}%`;
    percentText.textContent = `${percent}%`;
    speedText.textContent = `${Math.round((data.speed || 0) / 1024)} KB/s`;
  });
  window.electronAPI.onInstallProgress((data) => {
    panel?.classList.remove("hidden");
    const percent = data.percent || 0;
    bar.style.width = `${percent}%`;
    percentText.textContent = `${percent}%`;
    speedText.textContent = "";
    statusText.textContent = "Installing update...";
  });

  restartBtn?.addEventListener("click", () => {
    window.electronAPI?.restartApp();
  });
}

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
// CRUD CONTROLS BINDING
// ============================================================
function bindCrudControls() {
  $("loginButton")?.addEventListener("click", login);
  $("addGameButton")?.addEventListener("click", addGame);
  $("confirmDeleteGameButton")?.addEventListener("click", delGame);
  $("cancelDeleteGameButton")?.addEventListener("click", closeDeleteModal);
}

// ============================================================
// GAME DATA HELPERS
// ============================================================
function sameId(left, right) {
  return String(left) === String(right);
}

function findGameById(gameId) {
  return State.allGames.find((g) => sameId(g.id, gameId));
}
// ============================================================
// GAME LOADING & FILTERING
// ============================================================
async function loadGames() {
  try {
    State.allGames = window.electronAPI?.getGames
      ? await window.electronAPI.getGames()
      : [];
    applyFilters();
  } catch (error) {
    console.error("Failed to load games:", error);
    showToast("Failed to load games from JSON", "error");
  }
}

function applyFilters() {
  if (!Array.isArray(State.allGames)) State.allGames = [];

  let filtered = [...State.allGames];

  // Status filters
  const filterMap = {
    installed: (g) => g.status === "installed",
    updates: (g) => g.status === "update",
    favorites: (g) => g.isFavorite,
    recent: (g) => g.lastPlayedTimestamp !== null,
  };

  if (filterMap[State.currentFilter]) {
    filtered = filtered.filter(filterMap[State.currentFilter]);
  }

  // Search filter
  if (State.currentSearch) {
    filtered = filtered.filter((g) =>
      g.title.toLowerCase().includes(State.currentSearch),
    );
  }

  renderGames(filtered);
}

function searchGames() {
  State.currentSearch = $("searchInput")?.value.toLowerCase() || "";
  applyFilters();
}

function filterGames(filter, btn) {
  State.currentFilter = filter;

  $$(".tab-btn").forEach((b) => b.classList.remove("active"));
  btn?.classList.add("active");

  const titles = {
    all: "All Games",
    installed: "Installed Games",
    updates: "Updates Available",
    favorites: "Favorite Games",
    recent: "Recently Played",
  };

  const el = $("gamesSectionTitle");
  if (el) el.textContent = titles[filter] || "Games";

  applyFilters();
}

function changeRows(rows) {
  State.currentRows = parseInt(rows);
  const grid = $("gamesGrid");
  if (!grid) return;

  grid.classList.remove("rows-2", "rows-3", "rows-4", "rows-5", "rows-6");
  grid.classList.add(`rows-${State.currentRows}`);
}

// ============================================================
// FORMATTING UTILITIES
// ============================================================
function formatTimeAgo(timestamp) {
  if (!timestamp) return "Never";

  const seconds = Math.floor((Date.now() - timestamp) / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);

  if (seconds < 60) return "Just now";
  if (minutes < 60) return `${minutes}m ago`;
  if (hours < 24) return `${hours}h ago`;
  if (days < 7) return `${days} day${days > 1 ? "s" : ""} ago`;
  if (days < 30)
    return `${Math.floor(days / 7)} week${Math.floor(days / 7) > 1 ? "s" : ""} ago`;

  return new Date(timestamp).toLocaleDateString();
}

function formatHours(minutes) {
  if (!minutes || minutes === 0) return "0h";
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  if (h === 0) return `${m}m`;
  if (m === 0) return `${h}h`;
  return `${h}h ${m}m`;
}

function formatPlayTime(minutes) {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return `${h}h ${m}m`;
}

// ============================================================
// RENDERING
// ============================================================
function renderGames(gamesToRender) {
  const grid = $("gamesGrid");
  if (!grid) return;

  if (gamesToRender.length === 0) {
    grid.innerHTML = `
      <div class="empty-state" style="grid-column:1/-1">
        <h3>No games found</h3>
        <p>Try adjusting your search or filters</p>
      </div>
    `;
    return;
  }

  grid.innerHTML = gamesToRender
    .map((game) => {
      const gameId = JSON.stringify(game.id);
      const isPlaying =
        State.currentlyPlaying && sameId(State.currentlyPlaying.id, game.id);

      const statusBadge = isPlaying
        ? '<span class="status-badge status-playing">Playing</span>'
        : game.status === "update"
          ? '<span class="status-badge status-update">Update</span>'
          : game.status === "installed"
            ? '<span class="status-badge status-installed">Ready</span>'
            : "";

      const ownerActions = State.isOwnerLoggedIn
        ? `
      <div class="game-actions">
        <button class="action-btn" onclick='event.stopPropagation();toggleFavorite(${gameId})' 
          title="${game.isFavorite ? "Remove from favorites" : "Add to favorites"}">
          ${game.isFavorite ? "★" : "☆"}
        </button>
        <button class="action-btn delete" onclick='event.stopPropagation();openDeleteModal(${gameId})' title="Delete game">
          🗑
        </button>
      </div>
    `
        : "";

      return `
      <div class="game-card" data-title="${game.title.toLowerCase()}">
        <div class="game-cover" onclick='launchGameById(${gameId})'>
          <img src="${game.cover}" alt="${game.title}" loading="lazy">
          ${statusBadge}
          <div class="play-btn-overlay">
            <svg width="20" height="20" fill="black" viewBox="0 0 24 24">
              <path d="M8 5v14l11-7z"/>
            </svg>
          </div>
          <div class="game-overlay">
            <div style="font-size:11px;color:var(--text-muted);margin-bottom:3px">${formatTimeAgo(game.lastPlayedTimestamp)}</div>
            <div style="font-size:13px;font-weight:600">${formatHours(game.totalMinutes)} played</div>
          </div>
        </div>
        <div class="game-info">
          <h4 class="game-title">${game.title}</h4>
          <div class="game-meta">
            <span>${game.genre}</span>
            <span>${formatHours(game.totalMinutes)}</span>
          </div>
          <div class="game-tags">
            <span class="tag">${game.genre}</span>
            ${game.status === "installed" ? '<span class="tag">Installed</span>' : ""}
            ${game.isFavorite ? '<span class="tag">★ Favorite</span>' : ""}
            ${game.status === "update" ? '<span class="tag" style="color:#ff6b6b;border-color:rgba(255,50,50,0.3)">Update Available</span>' : ""}
          </div>
          <div class="game-card-actions">
            <button class="card-btn play" onclick='event.stopPropagation();launchGameById(${gameId})'>▶ Play</button>
            <button class="card-btn host" onclick='event.stopPropagation();openHostModal(${JSON.stringify(game)})'>🌐 Host</button>
          </div>
        </div>
        ${ownerActions}
      </div>
    `;
    })
    .join("");
}

// ============================================================
// GAME LAUNCHING & PLAY TIME TRACKING
// ============================================================
async function launchGameById(gameId) {
  const game = findGameById(gameId);
  if (!game) {
    showToast("Game not found", "error");
    return;
  }

  // Already playing this game?
  if (State.currentlyPlaying && sameId(State.currentlyPlaying.id, gameId)) {
    showToast(`${game.title} is already running`, "info");
    return;
  }

  // Stop current game first
  if (State.currentlyPlaying) {
    await stopPlaying();
  }

  if (!game.exePath?.trim()) {
    showToast(`No executable path set for ${game.title}`, "error");
    showToast("Owner needs to add EXE path", "info");
    return;
  }

  showToast(`Launching ${game.title}...`, "success");
  startPlayTimer(game);

  if (window.electronAPI?.launchGame) {
    window.electronAPI.launchGame(
      game.id,
      game.launchMethod,
      game.appId,
      game.title,
    );
  } else {
    showToast(`Would launch: ${game.exePath}`, "info");
    console.log("Launching:", game.exePath);
  }

  // Update last played
  const now = Date.now();
  game.lastPlayedTimestamp = now;
  game.lastPlayed = "Just now";

  try {
    if (window.electronAPI?.updateGame) {
      await window.electronAPI.updateGame(game.id, {
        lastPlayedTimestamp: now,
        lastPlayed: "Just now",
      });

      if (game.status === "update") {
        await window.electronAPI.updateGame(game.id, {
          status: "installed",
          version: game.setLatestVersion,
        });
      }
    }
    applyFilters();
  } catch (e) {
    console.error("Failed to update last played:", e);
  }
}

function startPlayTimer(game) {
  State.currentlyPlaying = {
    id: game.id,
    startTime: Date.now(),
    startTotalMinutes: game.totalMinutes || 0,
  };

  $("playingGameName").textContent = game.title;
  $("playingIndicator")?.classList.add("active");

  State.playTimerInterval = setInterval(async () => {
    if (!State.currentlyPlaying) return;

    let elapsedSeconds = 0;
    if (window.electronAPI?.getElapsedTime) {
      try {
        elapsedSeconds = await window.electronAPI.getElapsedTime(game.id);
      } catch (e) {
        elapsedSeconds = Math.floor(
          (Date.now() - State.currentlyPlaying.startTime) / 1000,
        );
      }
    } else {
      elapsedSeconds = Math.floor(
        (Date.now() - State.currentlyPlaying.startTime) / 1000,
      );
    }

    const totalMinutes =
      State.currentlyPlaying.startTotalMinutes +
      Math.floor(elapsedSeconds / 60);
    $("playingTime").textContent = formatPlayTime(totalMinutes);
  }, 1000);

  applyFilters();
}

async function stopPlaying() {
  if (!State.currentlyPlaying) return;

  const gameId = State.currentlyPlaying.id;

  if (window.electronAPI?.stopGame) {
    window.electronAPI.stopGame(gameId);
  }

  clearInterval(State.playTimerInterval);
  State.playTimerInterval = null;

  const elapsedMinutes = Math.floor(
    (Date.now() - State.currentlyPlaying.startTime) / 60000,
  );
  const game = findGameById(gameId);

  if (game) {
    game.totalMinutes = (game.totalMinutes || 0) + elapsedMinutes;
    game.hours = formatHours(game.totalMinutes);
    showToast(
      `${game.title} played for ${formatPlayTime(elapsedMinutes)}`,
      "success",
    );
  }

  State.currentlyPlaying = null;
  $("playingIndicator")?.classList.remove("active");
  applyFilters();
}

// Listen for game stopped from main process
if (window.electronAPI?.onGameStopped) {
  window.electronAPI.onGameStopped((data) => {
    if (
      !State.currentlyPlaying ||
      !sameId(State.currentlyPlaying.id, data.gameId)
    )
      return;

    clearInterval(State.playTimerInterval);
    State.playTimerInterval = null;
    State.currentlyPlaying = null;
    $("playingIndicator")?.classList.remove("active");

    const game = findGameById(data.gameId);
    if (game) {
      game.totalMinutes = data.totalMinutes;
      game.hours = data.hours;
      game.lastPlayed = "Just now";
      game.lastPlayedTimestamp = Date.now();
    }

    showToast(
      `Game closed. Played for ${formatPlayTime(data.elapsedMinutes)}`,
      "success",
    );
    applyFilters();
  });
}

// ============================================================
// FAVORITES
// ============================================================
async function toggleFavorite(gameId) {
  const game = findGameById(gameId);
  if (!game) return;

  const newFavorite = !game.isFavorite;

  try {
    if (window.electronAPI?.updateGame) {
      const updated = await window.electronAPI.updateGame(gameId, {
        isFavorite: newFavorite,
      });
      if (!updated) throw new Error(`Game ${gameId} was not found in JSON`);
      State.games = await window.electronAPI.getGames();
    } else {
      game.isFavorite = newFavorite;
    }

    applyFilters();
    showToast(
      newFavorite ? "Added to favorites" : "Removed from favorites",
      "success",
    );
  } catch (error) {
    console.error("Failed to toggle favorite:", error);
    showToast("Failed to update favorite status", "error");
  }
}

// ============================================================
// AUTHENTICATION
// ============================================================
async function login() {
  const username = $("loginUsername")?.value.trim();
  const password = $("loginPassword")?.value.trim();

  if (!username || !password) {
    showToast("Please enter credentials", "error");
    return;
  }

  try {
    const valid = window.electronAPI?.verifyOwner
      ? await window.electronAPI.verifyOwner(username, password)
      : username === "jldems" && password === "0925";

    if (valid) {
      State.isOwnerLoggedIn = true;
      closeLoginModal();
      $("loginText").textContent = "Logout";
      $("ownerBadge").style.display = "inline-flex";
      $("addGameNav").style.display = "flex";
      $("addBraveQos").style.display = "flex";
      $("addControlPanel").style.display = "flex";
      showToast("Owner logged in successfully", "success");
      applyFilters();
    } else {
      showToast("Invalid credentials", "error");
    }
  } catch (error) {
    console.error("Login error:", error);
    showToast("Login failed", "error");
  }
}

function openLoginModal() {
  if (State.isOwnerLoggedIn) {
    logout();
    return;
  }
  $("loginModal")?.classList.add("active");
}

function closeLoginModal() {
  $("loginModal")?.classList.remove("active");
  $("loginUsername").value = "";
  $("loginPassword").value = "";
}

function logout() {
  if (State.currentlyPlaying) stopPlaying();

  State.isOwnerLoggedIn = false;
  $("loginText").textContent = "Owner Login";
  $("ownerBadge").style.display = "none";
  $("addGameNav").style.display = "none";
  applyFilters();
  showToast("Logged out", "info");
}

// ============================================================
// GAME CRUD
// ============================================================
function openAddGameModal() {
  if (!State.isOwnerLoggedIn) {
    showToast("Owner login required", "error");
    return;
  }
  $("addGameModal")?.classList.add("active");
}

function closeAddGameModal() {
  $("addGameModal")?.classList.remove("active");
  $("gameTitle").value = "";
  $("gameGenre").value = "";
  $("gameCoverUpload").value = ""; // Changed from gameCover to gameCoverUpload
  $("gameExeManual").value = "";

  // Also reset app ID and launch method if needed
  $("gameAppId").value = "";
  $("gameLaunchMethod").value = "direct";
  $("gameHostSetup").value = "no";
  $("appIdGroup").style.display = "none";
}

async function addGame() {
  if (!State.isOwnerLoggedIn) {
    showToast("Owner login required", "error");
    return;
  }

  const title = $("gameTitle")?.value.trim();
  const genre = $("gameGenre")?.value;
  const manualPath = $("gameExeManual")?.value.trim();
  const launchMethod = $("gameLaunchMethod")?.value;
  const hostSetup = $("gameHostSetup")?.value;
  const appId = $("gameAppId")?.value.trim();
  const coverFile = $("gameCoverUpload")?.files[0];

  if (!title) return showToast("Please enter a game title", "info");
  if (!genre) return showToast("Please select a genre", "info");
  if (!manualPath) return showToast("Please enter an executable path", "info");

  // Default fallback cover if no image uploaded
  let cover =
    "https://images.unsplash.com/photo-1550745165-9bc0b252726f?w=400&h=600&fit=crop&q=80";

  // Handle cover image upload
  if (coverFile) {
    try {
      const gameDir = manualPath.substring(0, manualPath.lastIndexOf("\\"));
      const ext = coverFile.name.split(".").pop();
      const coverFileName = `cover.${ext}`;

      // Read file as base64
      const base64Data = await new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result.split(",")[1]); // Remove data:image/... prefix
        reader.onerror = reject;
        reader.readAsDataURL(coverFile);
      });

      // Send to main process to save file
      if (!window.electronAPI?.saveCoverImage) {
        throw new Error("saveCoverImage API not available");
      } 
      const savedPath = await window.electronAPI.saveCoverImage({
        gameDir,
        fileName: coverFileName,
        data: base64Data,
        ext: ext,
      });

      cover = savedPath;
    } catch (err) {
      console.error("Failed to save cover image:", err);
      showToast("Failed to save cover image, using default", "warning");
    }
  } 

  const newGame = {
    title,
    cover,
    genre,
    hours: "0h",
    totalMinutes: 0,
    status: "installed",
    lastPlayed: "Never",
    lastPlayedTimestamp: null,
    isFavorite: false,
    exePath: manualPath,
    detectedExePath: "",
    launchMethod,
    HostSetup: hostSetup,
    appId,
    version: "1.0.0",
    latestVersion: "1.0.0",
  };

  try {
    if (!window.electronAPI?.addGame) {
      throw new Error(
        "Electron API is unavailable. Restart the launcher and check preload setup.",
      );
    }

    const result = await window.electronAPI.addGame(newGame);
    State.games = await window.electronAPI.getGames();
    State.allGames = State.games;
    applyFilters();
    closeAddGameModal();
    showToast(`${result.title} added to library`, "success");
  } catch (error) {
    console.error("Failed to add game:", error);
    showToast("Failed to add game to JSON", "error");
  }
}

function openDeleteModal(gameId) {
  const game = findGameById(gameId);
  if (!game) return;

  State.gameToDelete = gameId;
  $("deleteGameName").textContent = game.title;
  $("deleteModal")?.classList.add("active");
}

function closeDeleteModal() {
  $("deleteModal")?.classList.remove("active");
  State.gameToDelete = null;
}

async function delGame() {
  if (!State.gameToDelete) return;

  if (
    State.currentlyPlaying &&
    sameId(State.currentlyPlaying.id, State.gameToDelete)
  ) {
    showToast("Stop the game before deleting it", "error");
    closeDeleteModal();
    return;
  }

  try {
    if (window.electronAPI?.deleteGame) {
      const deleted = await window.electronAPI.deleteGame(State.gameToDelete);
      if (!deleted)
        throw new Error(`Game ${State.gameToDelete} was not found in JSON`);
      State.games = await window.electronAPI.getGames();
    } else {
      State.games = State.games.filter(
        (g) => !sameId(g.id, State.gameToDelete),
      );
    }
    State.allGames = State.games;
    applyFilters();
    showToast("Game deleted", "success");
    closeDeleteModal();
  } catch (error) {
    console.error("Failed to delete game:", error);
    showToast("Failed to delete game from JSON", "error");
  }
}

// ============================================================
// HOSTING / MULTIPLAYER
// ============================================================
async function openHostModal(game) {
  State.currentHostGame = game;
  const roomObj = JSON.parse(localStorage.getItem("roominfo") || "null");
  const playerName = roomObj?.playerName || "";
  const gameMap = roomObj?.map || "";

  if (!game.title?.toLowerCase().includes("left 4 dead 2")) {
    showToast("Hosting is not available for this game.", "error");
    return;
  }

  const mapGroup = $("mapGroup");
  const playerNameGroup = $("playerNameGroup");

  mapGroup.style.display = "block";
  playerNameGroup?.classList.remove("full-width");
  await loadMaps();

  $("hostModal")?.classList.add("active");
  $("hostGameCover").src = game.cover;
  $("hostGameTitle").textContent = game.title;
  $("hostGameGenre").textContent = game.genre;
  $("hostGameStatus").textContent = game.status;
  $("hostGameVersion").textContent = `v${game.version}`;
  $("hostGameExe").textContent = game.exePath;
  $("hostPlayerName").value = playerName;
  $("hostGameMap").value = gameMap; 
}

function closeHostModal() {
  $("hostModal")?.classList.remove("active");
}

async function loadMaps() {
  try {
    const response = await fetch("left4dead2maps.json");
    const data = await response.json();
    State.cachedMaps = data.maps;

    const select = $("hostGameMap");
    if (!select) return;

    select.innerHTML = '<option value="">Select a map...</option>';
    data.maps.forEach((map) => {
      const option = document.createElement("option");
      option.value = map.value;
      option.textContent = map.label;
      select.appendChild(option);
    });

    return State.cachedMaps;
  } catch (error) {
    console.error("Failed to load maps:", error);
    showToast("Failed to load maps", "error");
  }
}

async function listRoom(){
  const rooms = await window.electronAPI.getRooms();
  renderHostRoom(rooms); 
}
async function createRoom() {
  if (!State.currentHostGame) return;

  const btn = document.querySelector(".btn-create-room");
  const playerName = $("hostPlayerName")?.value.trim();

  if (!playerName) {
    showToast("Please enter your name", "error");
    return;
  }

  const hostId = getOrCreateHostId();
  const payload = {
    gameId: State.currentHostGame.id,
    title: State.currentHostGame.title,
    playerName,
    hostId,
    map: "",
    mapname: "",
  };

  // L4D2 map selection
  if (State.currentHostGame.title.toLowerCase().includes("left 4 dead 2")) {
    const map = $("hostGameMap")?.value;
    if (!map) {
      showToast("Please select a map", "error");
      return;
    }
    payload.map = map;
    payload.mapname = State.cachedMaps.find((m) => m.value === map)?.label;
  } 

  setLoadingButton(btn, true, "Creating...");

  try {
    const result = await window.electronAPI.createRoom(payload);

    if (result.success) {
      let obj = {
        playerName: result.room.host.playerName,
        map: result.room.host.map,
        title: result.room.host.title,
        gameId: result.room.host.gameId,
      };
      localStorage.setItem("roominfo", JSON.stringify(obj));
      listRoom();

      await window.electronAPI.launchGameAsHost({
        gameId: State.currentHostGame.id,
        exePath: State.currentHostGame.exePath,
        title: State.currentHostGame.title,
        map: payload.map,
        playerName,
      });
      const game = findGameById(State.currentHostGame.id);
      startPlayTimer(game);
      showToast(`Room created! ${result.room.url}`, "success");
      window.currentRoomId = result.room.id;
    }
  } catch (error) {
    console.error("Failed to create room:", error);
    showToast("Failed to create room", "error");
  } finally {
    setLoadingButton(btn, false);
  }
}

function renderHostRoom(rooms) {
  const roomsList = $("roomsList");
  const myHostId = localStorage.getItem("hostId");

  roomsList.style.display = "grid";
  roomsList.style.gridTemplateColumns = "repeat(auto-fill, minmax(280px, 1fr))";
  roomsList.style.gap = "16px";
  roomsList.style.padding = "16px";

  const filteredRooms = rooms.filter(
    (room) => room.host.gameId === State.currentHostGame?.id,
  );

  if (filteredRooms.length === 0) {
    roomsList.innerHTML = `
      <div style="text-align:center;color:var(--text-muted);padding:20px">
        <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" style="margin-bottom:10px;opacity:0.3">
          <circle cx="11" cy="11" r="8"/>
          <path d="M21 21l-4.35-4.35"/>
        </svg>
        <p style="font-size:12px">No active sessions found</p>
      </div>
    `;
    return;
  }

  roomsList.innerHTML = filteredRooms
    .map((room) => {
      const isOwner = room.host.hostId === myHostId;

      const actionButton = isOwner
        ? `<button class="btn" style="padding:4px 10px;font-size:11px" onclick="copyToClipboard('${room.url}')">Copy</button>`
        : `<button class="btn" style="padding:4px 10px;font-size:11px" onclick='event.stopPropagation();joinRoom(${JSON.stringify(room)})'>Join</button>`;

      const ownerControls = isOwner
        ? `<button onclick="closeCurrentRoom()" class="btn btn-danger" style="width:100%;font-size:11px;margin-top:8px">Close Room</button>`
        : "";

      return `
      <div style="background:var(--bg-card);border:1px solid var(--border);border-radius:var(--radius);padding:16px;display:flex;flex-direction:column">
        <div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:12px">
          <div style="min-width:0">
            <div style="font-size:13px;font-weight:600;color:var(--text-primary);margin-bottom:2px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${room.host.playerName}'s Room</div>
            <div style="font-size:11px;color:var(--text-muted);white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${room.host.pcName} • ${room.host.mapname}</div>
          </div>
          <span style="font-size:10px;padding:3px 8px;background:rgba(50,255,50,0.15);color:#6bff6b;border-radius:20px;border:1px solid rgba(50,255,50,0.3);flex-shrink:0;margin-left:8px">HOSTING</span>
        </div>
        <div style="background:var(--bg-hover);border:1px solid var(--border);border-radius:var(--radius);padding:10px 12px;margin-bottom:8px">
          <div style="font-size:10px;color:var(--text-muted);margin-bottom:4px;text-transform:uppercase;letter-spacing:0.5px">Room URL</div>
          <div style="display:flex;gap:8px;align-items:center">
            <code style="font-size:12px;color:var(--text-primary);flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${room.url}</code>
            ${actionButton}
          </div>
        </div>
        ${ownerControls}
      </div>
    `;
    })
    .join("");
}

async function refreshRooms() {
  const btn = document.querySelector(".refresh-btn");
  setLoadingButton(btn, true, "Scanning...");

  try { 
    const rooms = await window.electronAPI.getRooms();
    renderHostRoom(rooms);
  } catch (error) {
    console.error("Failed to refresh rooms:", error);
  } finally {
    setLoadingButton(btn, false);
  }
}

async function joinRoom(room) {
  const playerName = $("hostPlayerName")?.value.trim();

  if (!playerName) {
    showToast("Please enter your name", "error");
    return;
  }
  if(!room){
    showToast("Room is already closed", "error");
    return;
  }

  try {
    const result = await window.electronAPI.launchGameHostJoin(room); 
    if (result.success) {
      // localStorage.setItem("roominfo", JSON.stringify(result.room));
      showToast("Joined Room success");
    }
  } catch (error) {
    
  }
}

function copyToClipboard(text) {
  navigator.clipboard
    .writeText(text)
    .then(() => showToast("URL copied!", "success"));
}

async function closeCurrentRoom() { 
  try {
    await window.electronAPI.closeRoom(window.currentRoomId);
    stopPlaying();
    window.currentRoomId = null;
    localStorage.removeItem("roominfo");
    localStorage.removeItem("hostId");

    $("roomsList").innerHTML = `
      <div style="text-align:center;color:var(--text-muted);padding:20px">
        <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" style="margin-bottom:10px;opacity:0.3">
          <circle cx="11" cy="11" r="8"/>
          <path d="M21 21l-4.35-4.35"/>
        </svg>
        <p style="font-size:12px">Click "Refresh Rooms" to scan for active sessions</p>
      </div>
    `; 
    showToast("Room closed", "info");
  } catch (error) {
    showToast("Failed to close room", "error");
  }
}

function getOrCreateHostId() {
  let hostId = localStorage.getItem("hostId");
  if (!hostId) {
    hostId = crypto.randomUUID();
    localStorage.setItem("hostId", hostId);
  }
  return hostId;
}

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
    closeAddGameModal();
    closeDeleteModal();
    closeHostModal();
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

// ─── QoS Modal ─── 
function openQosModal() {
    $('qosModal')?.classList.add('active'); 
    refreshQosStatus();
}

function closeQosModal() {
    $('qosModal')?.classList.remove('active');
}

async function refreshQosStatus() {
    try {
        const status = await window.electronAPI.qosStatus(); 
        updateQosModalUI(status);
    } catch (err) {
        $("qosStatusTitle").textContent = "Error";
    }
}

function updateQosModalUI(status) {
    const iconWrap = $('qosStatusIconWrap');
    const title = $('qosStatusTitle');
    const tag1 = $('qosStatusTag');
    const tag2 = $('qosStatusTag2');
    const desc = $('qosStatusDesc');
    const disableBtn = $('qosDisableBtn');
    const navBadge = $('qosNavBadge');

    // Reset preset boxes
    [3, 4, 5].forEach(mbps => {
        $(`qosPreset${mbps}`).classList.remove('active');
    });

    if (status.active) {
        iconWrap.innerHTML = `
            <svg width="32" height="32" fill="none" stroke="#4ade80" viewBox="0 0 24 24" stroke-width="1.5">
                <path d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z"/>
            </svg>
        `;
        title.textContent = `${status.throttle} Mbps Throttle`;
        tag1.textContent = 'Active';
        tag1.style.background = 'rgba(74, 222, 128, 0.15)';
        tag1.style.color = '#4ade80';
        tag2.textContent = `~${status.throttle} Mbps`;
        desc.textContent = `Brave.exe is limited to ${status.throttle} Mbps bandwidth`;
        disableBtn.style.display = 'flex';

        navBadge.textContent = `${status.throttle}M`;
        navBadge.style.display = 'inline-block';
        navBadge.style.background = 'rgba(74, 222, 128, 0.15)';
        navBadge.style.color = '#4ade80';

        const activeBox = $(`qosPreset${status.throttle}`);
        if (activeBox) activeBox.classList.add('active');
    } else {
        iconWrap.innerHTML = `
            <svg width="32" height="32" fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="1.5">
                <path d="M13 10V3L4 14h7v7l9-11h-7z"/>
            </svg>
        `;
        title.textContent = 'No Throttle Active';
        tag1.textContent = 'Full Speed';
        tag1.style.background = '';
        tag1.style.color = '';
        tag2.textContent = 'Unrestricted';
        desc.textContent = 'Brave is running at maximum bandwidth';
        disableBtn.style.display = 'none';
        navBadge.style.display = 'none';
    }
}

async function setQosThrottle(mbps) {
    try {
        const result = await window.electronAPI.qosApply(mbps);
        updateQosModalUI({ active: true, throttle: result.throttle });
        showToast(`Brave throttled to ${mbps} Mbps`);
    } catch (err) {
        showToast(`Failed: ${err.message}`, 'error');
    }
}

async function removeQosThrottle() {
    try {
        await window.electronAPI.qosRemove();
        updateQosModalUI({ active: false });
        showToast('Throttle removed');
    } catch (err) {
        showToast(`Failed: ${err.message}`, 'error');
    }
}

$("qosModal")?.addEventListener("click", (e) => {
  if (e.target.id === "qosModal") closeQosModal();
});

// ─── Control Panel Modal ─── 
function openCPModal() {
  console.log("asd");
  document.getElementById("cpModal").classList.add("active");
  checkCpStatus();
}

function closeCpModal() {
    document.getElementById('cpModal').classList.remove('active');
}

async function checkCpStatus() {
    try {
        const status = await window.electronAPI.getCpStatus();
        State.cpLocked = status?.locked || false;
        updateCpUI();
    } catch (err) {
        console.error('Failed to get CP status:', err);
    }
}

function updateCpUI() {
    const iconWrap = document.getElementById('cpStatusIconWrap');
    const title = document.getElementById('cpStatusTitle');
    const tag1 = document.getElementById('cpStatusTag');
    const tag2 = document.getElementById('cpStatusTag2');
    const desc = document.getElementById('cpStatusDesc');
    const lockPreset = document.getElementById('cpPresetLock');
    const unlockPreset = document.getElementById('cpPresetUnlock');
    const disableBtn = document.getElementById('cpDisableBtn');

    if (State.cpLocked) {
        iconWrap.style.background = 'rgba(244,67,54,0.12)';
        iconWrap.style.color = '#f44336';
        title.textContent = 'Control Panel Locked';
        tag1.textContent = 'Blocked';
        tag1.className = 'tag tag-red';
        tag2.textContent = 'Restricted';
        tag2.className = 'tag tag-red';
        desc.textContent = 'Control Panel and Settings are disabled for users';
        
        lockPreset.classList.add('active');
        unlockPreset.classList.remove('active');
        disableBtn.style.display = 'flex';
    } else {
        iconWrap.style.background = 'rgba(76,175,80,0.12)';
        iconWrap.style.color = '#4caf50';
        title.textContent = 'Control Panel Unlocked';
        tag1.textContent = 'Accessible';
        tag1.className = 'tag tag-green';
        tag2.textContent = 'Full Access';
        tag2.className = 'tag tag-green';
        desc.textContent = 'Users can open Control Panel and Settings';
        
        lockPreset.classList.remove('active');
        unlockPreset.classList.add('active');
        disableBtn.style.display = 'none';
    }
}

async function lockControlPanel() {
    try {
        await window.electronAPI.lockControlPanel();
        State.cpLocked = true;
        updateCpUI();
    } catch (err) {
        console.error('Failed to lock Control Panel:', err);
        alert('Failed to lock Control Panel. Make sure launcher is running as admin.');
    }
}

async function unlockControlPanel() {
    try {
        await window.electronAPI.unlockControlPanel();
        State.cpLocked = false;
        updateCpUI();
    } catch (err) {
        console.error('Failed to unlock Control Panel:', err);
        alert('Failed to unlock Control Panel. Make sure launcher is running as admin.');
    }
}

$("cpModal")?.addEventListener("click", (e) => {
  if (e.target.id === "cpModal") closeCPModal();
});