"use strict";

/**
 * Tempoross: shared ids, data and small helpers every unit uses.
 *
 * Wiki: https://oldschool.runescape.wiki/w/Tempoross
 * docs/tempoross.md records the live captures these ids, messages and timings come from.
 */

const DATA = require("../data/tempoross.json");

const state = { api: null, core: null };

function bind(api) {
  state.api = api;
  state.core = api.core;
}

function core() {
  return state.core;
}

function api() {
  return state.api;
}

const NPC = {
  BOSS: 10572,
  BOSS_DRAWING_WATER: 10573,
  BOSS_SUBMERGED: 10574,
  BOSS_ENRAGED: 10575,
  SPOT_NORTH: 10565,
  SPOT_SOUTH: 10568,
  SPOT_SPECIAL: 10569,
  POOL_INACTIVE: 10570,
  POOL: 10571,
  CLOUD: 10580,
  STRIKE: 10581,
  FIRE: 8643,
  ISLAND_CRAB: 10563,
  FERRY_TO_LOBBY: 10610,
  FERRY_FROM_LOBBY: 10611,
  REWARD_ANGLER: 10605,
};

/** The cove's fishing spots, any of which can turn into the jumping one. */
const SPOT_IDS = [NPC.SPOT_NORTH, NPC.SPOT_SOUTH, NPC.SPOT_SPECIAL];

const LOC = {
  LADDER: 41305,
  FERRY: 41311,
  SHRINE: 41236,
  LIGHTNING_SHADOW: 41006,
  FIRE_VISUALS: 37582,
  DEBRIS: [41292, 41293, 41294, 41295],
  REWARD_POOL: 41356,
};

const ITEM = {
  RAW: 25564,
  COOKED: 25565,
  CRYSTALLISED: 25566,
  CASKET: 25590,
  ROPE: 954,
  BUCKET: 1925,
  BUCKET_OF_WATER: 1929,
  HAMMER: 2347,
  HARPOON: 311,
};

/** Harpoonfish, best ammunition first. */
const FISH = [ITEM.COOKED, ITEM.CRYSTALLISED, ITEM.RAW];

/** What a wave or a fire can take: the cove's own tools and its fish (Wiki). */
const LOSABLE = [
  { id: ITEM.HAMMER, name: "Hammer" },
  { id: ITEM.ROPE, name: "Rope" },
  { id: ITEM.BUCKET, name: "Bucket" },
  { id: ITEM.BUCKET_OF_WATER, name: "Bucket of water" },
];

const VARBIT = {
  TETHERED: 11895,
  POINTS: 11897,
  PERMITS: 11936,
};

const VARP = {
  KILLS: 2934,
};

const INTERFACE = {
  HUD: 437,
  LOBBY_HUD: 687,
  FADE: 174,
};

/** tempoross_lobby_hud's two lines. */
const LOBBY_HUD = {
  PLAYERS: (INTERFACE.LOBBY_HUD << 16) | 3,
  DEPARTURE: (INTERFACE.LOBBY_HUD << 16) | 4,
};

const SCRIPT = {
  HUD_UPDATE: 4074,
  WAVE_SHOW: 4068,
  WAVE_HIDE: 4069,
  FADE: 948,
};

const ANIM = {
  LADDER: 828,
  HARPOON: 618,
  COOK: 896,
  TETHER: 3705,
  UNTETHER: 832,
  REPAIR: 3676,
  DOUSE: 2771,
  CANNON_FIRING: 8871,
  CANNON_FIRING_MIRROR: 8872,
  BOSS_TIDAL_WAVE: 8902,
  BOSS_SPAWN: 8897,
  BOSS_READY_TO_WHIRL: 8900,
  BOSS_TORRENT: 8903,
  BOSS_LIGHTNING: 8905,
  BOSS_DEATH: 8904,
  CHEER: 862,
  DANCE: 866,
  DANCE_SCOTTISH: 2106,
  CLOUD_GROWING: 8876,
  CLOUD_CHARGING: 8877,
  CLOUD_ATTACK: 8878,
  CLOUD_SHRINKING: 8879,
};

const GFX = {
  SPOT_SPLASH: 3,
  PROJECTILE_COOKED: 525,
  PROJECTILE_RAW: 528,
  PROJECTILE_CRYSTALLISED: 1837,
  IMPACT: 1838,
  FIRE_SPREAD: 1839,
  FIRE_SPAWN: 1840,
  TORRENT_CAST: 1841,
  TORRENT: 1842,
  WATER_SPLASH: 1843,
  TETHER: 1844,
  TETHER_LOOP: 1845,
  UNTETHER: 1846,
};

const SOUND = {
  BOAT: 2163,
  LADDER_WAIT: 2213,
  COOK: 2577,
  LOAD: 4959,
  CANNON_FIRE: 4949,
  CANNON_FIRE_2: 4945,
  POOL: 4944,
  TETHER: 1439,
  UNTETHER: 2247,
  REPAIR: 938,
  DOUSE: 1733,
  DOUSE_2: 2412,
  WAVE: 4038,
  WIND: 2186,
  CLOUD_CHARGE: 2941,
  STRIKE: 4433,
  FIRE: 159,
  MAST_BREAK: 4954,
  FULL_INVENTORY: 2277,
};

const JINGLE = {
  BOAT: 171,
  VICTORY: 288,
  DEFEAT: 289,
};

const MUSIC = {
  LOBBY: 58,
  COVE: 688,
};

const OVERLAY_HUD_UID = (161 << 16) | 8;
const OVERLAY_ATMOSPHERE_UID = (161 << 16) | 1;
const FADE_CYCLES = 50;
const CHUNK = 8;

/** Message colours from the captures. */
const RED = "ff9e7a";
const CYAN = "98ffff";
const PINK = "ff9fff";

function loc([x, y, z = 0]) {
  const { Location } = core();
  return new Location(x, y, z);
}

function inBox(box, location) {
  const x = location.getX();
  const y = location.getY();
  return x >= box.minX && x <= box.maxX && y >= box.minY && y <= box.maxY;
}

function randomInt(min, max) {
  return min + Math.floor(Math.random() * (max - min + 1));
}

function pick(list) {
  return list[Math.floor(Math.random() * list.length)];
}

function later(key, ticks, action) {
  const { Task, TaskManager } = core();
  const task = new (class extends Task {
    constructor() {
      super(Math.max(0, ticks), key, ticks <= 0);
    }
    execute() {
      this.stop();
      action();
    }
  })();
  TaskManager.submit(task);
  return task;
}

/** Runs `action` every `ticks` ticks until it returns false, keyed to `key`. */
function repeat(key, ticks, action) {
  const { Task, TaskManager } = core();
  const task = new (class extends Task {
    constructor() {
      super(Math.max(1, ticks), key, false);
    }
    execute() {
      if (action() === false) this.stop();
    }
  })();
  TaskManager.submit(task);
  return task;
}

function statement(player, text) {
  const { DialogueChainBuilder, StatementDialogue, EndDialogue } = core();
  player.getDialogueManager().startDialogues(new DialogueChainBuilder().add(
    new StatementDialogue(0, text),
    new EndDialogue(1),
  ));
}

function npcSays(player, npcId, text) {
  const { DialogueChainBuilder, NpcDialogue, EndDialogue } = core();
  player.getDialogueManager().startDialogues(new DialogueChainBuilder().add(
    new NpcDialogue(0, npcId, text),
    new EndDialogue(1),
  ));
}

/** Fades the screen out (or back in) with interface 174 and its fade script. */
function fade(player, out) {
  const args = out ? [0, 255, 0, 0, FADE_CYCLES] : [0, 0, 0, 255, FADE_CYCLES];
  player.getPacketSender().sendSubInterface(OVERLAY_ATMOSPHERE_UID, INTERFACE.FADE, 1, {
    postScripts: [{ scriptId: SCRIPT.FADE, args }],
  });
}

function animate(entity, id) {
  const { Animation } = core();
  entity?.performAnimation(new Animation(id));
}

/** A Graphic with a raw height (the captures' 124 for the tether), or none. */
function makeGraphic(id, height = 0, delay = 0) {
  const { Graphic } = core();
  return height || delay ? new Graphic(id, delay, height || 0) : new Graphic(id);
}

function graphic(entity, id, height = 0) {
  entity.performGraphic(makeGraphic(id, height));
}

function hasItem(player, id) {
  return player.getInventory().contains(id) || player.getEquipment().contains(id);
}

function baseLevel(player, skill) {
  return player.getSkillManager().getMaxLevel(core().Skill[skill]);
}

function addXp(player, skill, amount) {
  player.getSkillManager().addExperiences(core().Skill[skill], amount);
}

function points(player) {
  return player.getPacketSender().getVarbit(VARBIT.POINTS);
}

function permits(player) {
  return player.getPacketSender().getVarbit(VARBIT.PERMITS);
}

/** The Wiki's harpoonfish XP base for a base Fishing level, before the per-action scaling. */
function xpBase(player) {
  const level = Math.min(99, baseLevel(player, "FISHING"));
  if (level < 70) return Math.floor(450 + ((1000 - 450) * (level - 35)) / (99 - 35));
  return Math.floor(890 + ((1000 - 890) * (level - 70)) / (99 - 70));
}

/**
 * One repeated action per player (harpooning, cooking, loading): starting another, moving,
 * or `stopAction` ends it. `step(ticks)` runs every tick and returns false to stop.
 */
function startAction(player, name, step) {
  stopAction(player);
  const origin = player.getLocation();
  let ticks = 0;
  const action = { name, task: null };
  action.task = repeat(player, 1, () => {
    if (player.__temporossAction !== action) return false;
    if (!player.isRegistered() || !player.getLocation().equals(origin) || step(++ticks) === false) {
      endAction(player, action);
      return false;
    }
    return true;
  });
  player.__temporossAction = action;
}

function endAction(player, action) {
  if (player.__temporossAction !== action) return;
  player.__temporossAction = null;
  animate(player, -1);
}

function stopAction(player, name = null) {
  const action = player.__temporossAction;
  if (!action || (name && action.name !== name)) return;
  action.task?.stop();
  endAction(player, action);
}

function actionOf(player) {
  return player.__temporossAction?.name ?? null;
}

module.exports = {
  bind, core, api, DATA,
  NPC, SPOT_IDS, LOC, ITEM, FISH, LOSABLE, VARBIT, VARP, INTERFACE, LOBBY_HUD, SCRIPT, ANIM, GFX, SOUND, JINGLE, MUSIC,
  OVERLAY_HUD_UID, OVERLAY_ATMOSPHERE_UID, CHUNK, RED, CYAN, PINK,
  loc, inBox, randomInt, pick, later, repeat, statement, npcSays, fade, animate, makeGraphic, graphic, hasItem, baseLevel, addXp,
  points, permits, xpBase, startAction, stopAction, actionOf,
};
