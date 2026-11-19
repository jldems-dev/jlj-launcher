const fs = require("fs");
const os = require("os");
const path = require("path");
const zlib = require("zlib");
const crc32 = require("buffer-crc32");
const si = require("systeminformation");

function zipFiles(files) {
  const local = []; const central = []; let offset = 0;
  for (const file of files) {
    const name = Buffer.from(file.name.replace(/\\/g, "/"));
    const input = Buffer.isBuffer(file.data) ? file.data : Buffer.from(file.data);
    const compressed = zlib.deflateRawSync(input);
    const crc = crc32.unsigned(input);
    const header = Buffer.alloc(30); header.writeUInt32LE(0x04034b50, 0); header.writeUInt16LE(20, 4); header.writeUInt16LE(8, 6); header.writeUInt32LE(crc, 14); header.writeUInt32LE(compressed.length, 18); header.writeUInt32LE(input.length, 22); header.writeUInt16LE(name.length, 26);
    local.push(header, name, compressed);
    const entry = Buffer.alloc(46); entry.writeUInt32LE(0x02014b50, 0); entry.writeUInt16LE(20, 4); entry.writeUInt16LE(20, 6); entry.writeUInt16LE(8, 8); entry.writeUInt32LE(crc, 16); entry.writeUInt32LE(compressed.length, 20); entry.writeUInt32LE(input.length, 24); entry.writeUInt16LE(name.length, 28); entry.writeUInt32LE(offset, 42);
    central.push(entry, name); offset += header.length + name.length + compressed.length;
  }
  const directory = Buffer.concat(central); const end = Buffer.alloc(22); end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(files.length, 8); end.writeUInt16LE(files.length, 10); end.writeUInt32LE(directory.length, 12); end.writeUInt32LE(offset, 16);
  return Buffer.concat([...local, directory, end]);
}

function createDiagnosticsService({ app, logger, store, trackingService, getMainWindow }) {
  const startedAt = Date.now();
  async function collect() {
    const [osInfo, cpu, mem, fsInfo] = await Promise.allSettled([si.osInfo(), si.cpu(), si.mem(), si.fsSize()]);
    const disk = fsInfo.status === "fulfilled" ? fsInfo.value.find((item) => item.mount === path.parse(app.getPath("userData")).root) || fsInfo.value[0] : null;
    let userDataAvailable = false; try { fs.accessSync(app.getPath("userData"), fs.constants.R_OK | fs.constants.W_OK); userDataAvailable = true; } catch {}
    let storeAvailable = false; try { storeAvailable = Boolean(store.getStorageInfo().dbPath); } catch {}
    return {
      generatedAt: new Date().toISOString(), app: { name: app.getName(), version: app.getVersion(), uptimeSeconds: Math.floor((Date.now() - startedAt) / 1000) },
      runtime: { electron: process.versions.electron, node: process.versions.node },
      system: { platform: osInfo.status === "fulfilled" ? osInfo.value.platform : process.platform, windowsRelease: osInfo.status === "fulfilled" ? osInfo.value.release : os.release(), architecture: process.arch, cpu: cpu.status === "fulfilled" ? cpu.value.brand : os.cpus()[0]?.model || "Unknown", totalMemoryBytes: mem.status === "fulfilled" ? mem.value.total : os.totalmem(), availableMemoryBytes: mem.status === "fulfilled" ? mem.value.available : os.freemem(), diskTotalBytes: disk?.size ?? null, diskAvailableBytes: disk?.available ?? null },
      services: { gameTracking: "available", runningGameCount: trackingService.getRunningGameCount?.() ?? null, adminSocket: "configured", updateService: "available", scheduler: "not part of this application", announcements: "not part of this application", spotify: "not part of this application", backup: "not part of this application" },
      storage: { userDataAvailable, databaseAvailable: storeAvailable },
      recentErrors: logger.getRecentErrors(30),
    };
  }
  async function exportReport() {
    const info = await collect();
    const files = [{ name: "diagnostics/system-info.json", data: JSON.stringify(info, null, 2) }];
    for (const file of logger.listLogFiles()) {
      try { files.push({ name: `logs/${path.basename(file)}`, data: fs.readFileSync(file, "utf8") }); } catch {}
    }
    const zip = zipFiles(files);
    const { dialog } = require("electron");
    const result = await dialog.showSaveDialog(getMainWindow(), { title: "Export Diagnostics", defaultPath: `launcher-diagnostics-${new Date().toISOString().slice(0, 10)}.zip`, filters: [{ name: "ZIP archive", extensions: ["zip"] }] });
    if (result.canceled || !result.filePath) return { canceled: true };
    fs.writeFileSync(result.filePath, zip);
    logger.log("INFO", "diagnostics", "Diagnostic report exported", { includedLogs: files.length - 1 });
    return { canceled: false, filePath: result.filePath };
  }
  return { collect, exportReport };
}

module.exports = { createDiagnosticsService, zipFiles };
