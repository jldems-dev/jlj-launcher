const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { createLoggingService, sanitize } = require("../src/main/services/loggingService");

test("sanitizes credential fields, bearer values, and Windows profile names", () => {
  const result = sanitize({ accessToken: "private", message: "Bearer abc.def token C:\\Users\\Alice\\file.txt" });
  assert.equal(result.accessToken, "[REDACTED]");
  assert.match(result.message, /Bearer \[REDACTED\]/);
  assert.match(result.message, /C:\\Users\\\[REDACTED\]/);
});

test("writes structured daily error logs", (t) => {
  const logDir = fs.mkdtempSync(path.join(os.tmpdir(), "launcher-logs-"));
  t.after(() => fs.rmSync(logDir, { recursive: true, force: true }));
  const logger = createLoggingService({ getPath: () => logDir }, { logDir });
  logger.log("ERROR", "test", "failure", { password: "private" });
  const [file] = fs.readdirSync(logDir);
  assert.match(file, /^app-\d{4}-\d{2}-\d{2}\.log$/);
  const record = JSON.parse(fs.readFileSync(path.join(logDir, file), "utf8").trim());
  assert.equal(record.level, "ERROR");
  assert.equal(record.component, "test");
  assert.equal(record.details.password, "[REDACTED]");
});
