// Grimstone Dungeon (OSRS Wiki). The landings are walkable tiles beside the cached entrances.
const DUNGEON_LANDING = [2887, 10481, 0];
const ISLAND_LANDING = [2911, 4067, 0];

let core;

function enter({ player, objectId }) {
  if (objectId !== core.ObjectIdentifiers.CAVE_ENTRANCE_93) return false;
  player.moveTo(new core.Location(...DUNGEON_LANDING));
  return true;
}

function exit({ player, objectId }) {
  if (objectId !== core.ObjectIdentifiers.CAVE_EXIT_33) return false;
  player.moveTo(new core.Location(...ISLAND_LANDING));
  return true;
}

module.exports = {
  name: "GrimstoneDungeon",
  description: "Travel between Grimstone and its dungeon.",
  members: true,
  register(api) {
    core = api.core;
    api.onObjectInteraction("Cave entrance", { Enter: enter });
    api.onObjectInteraction("Cave exit", { Exit: exit });
  },
};
