require("dotenv").config();
const io = require("socket.io-client");
const os = require("os");
const { exec } = require("child_process");

const runtimeState = require("./runtimeState");
const popupWindowService = require("./popupWindowService");
const cpService = require("./cpService");

const PC_SECRET = process.env.PC_SECRET;
const SERVER_URL_SETTING_KEY = "https://jljgaminghouse.store/";
const PC_ID = os.hostname();
const MONITORING_INTERVAL_MS = 15000;
const STORAGE_REFRESH_MS = 60000;
const SCREEN_STREAM_FPS = 8;
const SCREEN_STREAM_QUALITY = 45;

let socket = null;
let currentServerUrl = "";
let monitoringInterval = null;
let screenStreamInterval = null;
let previewInterval = null;
let cachedStorage = [];
let cachedStorageAt = 0;
let screenCaptureRunning = false;
let previewCaptureRunning = false;
let cachedScreenSize = null;
let screenshotModule = null;
let robotModule = null;
let systemInformationModule = null;

function getScreenshot() {
  if (!screenshotModule) screenshotModule = require("screenshot-desktop");
  return screenshotModule;
}

function getRobot() {
  if (!robotModule) robotModule = require("robotjs");
  return robotModule;
}

function getSystemInformation() {
  if (!systemInformationModule) systemInformationModule = require("systeminformation");
  return systemInformationModule;
}

function getScreenSize() {
  if (!cachedScreenSize) cachedScreenSize = getRobot().getScreenSize();
  return cachedScreenSize;
}

function getLocalIP() {
  const interfaces = os.networkInterfaces();
  for (const name of Object.keys(interfaces)) {
    for (const iface of interfaces[name]) {
      if (iface.family === "IPv4" && !iface.internal) {
        return iface.address;
      }
    }
  }
  return "127.0.0.1";
}

function normalizeServerUrl(value) {
  const rawValue = String(value || "").trim();
  if (!rawValue) return "";

  let parsed;
  try {
    parsed = new URL(rawValue);
  } catch {
    throw new Error("Server URL must be a valid URL");
  }

  if (!["http:", "https:"].includes(parsed.protocol)) {
    throw new Error("Server URL must start with http:// or https://");
  }

  if (!parsed.hostname) {
    throw new Error("Server URL must include a hostname");
  }

  parsed.hash = "";
  parsed.search = "";
  return parsed.toString().replace(/\/$/, "");
}

function getSavedServerUrl(store) {
  if (!store?.getSetting) return "";
  return normalizeServerUrl(store.getSetting(SERVER_URL_SETTING_KEY));
}

function stopMonitoring() {
  if (monitoringInterval) {
    clearInterval(monitoringInterval);
    monitoringInterval = null;
  }
}

function disconnectSocket() {
  stopMonitoring();
  stopScreenStream();
  if (previewInterval) {
    clearInterval(previewInterval);
    previewInterval = null;
  }

  if (socket) {
    socket.removeAllListeners();
    socket.disconnect();
    socket = null;
  }
}

function connectSocket(serverUrl) {
  const normalizedServerUrl = normalizeServerUrl(serverUrl);
  if (!normalizedServerUrl) {
    console.warn("Socket connection skipped: no server URL is saved");
    disconnectSocket();
    currentServerUrl = "";
    return { connected: false, serverUrl: "" };
  }

  if (socket && currentServerUrl === normalizedServerUrl) {
    if (!socket.connected) socket.connect();
    return { connected: socket.connected, serverUrl: currentServerUrl };
  }

  disconnectSocket();
  currentServerUrl = normalizedServerUrl;

  const pcIp = getLocalIP();
  const socketOptions = {
    transports: ["websocket"],
    reconnection: true,
  };

  socket = io(currentServerUrl, socketOptions);

  socket.on("connect", () => {
    // console.log("✅ Connected to admin server");

    // Register as PC client
    socket.emit("register-client", {
      type: "pc",
      pcId: PC_ID,
      pcIp: pcIp,
    });

    socket.emit("client-connected", {
      pcId: PC_ID,
      online: true,
    });

    startMonitoring();
  });

  socket.on("show-popup", (data) => {
    // console.log("📨 POPUP RECEIVED:", data);

    popupWindowService.showPopup({
      title: data.title,
      message: data.message,
      type: data.type,
    });
  });

  socket.on("start-preview", (data) => {
    const { quality, fps } = data;
    // console.log(`👁️ Preview started (Q:${quality}, FPS:${fps})`);
    startPreviewStream(quality, fps);
  });

  socket.on("stop-preview", () => {
    // console.log("🛑 Preview stopped");
    stopPreviewStream();
  });

  async function capturePreview(quality = 30) {
    if (!socket?.connected || previewCaptureRunning) return;
    previewCaptureRunning = true;

    try {
      const imgBuffer = await getScreenshot()({ format: "jpeg", quality });
      const base64Image = imgBuffer.toString("base64");
      const screenSize = getScreenSize();

      socket.emit("preview-frame", {
        pcId: PC_ID,
        image: `data:image/jpeg;base64,${base64Image}`,
        width: screenSize.width,
        height: screenSize.height,
        timestamp: Date.now(),
      });
    } catch (err) {
      console.error("Preview capture error:", err);
    } finally {
      previewCaptureRunning = false;
    }
  }

  function startPreviewStream(quality = 30, fps = 5) {
    if (previewInterval) clearInterval(previewInterval);

    capturePreview(quality);

    const safeFps = Math.max(1, Math.min(Number(fps) || 5, 10));
    const intervalMs = Math.floor(1000 / safeFps);
    previewInterval = setInterval(() => capturePreview(quality), intervalMs);
  }

  function stopPreviewStream() {
    if (previewInterval) {
      clearInterval(previewInterval);
      previewInterval = null;
    }
  }

  // Update cleanup in disconnect
  socket.on("disconnect", () => {
    // console.log("❌ Disconnected from admin server");
    stopMonitoring();
    stopScreenStream();
    stopPreviewStream(); // Add this
  });

  // =========================
  // ADMIN COMMANDS
  // =========================

  socket.on("shutdown-pc", () => {
    console.log("🔴 Shutdown command received");
    exec("shutdown /s /t 0");
  });

  socket.on("restart-pc", () => {
    console.log("🔄 Restart command received");
    exec("shutdown /r /t 0");
  });

  socket.on("lock-pc", () => {
    console.log("🔒 Lock command received");
    exec("rundll32.exe user32.dll,LockWorkStation");
  });

  socket.on("open-control-panel", async () => {
    console.log("Control Panel open command received");
    try {
      await cpService.openWindowsControlPanel();
    } catch (err) {
      console.error("Open Control Panel error:", err);
    }
  });

  socket.on("open-gpedit", async () => {
    console.log("Local Group Policy Editor open command received");
    try {
      await cpService.openLocalGroupPolicyEditor();
    } catch (err) {
      console.error("Open Local Group Policy Editor error:", err);
    }
  });

  // =========================
  // REMOTE DESKTOP
  // =========================

  socket.on("start-remote-desktop", () => {
    console.log("🖥️ Remote desktop session started");
    startScreenStream();
  });

  socket.on("stop-remote-desktop", () => {
    console.log("🖥️ Remote desktop session stopped");
    stopScreenStream();
  });

  // Mouse events
  socket.on("remote-mouse-move", (data) => {
    try {
      const { x, y, screenWidth, screenHeight } = data;
      const actualScreen = getScreenSize();
      const scaledX = Math.round((x / screenWidth) * actualScreen.width);
      const scaledY = Math.round((y / screenHeight) * actualScreen.height);
      getRobot().moveMouse(scaledX, scaledY);
    } catch (err) {
      console.error("Mouse move error:", err);
    }
  });

  socket.on("remote-mouse-click", (data) => {
    try {
      const { button, double } = data;
      getRobot().mouseClick(button || "left", !!double);
    } catch (err) {
      console.error("Mouse click error:", err);
    }
  });

  socket.on("remote-mouse-down", (data) => {
    try {
      getRobot().mouseToggle("down", data?.button || "left");
    } catch (err) {
      console.error("Mouse down error:", err);
    }
  });

  socket.on("remote-mouse-up", (data) => {
    try {
      getRobot().mouseToggle("up", data?.button || "left");
    } catch (err) {
      console.error("Mouse up error:", err);
    }
  });

  socket.on("remote-scroll", (data) => {
    try {
      const { deltaY } = data;
      const scrollAmount = Math.round(deltaY / 100);
      if (scrollAmount !== 0) {
        getRobot().scrollMouse(
          Math.abs(scrollAmount),
          scrollAmount > 0 ? "up" : "down",
        );
      }
    } catch (err) {
      console.error("Scroll error:", err);
    }
  });

  // Keyboard events
  socket.on("remote-key", (data) => {
    try {
      const { key, ctrl, alt, shift, meta } = data;
      const modifiers = [];
      if (ctrl) modifiers.push("control");
      if (alt) modifiers.push("alt");
      if (shift) modifiers.push("shift");
      if (meta) modifiers.push("command");

      const keyMap = {
        Enter: "return",
        Return: "return",
        Backspace: "backspace",
        Tab: "tab",
        Escape: "escape",
        Delete: "delete",
        Home: "home",
        End: "end",
        PageUp: "pageup",
        PageDown: "pagedown",
        ArrowUp: "up",
        ArrowDown: "down",
        ArrowLeft: "left",
        ArrowRight: "right",
        " ": "space",
      };

      const robotKey = keyMap[key] || key.toLowerCase();

      if (modifiers.length > 0) {
        getRobot().keyTap(robotKey, modifiers);
      } else {
        getRobot().keyTap(robotKey);
      }
    } catch (err) {
      console.error("Key press error:", err);
    }
  });

  socket.on("remote-type", (data) => {
    try {
      getRobot().typeString(data?.text || "");
    } catch (err) {
      console.error("Type error:", err);
    }
  });

  return { connected: socket.connected, serverUrl: currentServerUrl };
}

function connectSocketFromStore(store) {
  return connectSocket(getSavedServerUrl(store));
}

function saveServerUrl(store, value) {
  if (!store?.setSetting) {
    throw new Error("Settings store is unavailable");
  }

  if (!String(value || "").trim()) {
    throw new Error("Server URL is required");
  }

  const normalizedServerUrl = normalizeServerUrl(value);
  store.setSetting(SERVER_URL_SETTING_KEY, normalizedServerUrl);
  connectSocket(normalizedServerUrl);
  return normalizedServerUrl;
}

function deleteServerUrl(store) {
  if (!store?.deleteSetting) {
    throw new Error("Settings store is unavailable");
  }

  store.deleteSetting(SERVER_URL_SETTING_KEY);
  disconnectSocket();
  currentServerUrl = "";
  return true;
}

function getServerUrl(store) {
  return getSavedServerUrl(store);
}

// =========================
// SCREEN STREAMING
// =========================

async function captureAndSendScreen() {
  if (!socket?.connected || screenCaptureRunning) return;
  screenCaptureRunning = true;

  try {
    const imgBuffer = await getScreenshot()({ format: "jpeg", quality: SCREEN_STREAM_QUALITY });
    const base64Image = imgBuffer.toString("base64");
    const screenSize = getScreenSize();

    socket.emit("screen-frame", {
      pcId: PC_ID,
      image: `data:image/jpeg;base64,${base64Image}`,
      width: screenSize.width,
      height: screenSize.height,
      timestamp: Date.now(),
    });
  } catch (err) {
    console.error("Screen capture error:", err);
  } finally {
    screenCaptureRunning = false;
  }
}

function startScreenStream() {
  if (screenStreamInterval) clearInterval(screenStreamInterval);

  captureAndSendScreen();

  const intervalMs = Math.floor(1000 / SCREEN_STREAM_FPS);
  screenStreamInterval = setInterval(captureAndSendScreen, intervalMs);
}

function stopScreenStream() {
  if (screenStreamInterval) {
    clearInterval(screenStreamInterval);
    screenStreamInterval = null;
  }
}

// =========================
// PC STATS
// =========================

async function sendPCStats() {
  if (!socket?.connected) return;

  try {
    const si = getSystemInformation();
    const [cpu, mem] = await Promise.all([si.currentLoad(), si.mem()]);
    if (Date.now() - cachedStorageAt > STORAGE_REFRESH_MS) {
      const disks = await si.fsSize();
      cachedStorage = disks.map((disk) => ({
        drive: disk.mount,
        totalGB: (disk.size / 1024 / 1024 / 1024).toFixed(1),
        usedGB: (disk.used / 1024 / 1024 / 1024).toFixed(1),
        freeGB: ((disk.size - disk.used) / 1024 / 1024 / 1024).toFixed(1),
      }));
      cachedStorageAt = Date.now();
    }

    socket.emit("pc-status", {
      pcId: PC_ID,
      currentGame: runtimeState.currentGame,
      cpuUsage: cpu.currentLoad.toFixed(1),
      ramUsage: ((mem.active / mem.total) * 100).toFixed(1),
      storage: cachedStorage,
      uptime: os.uptime(),
      online: true,
      timestamp: Date.now(),
    });
  } catch (err) {
    console.error("Stats error:", err);
  }
}

function startMonitoring() {
  if (monitoringInterval) clearInterval(monitoringInterval);
  sendPCStats();
  monitoringInterval = setInterval(sendPCStats, MONITORING_INTERVAL_MS);
}

module.exports = {
  connectSocket,
  connectSocketFromStore,
  deleteServerUrl,
  getServerUrl,
  normalizeServerUrl,
  saveServerUrl,
};
