const test = require("node:test");
const assert = require("node:assert/strict");
const { hashPassword, verifyPassword, isPasswordHash } = require("../src/main/security/passwordVerifier");
const { createOwnerSession } = require("../src/main/security/ownerSession");
const { isTrustedMainFrame, requireTrustedOwner } = require("../src/main/security/ipcSecurity");

test("scrypt verifier is salted, verifies candidates and supports legacy upgrade detection", async () => {
  const first = await hashPassword("correct horse battery staple");
  const second = await hashPassword("correct horse battery staple");
  assert.notEqual(first, second);
  assert.equal(isPasswordHash(first), true);
  assert.equal(await verifyPassword(first, "correct horse battery staple"), true);
  assert.equal(await verifyPassword(first, "wrong"), false);
  assert.equal(await verifyPassword("legacy-pass", "legacy-pass"), true);
  assert.equal(isPasswordHash("legacy-pass"), false);
});

test("owner session expires and can be invalidated on logout or lock", () => {
  let time = 100;
  const reasons = [];
  const session = createOwnerSession({ ttlMs: 50, now: () => time, onExpire: (reason) => reasons.push(reason) });
  session.establish(7);
  assert.equal(session.isActive(7), true);
  time += 51;
  assert.equal(session.isActive(7), false);
  session.establish(7);
  session.invalidate("windows-lock");
  assert.deepEqual(reasons, ["expired", "windows-lock"]);
});

test("website authorization requires trusted main frame and active owner session", () => {
  const contents = { id: 9, mainFrame: { url: "file:///C:/app/index.html" } };
  const window = { webContents: contents, isDestroyed: () => false };
  const app = { getAppPath: () => "C:/app" };
  const event = { sender: contents, senderFrame: contents.mainFrame };
  assert.equal(isTrustedMainFrame(event, window, app), true);
  const childEvent = { ...event, senderFrame: { url: "file:///C:/app/index.html" } };
  assert.equal(isTrustedMainFrame(childEvent, window, app), false);

  const session = createOwnerSession();
  assert.throws(() => requireTrustedOwner(event, { mainWindow: window, app, ownerSession: session }), /expired/i);
  session.establish(contents.id);
  assert.doesNotThrow(() => requireTrustedOwner(event, { mainWindow: window, app, ownerSession: session }));
});
