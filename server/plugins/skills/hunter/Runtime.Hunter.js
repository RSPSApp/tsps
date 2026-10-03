"use strict";

const C = require("./Context.Hunter");
const { H } = C;
const Traps = require("./Traps.Hunter");
const Catching = require("./Catching.Hunter");
const Birdhouses = require("./Birdhouses.Hunter");
const Tracking = require("./Tracking.Hunter");
const Pitfalls = require("./Pitfalls.Hunter");
const Aerial = require("./Aerial.Hunter");
const MagicBoxes = require("./MagicBoxes.Hunter");
const Rabbits = require("./Rabbits.Hunter");
const Herbiboar = require("./Herbiboar.Hunter");
const Crabs = require("./Crabs.Hunter");
const DriftNets = require("./DriftNets.Hunter");
const Dungeon = require("./Dungeon.Hunter");
const Broavs = require("./Broavs.Hunter");
let task;

function start(api) {
  H.api = api; H.core = api.core; H.data = require("./Data.Hunter").build(api.core); H.tick = 0;
  Birdhouses.initialize(); Tracking.initialize(); Crabs.initialize(); DriftNets.initialize();
  class HunterTask extends H.core.Task { execute() { tick(); } }
  task = new HunterTask(1);
  H.core.TaskManager.submit(task);
}

function tick() {
  H.tick++;
  C.processActions(); Traps.process(); C.processHidden(); Catching.process(); Tracking.process(); Pitfalls.process(); Rabbits.process(); Herbiboar.process(); Crabs.process(); DriftNets.process(); Dungeon.process(); Broavs.process();
}

function cleanup(event) {
  C.cancel(event.player); Traps.cleanup(event); Catching.cleanup(event); Tracking.clear(event); Pitfalls.clear(event); Aerial.cleanup(event); Herbiboar.clear(event); Crabs.cleanup(event); DriftNets.cleanup(event); Dungeon.cleanup(event); Broavs.cleanup(event);
  H.players.delete(event.player);
}

function shutdown() {
  task?.stop(); Rabbits.shutdown();
  for (const player of H.players) cleanup({ player });
  for (const npc of H.hidden.keys()) C.reveal(npc);
}

function processPlayer(event) {
  Birdhouses.sync(event); Crabs.sync(event); Catching.processPlayer(event); Aerial.processPlayer(event);
  for (const trap of H.traps) if (trap.player === event.player && trap.area !== event.player.getPrivateArea()) {
    // Recover reusable tools before changing instances, rather than leave them in an inaccessible area.
    for (const item of Traps.returnedItems(trap)) if (!C.exchange(event.player, [], [item])) C.drop(event.player, [item], event.player.getLocation());
    Traps.remove(trap);
  }
}

function catchNpc(event) { return Aerial.fish(event) || Dungeon.catchBat(event) || Catching.catchNpc(event); }
function npcRoute(event) {
  if (event.definition?.getActions()?.[event.clickType - 1] !== "Catch") return;
  if (event.npcId === H.core.NpcIdentifiers.FISHING_SPOT_12) event.range = 9;
  else if (H.data.falconry.some(c => c.npc === event.npcId)) event.range = 8;
}
function objectUse(event) {
  for (const handler of [Birdhouses.use, Rabbits.use, Crabs.use, DriftNets.use, Dungeon.use, Broavs.use, Traps.bait]) { handler(event); if (event.handled) return; }
}
function itemUse(event) {
  for (const handler of [Birdhouses.craft, Aerial.cut, Crabs.cut, MagicBoxes.use]) { handler(event); if (event.handled) return; }
}
function inspect(event) { return Herbiboar.inspect(event) || Tracking.inspect(event); }
function npcUse(event) { Aerial.tench(event); if (!event.handled) Broavs.train(event); }
function pitBuild(event) { return Broavs.build(event) || Pitfalls.build(event); }
function dismantle(event) { return Broavs.dismantle(event) || Traps.dismantle(event); }
function attack(event) { return Herbiboar.attack(event) || Tracking.catchPrey(event); }
function login(event) { H.players.add(event.player); Birdhouses.login(event); Crabs.login(event); DriftNets.login(event); }
function equipment(event) { Catching.equipment(event); Aerial.equipment(event); }

function release({ player, itemId }) {
  const I = H.core.ItemIdentifiers;
  if (![I.FERRET, I.SWAMP_LIZARD, I.ORANGE_SALAMANDER, I.RED_SALAMANDER, I.BLACK_SALAMANDER, I.TECU_SALAMANDER, I.IMMATURE_TECU_SALAMANDER].includes(itemId)) return false;
  if (C.exchange(player, [[itemId, 1]], [])) player.sendMessage("You release the creature.");
  return true;
}

module.exports = { start, tick, shutdown, login, inspect, attack, cleanup, processPlayer, catchNpc, npcRoute, objectUse, itemUse, equipment, release, npcUse, pitBuild, dismantle };
