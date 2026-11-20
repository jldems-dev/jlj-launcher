"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { EventEmitter } = require("node:events");
const { createWebsiteServiceClient, WebsiteServiceError, PROTOCOL_VERSION, MAX_MESSAGE_BYTES } = require("../src/main/websiteAccess/websiteServiceClient");

function fakeConnect(respond, { delay = 0, closeWithoutResponse = false } = {}) {
  return () => {
    const socket = new EventEmitter();
    socket.destroyed = false;
    socket.setEncoding = () => {};
    socket.destroy = () => { socket.destroyed = true; };
    socket.write = (payload, _encoding, callback) => {
      callback?.();
      const request = JSON.parse(payload.trim());
      if (closeWithoutResponse) {
        setTimeout(() => socket.emit("close"), delay);
      } else {
        setTimeout(() => socket.emit("data", `${JSON.stringify(respond(request))}\n`), delay);
      }
      return true;
    };
    process.nextTick(() => socket.emit("connect"));
    return socket;
  };
}

function success(request, body = {
  serviceVersion: "1.0.0", protocolVersion: 1, state: "healthy", heartbeatUtc: "2026-01-01T00:00:00Z",
  lastErrorCode: null, lastAcceptedRevision: -1, lastAcceptedSha256: null,
  mode: "monitoring", enforcementActive: false, resolverConfigured: false,
}) {
  return { protocolVersion: PROTOCOL_VERSION, requestId: request.requestId, success: true, body };
}

test("sends versioned correlated requests and accepts strict success responses", async () => {
  let seen;
  const client = createWebsiteServiceClient({
    platform: "win32", createRequestId: () => "00000000-0000-4000-8000-000000000001",
    connect: fakeConnect((request) => { seen = request; return success(request); }),
  });
  assert.deepEqual(await client.getStatus(), success({ requestId: "00000000-0000-4000-8000-000000000001" }).body);
  assert.deepEqual(seen, {
    protocolVersion: 1,
    requestId: "00000000-0000-4000-8000-000000000001",
    operation: "GetStatus",
    body: {},
  });
});

test("rejects protocol mismatch, request ID mismatch, extra fields and malformed messages", async () => {
  for (const respond of [
    (request) => ({ ...success(request), protocolVersion: 2 }),
    (request) => ({ ...success(request), requestId: "wrong" }),
    (request) => ({ ...success(request), unexpected: true }),
    (request) => ({ ...success(request), body: [] }),
    (request) => "not-json",
  ]) {
    const client = createWebsiteServiceClient({ platform: "win32", connect: fakeConnect(respond) });
    await assert.rejects(client.getStatus(), (error) => error instanceof WebsiteServiceError && error.code === "PROTOCOL_ERROR");
  }
});

test("reports sanitized service error codes and service unavailability", async () => {
  const client = createWebsiteServiceClient({
    platform: "win32",
    connect: fakeConnect((request) => ({ protocolVersion: 1, requestId: request.requestId, success: false, error: "UNAUTHORIZED" })),
  });
  await assert.rejects(client.applyPolicy({}), (error) => error.code === "UNAUTHORIZED");
  const unavailable = createWebsiteServiceClient({ platform: "win32", connect: () => { throw new Error("private path detail"); } });
  await assert.rejects(unavailable.getStatus(), (error) => error.code === "SERVICE_UNAVAILABLE" && !error.message.includes("private"));
  const nonWindows = createWebsiteServiceClient({ platform: "linux" });
  await assert.rejects(nonWindows.getStatus(), (error) => error.code === "SERVICE_UNAVAILABLE");
});

test("enforces connection timeout and rejects oversized requests", async () => {
  const timeoutClient = createWebsiteServiceClient({ platform: "win32", timeoutMs: 100, connect: fakeConnect(success, { delay: 500 }) });
  await assert.rejects(timeoutClient.getStatus(), (error) => error.code === "SERVICE_TIMEOUT");
  const sizeClient = createWebsiteServiceClient({ platform: "win32" });
  await assert.rejects(sizeClient.validatePolicy({ value: "x".repeat(MAX_MESSAGE_BYTES) }), (error) => error.code === "MESSAGE_TOO_LARGE");
});

test("rejects unknown operations before opening the pipe", async () => {
  let connected = false;
  const client = createWebsiteServiceClient({ platform: "win32", connect: () => { connected = true; throw new Error("should not connect"); } });
  await assert.rejects(client.request("StopService"), (error) => error.code === "INVALID_REQUEST");
  assert.equal(connected, false);
});
