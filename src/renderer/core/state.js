// ============================================================
// STATE MANAGEMENT
// ============================================================
const State = {
  isOwnerLoggedIn: false,
  currentFilter: "all",
  currentSearch: "",
  currentRows: 5,
  allGames: [],
  games: [],
  gameToEdit: null,
  gameToDelete: null,
  currentHostGame: null,
  cachedMaps: [],
  currentlyPlaying: null,
  playTimerInterval: null,
  updateListenerAttached: false,
  cpLocked: false,
};

// ============================================================
// DOM UTILITIES
// ============================================================
const $ = (id) => document.getElementById(id);
const $$ = (sel) => document.querySelectorAll(sel); 
