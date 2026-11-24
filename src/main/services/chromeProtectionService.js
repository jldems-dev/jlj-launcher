const path = require("node:path");
const { runWindowsPolicy } = require("./windowsPolicyRunner");

function validateRequest(action, options) {
  if (action === "status") {
    if (options === undefined) return {};
    if (options?.elevate === true) return { elevate: true };
    throw new Error("Unexpected Chrome protection options.");
  }
  if (action === "disable") {
    if (options !== undefined) throw new Error("Unexpected Chrome protection options.");
    return {};
  }
  if (action === "enable") {
    if (options !== undefined) throw new Error("Unexpected Chrome protection options.");
    return {};
  }
  if (action !== "audit" || !options ||
      typeof options.sample !== "string" || options.sample.length > 1024 ||
      (options.sample && !/^[a-z]:\\[^\x00-\x1f*?"<>|:]+\.(exe|msi)$/i.test(options.sample)) ||
      typeof options.install !== "boolean" || typeof options.execution !== "boolean" ||
      typeof options.portable !== "boolean" || !(options.install || options.execution || options.portable)) {
    throw new Error("Select at least one restriction, and use a local EXE or MSI path for any sample.");
  }
  const { sample, install, execution, portable } = options;
  return { sample, install, execution, portable };
}

function createChromeProtection({
  platform = process.platform,
  runCommand,
  elevate,
  windowsDirectory = process.env.SystemRoot,
} = {}) {
  let pending = false;
  return {
    async run(action, options) {
      if (platform !== "win32") return { state: "unsupported", detail: "AppLocker requires Windows." };
      if (pending) throw new Error("A Chrome protection operation is already running.");
      pending = true;
      try {
        const state = await runWindowsPolicy({
          scriptPath: path.join(__dirname, "chromeProtection.ps1"),
          request: { action, ...options },
          allowElevation: action !== "status" || options?.elevate === true,
          timeout: 120_000,
          runCommand, elevate, windowsDirectory,
        });
        if (state.elevationSid) {
          delete state.elevationSid;
          state.requiresElevation = true;
        }
        return state;
      } catch (error) {
        return { state: "error", detail: "Windows policy check failed. " + String(error.message).split("\n")[0] };
      } finally {
        pending = false;
      }
    },
  };
}

module.exports = { createChromeProtection, validateRequest };
