"use strict";

/**
 * Wintertodt: shared ids, tiles and small helpers every unit uses.
 *
 * Wiki: https://oldschool.runescape.wiki/w/Wintertodt
 * docs/wintertodt.md records the live captures these ids and timings come from.
 */

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

/** The prison behind the Doors of Dinh is the whole of map square (25, 62). */
const PRISON_ZONE = { minX: 1600, maxX: 1663, minY: 3968, maxY: 4031, levels: [0] };
/** The camp south of the doors: the HUD stays up here with only the energy and timer. */
const CAMP_ZONE = { minX: 1600, maxX: 1663, minY: 3904, maxY: 3967, levels: [0] };

/** Where the doors put you: inside by the gap in the wall, outside on the camp's path. */
const ENTER_AREA = { minX: 1627, maxX: 1633, minY: 3977, maxY: 3983 };
const EXIT_AREA = { minX: 1628, maxX: 1631, minY: 3955, maxY: 3956 };

const FIREMAKING_REQUIRED = 50;

/** Energy is 3500 at a round's start; each active pyromancer drains 1% (35) every 14 ticks. */
const MAX_ENERGY = 3500;
const DRAIN_PER_PYROMANCER = 35 / 14;
/** With no brazier lit the Wintertodt recovers 1% every 35 ticks. */
const RECOVERY_PER_TICK = 35 / 35;
/** The break between rounds, counted down on the HUD (varbit 7980). */
const BREAK_TICKS = 100;
/** The HUD script and the round timer are sent every other tick. */
const HUD_PERIOD = 2;

/** Warmth (varbit 11434) runs 0-1000 and is full on entering the prison. */
const MAX_WARMTH = 1000;

const REWARD_POINTS = 500;
const MAX_REWARDS = 8000;

/** The four corners in the HUD's order: south-west, north-west, north-east, south-east. */
const CORNERS = [
  { name: "south-west", brazier: { x: 1620, y: 3997 }, pyromancer: { x: 1619, y: 3996 } },
  { name: "north-west", brazier: { x: 1620, y: 4015 }, pyromancer: { x: 1619, y: 4018 } },
  { name: "north-east", brazier: { x: 1638, y: 4015 }, pyromancer: { x: 1641, y: 4018 } },
  { name: "south-east", brazier: { x: 1638, y: 3997 }, pyromancer: { x: 1641, y: 3996 } },
];

/** The HUD's brazier icons (script 1421): broken, unlit, lit. */
const BRAZIER = { BROKEN: 0, UNLIT: 1, LIT: 2 };

const STORM_TILE = { x: 1627, y: 4004 };
/** The Wintertodt's bolts and snow are thrown from here (captures). */
const STORM_SOURCE = { x: 1630, y: 4007 };

/**
 * The corridor by the doors: no attack reaches it and nobody can fletch in it (Wiki,
 * "Wintertodt/Strategies"; the outline is Near-Reality's).
 */
const SAFE_AREA = [
  [1624, 3988], [1625, 3987], [1625, 3978], [1628, 3975], [1628, 3971], [1625, 3968],
  [1636, 3968], [1633, 3971], [1633, 3975], [1636, 3978], [1636, 3987], [1637, 3988],
];

const OBJECT = {
  DOORS: "Doors of Dinh",
  ROOTS: "Bruma roots",
  SPROUTING_ROOTS: "Sprouting Roots",
  CRATE: "Crate",
  BRAZIER: "Brazier",
  BURNING_BRAZIER: "Burning brazier",
  REWARD_CART: "Reward Cart",
  SNOWFALL: 26690,
  ICICLE: 29324,
  SNOW: 29325,
  STORM: 29308,
  STORM_IDLE: 29309,
  BRAZIER_UNLIT: 29312,
  BRAZIER_BROKEN: 29313,
  BRAZIER_LIT: 29314,
};

const NPC = {
  PYROMANCER: 7371,
  INCAPACITATED_PYROMANCER: 7372,
  FIRE: 7373,
  BREWMA: "Brew'ma",
};

const ITEM = {
  BRUMA_ROOT: 20695,
  BRUMA_KINDLING: 20696,
  REJUVENATION_UNF: 20697,
  BRUMA_HERB: 20698,
  REJUVENATION_4: 20699,
  REJUVENATION_3: 20700,
  REJUVENATION_2: 20701,
  REJUVENATION_1: 20702,
  KNIFE: 946,
  HAMMER: 2347,
  TINDERBOX: 590,
  BRONZE_AXE: 1351,
  BRUMA_TORCH: 20720,
  BRUMA_TORCH_OFFHAND: 29777,
};

/** Rejuvenation potion doses, from 4 down to 1. */
const POTIONS = [ITEM.REJUVENATION_4, ITEM.REJUVENATION_3, ITEM.REJUVENATION_2, ITEM.REJUVENATION_1];

/** Fuel is taken from everyone in the prison when a round ends. */
const FUEL_ITEMS = [ITEM.BRUMA_ROOT, ITEM.BRUMA_KINDLING];

/** Wintertodt's own supplies vanish when you leave the prison or log out. */
const PRISON_ITEMS = [
  ITEM.BRUMA_ROOT, ITEM.BRUMA_KINDLING, ITEM.BRUMA_HERB, ITEM.REJUVENATION_UNF,
  ITEM.REJUVENATION_4, ITEM.REJUVENATION_3, ITEM.REJUVENATION_2, ITEM.REJUVENATION_1,
];

const VARP = {
  KILLS: 1528,
};

const VARBIT = {
  ROUND_TIMER: 7980,
  AREA_ATTACK: 5354,
  WARMTH: 11434,
  REWARDS_OWED: 11435,
};

const INTERFACE = {
  HUD: 396,
  FADE: 174,
};

const SCRIPT = {
  HUD_UPDATE: 1421,
  HUD_OUTSIDE: 1432,
  HUD_INSIDE: 1433,
  FADE: 948,
};

const ANIM = {
  FLETCH: 1248,
  FEED: 832,
  LIGHT_TINDERBOX: 733,
  LIGHT_TORCH: 7174,
  FIX: 3676,
  PICK: 2282,
  DRINK: 829,
  CART_SEARCH: 11758,
  PYROMANCER_CHANT: 4432,
  PYROMANCER_FALL: 7627,
};

const GFX = {
  SNOW_IMPACT: 502,
  AREA_IMPACT: 1311,
};

const PROJECTILE = {
  STORM_BOLT: 501,
  AREA_SPOT: 1310,
};

/** The cold's hitsplat (75 yours, 76 the darker one others see) and the warmth bar (79). */
const COLD_SPLAT = { mine: 75, others: 76 };
const WARMTH_BAR = { id: 79, width: 30 };

const OVERLAY_HUD_UID = (161 << 16) | 8;
const OVERLAY_ATMOSPHERE_UID = (161 << 16) | 1;
const FADE_CYCLES = 50;

function loc(tile, z = 0) {
  const { Location } = core();
  return new Location(tile.x, tile.y, tile.z ?? z);
}

function inZone(zone, location) {
  const x = location.getX();
  const y = location.getY();
  return x >= zone.minX && x <= zone.maxX && y >= zone.minY && y <= zone.maxY
    && (!zone.levels || zone.levels.includes(location.getZ()));
}

function randomTile(area) {
  const { Location } = core();
  const x = area.minX + Math.floor(Math.random() * (area.maxX - area.minX + 1));
  const y = area.minY + Math.floor(Math.random() * (area.maxY - area.minY + 1));
  return new Location(x, y, 0);
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

function statement(player, text) {
  const { DialogueChainBuilder, StatementDialogue, EndDialogue } = core();
  player.getDialogueManager().startDialogues(new DialogueChainBuilder().add(
    new StatementDialogue(0, text),
    new EndDialogue(1),
  ));
}

/** A chatbox choice: options("Title?", "Yes.", onYes, "No.", onNo). */
function options(player, title, ...pairs) {
  const args = [];
  for (let i = 0; i < pairs.length; i += 2) args.push(pairs[i], pairs[i + 1] ?? (() => {}));
  api().sendMultiChatboxPrompt(player, title, ...args);
}

/** Fades the screen out (or back in) with interface 174 and its fade script. */
function fade(player, out) {
  const args = out ? [0, 255, 0, 0, FADE_CYCLES] : [0, 0, 0, 255, FADE_CYCLES];
  player.getPacketSender().sendSubInterface(OVERLAY_ATMOSPHERE_UID, INTERFACE.FADE, 1, {
    postScripts: [{ scriptId: SCRIPT.FADE, args }],
  });
}

/** Fades out, moves the player two ticks later while the screen is black, then fades back in. */
function fadeMove(player, tile) {
  fade(player, true);
  later(player, 2, () => {
    player.moveTo(tile);
    fade(player, false);
  });
}

function inSafeArea(location) {
  const x = location.getX() + 0.5;
  const y = location.getY() + 0.5;
  let inside = false;
  for (let i = 0, j = SAFE_AREA.length - 1; i < SAFE_AREA.length; j = i++) {
    const [xi, yi] = SAFE_AREA[i];
    const [xj, yj] = SAFE_AREA[j];
    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

function distance(a, b) {
  return Math.max(Math.abs(a.getX() - b.x), Math.abs(a.getY() - b.y));
}

function hasItem(player, id) {
  return player.getInventory().contains(id) || player.getEquipment().contains(id);
}

function level(player, skill) {
  return player.getSkillManager().getMaxLevel(core().Skill[skill]);
}

function addXp(player, skill, amount) {
  player.getSkillManager().addExperiences(core().Skill[skill], amount);
}

function animate(player, id) {
  const { Animation } = core();
  player.performAnimation(new Animation(id));
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

/**
 * One repeated skilling action per player (chopping, fletching, feeding, picking): starting
 * another, moving, or `stopAction` ends it. `step(ticks)` runs every tick and returns false to stop.
 */
function startAction(player, name, step) {
  stopAction(player);
  const origin = player.getLocation();
  let ticks = 0;
  const action = { name, task: null };
  action.task = repeat(player, 1, () => {
    if (player.__wintertodtAction !== action) return false;
    if (!player.getLocation().equals(origin) || step(++ticks) === false) {
      endAction(player, action);
      return false;
    }
    return true;
  });
  player.__wintertodtAction = action;
}

function endAction(player, action) {
  if (player.__wintertodtAction !== action) return;
  player.__wintertodtAction = null;
  animate(player, -1);
}

function stopAction(player, name = null) {
  const action = player.__wintertodtAction;
  if (!action || (name && action.name !== name)) return;
  action.task?.stop();
  endAction(player, action);
}

function actionOf(player) {
  return player.__wintertodtAction?.name ?? null;
}

/** Takes every one of these items from the inventory. */
function removeItems(player, ids) {
  const inventory = player.getInventory();
  let removed = false;
  for (const id of ids) {
    const amount = inventory.getAmount(id);
    if (amount <= 0) continue;
    inventory.delete(id, amount);
    removed = true;
  }
  if (removed) inventory.refreshItems();
  return removed;
}

function firemakingLevel(player) {
  return player.getSkillManager().getMaxLevel(core().Skill.FIREMAKING);
}

module.exports = {
  bind, core, api,
  PRISON_ZONE, CAMP_ZONE, ENTER_AREA, EXIT_AREA, FIREMAKING_REQUIRED,
  MAX_ENERGY, MAX_WARMTH, DRAIN_PER_PYROMANCER, RECOVERY_PER_TICK, BREAK_TICKS, HUD_PERIOD,
  REWARD_POINTS, MAX_REWARDS, CORNERS, BRAZIER, STORM_TILE, STORM_SOURCE, SAFE_AREA,
  OBJECT, NPC, ITEM, POTIONS, FUEL_ITEMS, PRISON_ITEMS, VARP, VARBIT, INTERFACE, SCRIPT, ANIM, GFX, PROJECTILE,
  COLD_SPLAT, WARMTH_BAR, OVERLAY_HUD_UID,
  loc, inZone, inSafeArea, distance, randomTile, later, repeat, statement, options, fade, fadeMove,
  hasItem, removeItems, level, addXp, animate, startAction, stopAction, actionOf, firemakingLevel,
};
