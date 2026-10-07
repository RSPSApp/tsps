"use strict";

const Shared = require("./GauntletShared");
const GauntletMap = require("./GauntletMap");
const Run = require("./GauntletRun");
const Items = require("./GauntletItems");
const Rewards = require("./GauntletRewards");

/**
 * ::gauntletmap [corrupted] [all] - builds a maze (no run) and puts you in its start room, to
 * check the map; "all" lights every room at once. Leaving the maze removes it.
 */
function buildMap({ player, parts }) {
  const args = (parts?.slice(1) ?? []).map((arg) => arg.toLowerCase());
  if (Run.runOf(player)) {
    player.sendMessage("Leave your Gauntlet run before using ::gauntletmap.");
    return true;
  }
  const map = GauntletMap.createMap({ corrupted: args.includes("corrupted") });
  if (args.includes("all")) map.lightAll();
  map.enter(player);
  player.moveTo(map.startTile());
  player.sendMessage(`You enter a test maze of ${map.getName()} (start room ${map.start.x}, ${map.start.y}).`);
  return true;
}

/** ::gauntletstart [corrupted] - starts a run without Bryn's checks; your hands must be empty. */
function startRun({ player, parts }) {
  const corrupted = (parts?.slice(1) ?? []).some((arg) => arg.toLowerCase() === "corrupted");
  if (Run.runOf(player)) {
    player.sendMessage("You are already in a Gauntlet run.");
    return true;
  }
  if (!Shared.isEmptyHanded(player)) {
    player.sendMessage("Bank your inventory and equipment first: a run takes everything you carry when it ends.");
    return true;
  }
  Run.startRun(player, { corrupted });
  return true;
}

/** ::gauntletboss - ends the preparation now and takes you to the Hunllef. */
function skipToBoss({ player }) {
  const run = Run.runOf(player);
  if (!run || run.stage !== "prep") {
    player.sendMessage("Start a Gauntlet run before using ::gauntletboss.");
    return true;
  }
  run.startBossPhase({ forced: true });
  return true;
}

/** ::gauntlettime <seconds> - sets the preparation time left. */
function setPrepTime({ player, parts }) {
  const run = Run.runOf(player);
  const seconds = Number(parts?.[1]);
  if (!run || run.stage !== "prep" || !Number.isFinite(seconds) || seconds < 0) {
    player.sendMessage("Use ::gauntlettime <seconds> during a run's preparation.");
    return true;
  }
  run.prepLeft = Math.max(1, Math.round(seconds / 0.6));
  player.getPacketSender().sendClientScript(Shared.SCRIPT.TIMER_START, run.prepLeft);
  return true;
}

const TIERS = ["basic", "attuned", "perfected"];
const EGNIOL_4 = 23885;

/**
 * ::gauntletgear [basic|attuned|perfected] - during a run, swaps what you carry for a Hunllef
 * loadout of that tier (perfected by default): the armour worn and the bow wielded, the staff,
 * the halberd, four Egniol potions, four crystal paddlefish and paddlefish in the rest.
 */
function gearUp({ player, parts }) {
  const run = Run.runOf(player);
  if (!run) {
    player.sendMessage("Start a Gauntlet run before using ::gauntletgear.");
    return true;
  }
  const wanted = String(parts?.[1] ?? "perfected").toLowerCase();
  const tier = TIERS.indexOf(wanted);
  if (tier < 0) {
    player.sendMessage("Use ::gauntletgear [basic|attuned|perfected].");
    return true;
  }
  const { Item, Equipment } = Shared.core();
  const items = Items.itemsFor(run.mode);
  Shared.clearItems(player);
  const equipment = player.getEquipment();
  equipment.setItem(Equipment.HEAD_SLOT, new Item(items.helm[tier], 1));
  equipment.setItem(Equipment.BODY_SLOT, new Item(items.body[tier], 1));
  equipment.setItem(Equipment.LEG_SLOT, new Item(items.legs[tier], 1));
  equipment.setItem(Equipment.WEAPON_SLOT, new Item(items.bow[tier], 1));
  equipment.refreshItems();
  const inventory = player.getInventory();
  inventory.adds(items.staff[tier], 1);
  inventory.adds(items.halberd[tier], 1);
  for (let i = 0; i < 4; i++) inventory.adds(EGNIOL_4, 1);
  for (let i = 0; i < 4; i++) inventory.adds(items.comboFish, 1);
  while (inventory.getFreeSlots() > 0) inventory.adds(items.paddlefish, 1);
  inventory.refreshItems();
  player.resetAttributes();
  player.sendMessage(`You are equipped for the Hunllef with ${wanted} gear.`);
  return true;
}

/**
 * ::gauntletreward [corrupted|incomplete|junk] - puts a reward in the lobby chest as if a run
 * just ended: a Gauntlet kill by default, a Corrupted one, or a lost run's tables.
 */
function setReward({ player, parts }) {
  const args = (parts?.slice(1) ?? []).map((arg) => arg.toLowerCase());
  const mode = args.includes("corrupted") ? "corrupted" : "regular";
  const kind = args.includes("incomplete") ? "incomplete" : args.includes("junk") ? "junk" : "completed";
  Rewards.setReward(player, mode, kind);
  player.sendMessage(`A ${mode === "corrupted" ? "Corrupted " : ""}Gauntlet reward (${kind}) waits in the lobby chest.`);
  return true;
}

function toLobby({ player }) {
  if (Run.runOf(player)) {
    player.sendMessage("Leave your Gauntlet run before using ::gauntlet.");
    return true;
  }
  player.moveTo(Shared.loc(Shared.LOBBY));
  return true;
}

module.exports = function registerGauntletCommands(api) {
  Shared.bind(api);
  const { DEVELOPER } = api.core.PlayerRights;
  api.registerCommand("gauntlet", toLobby, DEVELOPER, "Teleport to the Gauntlet lobby");
  api.registerCommand("gauntletmap", buildMap, DEVELOPER, "Build a Gauntlet map");
  api.registerCommand("gauntletstart", startRun, DEVELOPER, "Start a Gauntlet run");
  api.registerCommand("gauntletboss", skipToBoss, DEVELOPER, "Skip to the Gauntlet boss");
  api.registerCommand("gauntlettime", setPrepTime, DEVELOPER, "Set Gauntlet preparation time");
  api.registerCommand("gauntletgear", gearUp, DEVELOPER, "Give Gauntlet equipment");
  api.registerCommand("gauntletreward", setReward, DEVELOPER, "Set Gauntlet rewards");
};
