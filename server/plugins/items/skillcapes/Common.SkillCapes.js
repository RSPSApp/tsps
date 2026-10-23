/**
 * Skillcapes: what the units share - the capes, hoods, max cape variants and masters from
 * data/skillcapes.json (cache gamevals, resolved to ids once), and small helpers for options,
 * dialogue, teleports and the daily allowances.
 */
const DATA = require("../data/skillcapes.json");

let api;
let core;

const MAX_LEVEL = 99;
/** OSRS resets daily limits at 00:00 UTC. */
const DAILY_ATTRIBUTE = "skillcapes:daily";
/** Ranging "Commune": the player has asked the cape not to gather metal items. */
const JUNK_OFF_ATTRIBUTE = "skillcapes:accumulator-junk-off";
/** Vorkath's head has been used on a Ranging or max cape: its ammo recovery and metal are mithril. */
const VORKATH_UPGRADE_ATTRIBUTE = "skillcapes:vorkath-head-upgrade";
const WORN_OPTION_PARAM = 451;
const FIRST_WORN_OPTION_CLICK = 2;
/** Worn submenus (cache params): the first entry at 661 + op, later entries at 2066 + op + 8 * n. */
const WORN_SUBOP_FIRST = 661;
const WORN_SUBOP_BASE = 2066;
const WORN_SUBOP_STEP = 8;
const MAX_WORN_SUBOPS = 20;

/** Skillcapes by skill key, every id (untrimmed, trimmed, worn) to its cape, and the hoods. */
const CAPES = [];
const CAPE_BY_SKILL = new Map();
const CAPE_BY_ITEM = new Map();
const HOOD_IDS = new Set();
const MAX = {};
const COMBINED = [];
const COMBINED_BY_CAPE = new Map();
const COMBINED_BY_ITEM = new Map();

function objId(name) {
  const id = core.CacheDefinitions.getObjId(name);
  if (!Number.isInteger(id)) throw new Error(`[skillcapes] unknown obj gameval ${name}`);
  return id;
}

function seqId(name) {
  const id = core.CacheDefinitions.getSeqId(name);
  if (!Number.isInteger(id)) throw new Error(`[skillcapes] unknown seq gameval ${name}`);
  return id;
}

/** Set once by the plugin before any unit attaches. */
function init(pluginApi) {
  api = pluginApi;
  core = pluginApi.core;
  CAPES.length = 0;
  for (const row of DATA.capes) {
    const cape = {
      skillKey: row.skill,
      skill: core.Skill[row.skill],
      cape: objId(row.cape),
      trimmed: objId(row.trimmed),
      hood: objId(row.hood),
      worn: row.worn ? objId(row.worn) : null,
      trimmedWorn: row.trimmedWorn ? objId(row.trimmedWorn) : null,
      masters: row.masters,
    };
    CAPES.push(cape);
    CAPE_BY_SKILL.set(row.skill, cape);
    for (const id of [cape.cape, cape.trimmed, cape.worn, cape.trimmedWorn]) if (id !== null) CAPE_BY_ITEM.set(id, cape);
    HOOD_IDS.add(cape.hood);
  }
  Object.assign(MAX, {
    cape: objId(DATA.max.cape),
    worn: objId(DATA.max.worn),
    hood: objId(DATA.max.hood),
    price: DATA.max.price,
    sellBack: Math.floor(DATA.max.price * DATA.max.sellBackPercent / 100),
  });
  COMBINED.length = 0;
  for (const row of DATA.combined) {
    // A locked ("(l)", Trouver parchment) item combines without the warning that it will be lost.
    const combined = {
      item: objId(row.item), cape: objId(row.cape), hood: objId(row.hood), label: row.label, locked: /_trouver$/.test(row.item),
    };
    COMBINED.push(combined);
    COMBINED_BY_CAPE.set(combined.cape, combined);
    if (!COMBINED_BY_ITEM.has(combined.item)) COMBINED_BY_ITEM.set(combined.item, combined);
  }
}

function isMaxCape(id) {
  return id === MAX.cape || id === MAX.worn;
}

function capeSlotId(player) {
  return player.getEquipment().getItems()[core.Equipment.CAPE_SLOT]?.getId?.() ?? -1;
}

function baseLevel(player, skill) {
  return player.getSkillManager().getMaxLevel(skill);
}

function count99s(player) {
  return core.Skill.values().filter((skill) => baseLevel(player, skill) >= MAX_LEVEL).length;
}

function maxed(player) {
  return core.Skill.values().every((skill) => baseLevel(player, skill) >= MAX_LEVEL);
}

/** Whether this cape id carries the skill's perk: its own cape, the max cape, or (for a few
 * perks) any combined max cape (Wiki: Max cape, "Max cape variants"). */
function capeHasPerk(itemId, skillKey) {
  if (itemId <= 0) return false;
  if (CAPE_BY_ITEM.get(itemId)?.skillKey === skillKey) return true;
  if (isMaxCape(itemId)) return true;
  return COMBINED_BY_CAPE.has(itemId) && DATA.combinedPerks.includes(skillKey);
}

/** The worn cape (and, with `inventory`, a carried one) gives the skill's perk. */
function hasPerk(player, skillKey, inventory = false) {
  if (capeHasPerk(capeSlotId(player), skillKey)) return true;
  if (!inventory) return false;
  return player.getInventory().getItems().some((item) => capeHasPerk(item?.getId?.() ?? -1, skillKey));
}

/** Answers "skillcape:has-perk" `{ player, skill, inventory?, result }` for other plugins. */
function answerPerk(request) {
  if (!request?.player || request.result === true) return;
  const skillKey = typeof request.skill === "string" ? request.skill.toUpperCase() : keyOf(request.skill);
  if (skillKey && hasPerk(request.player, skillKey, request.inventory === true)) request.result = true;
}

function keyOf(skill) {
  for (const [key, cape] of CAPE_BY_SKILL) if (cape.skill === skill) return key;
  return null;
}

/**
 * The option an item click names: a worn option (cache params 451+) from the equipment tab,
 * else the inventory option, and the submenu entry when the click came from one.
 */
function itemOption(event) {
  const definition = core.CacheDefinitions.getItem(event.itemId);
  const sub = Number.isInteger(event.subOpId) && event.subOpId > 0 ? event.subOpId - 1 : -1;
  if (event.interfaceId === core.Equipment.INVENTORY_INTERFACE_ID) {
    const op = event.clickType - FIRST_WORN_OPTION_CLICK;
    if (op < 0) return { option: null, sub: null };
    const option = event.option ?? definition?.params?.get?.(WORN_OPTION_PARAM + op) ?? null;
    return { option, sub: sub >= 0 ? wornSubOption(definition, op, sub) : null };
  }
  const index = event.clickType - 1;
  const option = event.option ?? definition?.inventoryActions?.[index] ?? null;
  return { option, sub: sub >= 0 ? (definition?.subops?.[index]?.[sub] ?? null) : null };
}

function wornSubOption(definition, op, sub) {
  const params = definition?.params;
  if (!params?.get) return null;
  if (sub === 0) return params.get(WORN_SUBOP_FIRST + op) ?? params.get(WORN_SUBOP_BASE + op) ?? null;
  return params.get(WORN_SUBOP_BASE + op + WORN_SUBOP_STEP * sub) ?? null;
}

/** Every worn submenu entry of an op, in order (the equipment tab lists them so). */
function wornSubOptions(definition, op) {
  const out = [];
  for (let sub = 0; sub < MAX_WORN_SUBOPS; sub++) {
    const text = wornSubOption(definition, op, sub);
    if (typeof text === "string") out.push(text);
    else if (sub > 0) break;
  }
  return out;
}

/** A short conversation: `{ npc: id, text }`, `{ player: text }`, `{ statement: text }`
 * or a function, which runs when reached before the rest carries on. */
function talk(player, steps) {
  const chain = new core.DialogueChainBuilder();
  let index = 0;
  for (let i = 0; i < steps.length; i++) {
    const step = steps[i];
    if (typeof step === "function") {
      const rest = steps.slice(i + 1);
      chain.add(new core.ActionDialogue(index++, { execute: () => {
        step();
        if (rest.length) talk(player, rest);
        else if (!player.getDialogueManager().getCurrent?.()) player.getPacketSender().sendInterfaceRemoval();
      } }));
      player.getDialogueManager().startDialogues(chain);
      return;
    }
    if (step.npc !== undefined) chain.add(new core.NpcDialogue(index++, step.npc, step.text));
    else if (step.player !== undefined) chain.add(new core.PlayerDialogue(index++, step.player));
    else chain.add(new core.StatementDialogue(index++, step.statement));
  }
  chain.add(new core.EndDialogue(index));
  player.getDialogueManager().startDialogues(chain);
}

/** A message box ("mesbox"), as OSRS shows most cape feedback. */
function messageBox(player, text) {
  talk(player, [{ statement: text }]);
}

/** Plays a variant of the NPC's Wiki transcript; false when the transcript lacks it. */
function playTranscript(player, npc, variant) {
  const request = { player, npcId: npc?.getId?.(), npc, variant, handled: false };
  api.emitCustomEvent("npc-dialogue:start", request);
  return request.handled;
}

/** A cape teleport: the standard cast (rsprox captures: human_castteleport + teleport_casting,
 * the move three ticks later), after the usual teleport checks. */
function teleport(player, tile, onArrival) {
  const destination = Array.isArray(tile) ? new core.Location(tile[0], tile[1], tile[2] ?? 0) : tile;
  if (!core.TeleportHandler.checkReqs(player, destination)) return false;
  core.TeleportHandler.teleport(player, destination, core.TeleportType.NORMAL, false, onArrival);
  return true;
}

function today() {
  return new Date().toISOString().slice(0, 10);
}

/** Today's uses of a daily allowance ("spellbook", "chinchompa", "grapple", "stamina"). */
function dailyUses(player, key) {
  const state = player.getAttribute(DAILY_ATTRIBUTE);
  if (!state || state.day !== today()) return 0;
  return Number(state.counts?.[key]) || 0;
}

function useDaily(player, key) {
  const state = player.getAttribute(DAILY_ATTRIBUTE);
  const fresh = !state || state.day !== today();
  const counts = fresh ? {} : { ...state.counts };
  counts[key] = (Number(counts[key]) || 0) + 1;
  player.setAttribute(DAILY_ATTRIBUTE, { day: today(), counts });
  return counts[key];
}

function later(owner, ticks, action) {
  core.TaskManager.submit(new (class extends core.Task {
    constructor() { super(ticks, owner ?? undefined, false); }
    execute() { this.stop(); action(); }
  })());
}

function itemName(id) {
  return core.ItemDefinition.forId(id)?.getName?.() ?? "item";
}

module.exports = {
  init, DATA, CAPES, CAPE_BY_SKILL, CAPE_BY_ITEM, HOOD_IDS, MAX, COMBINED, COMBINED_BY_CAPE, COMBINED_BY_ITEM,
  MAX_LEVEL, DAILY_ATTRIBUTE, JUNK_OFF_ATTRIBUTE, VORKATH_UPGRADE_ATTRIBUTE,
  objId, seqId, isMaxCape, capeSlotId, baseLevel, count99s, maxed, capeHasPerk, hasPerk,
  answerPerk, keyOf, itemOption, wornSubOption, wornSubOptions, talk, messageBox, playTranscript, teleport,
  today, dailyUses, useDaily, later, itemName,
  get api() { return api; },
  get core() { return core; },
};
