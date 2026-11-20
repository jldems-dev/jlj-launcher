"use strict";

const DEFAULT_TTL_MS = 15 * 60 * 1000;

function createOwnerSession({ ttlMs = DEFAULT_TTL_MS, now = Date.now, onExpire = () => {} } = {}) {
  let expiresAt = 0;
  let webContentsId = null;

  function invalidate(reason = "logout") {
    const hadSession = webContentsId !== null;
    expiresAt = 0;
    webContentsId = null;
    if (hadSession) onExpire(reason);
    return hadSession;
  }

  function establish(id) {
    if (!Number.isSafeInteger(id) || id < 0) throw new Error("Invalid owner session client");
    webContentsId = id;
    expiresAt = now() + ttlMs;
  }

  function isActive(id, refresh = true) {
    if (webContentsId === null || webContentsId !== id) return false;
    if (now() >= expiresAt) {
      invalidate("expired");
      return false;
    }
    if (refresh) expiresAt = now() + ttlMs;
    return true;
  }

  return { establish, isActive, invalidate };
}

module.exports = { DEFAULT_TTL_MS, createOwnerSession };
