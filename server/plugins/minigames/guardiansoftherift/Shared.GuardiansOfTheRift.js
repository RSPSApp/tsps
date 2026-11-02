"use strict";

/**
 * Guardians of the Rift: shared names, tiles and small helpers every unit uses.
 *
 * Ids are looked up by their cache gameval names (the names rsprox prints), so a cache update
 * that moves an id doesn't need a code change. Wiki: https://oldschool.runescape.wiki/w/Guardians_of_the_Rift
 * docs/guardians-of-the-rift.md records the live captures the names, timings and messages come from.
 */

const state = { api: null, core: null };
const ids = new Map();

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

/** The Temple of the Eye: map square (56, 148). The barrier splits it into the lobby and the game. */
const TEMPLE = { minX: 3584, maxX: 3647, minY: 9472, maxY: 9535, z: 0 };
/** The barrier (5x1 at 3613,9483): the game is north of it. */
const BARRIER = { minX: 3613, maxX: 3617, y: 9483 };
/** Where a login inside the game puts you: the lobby, in front of the barrier. */
const LOBBY_TILE = { x: 3615, y: 9480 };

const REQUIRED_RUNECRAFT = 27;
const QUEST_KEY = "temple_of_the_eye";

/** Per-game energy caps (Wiki): 1,000 of each type and 1,200 in all. */
const MAX_ENERGY_PER_TYPE = 1000;
const MAX_ENERGY_TOTAL = 1200;
/** At least this much energy in a game earns the closing bonus (Wiki). */
const REWARD_ENERGY = 300;
/** Mining XP stops after this many fragments a game (Wiki, rsprox captures). */
const MINING_XP_CAP = 250;
/** The HUD script runs every other tick (rsprox captures). */
const HUD_PERIOD = 2;
const RIFT_GUARDIAN_CAP = 10;

const LOC = {
  BARRIER: "gotr_barrier",
  BARRIER_CLOSED: "gotr_barrier_closed",
  BARRIER_FINISHING: "gotr_barrier_noentry",
  RIFT: "gotr_abyssal_rift",
};

const NPC = {
  GREAT_GUARDIAN: "gotr_great_guardian",
};

const ITEM = {
  FRAGMENTS: "gotr_guardian_fragment",
  ESSENCE: "gotr_guardian_essence",
  ELEMENTAL_STONE: "gotr_guardian_stone_elemental",
  CATALYTIC_STONE: "gotr_guardian_stone_catalytic",
  POLYELEMENTAL_STONE: "gotr_guardian_stone_polyelemental",
  POLYCATALYTIC_STONE: "gotr_guardian_stone_polycatalytic",
  UNCHARGED_CELL: "gotr_cell_uncharged",
  PEARL: "abyssal_pearl",
  CELLS: ["gotr_cell_tier1", "gotr_cell_tier2", "gotr_cell_tier3", "gotr_cell_tier4"],
  PORTAL_TALISMANS: [
    "gotr_portal_talisman_air", "gotr_portal_talisman_water", "gotr_portal_talisman_earth",
    "gotr_portal_talisman_fire", "gotr_portal_talisman_mind", "gotr_portal_talisman_chaos",
    "gotr_portal_talisman_death", "gotr_portal_talisman_blood", "gotr_portal_talisman_body",
    "gotr_portal_talisman_cosmic", "gotr_portal_talisman_nature", "gotr_portal_talisman_law",
  ],
};

const STONES = [ITEM.ELEMENTAL_STONE, ITEM.CATALYTIC_STONE, ITEM.POLYELEMENTAL_STONE, ITEM.POLYCATALYTIC_STONE];
/**
 * What a new game takes back (Wiki: fragments, essence and portal talismans; the stones already
 * went with the lobby countdown). Cells stay: live players keep theirs into the next game (rsprox captures).
 */
const NEW_GAME_ITEMS = [ITEM.FRAGMENTS, ITEM.ESSENCE, ...STONES, ...ITEM.PORTAL_TALISMANS];
/** What the game takes back when you leave it: everything, cells too (rsprox captures). */
const GAME_ITEMS = [...NEW_GAME_ITEMS, ITEM.UNCHARGED_CELL, ...ITEM.CELLS];

const VARBIT = {
  CATALYTIC_EARNED: "gotr_catalytic_earned_this_game",
  ELEMENTAL_EARNED: "gotr_elemental_earned_this_game",
  MINING_COUNT: "gotr_mining_count",
  PORTAL_BOTTOM_VISIBLE: "gotr_portal_bottom_visible",
  FINISHED_GAME: "gotr_player_has_finished_game",
  IS_PLAYING: "gotr_is_playing",
  COLOURFUL_FADE_PROMPT_DISABLED: "gotr_colourful_fade_prompt_disabled",
};

const VARP = {
  GAME_ID: "gotr_game_id_on_player",
  RIFTS_CLOSED: "total_gotr_kills",
};

const INTERFACE = {
  HUD: "gotr_hud",
  OVERLAY: "gotr_overlay",
};

/** Client scripts, by id: scripts have no gamevals. */
const SCRIPT = {
  HUD_UPDATE: 5980,
  OVERLAY_PORTAL: 5984,
  REMOVE_PORTAL: 5985,
};

const OVERLAY_HUD_UID = (161 << 16) | 8;
const OVERLAY_ATMOSPHERE_UID = (161 << 16) | 1;
/** chatbox_transparency: live colours highlighted messages by it (@mes_hl_gre@ and so on). */
const CHATBOX_TRANSPARENCY = 4608;
const HIGHLIGHT = {
  gre: { opaque: "06600c", transparent: "229628" },
  red: { opaque: "ef1020", transparent: "ef1020" },
};

function idOf(kind, name) {
  const key = `${kind}:${name}`;
  if (ids.has(key)) return ids.get(key);
  const { CacheDefinitions } = core();
  const lookup = {
    loc: CacheDefinitions.getLocId, npc: CacheDefinitions.getNpcId, obj: CacheDefinitions.getObjId,
    seq: CacheDefinitions.getSeqId, spotanim: CacheDefinitions.getSpotanimId,
    varbit: CacheDefinitions.getVarbitId, varp: CacheDefinitions.getVarpId,
    interface: CacheDefinitions.getInterfaceId,
  }[kind];
  const id = lookup.call(CacheDefinitions, name);
  if (id === null || id === undefined) throw new Error(`Guardians of the Rift: no ${kind} named ${name} in the cache`);
  ids.set(key, id);
  return id;
}

const loc = (name) => idOf("loc", name);
/** The clicked loc is one of these (name-based hooks also catch other content's same-named locs). */
const isLoc = (objectId, ...names) => names.some((name) => loc(name) === objectId);
const npc = (name) => idOf("npc", name);
const obj = (name) => idOf("obj", name);
const seq = (name) => idOf("seq", name);
const spotanim = (name) => idOf("spotanim", name);
const iface = (name) => idOf("interface", name);

function setVarbit(player, name, value) {
  player.getPacketSender().sendVarbit(idOf("varbit", name), value);
}

function getVarbit(player, name) {
  return player.getPacketSender().getVarbit(idOf("varbit", name));
}

function setVarp(player, name, value) {
  player.getPacketSender().sendConfig(idOf("varp", name), value);
}

function location(tile) {
  const { Location } = core();
  return new Location(tile.x, tile.y, tile.z ?? TEMPLE.z);
}

function inTemple(location) {
  return location.getZ() === TEMPLE.z
    && location.getX() >= TEMPLE.minX && location.getX() <= TEMPLE.maxX
    && location.getY() >= TEMPLE.minY && location.getY() <= TEMPLE.maxY;
}

/** North of the barrier: the game side of the temple (the huge-remains mine included). */
function inGameSide(location) {
  return inTemple(location) && location.getY() > BARRIER.y;
}

function now() {
  return core().World.getProcessCycle();
}

/** Runs `action` after `ticks` game ticks. */
function later(ticks, action) {
  const { Task, TaskManager } = core();
  const task = new (class extends Task {
    constructor() {
      super(Math.max(1, ticks), "guardians-of-the-rift", false);
    }
    execute() {
      this.stop();
      action();
    }
  })();
  TaskManager.submit(task);
  return task;
}

/** Runs `action` every `ticks` ticks until it returns false. */
function repeat(ticks, action) {
  const { Task, TaskManager } = core();
  const task = new (class extends Task {
    constructor() {
      super(Math.max(1, ticks), "guardians-of-the-rift", false);
    }
    execute() {
      if (action() === false) this.stop();
    }
  })();
  TaskManager.submit(task);
  return task;
}

/**
 * One repeated action per player (mining, the workbench): starting another, moving, or
 * `stopAction` ends it. `step(ticks)` runs every tick and returns false to stop.
 */
function startAction(player, name, step) {
  stopAction(player);
  const origin = player.getLocation();
  let ticks = 0;
  const action = { name, task: null };
  action.task = repeat(1, () => {
    if (player.__gotrAction !== action || !player.isRegistered()) return false;
    if (!player.getLocation().equals(origin) || step(++ticks) === false) {
      endAction(player, action);
      return false;
    }
    return true;
  });
  player.__gotrAction = action;
}

function endAction(player, action) {
  if (player.__gotrAction !== action) return;
  player.__gotrAction = null;
  animate(player, null);
}

function stopAction(player) {
  const action = player.__gotrAction;
  if (!action) return;
  action.task?.stop();
  endAction(player, action);
}

function statement(player, text) {
  const { DialogueChainBuilder, StatementDialogue, EndDialogue } = core();
  player.getDialogueManager().startDialogues(new DialogueChainBuilder().add(
    new StatementDialogue(0, text),
    new EndDialogue(1),
  ));
}

/** An objectbox: the item's model beside the text. */
function itemStatement(player, item, text) {
  const { DialogueChainBuilder, ItemStatementDialogue, EndDialogue } = core();
  player.getDialogueManager().startDialogues(new DialogueChainBuilder().add(
    new ItemStatementDialogue(0, obj(item), text),
    new EndDialogue(1),
  ));
}

/** A chatbox choice: options(player, "Title", "First.", onFirst, "Second.", onSecond). */
function options(player, title, ...pairs) {
  const args = [];
  for (let i = 0; i < pairs.length; i += 2) args.push(pairs[i], pairs[i + 1] ?? (() => {}));
  api().sendMultiChatboxPrompt(player, title, ...args);
}

/** Plays one variant of an NPC's transcript (npc-dialogue:start). */
function npcSays(player, npcId, variant) {
  const request = { player, npcId, variant, handled: false };
  api().emitCustomEvent("npc-dialogue:start", request);
  return request.handled === true;
}

function spam(player, text) {
  player.getPacketSender().sendTypedMessage(core().ChatType.SPAM, text);
}

/** Live's @mes_hl_gre@ / @mes_hl_red@: the colour follows the chatbox's transparency. */
function highlight(player, colour, text) {
  const transparent = player.getPacketSender().getVarbit(CHATBOX_TRANSPARENCY) === 1;
  return `<col=${HIGHLIGHT[colour][transparent ? "transparent" : "opaque"]}>${text}</col>`;
}

function animate(player, name) {
  player.performAnimation(new (core().Animation)(name === null ? -1 : seq(name)));
}

/** A spotanim on the player, at the captured height. */
function graphic(player, name, height = 0) {
  const { Graphic } = core();
  player.performGraphic(height > 0 ? new Graphic(spotanim(name), 0, height) : new Graphic(spotanim(name)));
}

/** Damage that lands now: the splat and health bar show and a lethal hit starts the NPC's death. */
function damageNpc(npc, damage) {
  const { HitDamage, HitMask } = core();
  if (!npc.isRegistered() || npc.getHitpoints() <= 0) return;
  npc.addTickHit(npc.decrementHealth(new HitDamage(damage, damage > 0 ? HitMask.RED : HitMask.BLUE)));
}

/**
 * The minigame's fighters: no regeneration between hits (they're never attacked through the
 * combat system, which would otherwise heal them 10% a tick), and, for walkers, no blocking.
 */
function prepareNpc(npc, { walkThrough = false } = {}) {
  npc.setFlag("combat:no-regen");
  if (walkThrough) npc.setFlag(core().NPC.WALK_THROUGH_ENTITIES_FLAG);
}

function sound(player, id, delay = 0) {
  player.getPacketSender().sendSound(id, 1, delay);
}

function runecraftLevel(player) {
  return player.getSkillManager().getMaxLevel(core().Skill.RUNECRAFTING);
}

function addXp(player, skill, amount) {
  player.getSkillManager().addExperiences(core().Skill[skill], amount);
}

function questComplete(player) {
  const request = { player, key: QUEST_KEY, complete: false };
  api().emitCustomEvent("quest:is-complete", request);
  return request.complete === true;
}

function count(player, name) {
  return player.getInventory().getAmount(obj(name));
}

/** Takes every one of these items from the inventory. */
function removeItems(player, names) {
  const inventory = player.getInventory();
  let removed = false;
  for (const name of names) {
    const id = obj(name);
    const amount = inventory.getAmount(id);
    if (amount <= 0) continue;
    inventory.delete(id, amount);
    removed = true;
  }
  if (removed) inventory.refreshItems();
  return removed;
}

function formatNumber(value) {
  return Math.round(value).toLocaleString("en-US");
}

function random(min, max) {
  return min + Math.floor(Math.random() * (max - min + 1));
}

module.exports = {
  bind, core, api,
  TEMPLE, BARRIER, LOBBY_TILE, REQUIRED_RUNECRAFT,
  MAX_ENERGY_PER_TYPE, MAX_ENERGY_TOTAL, REWARD_ENERGY, MINING_XP_CAP, HUD_PERIOD, RIFT_GUARDIAN_CAP,
  LOC, NPC, ITEM, STONES, NEW_GAME_ITEMS, GAME_ITEMS, VARBIT, VARP, INTERFACE, SCRIPT, OVERLAY_HUD_UID, OVERLAY_ATMOSPHERE_UID,
  loc, isLoc, npc, obj, seq, spotanim, iface, setVarbit, getVarbit, setVarp,
  location, inTemple, inGameSide, now, later, repeat, startAction, stopAction, statement, itemStatement, options, npcSays, spam, highlight,
  animate, graphic, damageNpc, prepareNpc, sound, runecraftLevel, addXp, questComplete, count, removeItems, formatNumber, random,
};
