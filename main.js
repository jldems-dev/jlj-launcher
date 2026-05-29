const { app } = require("electron");
app.disableHardwareAcceleration();
const { bootstrap } = require("./src/main/main");

app.whenReady().then(() => {
  bootstrap();
});