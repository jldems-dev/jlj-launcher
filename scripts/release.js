
const { execFileSync } = require("child_process");
const fs = require("fs");

const pkg = require("../package.json");
const version = pkg.version;
const tag = `v${version}`;

function run(command, args) {
  execFileSync(command, args, { stdio: "inherit" });
}

try {
  console.log(`\nPreparing release ${tag}...\n`);

  run("git", ["add", "."]);

  run("git", ["commit", "-m", `Release ${tag}`]);

  run("git", ["push", "origin", "main"]);

  run("git", ["tag", tag]);

  run("git", ["push", "origin", tag]);

  console.log(`\nRelease ${tag} pushed successfully!`);
} catch (error) {
  console.error("\nRelease process failed. Check Git status before retrying.");
  process.exit(1);
}
