#!/usr/bin/env node

const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const semver = require("semver");

function fail(message) {
  throw new Error(message);
}

function readJson(file) {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch (error) {
    fail(`Could not read ${file}: ${error.message}`);
  }
}

function normalizeNewlines(value) {
  return value.replace(/\r\n/g, "\n").trim();
}

function yamlScalar(manifest, key) {
  const match = manifest.match(new RegExp(`^${key}:\\s*(.+?)\\s*$`, "m"));
  if (!match) fail(`latest.yml is missing ${key}`);
  return match[1].replace(/^(["'])(.*)\1$/, "$2");
}

function validateProject(root, tag) {
  const pkg = readJson(path.join(root, "package.json"));
  const lock = readJson(path.join(root, "package-lock.json"));
  const lockRoot = lock.packages?.[""];
  if (!semver.valid(pkg.version)) fail(`Invalid package.json version: ${pkg.version}`);
  if (tag && tag !== `v${pkg.version}`) {
    fail(`Release tag ${tag} does not match package.json version ${pkg.version}`);
  }
  if (tag && !/^v\d+\.\d+\.\d+$/.test(tag)) {
    fail(`Release tag must be a stable vMAJOR.MINOR.PATCH tag: ${tag}`);
  }
  if (lock.name !== pkg.name || lock.version !== pkg.version) {
    fail("package-lock.json name/version does not match package.json");
  }
  if (!lockRoot || lockRoot.name !== pkg.name || lockRoot.version !== pkg.version) {
    fail("package-lock.json root package entry does not match package.json");
  }

  for (const field of ["dependencies", "devDependencies"]) {
    const declared = pkg[field] || {};
    const locked = lockRoot[field] || {};
    if (JSON.stringify(Object.entries(declared).sort()) !== JSON.stringify(Object.entries(locked).sort())) {
      fail(`package-lock.json root ${field} does not match package.json`);
    }
    for (const [name, range] of Object.entries(declared)) {
      const entry = lock.packages[`node_modules/${name}`];
      if (!entry?.version || !semver.satisfies(entry.version, range)) {
        fail(`Lockfile does not contain a ${name} version satisfying ${range}`);
      }
    }
  }

  const publish = Array.isArray(pkg.build?.publish) ? pkg.build.publish : [];
  const githubProvider = publish.find((provider) => provider.provider === "github");
  if (
    !githubProvider ||
    githubProvider.owner !== "jldems-dev" ||
    githubProvider.repo !== "jlj-launcher" ||
    githubProvider.releaseType !== "draft"
  ) {
    fail("Electron Builder must publish a draft to the configured GitHub repository");
  }
  const targets = Array.isArray(pkg.build?.win?.target)
    ? pkg.build.win.target.map((target) => typeof target === "string" ? target : target.target)
    : [typeof pkg.build?.win?.target === "string" ? pkg.build.win.target : pkg.build?.win?.target?.target];
  if (!targets.includes("nsis")) fail("The Windows release target must include NSIS");
  if (!pkg.build?.files?.includes("!database/*.db")) {
    fail("The packaged files must continue to exclude development database files");
  }

  return { pkg, lock };
}

function validateLocalArtifacts(root, artifactsDir, pkg) {
  const dir = path.resolve(root, artifactsDir);
  const files = fs.readdirSync(dir, { withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map((entry) => entry.name);
  const installerFiles = files.filter((name) => name.toLowerCase().endsWith(".exe"));
  if (installerFiles.length !== 1) {
    fail(`Expected exactly one NSIS installer in ${dir}; found ${installerFiles.length}`);
  }

  const artifactTemplate = pkg.build?.win?.artifactName || pkg.build?.artifactName;
  if (!artifactTemplate) fail("Electron Builder must define an explicit Windows artifactName");
  const expectedInstaller = artifactTemplate
    .replaceAll("${productName}", pkg.build.productName)
    .replaceAll("${version}", pkg.version)
    .replaceAll("${ext}", "exe");
  if (/\$\{[^}]+\}/.test(expectedInstaller)) {
    fail(`Unsupported artifactName macro in ${artifactTemplate}`);
  }
  if (installerFiles[0] !== expectedInstaller) {
    fail(`Expected ${expectedInstaller}, found ${installerFiles[0]}`);
  }

  const blockmapName = `${expectedInstaller}.blockmap`;
  if (!files.includes(blockmapName)) fail(`Missing NSIS blockmap ${blockmapName}`);
  const manifestPath = path.join(dir, "latest.yml");
  if (!fs.existsSync(manifestPath)) fail("Missing latest.yml");
  const manifest = fs.readFileSync(manifestPath, "utf8");
  const version = yamlScalar(manifest, "version");
  const relativeInstaller = yamlScalar(manifest, "path");
  if (version !== pkg.version) fail(`latest.yml version ${version} does not match ${pkg.version}`);
  if (relativeInstaller !== expectedInstaller || path.basename(relativeInstaller) !== relativeInstaller) {
    fail(`latest.yml path ${relativeInstaller} does not match installer ${expectedInstaller}`);
  }

  const urls = [...manifest.matchAll(/^\s+- url:\s*(.+?)\s*$/gm)]
    .map((match) => match[1].replace(/^(["'])(.*)\1$/, "$2"));
  if (urls.length !== 1 || urls[0] !== expectedInstaller) {
    fail("latest.yml files list must reference the single generated installer exactly once");
  }

  const installerPath = path.join(dir, expectedInstaller);
  const blockmapPath = `${installerPath}.blockmap`;
  const installerBuffer = fs.readFileSync(installerPath);
  const actualHash = crypto.createHash("sha512").update(installerBuffer).digest("base64");
  const topLevelHash = yamlScalar(manifest, "sha512");
  const filesHash = manifest.match(/^\s+sha512:\s*(.+?)\s*$/m)?.[1];
  if (topLevelHash !== actualHash || filesHash !== actualHash) {
    fail("latest.yml SHA-512 does not match the generated installer");
  }

  const size = Number(manifest.match(/^\s+size:\s*(\d+)\s*$/m)?.[1]);
  if (!Number.isSafeInteger(size) || size !== installerBuffer.length) {
    fail("latest.yml installer size does not match the generated installer");
  }
  const blockMapSize = Number(manifest.match(/^\s+blockMapSize:\s*(\d+)\s*$/m)?.[1]);
  if (
    Number.isFinite(blockMapSize) &&
    (!Number.isSafeInteger(blockMapSize) || blockMapSize !== fs.statSync(blockmapPath).size)
  ) {
    fail("latest.yml blockMapSize does not match the generated blockmap");
  }

  return {
    installer: expectedInstaller,
    blockmap: blockmapName,
    installerPath,
    blockmapPath,
    manifest: manifestPath,
    manifestText: manifest,
  };
}

function validateRemoteRelease(releaseJsonPath, remoteDir, tag, localArtifacts) {
  const release = readJson(releaseJsonPath);
  if (release.tagName !== tag) fail(`GitHub release tag ${release.tagName} does not match ${tag}`);
  if (release.isDraft !== true) fail("GitHub release must remain a draft until remote assets are verified");
  const names = (release.assets || []).map((asset) => asset.name);
  if (new Set(names).size !== names.length) fail("GitHub draft contains duplicate asset names");
  for (const required of ["latest.yml", localArtifacts.installer, localArtifacts.blockmap]) {
    if (!names.includes(required)) fail(`GitHub draft is missing ${required}`);
  }

  const remoteInstallerPath = path.join(remoteDir, localArtifacts.installer);
  const remoteBlockmapPath = path.join(remoteDir, localArtifacts.blockmap);
  const remoteManifestPath = path.join(remoteDir, "latest.yml");
  for (const file of [remoteInstallerPath, remoteBlockmapPath, remoteManifestPath]) {
    if (!fs.existsSync(file)) fail(`Could not download required draft asset ${path.basename(file)}`);
  }

  const localInstallerHash = crypto.createHash("sha512")
    .update(fs.readFileSync(localArtifacts.installerPath)).digest("base64");
  const remoteInstallerHash = crypto.createHash("sha512")
    .update(fs.readFileSync(remoteInstallerPath)).digest("base64");
  if (remoteInstallerHash !== localInstallerHash) {
    fail("Downloaded draft installer differs from the locally validated installer");
  }
  if (!fs.readFileSync(remoteBlockmapPath).equals(fs.readFileSync(localArtifacts.blockmapPath))) {
    fail("Downloaded draft blockmap differs from the locally validated blockmap");
  }

  const remoteManifest = fs.readFileSync(remoteManifestPath, "utf8");
  const localManifest = fs.readFileSync(localArtifacts.manifest, "utf8");
  if (normalizeNewlines(remoteManifest) !== normalizeNewlines(localManifest)) {
    fail("Downloaded draft latest.yml differs from the locally validated manifest");
  }
}

function parseArgs(argv) {
  const args = {};
  for (let index = 0; index < argv.length; index += 1) {
    const key = argv[index];
    if (!key.startsWith("--")) fail(`Unexpected argument: ${key}`);
    const name = key.slice(2);
    if (["check-project"].includes(name)) {
      args[name] = true;
    } else {
      const value = argv[index + 1];
      if (!value || value.startsWith("--")) fail(`Missing value for ${key}`);
      args[name] = value;
      index += 1;
    }
  }
  return args;
}

function main(argv) {
  const args = parseArgs(argv);
  const root = path.resolve(args.root || process.cwd());
  const { pkg } = validateProject(root, args.tag);
  let localArtifacts = null;
  if (args.artifacts) {
    localArtifacts = validateLocalArtifacts(root, args.artifacts, pkg);
    console.log(`Validated ${pkg.version} installer, latest.yml, and blockmap.`);
  }
  if (args["remote-release-json"] || args["remote-assets-dir"]) {
    if (!args["remote-release-json"] || !args["remote-assets-dir"] || !localArtifacts || !args.tag) {
      fail("Remote validation requires --tag, --artifacts, --remote-release-json, and --remote-assets-dir");
    }
    validateRemoteRelease(
      path.resolve(args["remote-release-json"]),
      path.resolve(args["remote-assets-dir"]),
      args.tag,
      localArtifacts,
    );
    console.log(`Validated remote draft assets for ${args.tag}.`);
  }
  if (!args["check-project"] && !args.artifacts) {
    fail("Use --check-project and/or --artifacts");
  }
  if (args["check-project"]) console.log(`Validated project and lockfile at version ${pkg.version}.`);
}

if (require.main === module) {
  try {
    main(process.argv.slice(2));
  } catch (error) {
    console.error(`Release validation failed: ${error.message}`);
    process.exitCode = 1;
  }
}

module.exports = {
  validateProject,
  validateLocalArtifacts,
  validateRemoteRelease,
};
