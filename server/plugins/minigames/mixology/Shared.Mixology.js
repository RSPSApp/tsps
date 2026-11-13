"use strict";

/**
 * Mastering Mixology: shared ids, the player's lab state and the helpers every unit uses.
 *
 * The cache draws the whole lab from the player's varbits: the HUD (882) reads the orders and
 * the hopper's paste (scripts 7063/7064), and the levers' mixers, the mixing vessel, the three
 * stations and the four digweed patches are multilocs on them. The server's job is to keep
 * those varbits right; every one of them is saved and re-sent at login, as live OSRS does
 * (rsprox captures: the order varbits arrive with the login burst wherever the player logs in).
 *
 * Wiki: https://oldschool.runescape.wiki/w/Mastering_Mixology
 * docs/mastering-mixology.md records the live captures these ids and timings come from.
 */

const DATA = require("../data/mastering-mixology.json");

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

/** The lab's varbits, by id, plus a few extras. */
const STATE_ATTRIBUTE = "mastering-mixology:state";
/** Resin, the reward shop's three currencies (varps 4416/4415/4414). */
const RESIN_ATTRIBUTE = "mastering-mixology:resin";
/** Orders fulfilled (varp 4480, total_mixology_orders). */
const ORDERS_ATTRIBUTE = "mastering-mixology:orders";

const VARP = {
  LYE_RESIN: 4414,
  AGA_RESIN: 4415,
  MOX_RESIN: 4416,
  TOTAL_ORDERS: 4480,
};

const VARBIT = {
  /** mm_potion_storage_unlocked */
  POTION_STORAGE: 11295,
  /** mm_lab_order_N_type (enum 5542 index) and _modifier (1 agitator, 2 retort, 3 alembic). */
  ORDER_TYPE: [11315, 11317, 11319],
  ORDER_MODIFIER: [11316, 11318, 11320],
  /** mm_lab_mixer_slot_0..2: 1 mox, 2 aga, 3 lye; slot 0 is the newest pull. */
  MIXER_SLOT: [11324, 11325, 11326],
  RETORT_PROGRESS: 11327,
  ALEMBIC_PROGRESS: 11328,
  AGITATOR_PROGRESS: 11329,
  /** mm_herb_ready_1..4: the digweed patches (multilocs 55396-55399). */
  HERB_READY: [11330, 11331, 11332, 11333],
  ORDERS_SINCE_HERB: 11334,
  /** Clanila let the player in (the stairs stop asking). */
  INTRODUCTION_COMPLETE: 11335,
  /** Supervisor Lalo explained the lab (multinpc 14099 shows Rewards; the machines work). */
  MET_SUPERVISOR: 11336,
  HIT_SKILLSHOT_AGITATOR: 11337,
  HIT_SKILLSHOT_ALEMBIC: 11338,
  /** The mixing vessel's potion (multiloc 55395), 0 empty. */
  VESSEL_READY: 11339,
  AGITATOR_POTION: 11340,
  RETORT_POTION: 11341,
  ALEMBIC_POTION: 11342,
  AVAILABLE: { mox: 11431, aga: 11432, lye: 11433 },
};

const SYNCED_VARBITS = [
  VARBIT.POTION_STORAGE,
  ...VARBIT.ORDER_TYPE, ...VARBIT.ORDER_MODIFIER, ...VARBIT.MIXER_SLOT,
  VARBIT.RETORT_PROGRESS, VARBIT.ALEMBIC_PROGRESS, VARBIT.AGITATOR_PROGRESS,
  ...VARBIT.HERB_READY, VARBIT.ORDERS_SINCE_HERB, VARBIT.INTRODUCTION_COMPLETE, VARBIT.MET_SUPERVISOR,
  VARBIT.HIT_SKILLSHOT_AGITATOR, VARBIT.HIT_SKILLSHOT_ALEMBIC, VARBIT.VESSEL_READY,
  VARBIT.AGITATOR_POTION, VARBIT.RETORT_POTION, VARBIT.ALEMBIC_POTION,
  VARBIT.AVAILABLE.mox, VARBIT.AVAILABLE.aga, VARBIT.AVAILABLE.lye,
];

/** The three reagents, in the order the levers, varbits and resin messages use them. */
const REAGENTS = ["mox", "aga", "lye"];
const REAGENT_NAME = { mox: "Mox", aga: "Aga", lye: "Lye" };
/** Paste per letter of a potion, and the hopper's limit per paste (Wiki). */
const PASTE_PER_LETTER = 10;
const HOPPER_CAPACITY = 3000;

const INTERFACE = {
  HUD: 882,
  FORMULAS: 883,
};

/** toplevel overlay_hud, where Wintertodt, the Gauntlet and ToA mount their HUDs too. */
const OVERLAY_HUD_UID = (161 << 16) | 8;

/** The lab beyond the lobby: the HUD is up from y 9319 (rsprox captures). */
const LAB = { minX: 1384, maxX: 1403, minY: 9319, maxY: 9335, z: 0 };

const NPC = {
  /** mm_lab_supervisor: 13920 (Talk-to) until varbit 11336, then 13921 (Talk-to, Rewards). */
  SUPERVISOR: 14099,
  SUPERVISOR_FIRST: 13920,
  SUPERVISOR_MET: 13921,
  SUPERVISOR_NAME: "Supervisor Lalo",
  /** mm_lab_tech_02, at the top of the stairs. */
  CLANILA: 13923,
  CLANILA_NAME: "Clanila",
  /** mm_lab_table_bar: invisible, in front of a working station, carrying its progress headbar. */
  TABLE_BAR: 13918,
  /** mm_lab_conveyor_chatter: carries the "+N Mox" overhead text for ten ticks. */
  CONVEYOR_CHATTER: 13919,
};

const OBJECT = {
  STAIRS_DOWN: 54946,
  STAIRS_UP: 54945,
  MOX_LEVER: "Mox lever",
  AGA_LEVER: "Aga lever",
  LYE_LEVER: "Lye lever",
  HOPPER: "Hopper",
  HOPPER_ID: 54903,
  REFINER: "Refiner",
  REFINER_ID: 54904,
  CONVEYOR: "Conveyor belt",
  RETORT: "Retort",
  AGITATOR: "Agitator",
  ALEMBIC: "Alembic",
  LAB_BOOKS: "Lab books",
  LAB_BOOKS_ID: 54943,
  DIGWEED: "Mature digweed",
  /** The multilocs the map places (dump:loc); their own names are "null". */
  VESSEL_MULTI: 55395,
  RETORT_MULTI: 55389,
  AGITATOR_MULTI: 55390,
  ALEMBIC_MULTI: 55391,
  MIXER_MULTI: [55392, 55393, 55394],
  DIGWEED_MULTI: [55396, 55397, 55398, 55399],
};

/** Where the lab's locs stand, as the map places them: for loc animations. */
const LOC = {
  LEVER: {
    mox: { id: 54868, x: 1395, y: 9324, type: 10, face: 3, anim: "lever02" },
    aga: { id: 54867, x: 1394, y: 9324, type: 4, face: 3, anim: "lever01" },
    lye: { id: 54869, x: 1393, y: 9324, type: 10, face: 3, anim: "lever03" },
  },
  /** Mixer slot 0, 1, 2 (the slot varbits' multilocs). */
  MIXER: [
    { id: 55392, x: 1393, y: 9323, type: 10, face: 3 },
    { id: 55393, x: 1394, y: 9323, type: 10, face: 3 },
    { id: 55394, x: 1395, y: 9323, type: 10, face: 3 },
  ],
  VESSEL: { id: 55395, x: 1394, y: 9326, type: 10, face: 1 },
  RETORT: { id: 55389, x: 1397, y: 9325, type: 10, face: 1 },
  AGITATOR: { id: 55390, x: 1393, y: 9329, type: 10, face: 0 },
  ALEMBIC: { id: 55391, x: 1391, y: 9325, type: 10, face: 3 },
  CONVEYOR: { x: 1394, y: 9331 },
  /** The far end of the belt, where a potion's projectile lands. */
  CONVEYOR_END: { x: 1394, y: 9333 },
  STAIRS_BOTTOM: { x: 1388, y: 9313 },
  STAIRS_TOP: { x: 1388, y: 2918 },
};

/** The paste items the refiner makes and the hopper takes. */
const ITEM = {
  PASTE: { mox: 30005, aga: 30007, lye: 30009 },
  DIGWEED: 30031,
  LAB_NOTES: 30032,
};

/** Unfinished potions by index (enum 5542); a finished potion is its unfinished id + 10. */
const POTION_ENUM = 5542;
/** Herblore level per unfinished potion (enum 5548). */
const POTION_LEVEL_ENUM = 5548;
const FINISHED_OFFSET = 10;
/** Order modifiers: 1 Homogenous (agitator), 2 Concentrated (retort), 3 Crystalised (alembic). */
const MODIFIER = { AGITATOR: 1, RETORT: 2, ALEMBIC: 3 };
const MODIFIER_NAME_ENUM = 5545;

/** Finished potions remember how they were finished and whether digweed went in. */
const META = { MODIFIER: "mastering-mixology:modifier", DIGWEED: "mastering-mixology:digweed" };

let potionTable = null;

/** Every potion: index, name, paste per reagent, level, xp, resin and its two item ids. */
function potions() {
  if (potionTable) return potionTable;
  const { CacheDefinitions } = core();
  const items = CacheDefinitions.getEnumValues(POTION_ENUM);
  const levels = CacheDefinitions.getEnumValues(POTION_LEVEL_ENUM);
  potionTable = new Map();
  for (const [key, row] of Object.entries(DATA.potions)) {
    const index = Number(key);
    const unfinished = Number(items.get(index));
    potionTable.set(index, {
      index,
      code: row.code,
      name: row.name,
      paste: { mox: row.paste[0], aga: row.paste[1], lye: row.paste[2] },
      resin: { mox: row.resin[0], aga: row.resin[1], lye: row.resin[2] },
      xp: row.xp,
      weight: row.weight,
      level: Number(levels.get(unfinished)) || 60,
      unfinished,
      finished: unfinished + FINISHED_OFFSET,
    });
  }
  return potionTable;
}

function potion(index) {
  return potions().get(index) ?? null;
}

/** The potion with exactly these letters (one per lever pull), or null. */
function potionFor(counts) {
  for (const entry of potions().values()) {
    if (REAGENTS.every((reagent) => entry.paste[reagent] === counts[reagent])) return entry;
  }
  return null;
}

function potionByItem(itemId) {
  for (const entry of potions().values()) {
    if (entry.unfinished === itemId || entry.finished === itemId) return entry;
  }
  return null;
}

function isUnfinished(itemId) {
  return potionByItem(itemId)?.unfinished === itemId;
}

function isFinished(itemId) {
  return potionByItem(itemId)?.finished === itemId;
}

function modifierName(modifier) {
  return String(core().CacheDefinitions.getEnumValues(MODIFIER_NAME_ENUM).get(modifier) ?? "");
}

// ============================================================================
// State
// ============================================================================

function stateOf(player) {
  let value = player.getAttribute(STATE_ATTRIBUTE);
  if (!value || typeof value !== "object") {
    value = { vars: {} };
    player.setAttribute(STATE_ATTRIBUTE, value);
  }
  if (!value.vars || typeof value.vars !== "object") value.vars = {};
  return value;
}

function get(player, varbit) {
  return Number(stateOf(player).vars[varbit]) || 0;
}

/** Stores a lab varbit and sends it when it changed (live sends a varbit only on change). */
function set(player, varbit, value) {
  const vars = stateOf(player).vars;
  const next = value | 0;
  const previous = Number(vars[varbit]) || 0;
  if (next === 0) delete vars[varbit];
  else vars[varbit] = next;
  if (previous !== next || player.getPacketSender().getVarbit(varbit) !== next) {
    player.getPacketSender().sendVarbit(varbit, next);
  }
}

/** A non-varbit field of the state (station work, the digweed timer). */
function field(player, key, fallback = null) {
  const value = stateOf(player)[key];
  return value === undefined ? fallback : value;
}

function setField(player, key, value) {
  const current = stateOf(player);
  if (value === null || value === undefined) delete current[key];
  else current[key] = value;
}

const RESIN_VARP = { mox: VARP.MOX_RESIN, aga: VARP.AGA_RESIN, lye: VARP.LYE_RESIN };

function resinOf(player) {
  const value = player.getAttribute(RESIN_ATTRIBUTE);
  if (value && typeof value === "object") return value;
  const fresh = { mox: 0, aga: 0, lye: 0 };
  player.setAttribute(RESIN_ATTRIBUTE, fresh);
  return fresh;
}

function resin(player, reagent) {
  return Number(resinOf(player)[reagent]) || 0;
}

function setResin(player, reagent, value) {
  const next = Math.max(0, value | 0);
  resinOf(player)[reagent] = next;
  player.getPacketSender().sendConfig(RESIN_VARP[reagent], next);
}

function ordersFulfilled(player) {
  return Number(player.getAttribute(ORDERS_ATTRIBUTE)) || 0;
}

function addOrdersFulfilled(player, count) {
  const next = ordersFulfilled(player) + count;
  player.setAttribute(ORDERS_ATTRIBUTE, next);
  player.getPacketSender().sendConfig(VARP.TOTAL_ORDERS, next);
}

/** Re-sends every lab varbit, the resin and the orders count (login). */
function sync(player) {
  const sender = player.getPacketSender();
  for (const varbit of SYNCED_VARBITS) sender.sendVarbit(varbit, get(player, varbit));
  for (const reagent of REAGENTS) sender.sendConfig(RESIN_VARP[reagent], resin(player, reagent));
  sender.sendConfig(VARP.TOTAL_ORDERS, ordersFulfilled(player));
}

// ============================================================================
// Helpers
// ============================================================================

function tick() {
  return core().World.getProcessCycle();
}

/** The Herblore level the lab checks: boosts count, as on live (captures at 103 and 111). */
function herbloreLevel(player) {
  return player.getSkillManager().getCurrentLevel(core().Skill.HERBLORE);
}

/** Orders only ask for potions the player's base level can make (script 7063 reads stat_base). */
function herbloreBase(player) {
  return player.getSkillManager().getMaxLevel(core().Skill.HERBLORE);
}

function addXp(player, amount) {
  player.getSkillManager().addExperiences(core().Skill.HERBLORE, amount);
}

function animate(player, name) {
  const id = core().CacheDefinitions.getSeqId(name);
  player.performAnimation(new (core().Animation)(id ?? -1));
}

function sound(player, id, delay = 0) {
  player.getPacketSender().sendSound(id, 1, delay);
}

/** Plays a lab loc's animation for this player only (live's loc_anim_specific). */
function animateLoc(player, loc, sequence) {
  const id = core().CacheDefinitions.getSeqId(sequence);
  if (id === null) return;
  const { Location } = core();
  player.getPacketSender().sendObjectAnimation({
    getId: () => loc.id,
    getLocation: () => new Location(loc.x, loc.y, LAB.z),
    getType: () => loc.type,
    getFace: () => loc.face,
  }, { id });
}

/** A graphic on a tile, for this player (live's map_anim_specific). */
function tileGraphic(player, name, x, y, delay = 0) {
  const { Graphic, Location, CacheDefinitions } = core();
  const id = CacheDefinitions.getSpotanimId(name);
  if (id === null) return;
  const graphic = new Graphic(id);
  graphic.delay = delay;
  player.getPacketSender().sendGraphic(graphic, new Location(x, y, LAB.z));
}

function statement(player, text) {
  const { DialogueChainBuilder, StatementDialogue, EndDialogue } = core();
  player.getDialogueManager().startDialogues(new DialogueChainBuilder().add(
    new StatementDialogue(0, text),
    new EndDialogue(1),
  ));
}

function itemStatement(player, itemId, text) {
  const { DialogueChainBuilder, ItemStatementDialogue, EndDialogue } = core();
  player.getDialogueManager().startDialogues(new DialogueChainBuilder().add(
    new ItemStatementDialogue(0, itemId, text),
    new EndDialogue(1),
  ));
}

/** Plays one variant of an NPC's transcript (npc-dialogue:start). */
function npcSays(player, npcId, variant) {
  const request = { player, npcId, variant, handled: false };
  api().emitCustomEvent("npc-dialogue:start", request);
  return request.handled === true;
}

/** Runs `action` after `ticks` game ticks. */
function later(ticks, action) {
  const { Task, TaskManager } = core();
  const task = new (class extends Task {
    constructor() {
      super(Math.max(1, ticks), "mastering-mixology", false);
    }
    execute() {
      this.stop();
      action();
    }
  })();
  TaskManager.submit(task);
  return task;
}

/**
 * A potion's or item's name as the lab's messages colour it: the chatbox's transparency
 * (varbit 4608) picks the shade, as on live (rsprox captures: <col=a53fff> on a transparent
 * chatbox, <col=6800bf> on the opaque one).
 */
const CHATBOX_TRANSPARENCY = 4608;
const COLOURS = {
  opaque: { name: "6800bf", herb: "06600c", mox: "0000b2", aga: "06600c", lye: "e00a19" },
  transparent: { name: "a53fff", herb: "229628", mox: "3366ff", aga: "229628", lye: "ff3045" },
};

function colours(player) {
  return player.getPacketSender().getVarbit(CHATBOX_TRANSPARENCY) === 1 ? COLOURS.transparent : COLOURS.opaque;
}

function coloured(player, text) {
  return `<col=${colours(player).name}>${text}</col>`;
}

function formatNumber(value) {
  return Math.round(value).toLocaleString("en-US");
}

/** In the inventory, worn, or in any bank tab. */
function owns(player, itemId) {
  const { Bank } = core();
  return player.getInventory().contains(itemId) || player.getEquipment().contains(itemId)
    || player.getBanks().some((bank, tab) => tab !== Bank.BANK_SEARCH_TAB_INDEX && bank?.contains?.(itemId));
}

/** The player has spoken to Supervisor Lalo; before that he stops them using the machines. */
function permitted(player) {
  if (get(player, VARBIT.MET_SUPERVISOR) === 1) return true;
  npcSays(player, NPC.SUPERVISOR_FIRST, "standard-dialogue-interacting-with-any-of-the-machines-before-talking-to-supervisor-lalo");
  return false;
}

module.exports = {
  bind, core, api, DATA,
  STATE_ATTRIBUTE, RESIN_ATTRIBUTE, ORDERS_ATTRIBUTE, VARP, VARBIT, SYNCED_VARBITS,
  REAGENTS, REAGENT_NAME, PASTE_PER_LETTER, HOPPER_CAPACITY,
  INTERFACE, OVERLAY_HUD_UID, LAB, NPC, OBJECT, LOC, ITEM, MODIFIER, META,
  potions, potion, potionFor, potionByItem, isUnfinished, isFinished, modifierName,
  stateOf, get, set, field, setField, resin, setResin, ordersFulfilled, addOrdersFulfilled, sync,
  tick, herbloreLevel, herbloreBase, addXp, animate, sound, animateLoc, tileGraphic,
  statement, itemStatement, npcSays, later, colours, coloured, formatNumber, owns, permitted,
};
