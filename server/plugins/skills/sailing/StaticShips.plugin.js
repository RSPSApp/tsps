// Boarding for any spawned static ship (a quest/plugin spawns the ship itself).
const StaticShips = require("./StaticShips.Sailing");

function interact(event) {
  if (event.clickType !== 1) return;
  const ship = StaticShips.get(event.entityIndex);
  if (!ship || !StaticShips.canSee(event.player, ship)) return;
  if (!StaticShips.inRange(event.player, ship, StaticShips.BOARD_RANGE)) {
    event.player.sendMessage("You can't reach that ship.");
    event.handled = true;
    return;
  }
  if (StaticShips.isAboard(event.player, ship)) {
    StaticShips.leave(event.player);
  } else {
    const refusal = StaticShips.board(event.player, ship);
    if (refusal) event.player.sendMessage(refusal);
  }
  event.handled = true;
}

/** Helper for direct callers/tests; logout hooks receive the event object. */
function forgetPlayer(player) {
  StaticShips.forget(player);
}

function logout({ player }) {
  forgetPlayer(player);
}

function initialize(api) {
  StaticShips.attach(api);
  require("./ShipCombat.Sailing").register(api);
}

module.exports = {
  name: "SailingStaticShips",
  members: true,
  register(api) {
    initialize(api);
    api.onWorldEntityInteraction(interact);
    api.onPlayerLogout(logout);
  },
};
