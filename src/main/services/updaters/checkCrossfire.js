const fs = require("fs");
const path = require("path");
const axios = require("axios");
const { execSync } = require("child_process");
const cheerio = require("cheerio"); 

async function getLatestVersion() {
  try {
    const response = await axios.get("https://cfph.onstove.com/Download", {
      timeout: 30000,
    });

    const $ = cheerio.load(response.data);

    let version = null;

    $(".patch").each((_, el) => {
      const text = $(el).text();

      // Check if this is the MANUAL PATCH section
      if (text.includes("MANUAL PATCH")) {
        const match = text.match(/v\d+/i);

        if (match) {
          version = match[0];
        }
      }
    });

    return version;
  } catch (err) {
    console.error(err);
    return null;
  }
}

module.exports = async function checkCrossfire(game) {
  try {
    const latestVersion = await getLatestVersion();

    const exePath = game.exePath || game.detectedExePath;

    if (!exePath || !fs.existsSync(exePath)) {
      return null;
    }

    // Get CrossFire folder
    const gameFolder = path.dirname(exePath);

    const versionIniPath = path.join(gameFolder, "version.ini");

    if (!fs.existsSync(versionIniPath)) {
      console.log("version.ini not found");
      return null;
    }

    // Read file
    const iniContent = fs.readFileSync(versionIniPath, "utf-8");

    // Extract LatestVersion
    const match = iniContent.match(/LatestVersion\s*=\s*(\d+)/i);

    if (!match) {
      return null;
    }

    const localVersion = `v${match[1]}`;  

    const updated = localVersion === latestVersion;

    return {
      game: "CrossFire",
      version: localVersion,
      latestVersion,
      status: updated ? "installed" : "update",
    };
  } catch (err) {
    console.log(err);

    return {
      game: "CrossFire",
      status: "ERROR",
    };
  }
};
