/**
 * Power Miner (https://oldschool.runescape.wiki/w/Power_Miner_(Raging_Echoes_League)), Raging
 * Echoes' tier 1 relic: the Echo pickaxe (a crystal pickaxe with no requirement, in Mining's own
 * table), a failed swing's second 50% chance, ore straight to the bank, a rock that lasts four
 * ores, and the pickaxe's toggles: ore smelted into the relic's bar (iron becomes steel, with
 * other ingredients waived) and gems cut, with the Smithing and Crafting XP
 * whatever the level.
 */
const Common = require("./Common.LeagueRelics");
const EchoTool = require("./EchoTool.LeagueRelics");

let api;
let core;
let effect;
let smeltBars;

/** Ores taken from each rock since it last depleted. */
const mined = new WeakMap();

function active(player) {
  return Common.effectActive(player, effect);
}

/** The pickaxe's effects need the pickaxe, carried or wielded (Wiki). */
function withTool(player) {
  return active(player) && EchoTool.holdsTool(core, player, effect);
}

function secondChance(request) {
  if (!request.success && withTool(request.player) && Math.random() < effect.secondChance) request.success = true;
}

/** The rock stands until its fourth ore; a rock depleted by anyone else starts its count afresh. */
function keepRock(request) {
  if (!withTool(request.player)) {
    // Another miner's last ore really depletes it; the respawned rock is the same object.
    if (!request.handled) mined.delete(request.object);
    return;
  }
  const count = (mined.get(request.object) ?? 0) + 1;
  if (count < effect.oresPerRock) {
    mined.set(request.object, count);
    request.handled = true;
  } else {
    mined.delete(request.object);
  }
}

/** What the ore becomes in the bank, with the XP it pays: a bar, a cut gem, or the ore itself. */
function processed(player, itemId) {
  const current = EchoTool.mode(player, effect);
  if (current.includes("smelt") && smeltBars.has(itemId)) {
    const bar = { oreId: itemId, outputId: smeltBars.get(itemId), barId: null, xp: null };
    api.emitCustomEvent("smithing:bar-for-ore", bar);
    if (bar.barId) return { itemId: bar.barId, skill: core.Skill.SMITHING, xp: bar.xp };
  }
  if (current.includes("cut")) {
    const gem = { uncutId: itemId, cutId: null, xp: null };
    api.emitCustomEvent("crafting:cut-gem", gem);
    if (gem.cutId) return { itemId: gem.cutId, skill: core.Skill.CRAFTING, xp: gem.xp };
  }
  return { itemId, skill: null, xp: 0 };
}

/** Mined items go to the bank, smelted or cut on the way when the pickaxe says so. */
function gather(request) {
  const { player, amount } = request;
  if (request.stored >= amount || request.skill !== core.Skill.MINING || !withTool(player)) return;
  const result = processed(player, request.itemId);
  if (Common.bank(player, result.itemId, amount - request.stored)) {
    request.stored = amount;
    if (result.skill && result.xp > 0) player.getSkillManager().addExperiences(result.skill, result.xp * amount);
    return;
  }
  // The processed item has no room: the ore itself, as it is.
  if (result.itemId !== request.itemId && Common.bank(player, request.itemId, amount - request.stored)) request.stored = amount;
}

/** Mining's room (`storage:room` for Mining only): the bank takes what the pickaxe's mode makes of the ore, or the ore. */
function room(request) {
  if (request.room || request.skill !== core.Skill.MINING || !withTool(request.player)) return;
  const result = processed(request.player, request.itemId);
  if (Common.bankHasRoom(request.player, result.itemId) || Common.bankHasRoom(request.player, request.itemId)) request.room = true;
}

module.exports = function attach(pluginApi) {
  api = pluginApi;
  core = api.core;
  effect = Common.data.effects.powerMiner;
  smeltBars = new Map(Object.entries(effect.smeltBars).map(([ore, bar]) => [core.ItemIdentifiers[ore], core.ItemIdentifiers[bar]]));
  EchoTool.attach(api, effect);
  api.onCustomEvent("mining:attempt", secondChance);
  api.onCustomEvent("mining:deplete-rock", keepRock);
  api.onCustomEvent("storage:gather", gather);
  api.onCustomEvent("storage:room", room);
};
