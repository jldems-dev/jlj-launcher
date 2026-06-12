const { EventEmitter } = require("events");
const { powerMonitor } = require("electron");

const IDLE_THRESHOLD_SECONDS = 5 * 60;
const ACTIVE_CHECK_INTERVAL_MS = 15 * 1000;
const IDLE_CHECK_INTERVAL_MS = 30 * 1000;

const events = new EventEmitter();
const busyReasons = new Set();

let idle = false;
let checkTimer = null;
let started = false;

function calculateIdleState() {
  return (
    busyReasons.size === 0 &&
    powerMonitor.getSystemIdleTime() >= IDLE_THRESHOLD_SECONDS
  );
}

function publishState(nextIdle) {
  if (idle === nextIdle) return;
  idle = nextIdle;
  events.emit("change", getState());
}

function scheduleCheck() {
  clearTimeout(checkTimer);
  checkTimer = setTimeout(
    checkActivity,
    idle ? IDLE_CHECK_INTERVAL_MS : ACTIVE_CHECK_INTERVAL_MS,
  );
  checkTimer.unref?.();
}

function checkActivity() {
  publishState(calculateIdleState());
  scheduleCheck();
}

function start() {
  if (started) return;
  started = true;
  checkActivity();
}

function stop() {
  started = false;
  clearTimeout(checkTimer);
  checkTimer = null;
}

function setBusy(reason, isBusy) {
  if (!reason) return;

  if (isBusy) busyReasons.add(reason);
  else busyReasons.delete(reason);

  if (started) {
    publishState(calculateIdleState());
    scheduleCheck();
  }
}

function getState() {
  return {
    idle,
    idleSeconds: powerMonitor.getSystemIdleTime(),
    busy: busyReasons.size > 0,
  };
}

function onChange(listener) {
  events.on("change", listener);
  return () => events.off("change", listener);
}

module.exports = {
  getState,
  onChange,
  setBusy,
  start,
  stop,
};
