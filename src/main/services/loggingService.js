const fs = require("fs");
const path = require("path");

const LEVELS = new Set(["DEBUG", "INFO", "WARN", "ERROR", "FATAL"]);
const SECRET_KEY = /token|password|secret|license|authorization|cookie|api.?key|auth.?code/i;
const SECRET_TEXT = /(bearer\s+)[A-Za-z0-9._~+\/-]+=*/gi;

function sanitize(value, key = "") {
  if (SECRET_KEY.test(key)) return "[REDACTED]";
  if (value instanceof Error) {
    return { name: value.name, message: String(value.message || "").replace(SECRET_TEXT, "$1[REDACTED]"), stack: String(value.stack || "").replace(SECRET_TEXT, "$1[REDACTED]") };
  }
  if (typeof value === "string") return value.replace(SECRET_TEXT, "$1[REDACTED]").replace(/([?&](?:access_token|refresh_token|code|client_secret|api_key)=)[^&\s]+/gi, "$1[REDACTED]").replace(/([A-Z]:\\Users\\)[^\\\s]+/gi, "$1[REDACTED]").replace(/(\/Users\/)[^/\s]+/g, "$1[REDACTED]");
  if (Array.isArray(value)) return value.map((entry) => sanitize(entry));
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).map(([childKey, child]) => [childKey, sanitize(child, childKey)]));
  return value;
}

function createLoggingService(app, options = {}) {
  const logDir = options.logDir || path.join(app.getPath("userData"), "logs");
  const maxBytes = 5 * 1024 * 1024;
  const retentionDays = 14;
  let writeFailed = false;
  let lastPruneDay = "";
  let previousRecordKey = "";
  let previousRecordAt = 0;

  function log(level, component, message, details, correlationId) {
    const normalizedLevel = String(level).toUpperCase();
    const record = sanitize({ timestamp: new Date().toISOString(), level: LEVELS.has(normalizedLevel) ? normalizedLevel : "INFO", component: String(component || "app"), message: String(message || ""), ...(details === undefined ? {} : { details }), ...(correlationId ? { correlationId } : {}) });
    const recordKey = JSON.stringify({ level: record.level, component: record.component, message: record.message, details: record.details });
    if (recordKey === previousRecordKey && Date.now() - previousRecordAt < 1000) return record;
    previousRecordKey = recordKey; previousRecordAt = Date.now();
    try {
      fs.mkdirSync(logDir, { recursive: true });
      const file = path.join(logDir, `app-${record.timestamp.slice(0, 10)}.log`);
      if (fs.existsSync(file) && fs.statSync(file).size >= maxBytes) {
        let suffix = 1; while (fs.existsSync(`${file}.${suffix}`)) suffix += 1;
        fs.renameSync(file, `${file}.${suffix}`);
      }
      fs.appendFileSync(file, `${JSON.stringify(record)}\n`, { encoding: "utf8" });
      const today = record.timestamp.slice(0, 10);
      if (today !== lastPruneDay) { lastPruneDay = today; pruneOldFiles(today); }
      writeFailed = false;
    } catch (error) {
      if (!writeFailed) { writeFailed = true; try { process.stderr.write(`Logging unavailable: ${error.message}\n`); } catch {} }
    }
    return record;
  }

  function pruneOldFiles(today) {
    try {
      const cutoff = Date.now() - retentionDays * 86400000;
      for (const name of fs.readdirSync(logDir)) {
        if (!/^app-\d{4}-\d{2}-\d{2}\.log(?:\.\d+)?$/.test(name) || name.startsWith(`app-${today}`)) continue;
        const file = path.join(logDir, name);
        try { if (fs.statSync(file).mtimeMs < cutoff) fs.unlinkSync(file); } catch {}
      }
    } catch {}
  }

  function listLogFiles() {
    try {
      const cutoff = Date.now() - retentionDays * 86400000;
      return fs.readdirSync(logDir).filter((name) => /^app-\d{4}-\d{2}-\d{2}\.log(?:\.\d+)?$/.test(name)).map((name) => path.join(logDir, name)).filter((file) => {
        try { if (fs.statSync(file).mtimeMs < cutoff) { fs.unlinkSync(file); return false; } return true; } catch { return false; }
      }).sort();
    } catch { return []; }
  }

  function getRecentErrors(limit = 50) {
    return listLogFiles().reverse().flatMap((file) => {
      try { return fs.readFileSync(file, "utf8").split(/\r?\n/).filter(Boolean).map((line) => JSON.parse(line)).filter((entry) => ["ERROR", "FATAL"].includes(entry.level)); } catch { return []; }
    }).slice(-limit).reverse();
  }

  return { log, logDir, listLogFiles, getRecentErrors };
}

module.exports = { createLoggingService, sanitize };
