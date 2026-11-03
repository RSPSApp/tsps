/**
 * Trollheim's thrower trolls (https://oldschool.runescape.wiki/w/Thrower_troll_(Trollheim)) throw
 * rocks from their ledge at anyone passing below it, every one of them at once (the path is
 * multi-combat, world.json). Rsprox 1633 ticks 193-206: each thrower stays on its tile while it
 * throws, starting when the player comes within about six tiles and stopping once they have
 * passed; one wanders a step or two when idle. This server's NPCs otherwise chase a target for
 * as long as it stays in sight, so a thrower is held where it stands while it has a target.
 */
let core = null;

const THROWER_NAME = "Thrower troll";
// The thrower ledge and the path past it, below the God Wars Dungeon entrance.
const BOUNDS = [2880, 2911, 3688, 3719, 0];

function isThrower(mobile) {
  return mobile.isNpc() && mobile.getAsNpc().getDefinition()?.getName?.() === THROWER_NAME;
}

/** Throwers in the area: anchored while they have a target, free to wander otherwise. */
function trollheimArea() {
  class Trollheim extends core.Area {
    getName() {
      return "Trollheim";
    }

    process(mobile) {
      if (!isThrower(mobile)) return;
      const npc = mobile.getAsNpc();
      const throwing = npc.getCombat().getTarget() != null;
      if (npc.getMovementQueue().isMovementBlocked() === throwing) return;
      npc.getMovementQueue().setBlockMovement(throwing);
      if (throwing) npc.getMovementQueue().reset();
    }
  }
  const [minX, maxX, minY, maxY, z] = BOUNDS;
  return new Trollheim([new core.Boundary(minX, maxX, minY, maxY, z)]);
}

function attach(pluginApi) {
  core = pluginApi.core;
}

module.exports = {
  name: "Trollheim",
  members: true,
  register(pluginApi) {
    attach(pluginApi);
    pluginApi.registerArea(trollheimArea());
  },
};
