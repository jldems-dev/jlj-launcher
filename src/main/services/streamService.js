const { spawn } = require("child_process");
const path = require("path");
const fs = require("fs");

function createStreamService() {
  let sunshineProcess = null;

  function getSunshinePath() {
    const possiblePaths = [
      "C:\\Program Files\\Sunshine\\sunshine.exe",
      "C:\\Program Files (x86)\\Sunshine\\sunshine.exe",
    ];

    for (const p of possiblePaths) {
      if (fs.existsSync(p)) {
        return p;
      }
    }

    return null;
  }

  async function startSunshine() {
    return new Promise((resolve, reject) => {
      const sunshinePath = getSunshinePath();

      if (!sunshinePath) {
        return reject(new Error("Sunshine is not installed"));
      }

      // already running
      if (sunshineProcess) {
        return resolve({
          success: true,
          alreadyRunning: true,
        });
      }

      sunshineProcess = spawn(sunshinePath, [], {
        detached: true,
        stdio: "ignore",
      });

      sunshineProcess.unref();

      resolve({
        success: true,
      });
    });
  }

  async function startMoonlight(ip) {
    return new Promise((resolve, reject) => {
      const moonlightPath =
        "C:\\Program Files\\Moonlight Game Streaming\\Moonlight.exe";

      if (!fs.existsSync(moonlightPath)) {
        return reject(new Error("Moonlight is not installed"));
      }

      const moonlight = spawn(moonlightPath,  ["stream", ip, "Desktop"], {
        detached: true,
        stdio: "ignore",
      });

      moonlight.unref();

      resolve({
        success: true,
      });
    });
  }

  return {
    startSunshine,
    startMoonlight,
  };
}

module.exports = {
  createStreamService,
};
