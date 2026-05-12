const { spawn } = require('child_process');
const { GAME_PATTERNS } = require('../config/gamePatterns');

async function findProcessByNames(names) {
    return new Promise((resolve) => {
        const cmd = spawn('tasklist', ['/FO', 'CSV', '/NH']);
        let output = '';

        cmd.stdout.on('data', (data) => { output += data.toString(); });
        cmd.on('close', () => {
            const lines = output.split('\n').filter(l => l.trim());
            for (const line of lines) {
                const parts = line.split('","').map(p => p.replace(/^"|"$/g, ''));
                const processName = parts[0];
                if (names.some(n => n.toLowerCase() === processName.toLowerCase())) {
                    resolve(processName);
                    return;
                }
            }
            resolve(null);
        });
        cmd.on('error', () => resolve(null));
    });
}

function isProcessRunning(processName) {
    return new Promise((resolve) => {
        const cmd = spawn('tasklist', ['/FI', `IMAGENAME eq ${processName}`, '/NH']);
        let output = '';

        cmd.stdout.on('data', (data) => { output += data.toString(); });
        cmd.on('close', () => {
            resolve(output.toLowerCase().includes(processName.toLowerCase()));
        });
        cmd.on('error', () => resolve(false));
    });
}

async function isGameProcessRunning(launchMethod) {
    const patterns = GAME_PATTERNS[launchMethod];
    if (!patterns || !patterns.processNames.length) return false;

    const running = await findProcessByNames(patterns.processNames);
    return !!running;
}

module.exports = {
    findProcessByNames,
    isProcessRunning,
    isGameProcessRunning
};
