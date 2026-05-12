let isOwnerLoggedIn = false;
let currentFilter = 'all';
let currentSearch = '';
let currentRows = 5;
let games = [];
let gameToDelete = null;

// Play time tracking
let currentlyPlaying = null; // { id, startTime, timerInterval }
let playTimerInterval = null;

document.addEventListener('DOMContentLoaded', () => { 
    bindWindowControls();
    bindCrudControls();
    loadGames();
    // Check for updates every 5 minutes
    setInterval(checkForUpdates, 5 * 60 * 1000);
    // Also check on load
    setTimeout(checkForUpdates, 2000);
});

function bindWindowControls() {
    document.getElementById('windowMinimizeButton')?.addEventListener('click', minimizeWindow);
    document.getElementById('windowMaximizeButton')?.addEventListener('click', maximizeWindow);
    document.getElementById('windowCloseButton')?.addEventListener('click', closeWindow);
}

function bindCrudControls() {
    document.getElementById('loginButton')?.addEventListener('click', login);
    document.getElementById('addGameButton')?.addEventListener('click', addGame);
    document.getElementById('confirmDeleteGameButton')?.addEventListener('click', confirmDeleteGame);
    document.getElementById('cancelDeleteGameButton')?.addEventListener('click', closeDeleteModal);
}

function sameId(left, right) {
    return String(left) === String(right);
}

function findGameById(gameId) {
    return games.find(g => sameId(g.id, gameId));
}

async function loadGames() {
    try {
        if (window.electronAPI && window.electronAPI.getGames) {
            games = await window.electronAPI.getGames();
        } else {
            games = [];
        }
        applyFilters();
    } catch (error) {
        console.error('Failed to load games:', error);
        showToast('Failed to load games from JSON', 'error');
    }
}

function formatTimeAgo(timestamp) {
    if (!timestamp) return 'Never';
    const now = Date.now();
    const diff = now - timestamp;
    const seconds = Math.floor(diff / 1000);
    const minutes = Math.floor(seconds / 60);
    const hours = Math.floor(minutes / 60);
    const days = Math.floor(hours / 24);
    
    if (seconds < 60) return 'Just now';
    if (minutes < 60) return `${minutes}m ago`;
    if (hours < 24) return `${hours}h ago`;
    if (days < 7) return `${days} day${days > 1 ? 's' : ''} ago`;
    if (days < 30) return `${Math.floor(days / 7)} week${Math.floor(days / 7) > 1 ? 's' : ''} ago`;
    return new Date(timestamp).toLocaleDateString();
}

function formatHours(minutes) {
    if (!minutes || minutes === 0) return '0h';
    const h = Math.floor(minutes / 60);
    const m = minutes % 60;
    if (h === 0) return `${m}m`;
    if (m === 0) return `${h}h`;
    return `${h}h ${m}m`;
}

function formatPlayTime(minutes) {
    const h = Math.floor(minutes / 60);
    const m = minutes % 60;
    return `${h}h ${m}m`;
}

function checkForUpdates() {
    // Simulate checking for updates by comparing version fields
    // In real app, this would check a server or file hash
    let updatesFound = 0;
    games.forEach(game => {
        if (game.version && game.latestVersion && game.version !== game.latestVersion) {
            if (game.status !== 'update') {
                game.status = 'update';
                updatesFound++;
            }
        }
    });
    if (updatesFound > 0) {
        applyFilters();
        showToast(`${updatesFound} game${updatesFound > 1 ? 's' : ''} need${updatesFound === 1 ? 's' : ''} update`, 'info');
    }
}

function renderGames(gamesToRender) {
    const grid = document.getElementById('gamesGrid');
    if (gamesToRender.length === 0) {
        grid.innerHTML = '<div class="empty-state" style="grid-column: 1/-1;"><h3>No games found</h3><p>Try adjusting your search or filters</p></div>';
        return;
    }
    grid.innerHTML = gamesToRender.map(game => {
        const gameId = JSON.stringify(game.id);
        const isPlaying = currentlyPlaying && sameId(currentlyPlaying.id, game.id);
        const statusBadge = isPlaying ? '<span class="status-badge status-playing">Playing</span>' : 
                            game.status === 'update' ? '<span class="status-badge status-update">Update</span>' : 
                            game.status === 'installed' ? '<span class="status-badge status-installed">Ready</span>' : '';
        return `
        <div class="game-card" data-title="${game.title.toLowerCase()}">
            <div class="game-cover" onclick='launchGameById(${gameId})'>
                <img src="${game.cover}" alt="${game.title}" loading="lazy">
                ${statusBadge}
                <div class="play-btn-overlay"><svg width="20" height="20" fill="black" viewBox="0 0 24 24"><path d="M8 5v14l11-7z"/></svg></div>
                <div class="game-overlay"><div style="font-size: 11px; color: var(--text-muted); margin-bottom: 3px;">${formatTimeAgo(game.lastPlayedTimestamp)}</div><div style="font-size: 13px; font-weight: 600;">${formatHours(game.totalMinutes)} played</div></div>
                ${game.status === 'update' ? '<div class="download-progress"><div class="download-progress-bar" style="width: 65%"></div></div>' : ''}
            </div>
            <div class="game-info">
                <h4 class="game-title">${game.title}</h4>
                <div class="game-meta"><span>${game.genre}</span><span>${formatHours(game.totalMinutes)}</span></div>
                <div class="game-tags"><span class="tag">${game.genre}</span>${game.status === 'installed' ? '<span class="tag">Installed</span>' : ''}${game.isFavorite ? '<span class="tag">★ Favorite</span>' : ''}${game.status === 'update' ? '<span class="tag" style="color:#ff6b6b;border-color:rgba(255,50,50,0.3)">Update Available</span>' : ''}</div>
            </div> 
            ${isOwnerLoggedIn ? `
            <div class="game-actions">
                <button class="action-btn" onclick='event.stopPropagation(); toggleFavorite(${gameId})' title="${game.isFavorite ? 'Remove from favorites' : 'Add to favorites'}">${game.isFavorite ? '★' : '☆'}</button>
                <button class="action-btn delete" onclick='event.stopPropagation(); openDeleteModal(${gameId})' title="Delete game">🗑</button>
            </div>
            ` : ''}
        </div>
    `}).join('');
}

function changeRows(rows) {
    currentRows = parseInt(rows);
    const grid = document.getElementById('gamesGrid');
    grid.classList.remove('rows-2', 'rows-3', 'rows-4', 'rows-5', 'rows-6');
    grid.classList.add(`rows-${currentRows}`);
}

function applyFilters() {
    let filtered = games;
    if (currentFilter === 'installed') filtered = filtered.filter(g => g.status === 'installed');
    else if (currentFilter === 'updates') filtered = filtered.filter(g => g.status === 'update');
    else if (currentFilter === 'favorites') filtered = filtered.filter(g => g.isFavorite);
    else if (currentFilter === 'recent') filtered = filtered.filter(g => g.lastPlayedTimestamp !== null);
    if (currentSearch) filtered = filtered.filter(g => g.title.toLowerCase().includes(currentSearch));
    renderGames(filtered);
}

function searchGames() { currentSearch = document.getElementById('searchInput').value.toLowerCase(); applyFilters(); }

function filterGames(filter, btn) {
    currentFilter = filter;
    document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    const titles = { 'all': 'All Games', 'installed': 'Installed Games', 'updates': 'Updates Available', 'favorites': 'Favorite Games', 'recent': 'Recently Played' };
    document.getElementById('gamesSectionTitle').textContent = titles[filter];
    applyFilters();
}

function switchTab(element, tab) { document.querySelectorAll('.nav-item').forEach(item => item.classList.remove('active')); element.classList.add('active'); }

// Replace the old launchGameById and timer functions with these:

async function launchGameById(gameId) { 
    const game = findGameById(gameId);
    if (!game) { showToast('Game not found', 'error'); return; }
    
    // If already playing this game, do nothing
    if (currentlyPlaying && sameId(currentlyPlaying.id, gameId)) {
        showToast(`${game.title} is already running`, 'info');
        return;
    }
    
    // If playing another game, stop it first
    if (currentlyPlaying) {
        await stopPlaying();
    }

    console.log(game);
    
    if (game.exePath && game.exePath.trim() !== '') {
        showToast(`Launching ${game.title}...`, 'success');
        
        // Start play timer locally for UI
        startPlayTimer(game);
        
        // Launch with process monitoring (pass gameId)
        if (window.electronAPI && window.electronAPI.launchGame) { 
            window.electronAPI.launchGame(game.id, game.launchMethod, game.appId);
        } else {
            showToast(`Would launch: ${game.exePath}`, 'info');
            console.log('Launching:', game.exePath);
        }
        
        // Update last played
        const now = Date.now();
        game.lastPlayedTimestamp = now;
        game.lastPlayed = 'Just now';
        
        try {
            if (window.electronAPI && window.electronAPI.updateGame) {
                await window.electronAPI.updateGame(game.id, { 
                    lastPlayedTimestamp: now,
                    lastPlayed: 'Just now'
                });
            }
            applyFilters();
        } catch (e) {
            console.error('Failed to update last played:', e);
        }
    } else {
        showToast(`No executable path set for ${game.title}`, 'error');
        showToast('Owner needs to add EXE path', 'info');
    }
}

function startPlayTimer(game) {
    currentlyPlaying = {
        id: game.id,
        startTime: Date.now(),
        startTotalMinutes: game.totalMinutes || 0
    };
    
    // Show playing indicator
    document.getElementById('playingGameName').textContent = game.title;
    document.getElementById('playingIndicator').classList.add('active');
    
    // Update timer every second
    playTimerInterval = setInterval(async () => {
        if (!currentlyPlaying) return;
        
        // Get accurate elapsed time from main process if available
        let elapsedSeconds = 0;
        if (window.electronAPI && window.electronAPI.getElapsedTime) {
            try {
                elapsedSeconds = await window.electronAPI.getElapsedTime(game.id);
            } catch (e) {
                elapsedSeconds = Math.floor((Date.now() - currentlyPlaying.startTime) / 1000);
            }
        } else {
            elapsedSeconds = Math.floor((Date.now() - currentlyPlaying.startTime) / 1000);
        }
        
        const totalMinutes = currentlyPlaying.startTotalMinutes + Math.floor(elapsedSeconds / 60);
        document.getElementById('playingTime').textContent = formatPlayTime(totalMinutes);
    }, 1000);
    
    // Re-render to show "Playing" badge
    applyFilters();
}

async function stopPlaying() {
    if (!currentlyPlaying) return;
    
    const gameId = currentlyPlaying.id;
    
    // Tell main process to stop tracking
    if (window.electronAPI && window.electronAPI.stopGame) {
        window.electronAPI.stopGame(gameId);
    }
    
    // Clear local timer
    clearInterval(playTimerInterval);
    playTimerInterval = null;
    
    // Calculate final time locally too (fallback)
    const elapsedMinutes = Math.floor((Date.now() - currentlyPlaying.startTime) / 60000);
    const game = findGameById(gameId);
    
    if (game) {
        game.totalMinutes = (game.totalMinutes || 0) + elapsedMinutes;
        game.hours = formatHours(game.totalMinutes);
        showToast(`${game.title} played for ${formatPlayTime(elapsedMinutes)}`, 'success');
    }
    
    currentlyPlaying = null;
    document.getElementById('playingIndicator').classList.remove('active');
    applyFilters();
}

// Listen for game stopped event from main process (auto-detect)
if (window.electronAPI && window.electronAPI.onGameStopped) {
    window.electronAPI.onGameStopped((data) => {
        console.log('Game stopped by monitor:', data);
        
        // If this is the currently playing game, update UI
        if (currentlyPlaying && sameId(currentlyPlaying.id, data.gameId)) {
            clearInterval(playTimerInterval);
            playTimerInterval = null;
            currentlyPlaying = null;
            document.getElementById('playingIndicator').classList.remove('active');
            
            // Update local game data
            const game = findGameById(data.gameId);
            if (game) {
                game.totalMinutes = data.totalMinutes;
                game.hours = data.hours;
                game.lastPlayed = 'Just now';
                game.lastPlayedTimestamp = Date.now();
            }
            
            showToast(`Game closed. Played for ${formatPlayTime(data.elapsedMinutes)}`, 'success');
            applyFilters();
        }
    });
}

async function toggleFavorite(gameId) {
    const game = findGameById(gameId);
    if (!game) return;
    const newFavorite = !game.isFavorite;
    try {
        if (window.electronAPI && window.electronAPI.updateGame) {
            const updated = await window.electronAPI.updateGame(gameId, { isFavorite: newFavorite });
            if (!updated) throw new Error(`Game ${gameId} was not found in JSON`);
            games = await window.electronAPI.getGames();
        } else {
            game.isFavorite = newFavorite;
        }
        applyFilters();
        showToast(newFavorite ? 'Added to favorites' : 'Removed from favorites', 'success');
    } catch (error) {
        console.error('Failed to toggle favorite:', error);
        showToast('Failed to update favorite status', 'error');
    }
}

function openExternal(url) { 
    showToast(`Opening ${url}...`, 'info'); 
    if (window.electronAPI && window.electronAPI.openExternal) {
        window.electronAPI.openExternal(url);
    } else {
        window.open(url, '_blank'); 
    }
}

function openLoginModal() { if (isOwnerLoggedIn) { logout(); return; } document.getElementById('loginModal').classList.add('active'); }
function closeLoginModal() { document.getElementById('loginModal').classList.remove('active'); document.getElementById('loginUsername').value = ''; document.getElementById('loginPassword').value = ''; }

async function login() {
    const username = document.getElementById('loginUsername').value.trim();
    const password = document.getElementById('loginPassword').value.trim();
    
    try {
        let valid = false;
        if (window.electronAPI && window.electronAPI.verifyOwner) {
            valid = await window.electronAPI.verifyOwner(username, password);
        } else {
            valid = (username === 'jldems' && password === '0925');
        }
        
        if (valid) {
            isOwnerLoggedIn = true;
            closeLoginModal();
            document.getElementById('loginText').textContent = 'Logout';
            document.getElementById('ownerBadge').style.display = 'inline-flex';
            document.getElementById('addGameNav').style.display = 'flex';
            showToast('Owner logged in successfully', 'success');
            applyFilters();
        } else { 
            showToast('Invalid credentials', 'error'); 
        }
    } catch (error) {
        console.error('Login error:', error);
        showToast('Login failed', 'error');
    }
}

function logout() {
    // Stop any active game
    if (currentlyPlaying) {
        stopPlaying();
    }
    isOwnerLoggedIn = false;
    document.getElementById('loginText').textContent = 'Owner Login';
    document.getElementById('ownerBadge').style.display = 'none';
    document.getElementById('addGameNav').style.display = 'none';
    applyFilters();
    showToast('Logged out', 'info');
}

function openAddGameModal() {
    if (!isOwnerLoggedIn) { showToast('Owner login required', 'error'); return; }
    document.getElementById('addGameModal').classList.add('active');
}

function closeAddGameModal() {
    document.getElementById('addGameModal').classList.remove('active');
    document.getElementById('gameTitle').value = '';
    document.getElementById('gameGenre').value = '';
    document.getElementById('gameCover').value = '';
    document.getElementById('gameExeManual').value = '';
}

async function addGame() {
    if (!isOwnerLoggedIn) { showToast('Owner login required', 'error'); return; }
    const title = document.getElementById('gameTitle').value.trim();
    const genre = document.getElementById('gameGenre').value;
    const cover = document.getElementById('gameCover').value.trim() || 'https://images.unsplash.com/photo-1550745165-9bc0b252726f?w=400&h=600&fit=crop&q=80';
    const manualPath = document.getElementById('gameExeManual').value.trim();
    const launchMethod = document.getElementById('gameLaunchMethod').value;
    const appId = document.getElementById('gameAppId').value.trim();
    if (!title) { showToast('Please enter a game title', 'info'); return; }
    if (!genre) { showToast('Please select a genre', 'info'); return; }
    if (!manualPath) { showToast('Please enter an executable path', 'info'); return; }
    
    const newGame = { 
        title: title, 
        cover: cover, 
        genre: genre, 
        hours: "0h", 
        totalMinutes: 0,
        status: "installed", 
        lastPlayed: "Never", 
        lastPlayedTimestamp: null,
        isFavorite: false, 
        exePath: manualPath,
        detectedExePath: '',
        launchMethod: launchMethod,
        appId: appId,
        version: "1.0.0",
        latestVersion: "1.0.0"
    };
    
    try {
        if (!window.electronAPI || !window.electronAPI.addGame) {
            throw new Error('Electron API is unavailable. Restart the launcher and check preload setup.');
        }

        const result = await window.electronAPI.addGame(newGame);
        games = await window.electronAPI.getGames();
        applyFilters();
        closeAddGameModal();
        showToast(`${result.title} added to library`, 'success');
    } catch (error) {
        console.error('Failed to add game:', error);
        showToast('Failed to add game to JSON', 'error');
    }
}

function openDeleteModal(gameId) {
    const game = findGameById(gameId);
    if (!game) return;
    gameToDelete = gameId;
    document.getElementById('deleteGameName').textContent = game.title;
    document.getElementById('deleteModal').classList.add('active');
}

function closeDeleteModal() {
    document.getElementById('deleteModal').classList.remove('active');
    gameToDelete = null;
}

async function confirmDeleteGame() {
    if (!gameToDelete) return;
    // Can't delete while playing
    if (currentlyPlaying && sameId(currentlyPlaying.id, gameToDelete)) {
        showToast('Stop the game before deleting it', 'error');
        closeDeleteModal();
        return;
    }
    try {
        if (window.electronAPI && window.electronAPI.deleteGame) {
            const deleted = await window.electronAPI.deleteGame(gameToDelete);
            if (!deleted) throw new Error(`Game ${gameToDelete} was not found in JSON`);
            games = await window.electronAPI.getGames();
        } else {
            games = games.filter(g => !sameId(g.id, gameToDelete));
        }
        applyFilters();
        showToast('Game deleted', 'success');
        closeDeleteModal();
    } catch (error) {
        console.error('Failed to delete game:', error);
        showToast('Failed to delete game from JSON', 'error');
    }
}

function showToast(message, type = 'info') {
    const container = document.getElementById('toastContainer');
    const toast = document.createElement('div');
    toast.className = `toast toast-${type}`;
    const icons = { success: '✓', info: 'ℹ', error: '✕' };
    toast.innerHTML = `<div class="toast-icon">${icons[type]}</div><div style="font-weight: 600; font-size: 13px;">${message}</div>`;
    container.appendChild(toast);
    requestAnimationFrame(() => toast.classList.add('show'));
    setTimeout(() => { toast.classList.remove('show'); setTimeout(() => toast.remove(), 350); }, 3000);
}

function minimizeWindow() { 
    if (window.electronAPI && window.electronAPI.minimize) {
        window.electronAPI.minimize();
    } else {
        showToast('Minimized', 'info'); 
    }
}

function maximizeWindow() { 
    if (window.electronAPI && window.electronAPI.maximize) {
        window.electronAPI.maximize();
    } else {
        showToast('Maximized', 'info'); 
    }
}

function closeWindow() { 
    if (currentlyPlaying) {
        if (!confirm('A game is currently running. Stop playing and exit?')) return;
        stopPlaying();
    }
    if (window.electronAPI && window.electronAPI.close) {
        if (confirm('Exit JLJGAMINGHOUSE Launcher?')) {
            window.electronAPI.close();
        }
    } else {
        if (confirm('Exit JLJGAMINGHOUSE Launcher?')) { 
            showToast('Closing...', 'info'); 
            setTimeout(() => document.body.innerHTML = '<div style="display:flex;justify-content:center;align-items:center;height:100vh;color:#666;font-size:16px;font-family:Poppins;">JLJGAMINGHOUSE Closed</div>', 800); 
        }
    }
}

document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') { 
        document.getElementById('searchInput').blur(); 
        closeLoginModal(); 
        closeAddGameModal(); 
        closeDeleteModal();
    }
    if (e.ctrlKey && e.key === 'f') { e.preventDefault(); document.getElementById('searchInput').focus(); }
});

// Handle app close while playing
window.addEventListener('beforeunload', () => {
    if (currentlyPlaying) {
        stopPlaying();
    }
});

// Check single game
async function checkGameUpdate(gameId) {
    showToast('Checking for updates...', 'info');
    
    try {
        if (window.electronAPI && window.electronAPI.checkGameUpdate) {
            const result = await window.electronAPI.checkGameUpdate(gameId);
            
            if (result.hasUpdate) {
                showToast(`Update available: ${result.currentVersion} → ${result.latestVersion}`, 'success');
                applyFilters();
            } else {
                showToast('Game is up to date', 'success');
            }
        } else {
            // Fallback: manual comparison
            checkForUpdates();
        }
    } catch (error) {
        console.error('Update check failed:', error);
        showToast('Could not check for updates', 'error');
    }
}

// Check all games
async function checkAllUpdates() {
    showToast('Checking all games for updates...', 'info');
    
    try {
        if (window.electronAPI && window.electronAPI.checkAllUpdates) {
            const updates = await window.electronAPI.checkAllUpdates();
            
            if (updates.length > 0) {
                showToast(`${updates.length} update(s) found!`, 'success');
                updates.forEach(u => {
                    console.log(`${u.title}: ${u.currentVersion} → ${u.latestVersion}`);
                });
                applyFilters();
            } else {
                showToast('All games are up to date', 'success');
            }
        } else {
            checkForUpdates();
        }
    } catch (error) {
        console.error('Bulk update check failed:', error);
        showToast('Update check failed', 'error');
    }
}
