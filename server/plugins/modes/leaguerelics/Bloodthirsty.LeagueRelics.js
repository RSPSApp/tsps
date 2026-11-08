/**
 * Bloodthirsty (https://oldschool.runescape.wiki/w/Bloodthirsty), Trailblazer Reloaded's tier 5
 * relic:
 * - The enchanted gem, slayer ring or slayer helmet takes a new task from the last master, or
 *   cancels the current one, from anywhere.
 * - The bracelet of slaughter and the expeditious bracelet work 35% of the time and uses no charge.
 * - Superiors come 1 time in 25. Each gives Slayer points (ours: 5 plus a fifth of its Slayer
 *   requirement; the Wiki says only "based on" it) and six more rolls on its normal monster's table.
 * - A quarter of them are bloodthirsty: nine rolls instead of six, a clue scroll for sure when the
 *   monster drops clues, three times the superior unique chance, and a roll on the bloodthirsty
 *   table (Wiki, Bloodthirsty Nechryarch).
 * Not here: the bloodthirsty variants' stronger
 * stats, own names and icon (no NPCs of their own in this cache): their rewards are the relic's.
 */
const Common = require("./Common.LeagueRelics");

const CLUE_SCROLL = /^clue scroll \(/i;

let api;
let core;
let effect;
/** Superiors that spawned bloodthirsty. */
const bloodthirsty = new WeakSet();

function active(player) {
  return Common.effectActive(player, effect);
}

function superiorChance(request) {
  if (active(request?.player)) request.chance = Math.min(request.chance, effect.superiorOneIn);
}

function spawned({ player, superior }) {
  if (!superior || !active(player) || Math.random() >= effect.variantChance) return;
  bloodthirsty.add(superior);
  player.sendMessage(Common.message("bloodthirstySuperior"));
}

/** Whether the player may receive a clue of this tier now (Treasure Trails: one of each at a time). */
function receivable(player, entry) {
  const tier = /\(([a-z]+)\)/i.exec(entry.name ?? "")?.[1]?.toLowerCase();
  if (!tier) return false;
  const request = { player, tier, allowed: null };
  api.emitCustomEvent("treasure-trails:can-receive", request);
  return request.allowed !== false;
}

/** A bloodthirsty superior's clue scroll is certain when its table has one the player can take. */
function clueChance(request) {
  if (Array.isArray(request.rules) && request.npc && bloodthirsty.has(request.npc) && active(request.player)) {
    request.rules.push({ pattern: CLUE_SCROLL, guarantee: true, accept: (entry) => receivable(request.player, entry) });
  }
}

function rollTable() {
  let roll = Math.floor(Math.random() * effect.uniqueTable.outOf);
  for (const row of effect.uniqueTable.rows) {
    roll -= row.weight;
    if (roll >= 0) continue;
    const base = core.ItemIdentifiers[row.item];
    const itemId = row.noted ? Common.noted(base) : base;
    const [minimum, maximum] = row.amount;
    return { itemId, amount: minimum + Math.floor(Math.random() * (maximum - minimum + 1)), noted: false };
  }
  return null;
}

function superiorRewards(rewards) {
  const { player, npc } = rewards;
  if (!active(player)) return;
  const variant = bloodthirsty.has(npc);
  rewards.extraRolls = Math.max(rewards.extraRolls, variant ? effect.variantRolls : effect.superiorRolls);
  if (variant) {
    rewards.uniqueBoost *= effect.variantUniqueBoost;
    const drop = rollTable();
    if (drop && Number.isInteger(drop.itemId)) rewards.drops.push(drop);
  }
  const level = Math.max(1, (npc.getCurrentDefinition?.() ?? npc.getDefinition?.())?.getSlayerLevel?.() ?? 1);
  const points = effect.superiorPoints.base + Math.floor(level / effect.superiorPoints.perLevels);
  api.emitCustomEvent("slayer:grant-points", { player, points });
  player.sendMessage(Common.message("superiorPoints", { points }));
}

function bracelet(request) {
  if (request.bracelet !== "slaughter" && request.bracelet !== "expeditious" || !active(request.player)) return;
  request.chance = Math.max(request.chance, effect.braceletChance);
  request.consumeCharge = false;
}

function remoteTask(request) {
  if (active(request.player)) request.allowed = true;
}

module.exports = function attach(pluginApi) {
  api = pluginApi;
  core = api.core;
  effect = Common.data.effects.bloodthirsty;
  api.onCustomEvent("slayer:superior-spawn", superiorChance);
  api.onCustomEvent("slayer:superior-spawned", spawned);
  api.onCustomEvent("npc-drops:tertiary-chance", clueChance);
  api.onCustomEvent("slayer:superior-rewards", superiorRewards);
  api.onCustomEvent("slayer:bracelet", bracelet);
  api.onCustomEvent("slayer:remote-task", remoteTask);
};

module.exports.bloodthirsty = bloodthirsty;
