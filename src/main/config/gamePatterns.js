const path = require('path');
const os = require('os');

const GAME_PATTERNS = {
    roblox: {
        name: 'Roblox',
        exePatterns: [
            path.join(os.homedir(), 'AppData', 'Local', 'Roblox', 'Versions', '*', 'RobloxPlayerBeta.exe'),
            path.join(os.homedir(), 'AppData', 'Local', 'Roblox', 'Versions', '*', 'RobloxPlayerLauncher.exe')
        ],
        processNames: ['RobloxPlayerBeta.exe', 'RobloxPlayerLauncher.exe'],
        launchUrl: 'roblox://',
        launcherPaths: [
            path.join(os.homedir(), 'AppData', 'Local', 'Roblox', 'Versions', 'version-*/RobloxPlayerLauncher.exe')
        ]
    },
    bloodstrike: {
        name: 'Blood Strike',
        processNames: ['BloodStrike.exe', 'BloodStrikeLauncher.exe'],
        launcherPaths: [
            'C:\\NetEase\\BloodStrike\\BloodStrikeLauncher.exe',
            path.join(os.homedir(), 'AppData', 'Local', 'BloodStrike', 'launcher.exe')
        ]
    },
    crossfire: {
        name: 'CrossFire',
        processNames: ['crossfire.exe', 'CFLauncher.exe'],
        launcherPaths: [
            'C:\\Program Files (x86)\\CrossFire\\crossfire.exe',
            'C:\\CrossFire\\crossfire.exe'
        ]
    },
    steam: {
        name: 'Steam Game',
        processNames: [],
        launcherPrefix: 'steam://rungameid/',
        steamExe: 'C:\\Program Files (x86)\\Steam\\steam.exe'
    },
    epic: {
        name: 'Epic Game',
        launcherPrefix: 'com.epicgames.launcher://apps/',
        epicExe: 'C:\\Program Files (x86)\\Epic Games\\Launcher\\Portal\\Binaries\\Win32\\EpicGamesLauncher.exe'
    },
    minecraft: {
        name: 'Minecraft',
        processNames: ['javaw.exe', 'Minecraft.exe'],
        launcherPaths: [
            path.join(os.homedir(), 'AppData', 'Roaming', '.minecraft', 'launcher', 'MinecraftLauncher.exe')
        ]
    }
};

module.exports = { GAME_PATTERNS };
