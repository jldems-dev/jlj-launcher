const checkRoblox = require("./updaters/checkRoblox");
const checkCrossfire = require("./updaters/checkCrossfire");

function createGameUpdateService({ store }) {
  async function checkGameUpdate(gameId) {
    const game = store.findGame(gameId);

    if (!game) return null;

    let result = null;

    const title = game.title.toLowerCase(); 

    if (title.includes("roblox")) {
      result = await checkRoblox(game);
    } else if (title.includes("crossfire")) {
      result = await checkCrossfire(game);
    } 
    if (result) {
      store.updateGame(game.id, {
        version: result.version || game.version,

        latestVersion: result.latestVersion || game.latestVersion,

        status: result.status || game.status,
      });
    }

    return result;
  }

  async function checkAllGames() {
    const games = store.getGames();

    const updates = [];

    for (const game of games) {
      const result = await checkGameUpdate(game.id);

      if (result) {
        updates.push({
          gameId: game.id,
          title: game.title,
          currentVersion: game.version,
          latestVersion: result.latestVersion,
          status: result.status,
        });
      }
    }
    
    return updates;
  }

  return {
    checkGameUpdate,
    checkAllGames,
  };
}

module.exports = {
  createGameUpdateService,
};