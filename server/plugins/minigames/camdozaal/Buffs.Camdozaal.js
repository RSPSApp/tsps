"use strict";

const S = require("./Shared.Camdozaal");
const FISH = ["RAW_GUPPY", "RAW_CAVEFISH", "RAW_TETRA", "RAW_CATFISH"];

function bonus(player, index) {
  return (S.purchased(player, index) ? 0.1 : 0) + (S.boostTicks(player) > 0 ? 0.05 : 0);
}
function fishingChance(request) {
  if (!S.inRuins(request.player) || !FISH.some(name => S.core().ItemIdentifiers[name] === request.itemId)) return;
  // Wiki gives nominal +10%/+5%, not a complete success curve. TSPS uses percentage points.
  request.chance = Math.min(1, request.chance + bonus(request.player, 0));
}
function miningAttempt(request) {
  if (request.success || request.rock !== "Barronite rocks" || !S.inRuins(request.player)) return;
  const extra = bonus(request.player, 3);
  // Rescue a fraction of misses so the aggregate chance rises by the additive bonus.
  if (extra > 0 && Number.isFinite(request.chance) && request.chance < 1
      && Math.random() < Math.min(1, extra / (1 - request.chance))) request.success = true;
}

function defenceRoll(request) {
  const { attacker, target } = request;
  if (!attacker?.isNpc?.() || !target?.isPlayer?.()) return;
  const player = target.getAsPlayer();
  if (!S.inRuins(player)) return;
  const names = S.core().CacheDefinitions.getNpcNames();
  if (!/^camdozaal_golem_(mind|body|chaos|flawed)$/.test(names.get(attacker.getId()) ?? "")) return;
  const effective = S.core().AccuracyFormulasDpsCalc.effectiveDefenseLevel(player);
  // The published +5 Defence bonus is invisible. Apply it to the effective roll,
  // leaving displayed/current skill levels untouched. Boost's extra 5% is estimated.
  if (S.purchased(player, 2) && effective > 0) request.defenceRoll *= (effective + 5) / effective;
  if (S.boostTicks(player) > 0) request.defenceRoll *= 1.05;
}

function dropChance(request) {
  if (!S.inRuins(request.player) || !request.npc) return;
  const name = S.core().CacheDefinitions.getNpcNames().get(request.npc.getId()) ?? "";
  if (!/^camdozaal_golem_(mind|body|chaos|flawed)$/.test(name)) return;
  request.rules.push({ pattern: /^(Barronite guard|(?:Mind|Body|Chaos) core|Clue scroll \(beginner\))$/i,
    multiplier: require("./Rewards.Camdozaal").rareMultiplier(request.player) });
}
function clueChance(request) {
  if (request.tier !== "beginner" || !S.inRuins(request.player)) return;
  request.multiplier *= require("./Rewards.Camdozaal").rareMultiplier(request.player);
}

module.exports = function attach(api) {
  api.onCustomEvent("fishing:catch-chance", fishingChance);
  api.onCustomEvent("mining:attempt", miningAttempt);
  api.onCustomEvent("combat:defence-roll", defenceRoll);
  api.onCustomEvent("npc-drops:chance", dropChance);
  api.onCustomEvent("treasure-trails:vessel-chance", clueChance);
};
