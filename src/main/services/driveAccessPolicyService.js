const path = require("node:path");
const { runWindowsPolicy } = require("./windowsPolicyRunner");

const sourcePath = path.join(__dirname, "driveAccessPolicy.cs");
const scriptPath = path.join(__dirname, "driveAccessPolicy.ps1");
let pending = false;

function validateRequest(action, initialMask) {
  if (!["status", "enable", "disable", "rollback"].includes(action)) {
    throw new Error("Invalid drive policy action.");
  }
  if (initialMask !== undefined && (action !== "enable" || ![0, 3, 4, 7, 8, 15, 67108863].includes(initialMask))) {
    throw new Error("Select a valid Windows drive option.");
  }
}

async function manageDriveAccessPolicy(action, initialMask) {
  validateRequest(action, initialMask);
  if (process.platform !== "win32") throw new Error("Local Group Policy requires Windows.");
  if (pending) throw new Error("A drive policy request is already running.");

  pending = true;
  try {
    const state = await runWindowsPolicy({ scriptPath, sourcePath, request: { action, initialMask } });
    if (state.error) throw new Error(state.error);
    return state;
  } finally {
    pending = false;
  }
}

module.exports = { manageDriveAccessPolicy, validateRequest };
