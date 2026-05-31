const { app } = require("electron");
const { bootstrap } = require("./src/main/main");

const gotSingleInstanceLock = app.requestSingleInstanceLock();

if (!gotSingleInstanceLock) {
  app.quit();
} else {
  app.disableHardwareAcceleration();
  bootstrap();
}
