require("dotenv").config();
const io = require("socket.io-client");
const si = require("systeminformation");
const os = require("os");
const { exec } = require("child_process");
const screenshot = require("screenshot-desktop");
const robot = require("robotjs");

const runtimeState = require("./runtimeState");
const popupWindowService = require("./popupWindowService");

const PC_SECRET = process.env.PC_SECRET;
const SERVER_URL = "http://localhost:3002/";

let socket = null;
let monitoringInterval = null;
let screenStreamInterval = null;
let previewInterval = null;
const SCREEN_STREAM_FPS = 15;

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

function connectSocket() {
  const pcIp = getLocalIP();
  const socketOptions = {
    transports: ["websocket"],
    reconnection: true,
  };

  socket = io(SERVER_URL, socketOptions);

  socket.on("connect", () => {
    // console.log("✅ Connected to admin server");

    // Register as PC client
    socket.emit("register-client", {
      type: "pc",
      pcId: os.hostname(),
      pcIp: pcIp,
    });

    socket.emit("client-connected", {
      pcId: os.hostname(),
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
    if (!socket?.connected) return;

    try {
      const imgBuffer = await screenshot({ format: "jpeg", quality });
      const base64Image = imgBuffer.toString("base64");
      const screenSize = robot.getScreenSize();

      socket.emit("preview-frame", {
        pcId: os.hostname(),
        image: `data:image/jpeg;base64,${base64Image}`,
        width: screenSize.width,
        height: screenSize.height,
        timestamp: Date.now(),
      });
    } catch (err) {
      console.error("Preview capture error:", err);
    }
  }

  function startPreviewStream(quality = 30, fps = 5) {
    if (previewInterval) clearInterval(previewInterval);

    capturePreview(quality);

    const intervalMs = Math.floor(1000 / fps);
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
      const actualScreen = robot.getScreenSize();
      const scaledX = Math.round((x / screenWidth) * actualScreen.width);
      const scaledY = Math.round((y / screenHeight) * actualScreen.height);
      robot.moveMouse(scaledX, scaledY);
    } catch (err) {
      console.error("Mouse move error:", err);
    }
  });

  socket.on("remote-mouse-click", (data) => {
    try {
      const { button, double } = data;
      robot.mouseClick(button || "left", !!double);
    } catch (err) {
      console.error("Mouse click error:", err);
    }
  });

  socket.on("remote-mouse-down", (data) => {
    try {
      robot.mouseToggle("down", data?.button || "left");
    } catch (err) {
      console.error("Mouse down error:", err);
    }
  });

  socket.on("remote-mouse-up", (data) => {
    try {
      robot.mouseToggle("up", data?.button || "left");
    } catch (err) {
      console.error("Mouse up error:", err);
    }
  });

  socket.on("remote-scroll", (data) => {
    try {
      const { deltaY } = data;
      const scrollAmount = Math.round(deltaY / 100);
      if (scrollAmount !== 0) {
        robot.scrollMouse(
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
        robot.keyTap(robotKey, modifiers);
      } else {
        robot.keyTap(robotKey);
      }
    } catch (err) {
      console.error("Key press error:", err);
    }
  });

  socket.on("remote-type", (data) => {
    try {
      robot.typeString(data?.text || "");
    } catch (err) {
      console.error("Type error:", err);
    }
  });
}

// =========================
// SCREEN STREAMING
// =========================

async function captureAndSendScreen() {
  if (!socket?.connected) return;

  try {
    const imgBuffer = await screenshot({ format: "jpeg", quality: 60 });
    const base64Image = imgBuffer.toString("base64");
    const screenSize = robot.getScreenSize();

    socket.emit("screen-frame", {
      pcId: os.hostname(),
      image: `data:image/jpeg;base64,${base64Image}`,
      width: screenSize.width,
      height: screenSize.height,
      timestamp: Date.now(),
    });
  } catch (err) {
    console.error("Screen capture error:", err);
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
    const cpu = await si.currentLoad();
    const mem = await si.mem();
    const disks = await si.fsSize();

    socket.emit("pc-status", {
      pcId: os.hostname(),
      currentGame: runtimeState.currentGame,
      cpuUsage: cpu.currentLoad.toFixed(1),
      ramUsage: ((mem.active / mem.total) * 100).toFixed(1),
      storage: disks.map((disk) => ({
        drive: disk.mount,
        totalGB: (disk.size / 1024 / 1024 / 1024).toFixed(1),
        usedGB: (disk.used / 1024 / 1024 / 1024).toFixed(1),
        freeGB: ((disk.size - disk.used) / 1024 / 1024 / 1024).toFixed(1),
      })),
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
  monitoringInterval = setInterval(sendPCStats, 5000);
}

module.exports = { connectSocket };
