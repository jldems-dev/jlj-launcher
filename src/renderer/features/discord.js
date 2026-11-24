let discordBusy = false;
let discordVersion = null;

function bindDiscordTools() {
  $("discordOpenButton").addEventListener("click", () => runDiscordAction("launch"));
  $("discordRefreshButton").addEventListener("click", () => runDiscordAction("refresh"));
  $("discordInstallButton").addEventListener("click", () => runDiscordAction("install"));
  window.electronAPI?.onDiscordProgress?.((progress) => {
    const messages = {
      downloading: progress.percent == null ? "Downloading Discord…" : `Downloading Discord… ${progress.percent}%`,
      verifying: "Verifying the installer signature…",
      installing: "Running the official Discord installer…",
    };
    $("discordStatus").textContent = messages[progress.phase];
  });
}

function openDiscordTools() {
  $("discordModal").classList.add("active");
  runDiscordAction("open");
}

function closeDiscordTools() {
  $("discordModal").classList.remove("active");
}

function displayDiscordStatus(info) {
  const repair = info.canLaunch || info.needsRepair;
  $("discordOpenButton").hidden = !info.canLaunch;
  $("discordInstallButton").hidden = !info.supported;
  $("discordInstallButton").textContent = repair ? "Repair / Reinstall Discord" : "Install Discord";
  $("discordVersion").textContent = info.version ? `Installed version ${info.version}` : "";

  if (!info.supported) return "Discord integration requires Windows x64.";
  if (info.updaterRunning) return "Discord’s updater is running. Refresh when it finishes to check the installed version.";
  if (info.needsRepair) return "The Discord installation is incomplete. Use Repair / Reinstall to restore it.";
  if (!info.canLaunch) return "Discord is not installed for this Windows user.";
  if (discordVersion && info.version !== discordVersion) return `Installed version changed to ${info.version}. Discord manages its own updates.`;
  return "Discord checks for and applies its own updates. Refresh to see the installed version.";
}

async function runDiscordAction(action) {
  if (discordBusy) return;
  const api = window.electronAPI;
  const status = $("discordStatus");
  if (!api?.getDiscordStatus) {
    status.textContent = "Discord integration is unavailable.";
    return;
  }
  discordBusy = true;
  const buttons = [$("discordOpenButton"), $("discordRefreshButton"), $("discordInstallButton")];
  buttons.forEach((button) => { button.disabled = true; });
  try {
    if (action === "install") {
      const info = await api.installDiscord();
      displayDiscordStatus(info);
      discordVersion = info.version;
      status.textContent = "Discord setup completed. Discord manages its own updates.";
      return;
    }
    status.textContent = "Checking the Discord installation…";
    const info = await api.getDiscordStatus();
    status.textContent = displayDiscordStatus(info);
    discordVersion = info.version;
    if ((action === "open" || action === "launch") && info.canLaunch) {
      status.textContent = "Opening Discord through its updater…";
      const launched = await api.launchDiscord();
      const updated = launched.version && launched.version !== discordVersion;
      const message = displayDiscordStatus(launched);
      discordVersion = launched.version;
      status.textContent = updated || launched.updaterRunning ? message : "Discord launch requested. Check Discord for update progress, or refresh here to check the installed version.";
    }
  } catch (error) {
    status.textContent = error.message.replace(/^Error invoking remote method '[^']+': Error: /, "");
  } finally {
    discordBusy = false;
    buttons.forEach((button) => { button.disabled = false; });
  }
}
