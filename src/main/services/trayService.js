const { app, Menu, Tray } = require("electron");
const path = require("path");

function createTrayService({ getMainWindow, checkForUpdates }) {
  let tray = null;

  function showLauncher() {
    const mainWindow = getMainWindow();
    if (!mainWindow || mainWindow.isDestroyed()) return;

    mainWindow.setSkipTaskbar(false);
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.show();
    mainWindow.focus();
    mainWindow.moveTop();
  }

  function hideLauncher() {
    const mainWindow = getMainWindow();
    if (!mainWindow || mainWindow.isDestroyed()) return;

    // A hidden window is absent from Alt+Tab; skipTaskbar also prevents a
    // transient taskbar entry while Windows processes the visibility change.
    mainWindow.setSkipTaskbar(true);
    mainWindow.hide();
  }

  function restartApp() {
    app.relaunch();
    app.quit();
  }

  async function checkForLauncherUpdates() {
    showLauncher();
    try {
      await checkForUpdates?.();
    } catch (error) {
      console.error("Tray update check failed:", error);
    }
  }

  function exitApp() {
    app.quit();
  }

  function create() {
    if (tray) return tray;

    const iconPath = path.join(
      app.getAppPath(),
      "assets",
      "images",
      "favicon.ico",
    );

    tray = new Tray(iconPath);
    tray.setToolTip("JLJGAMINGHOUSE Launcher");
    tray.setContextMenu(
      Menu.buildFromTemplate([
        { label: "Show Launcher", click: showLauncher },
        { label: "Check for Updates", click: checkForLauncherUpdates },
        { type: "separator" },
        { label: "Restart Launcher", click: restartApp },
        { label: "Exit", click: exitApp },
      ]),
    );
    tray.on("click", showLauncher);
    tray.on("double-click", showLauncher);

    return tray;
  }

  function destroy() {
    if (!tray) return;
    tray.destroy();
    tray = null;
  }

  return {
    create,
    destroy,
    hideLauncher,
    showLauncher,
  };
}

module.exports = { createTrayService };
