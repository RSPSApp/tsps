/**
 * Trouble Brewing's stations: hoppers, boilers, kettle, log store, water, workbench, flowers,
 * mounds, scrapey and jungle trees, bitternut trees and monkeys, and the waiting-room door and
 * exit portal. Every handler first checks the cache placement, so the same object names
 * elsewhere in the world are left alone, and then the player's team.
 */
const Common = require("./Common.TroubleBrewing");
const Game = require("./Game.TroubleBrewing");
const Lobby = require("./Lobby.TroubleBrewing");

let index = null;

function data() {
  if (index) return index;
  const boilerByTile = new Map();
  const hopperByTile = new Map();
  const kettle = new Map();
  const logStore = new Map();
  const pump = new Map();
  const tools = new Map();
  const bench = new Map();
  const conveyor = new Map();
  for (const team of Common.TEAMS) {
    const base = Common.BASE[team];
    base.boilers.forEach((tile, i) => boilerByTile.set(tile, { team, index: i }));
    for (const [kind, tile] of Object.entries(base.hoppers)) hopperByTile.set(tile, { team, kind });
    kettle.set(base.kettle, team);
    logStore.set(base.logStore, team);
    pump.set(base.pump, team);
    tools.set(base.tools, team);
    bench.set(base.bench, team);
    conveyor.set(base.conveyor.join(","), team);
  }
  const flowers = new Map();
  for (const [colour, tiles] of Object.entries(Common.FLOWERS)) for (const tile of tiles) flowers.set(tile, colour);
  return (index = { boilerByTile, hopperByTile, kettle, logStore, pump, tools, bench, conveyor, flowers });
}

const at = (event) => Common.key(event.location ?? event.object?.getLocation?.());
const ids = () => Game.items();

function teamOf(player) {
  return Game.current?.teamOf(player) ?? null;
}

function inGame(player) {
  return Game.current !== null && Game.current.teamOf(player) !== null;
}

/** Item on a hopper: the matching ingredient, a bucket of water or the team's coloured water. */
function useOnHopper(event, station) {
  const { player, itemId } = event;
  if (station.team !== teamOf(player)) {
    return true;
  }
  const inventory = player.getInventory();
  const table = ids();
  const deposited = {
    bitternut: itemId === table.bitternut,
    sweetgrub: itemId === table.sweetgrubs,
    bark: itemId === table.bark,
    water: itemId === table.water,
    colour: itemId === (station.team === "red" ? table.redWater : table.blueWater),
  }[station.kind];
  if (!deposited) {
    return true;
  }
  inventory.deleteNumber(itemId, 1);
  if (station.kind === "water") inventory.addItem(new Common.core.Item(table.bucket, 1));
  if (station.kind === "colour") inventory.addItem(new Common.core.Item(table.bowl, 1));
  Game.current.deposit(player, station.kind);
  return true;
}

function useOnBoiler(event, station) {
  const { player, itemId } = event;
  if (station.team !== teamOf(player)) {
    return true;
  }
  const inventory = player.getInventory();
  if (itemId === ids().logs) {
    inventory.deleteNumber(itemId, 1);
    Game.current.addLog(player, station.index);
    return true;
  }
  if (itemId === ids().tinderbox) {
    Game.current.lightBoiler(player, station.index);
    return true;
  }
  return false;
}

function useOnKettle(event, team) {
  const { player, itemId } = event;
  if (team !== teamOf(player)) {
    return true;
  }
  const table = ids();
  if (itemId === table.bowl) return Game.current.takeColouredWater(player);
  const colour = itemId === table.redFlowers ? "red" : itemId === table.blueFlowers ? "blue" : null;
  if (!colour) return false;
  const inventory = player.getInventory();
  inventory.deleteNumber(itemId, 1);
  return Game.current.addFlowers(player, colour);
}

function useOnPump(event, team) {
  const { player, itemId } = event;
  if (itemId !== ids().bucket) return false;
  if (team !== teamOf(player)) {
    return true;
  }
  fillBuckets(player);
  return true;
}

function fillBuckets(player) {
  const inventory = player.getInventory();
  const table = ids();
  const empty = inventory.getAmount(table.bucket);
  if (empty === 0) {
    return;
  }
  inventory.deleteNumber(table.bucket, empty);
  inventory.addItem(new Common.core.Item(table.water, empty));
}

function useOnMound(event) {
  const { player, itemId } = event;
  if (itemId !== ids().meat) return false;
  player.getInventory().deleteNumber(itemId, 1);
  if (Math.random() < 0.2) {
    return true;
  }
  player.getInventory().addItem(new Common.core.Item(ids().sweetgrubs, 1));
  player.getSkillManager().addExperiences(Common.core.Skill.HUNTER, 40);
  return true;
}

function useOnBitternutTree(event) {
  const { player, itemId } = event;
  const table = ids();
  if (itemId !== table.redMonkey && itemId !== table.blueMonkey) return false;
  const game = Game.current;
  if (!game) return false;
  if (player.getInventory().getFreeSlots() < 1) {
    return true;
  }
  player.getInventory().deleteNumber(itemId, 1);
  Common.later(10, () => {
    if (!player.isRegistered?.() || !game.teams.has(player)) return;
    player.getInventory().addItem(new Common.core.Item(table.bitternut, 1));
    player.getSkillManager().addExperiences(Common.core.Skill.HUNTER, 50);
  });
  return true;
}

function useOnLogStore(event, team) {
  if (event.itemId !== ids().logs) return false;
  if (team !== teamOf(event.player)) {
    return true;
  }
  event.player.getInventory().deleteNumber(ids().logs, 1);
  Game.current.stateOf(team).storeLogs = Math.min(Common.STORE_LOGS, Game.current.stateOf(team).storeLogs + 1);
  return true;
}

/** One generic item-on-object entry point; every station checks its own cache tile. */
function itemOnObject(event) {
  if (!inGame(event.player)) return false;
  const table = data();
  const tile = at(event);
  const hopper = table.hopperByTile.get(tile);
  if (hopper) { event.handled = true; return useOnHopper(event, hopper); }
  const boiler = table.boilerByTile.get(tile);
  if (boiler) { event.handled = true; return useOnBoiler(event, boiler); }
  const kettle = table.kettle.get(tile);
  if (kettle) { event.handled = true; return useOnKettle(event, kettle); }
  const pump = table.pump.get(tile);
  if (pump) { event.handled = true; return useOnPump(event, pump); }
  const store = table.logStore.get(tile);
  if (store) { event.handled = true; return useOnLogStore(event, store); }
  if (Common.SWEETGRUB_MOUNDS.has(tile)) { event.handled = true; return useOnMound(event); }
  if (Common.BITTERNUT_TREES.has(tile)) { event.handled = true; return useOnBitternutTree(event); }
  if (Common.WATERING_HOLE.z === 0 && insideWateringHole(event.location) && event.itemId === ids().bucket) {
    event.handled = true; fillBuckets(event.player); return true;
  }
  return false;
}

function insideWateringHole(location) {
  const hole = Common.WATERING_HOLE;
  const x = location.x ?? location.getX();
  const y = location.y ?? location.getY();
  return (location.z ?? location.getZ()) === hole.z && x >= hole.minX && x <= hole.maxX && y >= hole.minY && y <= hole.maxY;
}

function takeLog({ player, location }) {
  if (!inGame(player)) return false;
  const team = data().logStore.get(Common.key(location));
  if (!team) return false;
  if (team !== teamOf(player)) { return true; }
  const state = Game.current.stateOf(team);
  if (state.storeLogs <= 0) { return true; }
  if (player.getInventory().getFreeSlots() < 1) { return true; }
  state.storeLogs--;
  player.getInventory().addItem(new Common.core.Item(ids().logs, 1));
  return true;
}

function takeTool({ player, location }) {
  if (!inGame(player)) return false;
  const team = data().tools.get(Common.key(location));
  if (!team) return false;
  if (team !== teamOf(player)) { return true; }
  const table = ids();
  const supplied = [table.bucket, table.bowl, table.knife, table.tinderbox, table.axe, table.meat, table.torch];
  const inventory = player.getInventory();
  for (const id of supplied) {
    if (inventory.contains(id) || inventory.getFreeSlots() < 1) continue;
    inventory.addItem(new Common.core.Item(id, 1));
  }
  return true;
}

function pickFlowers({ player, location }) {
  const colour = data().flowers.get(Common.key(location));
  if (!colour) return false;
  const team = teamOf(player);
  if (!team) return false;
  if (team !== colour) { return true; }
  const itemId = colour === "red" ? ids().redFlowers : ids().blueFlowers;
  const inventory = player.getInventory();
  if (inventory.getAmount(itemId) >= Common.MAX_FLOWERS) {
    return true;
  }
  if (inventory.getFreeSlots() < 1) { return true; }
  inventory.addItem(new Common.core.Item(itemId, 1));
  return true;
}

function chopTree(event, tiles, logId) {
  if (!inGame(event.player) || !tiles.has(at(event))) return false;
  Common.api.emitCustomEvent("woodcutting:chop", { player: event.player, object: event.object, logId, handled: false });
  return true;
}

function cutScrapey(event) {
  return chopTree(event, Common.SCRAPEY_TREES, ids().scrapeyLogs);
}

function cutJungle(event) {
  return chopTree(event, Common.JUNGLE_TREES, ids().logs);
}

function validateChopping(request) {
  const tile = Common.key(request.object.getLocation());
  if ((Common.SCRAPEY_TREES.has(tile) || Common.JUNGLE_TREES.has(tile)) && !inGame(request.player)) request.allow = false;
}

function knifeOnLogs(event) {
  const { player, usedItemId, usedWithItemId } = event;
  const table = ids();
  if (!((usedItemId === table.knife && usedWithItemId === table.scrapeyLogs)
    || (usedItemId === table.scrapeyLogs && usedWithItemId === table.knife))) return false;
  event.handled = true;
  player.getInventory().deleteNumber(table.scrapeyLogs, 1);
  player.getInventory().addItem(new Common.core.Item(table.bark, 1));
  player.getSkillManager().addExperiences(Common.core.Skill.FLETCHING, 50);
  return true;
}

function dyeMonkey(event) {
  const { player, usedItemId, usedWithItemId } = event;
  const table = ids();
  const bowl = usedItemId === table.redWater || usedItemId === table.blueWater ? usedItemId
    : usedWithItemId === table.redWater || usedWithItemId === table.blueWater ? usedWithItemId : null;
  const monkey = usedItemId === table.monkey ? usedItemId : usedWithItemId === table.monkey ? usedWithItemId : null;
  if (!bowl || !monkey) return false;
  const team = teamOf(player);
  if (!team) return false;
  const correct = team === "red" ? table.redWater : table.blueWater;
  if (bowl !== correct) {
    return false;
  }
  event.handled = true;
  player.getInventory().deleteNumber(table.monkey, 1);
  player.getInventory().deleteNumber(bowl, 1);
  player.getInventory().addItem(new Common.core.Item(table.bowl, 1));
  player.getInventory().addItem(new Common.core.Item(team === "red" ? table.redMonkey : table.blueMonkey, 1));
  return true;
}

function catchMonkey({ player, npc }) {
  const game = Game.current;
  if (!game || !npc) return false;
  if (!game.teams.has(player)) return false;
  return game.catchMonkey(player, npc);
}

function waitingDoor({ player, location }) {
  const tile = Common.key(location);
  for (const team of Common.TEAMS) {
    if (Common.WAITING[team].door === tile) {
      if (Lobby.inQueue(player)) {
        Lobby.leaveWaiting(player);
        return true;
      }
      return true;
    }
  }
  return false;
}

function exitPortal({ player, location }) {
  const game = Game.current;
  if (!game || !game.teams.has(player)) return false;
  const tile = Common.key(location);
  if (tile !== "3800,2953,0" && tile !== "3829,2997,0") return false;
  game.left(player);
  player.moveTo(Common.toLocation(Common.LOBBY_RETURN));
  return true;
}

function attachStations(api) {
  api.onItemOnObject(itemOnObject, { noted: false });
  api.onItemOnItem(knifeOnLogs, { noted: false });
  api.onItemOnItem(dyeMonkey, { noted: false });
  api.onObjectInteraction("Log Store", { "Take-Log": takeLog });
  api.onObjectInteraction("Workbench", { "Take-Tool": takeTool });
  api.onObjectInteraction("Red flowers", { Pick: pickFlowers });
  api.onObjectInteraction("Blue flowers", { Pick: pickFlowers });
  api.onObjectInteraction("Scrapey Tree", { "Cut-Down": cutScrapey });
  api.onObjectInteraction("Jungle tree", { "Cut-Down": cutJungle });
  api.onObjectInteraction("Waiting Room Door", { Open: waitingDoor });
  api.onObjectInteraction("Portal", { Exit: exitPortal });
  api.onNpcInteraction("Monkey", { Catch: catchMonkey });
  api.onGroundItemPickup(Game.pickupRum);
  api.onCustomEvent("agent:advance-time", Game.advanceTime);
  api.onCustomEvent("woodcutting:validate-tree", validateChopping);
}

module.exports = { attachStations, data, itemOnObject, takeLog, takeTool, pickFlowers };
