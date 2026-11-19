const test = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { validateLocalArtifacts, validateRemoteRelease } = require("../scripts/validate-release");

const pkg = { version: "1.0.25", build: { productName: "JLJGAMINGHOUSE", win: { artifactName: "${productName}-Setup-${version}.${ext}" } } };

test("checks generated installer metadata and uploaded draft assets", (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "jlj-release-test-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const dist = path.join(root, "dist");
  fs.mkdirSync(dist);
  const exe = "JLJGAMINGHOUSE-Setup-1.0.25.exe";
  const bytes = Buffer.from("installer bytes");
  const hash = crypto.createHash("sha512").update(bytes).digest("base64");
  fs.writeFileSync(path.join(dist, exe), bytes);
  fs.writeFileSync(path.join(dist, `${exe}.blockmap`), "blockmap");
  fs.writeFileSync(path.join(dist, "latest.yml"), `version: 1.0.25\nfiles:\n  - url: ${exe}\n    sha512: ${hash}\n    size: ${bytes.length}\npath: ${exe}\nsha512: ${hash}\n`);
  const artifacts = validateLocalArtifacts(root, "dist", pkg);
  assert.equal(artifacts.installer, exe);

  const remote = path.join(root, "remote");
  fs.mkdirSync(remote);
  for (const name of [exe, `${exe}.blockmap`, "latest.yml"]) fs.copyFileSync(path.join(dist, name), path.join(remote, name));
  const releaseJson = path.join(root, "release.json");
  fs.writeFileSync(releaseJson, JSON.stringify({ tagName: "v1.0.25", isDraft: true, assets: [exe, `${exe}.blockmap`, "latest.yml"].map((name) => ({ name })) }));
  assert.doesNotThrow(() => validateRemoteRelease(releaseJson, remote, "v1.0.25", artifacts));

  fs.writeFileSync(path.join(remote, exe), "altered");
  assert.throws(() => validateRemoteRelease(releaseJson, remote, "v1.0.25", artifacts), /differs/);
});

test("rejects a latest.yml installer path mismatch", (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "jlj-release-test-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const dist = path.join(root, "dist"); fs.mkdirSync(dist);
  const exe = "JLJGAMINGHOUSE-Setup-1.0.25.exe"; const bytes = Buffer.from("installer");
  const hash = crypto.createHash("sha512").update(bytes).digest("base64");
  fs.writeFileSync(path.join(dist, exe), bytes); fs.writeFileSync(path.join(dist, `${exe}.blockmap`), "blockmap");
  fs.writeFileSync(path.join(dist, "latest.yml"), `version: 1.0.25\nfiles:\n  - url: ${exe}\n    sha512: ${hash}\n    size: ${bytes.length}\npath: wrong.exe\nsha512: ${hash}\n`);
  assert.throws(() => validateLocalArtifacts(root, "dist", pkg), /path/);
});
