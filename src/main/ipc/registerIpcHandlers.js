const { exec } = require("child_process");
const util = require("util");
const path = require("path");
const fs = require("node:fs/promises");
const { app, shell, dialog } = require('electron');
const systemActivityService = require("../services/systemActivityService");
const { requireTrustedOwner, isTrustedMainFrame } = require("../security/ipcSecurity");
const { createImportPreviewManager } = require("../websiteAccess/importExport");
const { createPolicySnapshot } = require("../websiteAccess/policyEngine");

const execAsync = util.promisify(exec);

function registerIpcHandlers({
  ipcMain,
  appUpdateService,
  store,
  trackingService,
  launchService,
  detectionService,
  hostService,
  updateService,
  getMainWindow,
  hideMainWindow,
  cpService,
  popupWindowService,
  adminSocketService,
  logger,
  diagnosticsService,
  ownerSession,
  websiteServiceClient,
}) {
  const requireOwner = (event) => requireTrustedOwner(event, { mainWindow: getMainWindow(), app, ownerSession });
  const importPreviews = createImportPreviewManager({
    dialog,
    getMainWindow,
    repository: { listRules: store.listWebsiteRules, applyImportedRules: store.applyImportedWebsiteRules },
  });

  ipcMain.handle("app-update:get-state", () => appUpdateService.getState());
  ipcMain.handle("app-update:check", () => appUpdateService.checkForUpdates());
  ipcMain.handle("app-update:update", () => appUpdateService.updateApp());

  ipcMain.handle("diagnostics:get", () => diagnosticsService.collect());
  ipcMain.handle("diagnostics:export", () => diagnosticsService.exportReport());
  ipcMain.handle("diagnostics:open-logs", async () => {
    const error = await shell.openPath(logger.logDir);
    if (error) throw new Error(error);
    return { success: true };
  });
  ipcMain.handle("check-for-updates", () => appUpdateService.checkForUpdates());

  ipcMain.handle("get-app-version", () => {
    return app.getVersion();
  });

  ipcMain.handle("get-system-idle-state", () => {
    return systemActivityService.getState();
  });

  ipcMain.handle("db-get-games", () => {
    return store.getGames();
  });

  ipcMain.handle("db-get-left4dead2-maps", () => {
    return store.getLeft4Dead2Maps();
  });

  ipcMain.handle("db-get-pc-specs", () => {
    return store.getPcSpecs();
  });

  ipcMain.handle("db-save-pc-spec", (event, pcSpec, originalPcIp) => {
    return store.savePcSpec(pcSpec, originalPcIp);
  });

  ipcMain.handle("db-delete-pc-spec", (event, pcIp) => {
    return store.deletePcSpec(pcIp);
  });

  ipcMain.handle("db-get-storage-info", () => {
    return store.getStorageInfo();
  });

  ipcMain.handle("db-add-game", (event, game) => {
    const newGame = store.addGame(game);
    return { id: newGame.id, ...newGame };
  });

  ipcMain.handle("db-delete-game", (event, id) => {
    console.log("IPC db-delete-game:", id);
    trackingService.stopIfRunning(id);
    return store.deleteGame(id);
  });

  ipcMain.handle("db-update-game", (event, id, updates) => {
    console.log("IPC db-update-game:", id, updates);
    return store.updateGame(id, updates);
  });

  ipcMain.handle("db-verify-owner", async (event, username, password) => {
    if (!isTrustedMainFrame(event, getMainWindow(), app)) throw new Error("Unauthorized IPC sender");
    if (typeof username !== "string" || username.length > 128 || typeof password !== "string" || password.length > 1024) return false;
    ownerSession.invalidate("new-login-attempt");
    const valid = await store.verifyOwner(username, password);
    if (valid) ownerSession.establish(event.sender.id);
    return valid;
  });

  ipcMain.on("db-owner-logout", (event) => {
    if (isTrustedMainFrame(event, getMainWindow(), app)) ownerSession.invalidate("logout");
  });

  ipcMain.handle("db-change-password", async (event, currentPass, newPass) => {
    requireOwner(event);
    if (typeof currentPass !== "string" || currentPass.length > 1024 || typeof newPass !== "string" || newPass.length > 1024) throw new Error("Password request is invalid");
    return store.changePassword(currentPass, newPass);
  });

  ipcMain.handle("website-access:get-status", (event) => {
    requireOwner(event);
    return store.getWebsiteAccessStatus();
  });

  const serviceCall = async (operation) => {
    try { return { available: true, result: await operation() }; }
    catch (error) {
      const code = /^[A-Z][A-Z0-9_]{0,63}$/.test(error?.code || "") ? error.code : "SERVICE_UNAVAILABLE";
      return { available: false, code };
    }
  };
  const makeServicePolicy = () => {
    const settings = store.getWebsiteAccessSettings();
    const rules = store.listWebsiteRules().map(({ domain, action, enabled, includeSubdomains }) => ({ domain, action, enabled, includeSubdomains }));
    return createPolicySnapshot(rules, settings.policyRevision);
  };
  let pendingPolicySync = Promise.resolve();
  const syncServicePolicy = () => {
    pendingPolicySync = pendingPolicySync.then(() => {
      let policy;
      try { policy = makeServicePolicy(); }
      catch { return { available: false, code: "INVALID_POLICY" }; }
      return serviceCall(() => websiteServiceClient.applyPolicy(policy));
    });
    return pendingPolicySync;
  };

  const protectionReadiness = (service) => {
    const reasons = [];
    let policySynchronized = false;
    if (!service.available) {
      reasons.push(`The Windows protection service could not be reached (${service.code}). Confirm it is installed and running.`);
    } else {
      const status = service.result;
      if (status.state !== "healthy" || status.lastErrorCode) {
        reasons.push(`The protection service is ${status.state}${status.lastErrorCode ? ` (${status.lastErrorCode})` : ""}.`);
      }
      try {
        const policy = makeServicePolicy();
        policySynchronized = policy.policyRevision === status.lastAcceptedRevision && policy.sha256 === status.lastAcceptedSha256;
        if (!policySynchronized) reasons.push("Sync the current policy to the service before enabling protection.");
        if (!policy.rules.some((rule) => rule.enabled && rule.action === "allow")) reasons.push("Add at least one enabled ALLOW rule.");
      } catch {
        reasons.push("The launcher could not validate the saved website policy.");
      }
      reasons.push(status.resolverConfigured
        ? "The service cannot verify upstream DNS resolution."
        : "The service has no configured and tested upstream DNS resolver.");
      reasons.push("Windows DNS recovery and enforcement controls are unavailable in this service build.");
    }
    return { policySynchronized, reasons };
  };

  ipcMain.handle("website-access:service-status", async (event) => {
    requireOwner(event);
    const service = await serviceCall(() => websiteServiceClient.getStatus());
    return { ...service, readiness: protectionReadiness(service) };
  });

  let protectionRequestPending = false;
  ipcMain.handle("website-access:request-protection", async (event, enable) => {
    requireOwner(event);
    if (typeof enable !== "boolean") throw new Error("Protection request is invalid");
    if (protectionRequestPending) return { reasons: ["A protection request is already in progress."] };

    protectionRequestPending = true;
    const action = enable ? "Enable" : "Disable";
    const reasons = [];
    try {
      const service = await serviceCall(() => websiteServiceClient.getStatus());
      if (enable || !service.available) {
        reasons.push(...protectionReadiness(service).reasons);
      } else if (!service.result.enforcementActive) {
        // Inactive enforcement alone does not verify that normal DNS has been restored.
        reasons.push("The service reports inactive enforcement. DNS restoration has not been verified.");
      } else {
        reasons.push("Windows DNS recovery and enforcement controls are unavailable in this service build.");
      }
    } catch {
      reasons.push("The launcher could not complete the protection checks.");
    } finally {
      protectionRequestPending = false;
    }
    logger?.log("WARN", "website-access", `${action} protection request refused`, { reasons });
    return { reasons };
  });

  ipcMain.handle("website-access:service-capabilities", (event) => {
    requireOwner(event);
    return serviceCall(() => websiteServiceClient.getCapabilities());
  });
  ipcMain.handle("website-access:service-validate-policy", (event) => {
    requireOwner(event);
    let policy;
    try { policy = makeServicePolicy(); }
    catch { return Promise.resolve({ available: false, code: "INVALID_POLICY" }); }
    return serviceCall(() => websiteServiceClient.validatePolicy(policy));
  });
  ipcMain.handle("website-access:service-sync-policy", (event) => {
    requireOwner(event);
    return syncServicePolicy();
  });
  ipcMain.handle("website-access:service-restore-policy", (event) => {
    requireOwner(event);
    return serviceCall(() => websiteServiceClient.restoreLastKnownGood());
  });

  ipcMain.handle("website-access:list-rules", (event, filters = {}) => {
    requireOwner(event);
    if (!filters || typeof filters !== "object" || Array.isArray(filters) || Object.keys(filters).some((key) => !["action", "search", "enabled"].includes(key))) throw new Error("Rule filters are invalid");
    return store.listWebsiteRules(filters);
  });

  ipcMain.handle("website-access:save-rule", async (event, rule) => {
    requireOwner(event);
    if (!rule || typeof rule !== "object" || Array.isArray(rule) || Object.keys(rule).some((key) => !["id", "domain", "action", "enabled", "includeSubdomains"].includes(key))) throw new Error("Rule payload is invalid");
    const saved = store.saveWebsiteRule(rule);
    await syncServicePolicy();
    return saved;
  });

  ipcMain.handle("website-access:set-rule-enabled", async (event, payload) => {
    requireOwner(event);
    if (!payload || typeof payload !== "object" || Array.isArray(payload) || Object.keys(payload).some((key) => !["id", "enabled"].includes(key))) throw new Error("Rule update is invalid");
    const changed = store.setWebsiteRuleEnabled(payload.id, payload.enabled);
    if (changed) await syncServicePolicy();
    return changed;
  });

  ipcMain.handle("website-access:remove-rule", async (event, payload) => {
    requireOwner(event);
    if (!payload || typeof payload !== "object" || Array.isArray(payload) || Object.keys(payload).some((key) => key !== "id")) throw new Error("Rule removal is invalid");
    const removed = store.removeWebsiteRule(payload.id);
    if (removed) await syncServicePolicy();
    return removed;
  });

  ipcMain.handle("website-access:get-settings", (event) => {
    requireOwner(event);
    return store.getWebsiteAccessSettings();
  });

  ipcMain.handle("website-access:save-settings", async (event, settings) => {
    requireOwner(event);
    const saved = store.saveWebsiteAccessSettings(settings);
    await syncServicePolicy();
    return saved;
  });

  ipcMain.handle("website-access:preview-import", (event) => {
    requireOwner(event);
    return importPreviews.preview(event.sender.id);
  });

  ipcMain.handle("website-access:apply-import", async (event, previewId) => {
    requireOwner(event);
    const imported = importPreviews.apply(previewId, event.sender.id);
    await syncServicePolicy();
    return imported;
  });

  ipcMain.handle("website-access:export", async (event) => {
    requireOwner(event);
    const result = await dialog.showSaveDialog(getMainWindow(), {
      title: "Export Website Access Rules",
      defaultPath: "jlj-website-access.json",
      filters: [{ name: "JSON files", extensions: ["json"] }],
    });
    if (result.canceled || !result.filePath) return { canceled: true };
    const config = store.exportWebsiteAccessConfig();
    await fs.writeFile(result.filePath, `${JSON.stringify(config, null, 2)}\n`, { encoding: "utf8", flag: "w" });
    return { canceled: false };
  });

  ipcMain.handle("website-access:list-logs", (event, filters = {}) => {
    requireOwner(event);
    if (!filters || typeof filters !== "object" || Array.isArray(filters) || Object.keys(filters).some((key) => !["limit", "beforeId"].includes(key))) throw new Error("Log filters are invalid");
    return store.listWebsiteAccessLogs(filters);
  });

  ipcMain.handle("db-get-gcash-number", () => {
    return store.getGcashNumber();
  });

  ipcMain.handle("db-update-gcash-number", (event, gcashNumber) => {
    return store.updateGcashNumber(gcashNumber);
  });

  ipcMain.handle("db-get-server-url", () => {
    return adminSocketService.getServerUrl(store);
  });

  ipcMain.handle("db-save-server-url", (event, serverUrl) => {
    return adminSocketService.saveServerUrl(store, serverUrl);
  });

  ipcMain.handle("db-delete-server-url", () => {
    return adminSocketService.deleteServerUrl(store);
  });

  ipcMain.handle("save-cover-image", (event, params) => {
    return store.saveCoverImage(params);
  });

  ipcMain.on(
    "launch-game",
    async (event, gameId, launchMethod, appId, title) => {
      await launchService.launchGame(gameId, launchMethod, appId, title);
    },
  );

  ipcMain.on("launch-game-as-host", async (event, game) => {
    await launchService.launchGameAsHost(game);
  });
  ipcMain.handle("launch-game-host-join", async (event, room) => {
    return await launchService.launchGameHostJoin(room);
  });

  ipcMain.on("stop-game", (event, gameId) => {
    trackingService.stopIfRunning(gameId);
  });

  ipcMain.handle("is-game-running", (event, gameId) => {
    return trackingService.isRunning(gameId);
  });

  ipcMain.handle("get-elapsed-time", (event, gameId) => {
    return trackingService.getElapsedTime(gameId);
  });

  ipcMain.handle("scan-for-games", async () => {
    return detectionService.scanForInstalledGames();
  });

  ipcMain.handle("check-game-updates", async () => {
    return await updateService.checkAllGames();
  });

  ipcMain.on("open-external", (event, url) => {
    shell.openExternal(url);
  });

  ipcMain.handle("open-multiple-roblox-instances", async () => {
    const exePath = path.join(
      app.getAppPath(),
      "instance",
      "Multiple ROBLOX.exe",
    );
    const error = await shell.openPath(exePath);

    if (error) {
      throw new Error(error);
    }

    return { success: true };
  });

  ipcMain.on("window-minimize", () => {
    hideMainWindow();
  });
  ipcMain.on("window-maximize", () => {
    const mainWindow = getMainWindow();
    if (!mainWindow || mainWindow.isDestroyed()) return;
    if (mainWindow.isMaximized()) mainWindow.unmaximize();
    else mainWindow.maximize();
  });
  ipcMain.on("window-close", () => {
    const mainWindow = getMainWindow();
    if (mainWindow && !mainWindow.isDestroyed()) mainWindow.close();
  });

  ipcMain.handle("pc:restart", async () => {
    await execAsync("shutdown /r /t 0");
    return { success: true };
  });

  ipcMain.handle("pc:shutdown", async () => {
    await execAsync("shutdown /s /t 0");
    return { success: true };
  });

  // Room hosting handlers
  ipcMain.handle("create-room", async (event, payload) => {
    return hostService.createRoom(payload);
  });

  ipcMain.handle("get-rooms", async () => {
    return hostService.getRooms();
  });

  ipcMain.handle("close-room", async (event, roomId) => {
    return hostService.closeRoom(roomId);
  });
  ipcMain.on("show-popup-window", (_, data) => {
    popupWindowService.showPopup(data);
  });

  // Control Panel
  ipcMain.handle("cp:lock", async () => {
    return cpService.lockControlPanel();
  });

  ipcMain.handle("cp:unlock", async () => {
    return cpService.unlockControlPanel();
  });

  ipcMain.handle("cp:status", async () => {
    return cpService.getStatus();
  });

  ipcMain.handle("cp:open-control-panel", async () => {
    return cpService.openWindowsControlPanel();
  });

  ipcMain.handle("cp:open-gpedit", async () => {
    return cpService.openLocalGroupPolicyEditor();
  });
}

module.exports = { registerIpcHandlers };
