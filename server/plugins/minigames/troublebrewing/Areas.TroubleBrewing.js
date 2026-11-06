/**
 * The Trouble Brewing arena is a normal map area: players inside it cannot teleport out, and
 * anyone who leaves it (logout, teleport, death walk) is dropped from the running game.
 */
const Common = require("./Common.TroubleBrewing");
const Game = require("./Game.TroubleBrewing");

function createArena() {
  class TroubleBrewingArena extends Common.core.Area {
    constructor() {
      // The bases have a ground floor and the hopper floor above it; both are the arena.
      super([0, 1, 2].map((z) =>
        new Common.core.Boundary(Common.ARENA.minX, Common.ARENA.maxX, Common.ARENA.minY, Common.ARENA.maxY, z)));
    }

    getName() {
      return "Trouble Brewing";
    }

    canTeleport() {
      return false;
    }

    postLeave(mobile, logout) {
      const player = mobile.getAsPlayer?.() ?? null;
      if (!player) return;
      const game = Game.gameOf(player);
      if (game) {
        game.left(player);
        if (logout) player.moveTo(Common.toLocation(Common.LOBBY_RETURN));
      }
    }
  }
  return new TroubleBrewingArena();
}

module.exports = function attachAreas(api) {
  api.registerArea(createArena());
};

module.exports.createArena = createArena;
