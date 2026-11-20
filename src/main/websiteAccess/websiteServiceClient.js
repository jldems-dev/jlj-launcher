"use strict";

const net = require("node:net");
const crypto = require("node:crypto");

const PROTOCOL_VERSION = 1;
const MAX_MESSAGE_BYTES = 1024 * 1024;
const DEFAULT_PIPE_NAME = "\\\\.\\pipe\\JLJWebsiteProtection.v1";
const OPERATIONS = new Set(["GetCapabilities", "GetStatus", "ValidatePolicy", "ApplyPolicy", "RestoreLastKnownGood"]);
const RESPONSE_KEYS = {
  GetCapabilities: ["serviceVersion", "protocolVersion", "operations", "maximumMessageBytes", "maximumRules", "policyMode", "enforcementActive", "resolverConfigured"],
  GetStatus: ["serviceVersion", "protocolVersion", "state", "heartbeatUtc", "lastErrorCode", "lastAcceptedRevision", "lastAcceptedSha256", "mode", "enforcementActive", "resolverConfigured"],
  ValidatePolicy: ["valid", "policyRevision", "sha256", "revisionAvailable", "enforcementActive"],
  ApplyPolicy: ["accepted", "duplicate", "policyRevision", "sha256", "mode", "enforcementActive"],
  RestoreLastKnownGood: ["restored", "policyRevision", "sha256", "mode", "enforcementActive"],
};

function hasExactKeys(value, keys) {
  return value && typeof value === "object" && !Array.isArray(value)
    && Object.keys(value).sort().join("|") === [...keys].sort().join("|");
}

function validResponseBody(operation, body) {
  if (!hasExactKeys(body, RESPONSE_KEYS[operation])) return false;
  if (operation === "GetCapabilities") {
    return typeof body.serviceVersion === "string" && body.protocolVersion === PROTOCOL_VERSION
      && Array.isArray(body.operations) && body.operations.every((item) => typeof item === "string")
      && body.maximumMessageBytes === MAX_MESSAGE_BYTES && body.maximumRules === 5000
      && body.policyMode === "monitoring" && body.enforcementActive === false && body.resolverConfigured === false;
  }
  if (operation === "GetStatus") {
    return typeof body.serviceVersion === "string" && body.protocolVersion === PROTOCOL_VERSION
      && ["starting", "healthy", "degraded", "stopped"].includes(body.state)
      && typeof body.heartbeatUtc === "string" && (body.lastErrorCode === null || typeof body.lastErrorCode === "string")
      && Number.isSafeInteger(body.lastAcceptedRevision) && (body.lastAcceptedSha256 === null || /^[a-f0-9]{64}$/.test(body.lastAcceptedSha256))
      && body.mode === "monitoring" && body.enforcementActive === false && body.resolverConfigured === false;
  }
  if (operation === "ValidatePolicy") {
    return body.valid === true && Number.isSafeInteger(body.policyRevision) && /^[a-f0-9]{64}$/.test(body.sha256)
      && body.revisionAvailable === true && body.enforcementActive === false;
  }
  if (operation === "ApplyPolicy") {
    return body.accepted === true && typeof body.duplicate === "boolean" && Number.isSafeInteger(body.policyRevision)
      && /^[a-f0-9]{64}$/.test(body.sha256) && body.mode === "monitoring" && body.enforcementActive === false;
  }
  return body.restored === true && Number.isSafeInteger(body.policyRevision) && /^[a-f0-9]{64}$/.test(body.sha256)
    && body.mode === "monitoring" && body.enforcementActive === false;
}

class WebsiteServiceError extends Error {
  constructor(code) {
    super(code);
    this.name = "WebsiteServiceError";
    this.code = code;
  }
}

function createWebsiteServiceClient({
  pipeName = DEFAULT_PIPE_NAME,
  timeoutMs = 2500,
  platform = process.platform,
  connect = (name) => net.createConnection(name),
  createRequestId = () => crypto.randomUUID(),
} = {}) {
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 100 || timeoutMs > 30000) throw new Error("Service timeout is invalid");

  function request(operation, body = {}) {
    if (platform !== "win32") return Promise.reject(new WebsiteServiceError("SERVICE_UNAVAILABLE"));
    if (!OPERATIONS.has(operation) || !body || typeof body !== "object" || Array.isArray(body)) {
      return Promise.reject(new WebsiteServiceError("INVALID_REQUEST"));
    }
    const bodyKeys = operation === "ApplyPolicy" || operation === "ValidatePolicy" ? ["policy"] : [];
    if (!hasExactKeys(body, bodyKeys) || (bodyKeys.length && (!body.policy || typeof body.policy !== "object" || Array.isArray(body.policy)))) {
      return Promise.reject(new WebsiteServiceError("INVALID_REQUEST"));
    }

    const requestId = createRequestId();
    const envelope = { protocolVersion: PROTOCOL_VERSION, requestId, operation, body };
    const payload = `${JSON.stringify(envelope)}\n`;
    if (Buffer.byteLength(payload, "utf8") > MAX_MESSAGE_BYTES) return Promise.reject(new WebsiteServiceError("MESSAGE_TOO_LARGE"));

    return new Promise((resolve, reject) => {
      let socket;
      let settled = false;
      let received = "";
      const finish = (error, value) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        if (socket && !socket.destroyed) socket.destroy();
        if (error) reject(error); else resolve(value);
      };
      const timer = setTimeout(() => finish(new WebsiteServiceError("SERVICE_TIMEOUT")), timeoutMs);
      try {
        socket = connect(pipeName);
      } catch {
        finish(new WebsiteServiceError("SERVICE_UNAVAILABLE"));
        return;
      }
      socket.setEncoding?.("utf8");
      socket.on("connect", () => socket.write(payload, "utf8", (error) => {
        if (error) finish(new WebsiteServiceError("SERVICE_UNAVAILABLE"));
      }));
      socket.on("data", (chunk) => {
        received += String(chunk);
        if (Buffer.byteLength(received, "utf8") > MAX_MESSAGE_BYTES) {
          finish(new WebsiteServiceError("PROTOCOL_ERROR"));
          return;
        }
        const newline = received.indexOf("\n");
        if (newline < 0) return;
        const extra = received.slice(newline + 1);
        if (extra.trim()) {
          finish(new WebsiteServiceError("PROTOCOL_ERROR"));
          return;
        }
        let response;
        try { response = JSON.parse(received.slice(0, newline)); }
        catch { finish(new WebsiteServiceError("PROTOCOL_ERROR")); return; }
        const baseKeys = ["protocolVersion", "requestId", "success"];
        const expectedKeys = response?.success === true ? [...baseKeys, "body"] : [...baseKeys, "error"];
        if (!response || typeof response !== "object" || Array.isArray(response)
          || Object.keys(response).sort().join("|") !== expectedKeys.sort().join("|")
          || response.protocolVersion !== PROTOCOL_VERSION
          || response.requestId !== requestId
          || typeof response.success !== "boolean") {
          finish(new WebsiteServiceError("PROTOCOL_ERROR"));
          return;
        }
        if (!response.success) {
          const code = typeof response.error === "string" && /^[A-Z][A-Z0-9_]{0,63}$/.test(response.error)
            ? response.error : "REMOTE_ERROR";
          finish(new WebsiteServiceError(code));
          return;
        }
        if (!validResponseBody(operation, response.body)) {
          finish(new WebsiteServiceError("PROTOCOL_ERROR"));
          return;
        }
        finish(null, response.body);
      });
      socket.on("error", () => finish(new WebsiteServiceError("SERVICE_UNAVAILABLE")));
      socket.on("close", () => { if (!settled) finish(new WebsiteServiceError("SERVICE_UNAVAILABLE")); });
    });
  }

  return {
    getCapabilities: () => request("GetCapabilities"),
    getStatus: () => request("GetStatus"),
    validatePolicy: (policy) => request("ValidatePolicy", { policy }),
    applyPolicy: (policy) => request("ApplyPolicy", { policy }),
    restoreLastKnownGood: () => request("RestoreLastKnownGood"),
    request,
  };
}

module.exports = { PROTOCOL_VERSION, MAX_MESSAGE_BYTES, DEFAULT_PIPE_NAME, WebsiteServiceError, createWebsiteServiceClient };
