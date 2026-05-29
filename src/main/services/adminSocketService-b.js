require("dotenv").config();
const io = require("socket.io-client");
const si = require("systeminformation");
const os = require("os");
const { exec } = require("child_process");
const screenshot = require("screenshot-desktop");
const robot = require("robotjs");

const runtimeState = require("./runtimeState");
const popupWindowService = require("./popupWindowService");

let socket = null;
let monitoringInterval = null;
let screenStreamInterval = null;
let previewInterval = null;

const SCREEN_STREAM_FPS = 15;

// =========================
// SECURITY CONFIG (CLIENT SIDE)
// =========================

// MUST MATCH SERVER SOCKET_SECRET ONLY
const SOCKET_SECRET = process.env.SOCKET_SECRET;

// Trusted session flag (server must approve)
let TRUSTED_SESSION = false;

// Allowed events whitelist (VERY IMPORTANT)
const CONTROL_EVENTS = new Set([
  "shutdown-pc",
  "restart-pc",
  "lock-pc",
  "start-remote-desktop",
  "stop-remote-desktop",
  "remote-mouse-move",
  "remote-mouse-click",
  "remote-mouse-down",
  "remote-mouse-up",
  "remote-scroll",
  "remote-key",
  "remote-type",
]);

const SAFE_EVENTS = new Set([
  "pcs-update",
  "templates-update",
  "show-popup",
  "screen-frame",
  "preview-frame",
  "session-approved",
]); 

// =========================
// SOCKET CONNECTION
// =========================

function connectSocket() {
  const SERVER_URL = "https://jlj-launcher-server.onrender.com";

  console.log("🔌 Connecting to:", SERVER_URL);
  console.log("🔑 Token present:", !!SOCKET_SECRET);

  socket = io(SERVER_URL, {
    transports: ["websocket", "polling"],
    query: {
      token: SOCKET_SECRET,
    },
    extraHeaders: {
      "x-auth-token": SOCKET_SECRET,
    },
    reconnection: true,
    reconnectionAttempts: 10,
    reconnectionDelay: 2000,
    timeout: 20000,
  });

  // Debug
  socket.on("connect_error", (err) => {
    console.error("❌ Connection error:", err.message);
  });

  socket.on("error", (err) => {
    console.error("❌ Socket error:", err);
  });

  // =========================
  // CONNECTION SECURITY CHECK
  // =========================

  socket.on("connect", () => {
    console.log("✅ Connected to server");

    socket.emit("register-client", {
      type: "pc",
      pcId: os.hostname(),
    });

    socket.emit("client-connected", {
      pcId: os.hostname(),
      online: true,
    });

    startMonitoring();
  });

  // Server must explicitly approve session
  socket.on("session-approved", () => {
    TRUSTED_SESSION = true;
    console.log("🔐 Session approved by server");
  });

  socket.on("disconnect", () => {
    console.log("❌ Disconnected");
    TRUSTED_SESSION = false;
    stopScreenStream();
    stopPreviewStream();
  });

  // =========================
  // POPUP
  // =========================

  socket.on("show-popup", (data) => {
    popupWindowService.showPopup({
      title: data.title,
      message: data.message,
      type: data.type,
    });
  });

  // =========================
  // ADMIN COMMANDS (SAFE EXECUTION ONLY)
  // =========================

  socket.on("shutdown-pc", () => {
    if (!TRUSTED_SESSION) return;
    exec("shutdown /s /t 0");
  });

  socket.on("restart-pc", () => {
    if (!TRUSTED_SESSION) return;
    exec("shutdown /r /t 0");
  });

  socket.on("lock-pc", () => {
    if (!TRUSTED_SESSION) return;
    exec("rundll32.exe user32.dll,LockWorkStation");
  });

  // =========================
  // REMOTE DESKTOP (PROTECTED)
  // =========================

  socket.on("start-remote-desktop", () => {
    if (!TRUSTED_SESSION) return;
    startScreenStream();
  });

  socket.on("stop-remote-desktop", () => {
    stopScreenStream();
  });

  // =========================
  // INPUT CONTROL (SAFE GUARD)
  // =========================

  socket.on("remote-mouse-move", (data) => {
    if (!TRUSTED_SESSION) return;

    const { x, y, screenWidth, screenHeight } = data;
    const actual = robot.getScreenSize();

    robot.moveMouse(
      Math.round((x / screenWidth) * actual.width),
      Math.round((y / screenHeight) * actual.height),
    );
  });

  socket.on("remote-mouse-click", (data) => {
    if (!TRUSTED_SESSION) return;
    robot.mouseClick(data.button || "left", !!data.double);
  });

  socket.on("remote-key", (data) => {
    if (!TRUSTED_SESSION) return;

    const keyMap = {
      Enter: "return",
      Backspace: "backspace",
      Tab: "tab",
      Escape: "escape",
      " ": "space",
    };

    robot.keyTap(keyMap[data.key] || data.key.toLowerCase());
  });

  socket.on("remote-type", (data) => {
    if (!TRUSTED_SESSION) return;
    robot.typeString(data?.text || "");
  });
}

// =========================
// SCREEN STREAM
// =========================

async function captureAndSendScreen() {
  if (!socket?.connected || !TRUSTED_SESSION) return;

  const imgBuffer = await screenshot({
    format: "jpeg",
    quality: 60,
  });

  socket.emit("screen-frame", {
    pcId: os.hostname(),
    image: `data:image/jpeg;base64,${imgBuffer.toString("base64")}`,
    timestamp: Date.now(),
  });
}

function startScreenStream() {
  if (screenStreamInterval) clearInterval(screenStreamInterval);

  captureAndSendScreen();

  screenStreamInterval = setInterval(
    captureAndSendScreen,
    Math.floor(1000 / SCREEN_STREAM_FPS),
  );
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

  const cpu = await si.currentLoad();
  const mem = await si.mem();

  socket.emit("pc-status", {
    pcId: os.hostname(),
    cpuUsage: cpu.currentLoad.toFixed(1),
    ramUsage: ((mem.active / mem.total) * 100).toFixed(1),
    online: true,
    timestamp: Date.now(),
  });
}

function startMonitoring() {
  if (monitoringInterval) clearInterval(monitoringInterval);
  monitoringInterval = setInterval(sendPCStats, 5000);
}

module.exports = { connectSocket };
