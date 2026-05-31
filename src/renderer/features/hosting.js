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
    if (!window.electronAPI?.getLeft4Dead2Maps) {
      throw new Error("Map database API is unavailable");
    }

    const maps = await window.electronAPI.getLeft4Dead2Maps();
    State.cachedMaps = maps;

    const select = $("hostGameMap");
    if (!select) return;

    select.innerHTML = '<option value="">Select a map...</option>';
    maps.forEach((map) => {
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
            <div style="font-size:11px;color:var(--text-muted);white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${room.host.pcName} â€¢ ${room.host.mapname}</div>
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

