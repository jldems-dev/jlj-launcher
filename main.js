/* const { app } = require("electron");
const { bootstrap } = require("./src/main/app");

app.whenReady().then(() => {
  bootstrap(app.getAppPath());
});
 */
const { app } = require("electron");
app.disableHardwareAcceleration();
const { bootstrap } = require("./src/main/main");

app.whenReady().then(() => {
  bootstrap();
});