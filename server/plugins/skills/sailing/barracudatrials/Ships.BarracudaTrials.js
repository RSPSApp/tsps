// The Barracudas' boats (rsprox): each trial master stands on his boat at the trial's start
// (Rum-dashed Ralph north of the Storm Tempor, Gurtob with Ros at Backwater, Gwyna by Porth
// Gwenith), and the trials' supply boats lie out on the course (the rum boat south of Tempoross
// Cove, the toad boat at the Jubbly Jive's far west, each with a rat aboard). They're public,
// unboardable world entities of type 10, from their own template zones.
const common = require("./Common.BarracudaTrials");
const StaticShips = require("../StaticShips.Sailing");

/** Ros steps between her two tiles now and then (rsprox). */
const ROS_STEP_TICKS = 8;

/** Spawned ships by data id: the ship and the NPCs on it. */
const spawned = new Map();

/**
 * Where a trial master or assistant stands: on the boat's own hull, in the main world, instead of
 * in the ship's synthetic deck region. The trial ships are `"boardable": false`, so a deck-region
 * NPC (StaticShips.addDeckNpc, `deckBaseX + x` — entity 3000 is at 1200,1200) can never be reached
 * from the water, which is what issue 6667 reports: the boat renders and the master does not.
 *
 * The deck-local tile is mapped through `Boat.deckTileToWorld`, which applies the deck base, the
 * deck centre and the boat's angle — the ships are spawned rotated (Ralph's is at 1536 = 270°), so
 * adding the offset straight onto the hull tile puts the NPC off the deck rather than on it.
 */
function hullLocation(ship, x, y) {
  const deck = StaticShips.deckLocation(ship, x, y);
  const world = ship.boat.deckTileToWorld(deck.getX(), deck.getY());
  return new (common.core().Location)(world.x, world.y, ship.boat.level);
}

/** A public world NPC standing on the hull at the boat's tile + the deck-local offset. */
function spawnOnHull(ship, npcId, x, y) {
  const location = hullLocation(ship, x, y);
  return common.core().PluginManager.spawnNpc({
    id: npcId, x: location.getX(), y: location.getY(), z: location.getZ(),
  });
}

function spawnShip(entry) {
  const ship = StaticShips.spawn(entry.id, { fineX: entry.fineX, fineY: entry.fineY, angle: entry.angle });
  if (!ship) return undefined;
  const npcs = (entry.npcs ?? []).map((npc) => StaticShips.addDeckNpc(ship, npc.id, npc.tile[0], npc.tile[1], undefined, { shared: true }));
  const record = { ship, npcs };
  spawned.set(entry.id, record);
  return record;
}

function spawnAll() {
  for (const trial of common.trials) {
    for (const entry of trial.ships) {
      const record = spawnShip(entry);
      if (!record) continue;
      if (entry.id === trial.master.ship) {
        const [x, y] = trial.master.tile;
        record.master = spawnOnHull(record.ship, trial.master.npc, x, y);
        if (trial.assistant) {
          const [ax, ay] = trial.assistant.tiles[0];
          record.assistant = spawnOnHull(record.ship, trial.assistant.npc, ax, ay);
          pace(record, trial.assistant.tiles);
        }
      }
    }
  }
}

/** The assistant's idle steps between her tiles. */
function pace(record, tiles) {
  const { Task, TaskManager, PathFinder } = common.core();
  let next = 1;
  TaskManager.submit(new (class extends Task {
    constructor() { super(ROS_STEP_TICKS, "barracuda-trials:assistant", false); }
    execute() {
      const npc = record.assistant;
      if (!npc?.isRegistered?.()) return this.stop();
      const [x, y] = tiles[next];
      const to = hullLocation(record.ship, x, y);
      npc.setSpawnPosition?.(to);
      PathFinder.calculateWalkRoute(npc, to.getX(), to.getY());
      next = (next + 1) % tiles.length;
    }
  })());
}

/** A spawned ship's world entity index (hint arrows, camera targets), by its data id. */
function entityIndex(id) {
  return spawned.get(id)?.ship.boat.entityIndex;
}

function shipOf(id) {
  return spawned.get(id)?.ship;
}

function masterOf(trial) {
  return spawned.get(trial.master.ship)?.master;
}

function attach(api) {
  common.init(api);
  StaticShips.attach(api);
  api.onServerStartup(spawnAll);
}

module.exports = attach;
module.exports.entityIndex = entityIndex;
module.exports.shipOf = shipOf;
module.exports.masterOf = masterOf;
module.exports.spawnAll = spawnAll;
