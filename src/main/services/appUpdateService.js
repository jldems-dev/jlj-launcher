const semver = require("semver");

function createAppUpdateService({
  autoUpdater,
  app,
  getMainWindow,
  logger,
  canInstallUpdate = () => true,
}) {
  let latestUpdateInfo = null;
  let downloadedUpdateInfo = null;
  let status = "idle";
  let statusMessage = null;
  let checking = false;
  let downloading = false;
  let installing = false;
  let checkPromise = null;
  let downloadPromise = null;

  function currentVersion() {
    return app.getVersion();
  }

  function getMainWindowIfAvailable() {
    const mainWindow = getMainWindow();
    return mainWindow && !mainWindow.isDestroyed() ? mainWindow : null;
  }

  function sendStatus(payload) {
    const mainWindow = getMainWindowIfAvailable();
    if (!mainWindow) return;

    mainWindow.webContents.send("app-update-status", payload);
    const legacyStatus = payload.status === "downloaded" ? "ready" : payload.status;
    mainWindow.webContents.send("update-status", {
      ...payload,
      status: legacyStatus,
      version: payload.latestVersion || payload.currentVersion,
    });
  }

  function sendProgress(payload) {
    const mainWindow = getMainWindowIfAvailable();
    if (!mainWindow) return;

    mainWindow.webContents.send("app-update-progress", payload);
    mainWindow.webContents.send("update-progress", {
      percent: Number(payload.percent || 0).toFixed(2),
      speed: payload.speed || 0,
    });
  }

  function errorDetails(error) {
    return {
      code: error?.code || null,
      statusCode: error?.statusCode || error?.response?.statusCode || null,
      message: error?.message || String(error || "Update failed"),
    };
  }

  function logError(context, error) {
    try {
      logger?.log("ERROR", "updater", context, errorDetails(error));
    } catch {
      // Logging failure must not stop the application or update flow.
    }
  }

  function isRateLimitError(error) {
    const details = errorDetails(error);
    return (
      details.statusCode === 403 ||
      details.statusCode === 429 ||
      /rate.?limit|api rate limit/i.test(details.message)
    );
  }

  function isNoPublishedReleaseError(error) {
    const details = errorDetails(error);
    return (
      details.statusCode === 404 ||
      /ERR_UPDATER_CHANNEL_FILE_NOT_FOUND|ERR_UPDATER_NO_PUBLISHED_VERSIONS|no published versions/i.test(
        `${details.code || ""} ${details.message}`,
      )
    );
  }

  function userFacingError(error) {
    if (isRateLimitError(error)) {
      return "GitHub temporarily rate-limited update checks. Try again later.";
    }
    return errorDetails(error).message;
  }

  function makeStatus(nextStatus, latestVersion, message, extra = {}) {
    return {
      status: nextStatus,
      currentVersion: currentVersion(),
      latestVersion: latestVersion || latestUpdateInfo?.version || null,
      ...(message ? { message } : {}),
      ...extra,
    };
  }

  function publishStatus(nextStatus, latestVersion, message, extra = {}) {
    status = nextStatus;
    statusMessage = message || null;
    const payload = makeStatus(nextStatus, latestVersion, message, extra);
    sendStatus(payload);
    return payload;
  }

  function isNewerVersion(version) {
    const current = semver.valid(currentVersion());
    const candidate = semver.valid(version);
    return Boolean(current && candidate && semver.gt(candidate, current));
  }

  function acceptUpdateInfo(info) {
    checking = false;
    if (!info?.version || !isNewerVersion(info.version)) {
      latestUpdateInfo = null;
      downloadedUpdateInfo = null;
      publishStatus("none", currentVersion());
      return false;
    }

    latestUpdateInfo = info;
    downloadedUpdateInfo = null;
    publishStatus("available", info.version, null, {
      releaseDate: info.releaseDate || null,
    });
    return true;
  }

  function getState() {
    const currentStatus = installing
      ? "installing"
      : downloading
        ? "downloading"
        : downloadedUpdateInfo
          ? "downloaded"
          : checking
            ? "checking"
            : status === "error"
              ? "error"
              : updateAvailable()
                ? "available"
                : status;

    return makeStatus(
      currentStatus,
      downloadedUpdateInfo?.version || latestUpdateInfo?.version || null,
      statusMessage,
    );
  }

  function updateAvailable() {
    return Boolean(latestUpdateInfo && isNewerVersion(latestUpdateInfo.version));
  }

  function setNoUpdate(message = null) {
    checking = false;
    latestUpdateInfo = null;
    downloadedUpdateInfo = null;
    return publishStatus("none", currentVersion(), message);
  }

  function handleCheckFailure(error) {
    checking = false;
    if (isNoPublishedReleaseError(error)) {
      return setNoUpdate("No published update is available yet.");
    }

    logError("Update check failed", error);
    return publishStatus("error", latestUpdateInfo?.version, userFacingError(error));
  }

  function setup() {
    autoUpdater.autoDownload = false;
    autoUpdater.autoInstallOnAppQuit = false;
    autoUpdater.allowPrerelease = false;
    autoUpdater.allowDowngrade = false;
    autoUpdater.channel = "latest";

    autoUpdater.on("checking-for-update", () => {
      checking = true;
      publishStatus("checking", latestUpdateInfo?.version || null);
    });

    autoUpdater.on("update-available", (info) => {
      checking = false;
      acceptUpdateInfo(info);
    });

    autoUpdater.on("update-not-available", () => {
      setNoUpdate();
    });

    autoUpdater.on("download-progress", (progress) => {
      downloading = true;
      status = "downloading";
      sendProgress({
        percent: Math.max(0, Math.min(100, Number(progress.percent || 0))),
        speed: Number(progress.bytesPerSecond || 0),
        transferred: Number(progress.transferred || 0),
        total: Number(progress.total || 0),
      });
    });

    autoUpdater.on("update-downloaded", (info) => {
      downloading = false;
      downloadedUpdateInfo = info || latestUpdateInfo;
      statusMessage = null;
      publishStatus(
        "downloaded",
        downloadedUpdateInfo?.version || latestUpdateInfo?.version || null,
      );
    });

    autoUpdater.on("error", (error) => {
      checking = false;
      downloading = false;
      if (isNoPublishedReleaseError(error)) {
        setNoUpdate("No published update is available yet.");
        return;
      }
      logError("Updater emitted an error", error);
      publishStatus("error", latestUpdateInfo?.version, userFacingError(error));
    });
  }

  async function checkForUpdates() {
    if (checkPromise) return checkPromise;
    if (installing || downloading) return getState();

    checking = true;
    publishStatus("checking", latestUpdateInfo?.version || null);

    const operation = (async () => {
      try {
        const result = await autoUpdater.checkForUpdates();
        const info = result?.updateInfo;
        if (info && status === "checking") {
          if (result.isUpdateAvailable) acceptUpdateInfo(info);
          else setNoUpdate();
        }
        return getState();
      } catch (error) {
        return handleCheckFailure(error);
      } finally {
        checking = false;
        if (status === "checking") status = "idle";
      }
    })();

    checkPromise = operation;
    try {
      return await operation;
    } finally {
      if (checkPromise === operation) checkPromise = null;
    }
  }

  function canInstallNow() {
    try {
      return canInstallUpdate() !== false;
    } catch (error) {
      logError("Could not verify whether the launcher is safe to update", error);
      return false;
    }
  }

  function installDownloadedUpdate() {
    if (!downloadedUpdateInfo) return getState();
    if (installing) return getState();

    if (!canInstallNow()) {
      return publishStatus(
        "downloaded",
        downloadedUpdateInfo.version || latestUpdateInfo?.version,
        "Update downloaded. Close active games before installing.",
      );
    }

    installing = true;
    publishStatus(
      "installing",
      downloadedUpdateInfo.version || latestUpdateInfo?.version,
    );
    try {
      autoUpdater.quitAndInstall(false, true);
    } catch (error) {
      installing = false;
      logError("Could not start the update installer", error);
      return publishStatus(
        "error",
        latestUpdateInfo?.version,
        userFacingError(error),
      );
    }
    return getState();
  }

  async function updateApp() {
    if (installing || downloading) return getState();
    if (downloadedUpdateInfo) return installDownloadedUpdate();

    if (!updateAvailable()) {
      const checked = await checkForUpdates();
      if (checked.status !== "available") return checked;
    }

    if (!updateAvailable()) return getState();
    if (downloadPromise) return downloadPromise;

    downloading = true;
    statusMessage = null;
    publishStatus("downloading", latestUpdateInfo?.version);

    const operation = (async () => {
      try {
        await autoUpdater.downloadUpdate();
        downloading = false;
        if (!downloadedUpdateInfo) downloadedUpdateInfo = latestUpdateInfo;
        return installDownloadedUpdate();
      } catch (error) {
        downloading = false;
        downloadedUpdateInfo = null;
        logError("Update download failed", error);
        return publishStatus(
          "error",
          latestUpdateInfo?.version,
          userFacingError(error),
        );
      } finally {
        if (downloadPromise === operation) downloadPromise = null;
      }
    })();

    downloadPromise = operation;
    return operation;
  }

  return {
    setup,
    checkForUpdates,
    updateApp,
    getState,
  };
}

module.exports = { createAppUpdateService };
