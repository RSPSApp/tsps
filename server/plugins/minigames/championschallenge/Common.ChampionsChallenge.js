"use strict";

/**
 * Champions' Challenge: what the units share - the plugin api, plugins/minigames/data/
 * champions-challenge.json, the saved progress and the varp the client draws it from.
 *
 * Progress is two bit sets, one bit per champion (`bit` in the data): the champions beaten and
 * the lamps rubbed. Varp 617 carries both, as the cache lays it out: champions_defeated_* (and
 * champions_slain) in bits 0-15, champions_lamps in bits 16-31. The banners on the Wall of
 * Defeated Champions and the Chest of Champions are multilocs on those varbits.
 */
const DATA = require("../data/champions-challenge.json");

const DEFEATED_ATTRIBUTE = "champions-challenge:defeated";
const LAMPS_ATTRIBUTE = "champions-challenge:lamps";
/** Set while the player is in the basement, so a login there puts them by the trapdoor. */
const INSIDE_ATTRIBUTE = "champions-challenge:inside";

const LARXUS = DATA.npcs.larxus.id;

let api = null;
let core = null;

/** Set once by the plugin before any unit attaches. */
function init(pluginApi) {
  api = pluginApi;
  core = pluginApi.core;
}

const byKey = new Map(DATA.champions.map((champion) => [champion.key, champion]));
const byNpc = new Map(DATA.champions.map((champion) => [champion.npc, champion]));
const byScroll = new Map(DATA.champions.filter((champion) => champion.scroll).map((champion) => [champion.scroll, champion]));
const LEON = byKey.get("leon");
/** The ten champions with a scroll; beating them all brings Leon d'Cour's challenge. */
const SCROLL_CHAMPIONS = DATA.champions.filter((champion) => champion.scroll);

const bits = (player, key) => Number(player.getAttribute(key)) || 0;
const flag = (champion) => 1 << champion.bit;

/** The champions `player` has beaten, one bit per champion (`bit` in the data). */
function defeatedBits(player) {
  return bits(player, DEFEATED_ATTRIBUTE);
}

function hasDefeated(player, champion) {
  return (bits(player, DEFEATED_ATTRIBUTE) & flag(champion)) !== 0;
}

function hasRubbed(player, champion) {
  return (bits(player, LAMPS_ATTRIBUTE) & flag(champion)) !== 0;
}

function anyDefeated(player) {
  return bits(player, DEFEATED_ATTRIBUTE) !== 0;
}

/** Leon d'Cour challenges whoever has beaten the other ten. */
function leonUnlocked(player) {
  return SCROLL_CHAMPIONS.every((champion) => hasDefeated(player, champion));
}

/** The first beaten champion whose lamp has not been rubbed: what the chest and lamp are for. */
function unclaimed(player) {
  return DATA.champions.find((champion) => hasDefeated(player, champion) && !hasRubbed(player, champion)) ?? null;
}

function sendVarp(player) {
  const value = bits(player, DEFEATED_ATTRIBUTE) | (bits(player, LAMPS_ATTRIBUTE) << DATA.lampBitOffset);
  player.getPacketSender().sendConfig(DATA.varp, value);
}

function setDefeated(player, champion) {
  player.setAttribute(DEFEATED_ATTRIBUTE, bits(player, DEFEATED_ATTRIBUTE) | flag(champion));
  sendVarp(player);
}

function setRubbed(player, champion) {
  player.setAttribute(LAMPS_ATTRIBUTE, bits(player, LAMPS_ATTRIBUTE) | flag(champion));
  sendVarp(player);
}

const holdsLamp = (player) => player.getInventory().contains(DATA.items.lamp);
const heldScroll = (player) => SCROLL_CHAMPIONS.find((champion) => player.getInventory().contains(champion.scroll)) ?? null;

const toLocation = ([x, y, z]) => new core.Location(x, y, z ?? 0);

/** Runs `action` `ticks` ticks from now (at least one). */
function later(ticks, action) {
  const { Task, TaskManager } = core;
  TaskManager.submit(new (class extends Task {
    constructor() {
      super(Math.max(1, ticks), null, false);
    }
    execute() {
      this.stop();
      action();
    }
  })());
}

/** One line from Larxus, outside his transcript. */
function larxusSays(player, text) {
  const { DialogueChainBuilder, NpcDialogue } = core;
  player.getDialogueManager().startDialogues(new DialogueChainBuilder().add(new NpcDialogue(0, LARXUS, text)));
}

/** Plays a named variant of Larxus's Wiki transcript. */
function larxusVariant(player, variant, npc = null) {
  const request = { player, npc, npcId: LARXUS, variant, handled: false };
  api.emitCustomEvent("npc-dialogue:start", request);
  return request.handled;
}

/** The champion's name as the chest, lamp and reward scroll print it ("Giant Champion"). */
const title = (champion) => `${champion.name} Champion`;

module.exports = {
  get api() {
    return api;
  },
  get core() {
    return core;
  },
  init,
  DATA,
  LARXUS,
  LEON,
  SCROLL_CHAMPIONS,
  DEFEATED_ATTRIBUTE,
  LAMPS_ATTRIBUTE,
  INSIDE_ATTRIBUTE,
  byKey,
  byNpc,
  byScroll,
  defeatedBits,
  hasDefeated,
  hasRubbed,
  anyDefeated,
  leonUnlocked,
  unclaimed,
  sendVarp,
  setDefeated,
  setRubbed,
  holdsLamp,
  heldScroll,
  toLocation,
  later,
  larxusSays,
  larxusVariant,
  title,
};
