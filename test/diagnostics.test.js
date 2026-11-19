const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const zlib = require("node:zlib");
const { createLoggingService, sanitize } = require("../src/main/services/loggingService");
const { zipFiles } = require("../src/main/services/diagnosticsService");

test("sanitizes credential fields, bearer values, and Windows profile names", () => {
  const result = sanitize({ accessToken: "private", message: "Bearer abc.def token C:\\Users\\Alice\\file.txt" });
  assert.equal(result.accessToken, "[REDACTED]");
  assert.match(result.message, /Bearer \[REDACTED\]/);
  assert.match(result.message, /C:\\Users\\\[REDACTED\]/);
});

test("writes structured daily logs and retains recent errors", (t) => {
  const logDir = fs.mkdtempSync(path.join(os.tmpdir(), "launcher-logs-"));
  t.after(() => fs.rmSync(logDir, { recursive: true, force: true }));
  const logger = createLoggingService({ getPath: () => logDir }, { logDir });
  logger.log("ERROR", "test", "failure", { password: "private" });
  const [file] = logger.listLogFiles();
  const record = JSON.parse(fs.readFileSync(file, "utf8").trim());
  assert.equal(record.level, "ERROR");
  assert.equal(record.component, "test");
  assert.equal(record.details.password, "[REDACTED]");
  assert.equal(logger.getRecentErrors().length, 1);
});

test("creates a readable deflated ZIP archive", () => {
  const archive = zipFiles([{ name: "diagnostics/info.txt", data: "safe report" }]);
  assert.equal(archive.readUInt32LE(0), 0x04034b50);
  const nameLength = archive.readUInt16LE(26);
  const compressedSize = archive.readUInt32LE(18);
  const fileName = archive.subarray(30, 30 + nameLength).toString();
  const contents = zlib.inflateRawSync(archive.subarray(30 + nameLength, 30 + nameLength + compressedSize)).toString();
  assert.equal(fileName, "diagnostics/info.txt");
  assert.equal(contents, "safe report");
  assert.equal(archive.readUInt32LE(archive.length - 22), 0x06054b50);
});
