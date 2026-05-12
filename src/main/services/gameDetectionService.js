const fs = require('fs');
const path = require('path');
const os = require('os');
const { GAME_PATTERNS } = require('../config/gamePatterns');

async function findRobloxExe() {
    const versionsDir = path.join(os.homedir(), 'AppData', 'Local', 'Roblox', 'Versions');

    if (!fs.existsSync(versionsDir)) {
        return null;
    }

    try {
        const entries = fs.readdirSync(versionsDir, { withFileTypes: true });

        for (const entry of entries) {
            if (entry.isDirectory() && entry.name.startsWith('version-')) {
                const exePath = path.join(versionsDir, entry.name, 'RobloxPlayerBeta.exe');
                if (fs.existsSync(exePath)) {
                    return exePath;
                }
            }
        }
    } catch (e) {
        console.error('Error finding Roblox:', e);
    }

    return null;
}

async function findGameExe(launchMethod) {
    const patterns = GAME_PATTERNS[launchMethod];
    if (!patterns) return null;

    if (patterns.launcherPaths) {
        for (const p of patterns.launcherPaths) {
            if (p.includes('*')) {
                const resolved = await resolveWildcard(p);
                if (resolved) return resolved;
            } else if (fs.existsSync(p)) {
                return p;
            }
        }
    }

    if (patterns.exePatterns) {
        for (const p of patterns.exePatterns) {
            const resolved = await resolveWildcard(p);
            if (resolved) return resolved;
        }
    }

    return null;
}

async function resolveWildcard(pattern) {
    const parts = pattern.split(path.sep);
    let currentPaths = [parts[0] + path.sep];

    for (let i = 1; i < parts.length; i++) {
        const part = parts[i];
        const newPaths = [];

        for (const cp of currentPaths) {
            const fullPath = path.join(cp, part);

            if (!part.includes('*') && !part.includes('?')) {
                if (fs.existsSync(fullPath)) {
                    newPaths.push(fullPath);
                }
                continue;
            }

            const dir = path.dirname(fullPath);
            const base = path.basename(fullPath);
            const regex = new RegExp('^' + base.replace(/\*/g, '.*').replace(/\?/g, '.') + '$');

            if (fs.existsSync(dir)) {
                try {
                    const entries = fs.readdirSync(dir);
                    for (const entry of entries) {
                        if (regex.test(entry)) {
                            newPaths.push(path.join(dir, entry));
                        }
                    }
                } catch (e) {
                    // Permission denied, skip
                }
            }
        }

        currentPaths = newPaths;
        if (currentPaths.length === 0) return null;
    }

    for (const p of currentPaths) {
        if (fs.existsSync(p) && fs.statSync(p).isFile()) {
            return p;
        }
    }

    return null;
}

async function scanForInstalledGames() {
    const found = [];

    const robloxExe = await findRobloxExe();
    if (robloxExe) {
        found.push({ title: 'Roblox', exePath: robloxExe, launchMethod: 'roblox' });
    }

    const bloodExe = await findGameExe('bloodstrike');
    if (bloodExe) {
        found.push({ title: 'Blood Strike', exePath: bloodExe, launchMethod: 'bloodstrike' });
    }

    const cfExe = await findGameExe('crossfire');
    if (cfExe) {
        found.push({ title: 'CrossFire', exePath: cfExe, launchMethod: 'crossfire' });
    }

    const mcExe = await findGameExe('minecraft');
    if (mcExe) {
        found.push({ title: 'Minecraft', exePath: mcExe, launchMethod: 'minecraft' });
    }

    return found;
}

module.exports = {
    findRobloxExe,
    findGameExe,
    resolveWildcard,
    scanForInstalledGames
};
