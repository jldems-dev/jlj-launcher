const drivePolicyLabels = {
  unconfigured: "Not Configured",
  enabled: "Enabled",
  disabled: "Disabled",
};

let drivePolicyBusy = false;
let drivePolicyState;

function driveAccessLetters(mask) {
  if (mask === 0) return "no drives restricted";
  return Array.from({ length: 26 }, (_, index) => index)
    .filter((index) => mask & (1 << index))
    .map((index) => String.fromCharCode(65 + index) + ":")
    .join(", ");
}

function updateDriveAccessControls() {
  const state = drivePolicyState;
  const hasSelection = state &&
    [state.configuredMask, state.effectiveMask, state.savedMask].some(Number.isInteger);
  const needsSelection = state && !hasSelection;
  $("driveAccessSelection").hidden = !needsSelection;
  $("driveAccessRefresh").disabled = drivePolicyBusy;
  $("driveAccessMask").disabled = drivePolicyBusy;
  $("driveAccessRollback").disabled = drivePolicyBusy || !state?.canRollback;
  $("driveAccessEnable").disabled = drivePolicyBusy || !state ||
    (state.configured === "enabled" && state.configuredMask === state.effectiveMask) ||
    (needsSelection && !$("driveAccessMask").value);
  $("driveAccessDisable").disabled = drivePolicyBusy || !state ||
    (state.configured === "disabled" && state.effectiveMask == null);
}

async function requestDriveAccessPolicy(action) {
  if (drivePolicyBusy || !State.isOwnerLoggedIn) return;

  drivePolicyBusy = true;
  updateDriveAccessControls();
  $("driveAccessStatus").textContent = "Checking Windows policy…";
  try {
    const select = $("driveAccessMask");
    const initial = action === "enable" && !$("driveAccessSelection").hidden && select.value
      ? Number(select.value)
      : undefined;
    const state = await window.electronAPI.driveAccessPolicy(action, initial);
    drivePolicyState = state;

    const saved = drivePolicyLabels[state.configured];
    let message = "Local Group Policy — " + saved + ".";
    const selection = state.configuredMask ?? state.savedMask;
    if (selection != null) message += " Saved drive selection — " + driveAccessLetters(selection) + ".";
    message += state.effectiveMask == null
      ? " Current Windows registry — no restriction from this setting."
      : " Current Windows registry — " + driveAccessLetters(state.effectiveMask) + ".";
    if ((state.configured === "enabled" && state.configuredMask !== state.effectiveMask) ||
        (state.configured === "disabled" && state.effectiveMask != null)) {
      message += " The saved policy and live registry differ.";
    }
    $("driveAccessStatus").textContent = message;
    if (action !== "status") {
      showToast(state.verified ? "Windows confirmed the policy and live registry" : "Windows did not confirm the requested policy",
        state.verified ? "success" : "error");
    }
  } catch (error) {
    $("driveAccessStatus").textContent = error.message;
    drivePolicyState = undefined;
  } finally {
    drivePolicyBusy = false;
    updateDriveAccessControls();
  }
}

function bindDriveAccessPolicy() {
  $("driveAccessMask").addEventListener("change", updateDriveAccessControls);
  $("driveAccessRefresh").addEventListener("click", () => requestDriveAccessPolicy("status"));
  $("driveAccessEnable").addEventListener("click", () => requestDriveAccessPolicy("enable"));
  $("driveAccessDisable").addEventListener("click", () => requestDriveAccessPolicy("disable"));
  $("driveAccessRollback").addEventListener("click", () => requestDriveAccessPolicy("rollback"));
  updateDriveAccessControls();
}
