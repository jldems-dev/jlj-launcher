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
    showToast("Failed to load games from database", "error");
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
          ${
            game.isFavorite
              ? `<img src="assets/icons/star-solid.svg" width="14" alt="Favorite">`
              : `<img src="assets/icons/star-line.svg" width="14" alt="Not Favorite">`
          }
        </button>
        <button class="action-btn delete" onclick='event.stopPropagation();openDeleteModal(${gameId})' title="Delete game">
          <img src='assets/icons/trash.svg' width='14'>
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
            ${game.isFavorite ? '<span class="tag">â˜… Favorite</span>' : ""}
            ${game.status === "update" ? '<span class="tag" style="color:#ff6b6b;border-color:rgba(255,50,50,0.3)">Update Available</span>' : ""}
          </div>
          <div class="game-card-actions">
            <button class="card-btn play" onclick='event.stopPropagation();launchGameById(${gameId})'><img src='assets/icons/play.svg' width='14'> Play</button>
            <button class="card-btn host" onclick='event.stopPropagation();openHostModal(${JSON.stringify(game)})'><img src='assets/icons/globe.svg' width='14'> Host</button>
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
          version: game.latestVersion,
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
      if (!updated) throw new Error(`Game ${gameId} was not found in database`);
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
      $("ownerSettingsNav").style.display = "flex";
      $("addControlPanel").style.display = "flex";
      $("openGpeditNav").style.display = "flex";
      loadOwnerSettingsDisplay();
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
  $("ownerSettingsNav").style.display = "none";
  $("addControlPanel").style.display = "none";
  $("openGpeditNav").style.display = "none";
  closeOwnerSettings();
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
    showToast("Failed to add game to database", "error");
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
        throw new Error(`Game ${State.gameToDelete} was not found in database`);
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
    showToast("Failed to delete game from database", "error");
  }
}

