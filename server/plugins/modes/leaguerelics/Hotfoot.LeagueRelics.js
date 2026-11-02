/**
 * Hotfoot (https://oldschool.runescape.wiki/w/Demonic_Pacts_League/Relics), Demonic Pacts' tier 2
 * relic. With the Searing boots (from the cache's relic struct) worn, caught fish come cooked and
 * mined ore comes smelted into its own bar, with the Cooking or Smithing XP (ours: the Wiki gives
 * none; coal, and anything with no recipe of its own, stays as it is). Whatever the footwear,
 * Agility and Cooking never fail, a lap counts twice and pays 25% more experience, a mark of grace
 * on a rooftop course is a 33% chance a lap (`agility:mark-chance`, in place of the course's own
 * and its overlevel cut; the 3-minute mark cooldown still runs: ours), and a course mark picked up
 * finishes a lap of its course, paid as one, with 10,000 coins (`agility:mark-taken`).
 *
 * The processing hears `storage:gather` twice: first (attached before the other gathering
 * relics) it swaps the request's item for the cooked fish or bar, so a relic that banks or
 * doubles the harvest (Endless Harvest) handles the processed item; last, it hands what nobody
 * stored to the inventory in place of the raw item.
 * Not here: Agility XP while running (the Wiki gives no rate: "based on your Agility level"),
 * and termites finishing a lap, the doubled termites and the tenfold crystal shards (the Colossal
 * Wyrm courses give no termites and Prifddinas no shards yet).
 */
const Common = require("./Common.LeagueRelics");

let api;
let core;
let effect;

/** Gathers being processed: request -> the raw item it replaced. */
const processing = new WeakMap();

function active(player) {
  return Common.effectActive(player, effect);
}

function wearsBoots(player) {
  return active(player) && player.getEquipment().contains(core.ItemIdentifiers[effect.tool]);
}

/** The cooked fish or the bar, with its skill and XP; null when the item has none. */
function processed(skill, itemId) {
  if (skill === core.Skill.FISHING) {
    const cooked = { rawId: itemId, cookedId: null, xp: null };
    api.emitCustomEvent("cooking:cooked", cooked);
    return cooked.cookedId ? { itemId: cooked.cookedId, skill: core.Skill.COOKING, xp: cooked.xp } : null;
  }
  if (skill === core.Skill.MINING) {
    const bar = { oreId: itemId, outputId: null, barId: null, xp: null };
    api.emitCustomEvent("smithing:bar-for-ore", bar);
    return bar.barId ? { itemId: bar.barId, skill: core.Skill.SMITHING, xp: bar.xp } : null;
  }
  return null;
}

function process(request) {
  const { player, amount } = request;
  if (request.stored >= amount || !wearsBoots(player)) return;
  const result = processed(request.skill, request.itemId);
  if (!result) return;
  processing.set(request, request.itemId);
  request.itemId = result.itemId;
  if (result.xp > 0) player.getSkillManager().addExperiences(result.skill, result.xp * (amount - request.stored));
}

/** What nobody stored goes to the inventory as the processed item, in the raw item's place. */
function deliver(request) {
  if (!processing.has(request)) return;
  processing.delete(request);
  const left = request.amount - request.stored;
  if (left <= 0) return;
  request.player.getInventory().adds(request.itemId, left);
  request.stored = request.amount;
}

function succeeds(request) {
  if (active(request.player)) request.success = true;
}

function neverBurns(request) {
  if (active(request.player)) request.burn = false;
}

function lapReward(request) {
  if (!active(request.player)) return;
  request.count = Math.max(request.count, effect.lapCount);
  request.xp *= effect.lapXpMultiplier;
}

function markChance(request) {
  if (active(request.player) && effect.markCourses.includes(request.course)) request.chance = effect.markChance;
}

function markTaken(request) {
  if (!active(request.player)) return;
  request.completesLap = true;
  request.items.push([core.ItemIdentifiers.COINS, effect.markLapCoins]);
}

module.exports = function attach(pluginApi) {
  api = pluginApi;
  core = api.core;
  effect = Common.data.effects.hotfoot;
  api.onCustomEvent("storage:gather", process);
  api.onCustomEvent("agility:roll", succeeds);
  api.onCustomEvent("cooking:burn", neverBurns);
  api.onCustomEvent("agility:lap-reward", lapReward);
  api.onCustomEvent("agility:mark-chance", markChance);
  api.onCustomEvent("agility:mark-taken", markTaken);
};

/** The last `storage:gather` listener: attached after every other gathering relic. */
module.exports.late = function attachLate(pluginApi) {
  pluginApi.onCustomEvent("storage:gather", deliver);
};
