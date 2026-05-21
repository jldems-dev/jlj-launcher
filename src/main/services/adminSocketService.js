const io = require("socket.io-client");
const si = require("systeminformation");
const os = require("os");
const { exec } = require("child_process");

const runtimeState = require("./runtimeState");

let socket = null;
let monitoringInterval = null;
// Get local IP address
function getLocalIP() {
    const interfaces = os.networkInterfaces();
    for (const name of Object.keys(interfaces)) {
        for (const iface of interfaces[name]) {
            if (iface.family === 'IPv4' && !iface.internal) {
                return iface.address;
            }
        }
    }
    return '127.0.0.1';
} 

function connectSocket() {
  const localIP = getLocalIP();
  socket = io(`http://${localIP}:3000`, {
    transports: ["websocket"],
    reconnection: true,
  });

  socket.on("connect", () => {
    console.log("✅ Connected to admin server");

    socket.emit("client-connected", {
      pcId: os.hostname(),
      online: true,
    });

    startMonitoring();
  });

  socket.on("disconnect", () => {
    console.log("❌ Disconnected from admin server");
  });

  // =========================
  // ADMIN COMMANDS
  // =========================

  socket.on("shutdown-pc", () => {
    exec("shutdown /s /t 0");
  });

  socket.on("restart-pc", () => {
    exec("shutdown /r /t 0");
  });

  socket.on("lock-pc", () => {
    exec("rundll32.exe user32.dll,LockWorkStation");
  });
}

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
    console.error(err);
  }
}

function startMonitoring() {
  if (monitoringInterval) {
    clearInterval(monitoringInterval);
  }

  monitoringInterval = setInterval(() => {
    sendPCStats();
  }, 5000);
}

module.exports = {
  connectSocket,
};
