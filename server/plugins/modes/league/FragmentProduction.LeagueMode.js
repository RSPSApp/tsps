/**
 * Shattered Relics' production fragments, and The Alchemist, The Craftsman and Unchained Talent
 * (data/league-shattered.json `productionEffects`; Wiki /Fragments). Each fragment works with the
 * number its equipped level gives in the cache (Fragments.equippedValue), each set with its tier
 * (Fragments.setTier). They hear the skills' own events: `skills:produced` and
 * `skills:actions-per-cycle` (the make-X loops, by `kind`), `herblore:mix`, `runecrafting:success`,
 * `construction:materials`, `magic:enchant-pieces`, `magic:spell-batch`, `magic:alchemy-policy`,
 * and `league:fragment-tick` for Unchained Talent's boost.
 */
const Common = require("./Common.LeagueMode");
const Fragments = require("./Fragments.LeagueMode");
const { data } = require("./Shattered.LeagueMode");

/** The players Unchained Talent boosted, so the boost comes off with the set. */
const boosted = new WeakSet();

function effects() {
  return data.productionEffects;
}

function core() {
  return Common.core;
}

function chance(percent) {
  return Math.random() * 100 < percent;
}

function value(player, effect) {
  return Fragments.equippedValue(player, effects()[effect].fragment);
}

function itemName(itemId) {
  return core().ItemDefinition.forId(itemId)?.getName?.() ?? "";
}

/** A fragment's number when the product is of one of its loops, else null. */
function forKind(request, effect) {
  return effects()[effect].kinds.includes(request.kind) ? value(request.player, effect) : null;
}

// ---- The Alchemist, The Craftsman: everything in the inventory at once ----

function batchSize(player, set, request) {
  const { set: id, actions, batch } = effects()[set];
  const skill = Object.keys(batch).find((name) => core().Skill[name] === request.skill);
  if (!skill || !batch[skill].includes(request.kind)) return null;
  return Fragments.setTier(player, id) > 0 ? actions : null;
}

function allAtOnce(request) {
  for (const set of ["theAlchemist", "theCraftsman"]) {
    const actions = batchSize(request.player, set, request);
    if (actions) request.actions = Math.max(request.actions, actions);
  }
}

// ---- What a product brings: Smithing Double, Imcando's Apprentice, Dragon On A Bit, Dine & Dash, the XP and bolt tips ----

function produced(request) {
  smithingDouble(request);
  imcandosApprentice(request);
  dragonOnABit(request);
  dineAndDash(request);
  moreExperience(request, "profletchional");
  moreExperience(request, "justDruid");
  proTips(request);
}

/** An extra of what the anvil made, with its XP; it falls to the floor when the inventory is full (Wiki). */
function smithingDouble(request) {
  const percent = forKind(request, "smithingDouble");
  if (percent === null || !chance(percent)) return;
  const { player } = request;
  player.getInventory().forceAdd(player, new (core().Item)(request.itemId, request.amount));
  if (request.xp > 0) player.getSkillManager().addExperiences(request.skill, request.xp);
}

/** Gemmed jewellery (more than its bar went in): an extra piece with its XP, given only with room for it (Wiki). */
function imcandosApprentice(request) {
  const percent = forKind(request, "imcandosApprentice");
  if (percent === null || (request.materials?.length ?? 0) < 2 || !chance(percent)) return;
  const { player } = request;
  const item = new (core().Item)(request.itemId, request.amount);
  if (player.getInventory().getAddableAmount(item) < request.amount) return;
  player.getInventory().add(item, true);
  if (request.xp > 0) player.getSkillManager().addExperiences(request.skill, request.xp);
}

/** Dragonhide armour: its dragon leather comes back, to the bank (Wiki); a shield's frame and nails stay used. */
function dragonOnABit(request) {
  const effect = effects().dragonOnABit;
  const percent = forKind(request, "dragonOnABit");
  if (percent === null || !itemName(request.itemId).toLowerCase().includes(effect.product) || !chance(percent)) return;
  for (const [itemId, amount] of request.materials ?? []) {
    if (itemName(itemId).toLowerCase().includes(effect.material)) Common.bank(request.player, itemId, amount);
  }
}

/** Another of the cooked food, to the bank and with no XP; never untradeable food, never in an instance (Wiki). */
function dineAndDash(request) {
  const percent = forKind(request, "dineAndDash");
  const { player } = request;
  if (percent === null || player.getPrivateArea?.()) return;
  if (core().ItemDefinition.forId(request.itemId)?.isTradeable?.() === false || !chance(percent)) return;
  Common.bank(player, request.itemId, request.amount);
}

/** Profletchional (logs and stringing), Just Druid! (cleaning): a percent more of the product's XP. */
function moreExperience(request, effect) {
  const percent = forKind(request, effect);
  if (percent === null || !(request.xp > 0)) return;
  request.player.getSkillManager().addExperiences(request.skill, (request.xp * percent) / 100);
}

/** More bolt tips a gem. */
function proTips(request) {
  const effect = effects().proTips;
  const percent = forKind(request, "proTips");
  if (percent === null || !itemName(request.itemId).toLowerCase().includes(effect.product)) return;
  const extra = Math.floor((request.amount * percent) / 100);
  if (extra > 0) request.player.getInventory().forceAdd(request.player, new (core().Item)(request.itemId, extra));
}

// ---- Mixologist ----

function isPotion(itemId) {
  const name = itemName(itemId);
  return /\(\d\)$/.test(name) || /\(unf\)$/i.test(name) || /^vial of water$/i.test(name);
}

/** A potion from an unfinished one may come with four doses, and its secondary may be kept. */
function mix(request) {
  const { player } = request;
  const percent = value(player, "mixologist");
  if (percent === null || /\(unf\)$/i.test(itemName(request.productId))) return;
  const level = Fragments.equippedLevel(player, effects().mixologist.fragment);
  const save = effects().mixologist.secondarySavePercent[level - 1];
  // The recipe's first ingredient is what the potion is mixed from (a potion, or a base such as the
  // haemostatic poultice); only the others are secondaries, and a dosed or unfinished one never is.
  request.consume.forEach((item, index) => {
    if (index > 0 && !isPotion(item.id) && chance(save)) item.count = 0;
  });
  const upgrade = request.consume.some((item) => /\(\d\)$/.test(itemName(item.id)));
  const product = request.recipe?.product;
  if (upgrade || typeof product !== "string" || !product.startsWith("3dose") || !chance(percent)) return;
  const fourDose = core().CacheDefinitions.getObjId(`4dose${product.slice(5)}`);
  if (!Number.isInteger(fourDose)) return;
  request.productId = fourDose;
  // The dose is the fragment's: an amulet of chemistry that answered first spends no charge on it.
  request.extraDose = false;
}

// ---- Rooty Tooty 2x Runeys, Plank Stretcher, Enchanted Jeweler, Rumple-Bow-String, Alchemaniac ----

/** Each rune crafted has the chance of another. */
function moreRunes(request) {
  const { player } = request;
  const percent = value(player, "rootyTooty");
  if (percent === null) return;
  const runes = (Number(request.rolls) || 0) * (Number(request.amountPerEssence) || 0);
  let extra = 0;
  for (let rune = 0; rune < runes; rune++) if (chance(percent)) extra++;
  if (extra > 0) player.getInventory().forceAdd(player, new (core().Item)(request.runeId, extra));
}

/** A build's planks are kept at the chance. */
function keepPlanks(request) {
  const percent = value(request.player, "plankStretcher");
  if (percent === null || !chance(percent)) return;
  const material = effects().plankStretcher.material;
  request.materials = request.materials.map(([itemId, amount]) => [itemId, itemName(itemId).toLowerCase().endsWith(material) ? 0 : amount]);
}

/** More pieces of jewellery a cast (not a quest's enchanted items). */
function enchantPieces(request) {
  const name = itemName(request.itemId).toLowerCase();
  if (!effects().enchantedJeweler.jewellery.some((kind) => name.includes(kind))) return;
  const pieces = value(request.player, "enchantedJeweler");
  if (pieces !== null) request.pieces = Math.max(request.pieces, pieces);
}

function spinFlax(request) {
  if (request.spellName !== effects().rumpleBowString.spell) return;
  const batch = value(request.player, "rumpleBowString");
  if (batch !== null) request.batch = Math.max(request.batch, batch);
}

function alchemy(policy) {
  if (!policy.high) return;
  const percent = value(policy.player, "alchemaniac");
  if (percent !== null && policy.coins > 0) policy.coins = Math.floor((policy.coins * (100 + percent)) / 100);
}

// ---- Unchained Talent ----

/** Every tick: the non-combat skills at least `boost` over their level while the set is on; back to their level once it is off. */
function unchainedTalent({ player }) {
  const { set, boost, skills } = effects().unchainedTalent;
  const on = Fragments.setTier(player, set) > 0;
  if (!on && !boosted.has(player)) return;
  const manager = player.getSkillManager();
  for (const name of skills) {
    const skill = core().Skill[name];
    const max = manager.getMaxLevel(skill);
    const current = manager.getCurrentLevel(skill);
    if (on && current < max + boost) manager.setCurrentLevel(skill, max + boost, true);
    else if (!on && current > max) manager.setCurrentLevel(skill, max, true);
  }
  if (on) boosted.add(player);
  else boosted.delete(player);
}

module.exports = function attach(api) {
  api.onCustomEvent("skills:actions-per-cycle", allAtOnce);
  api.onCustomEvent("skills:produced", produced);
  api.onCustomEvent("herblore:mix", mix);
  api.onCustomEvent("runecrafting:success", moreRunes);
  api.onCustomEvent("construction:materials", keepPlanks);
  api.onCustomEvent("magic:enchant-pieces", enchantPieces);
  api.onCustomEvent("magic:spell-batch", spinFlax);
  api.onCustomEvent("magic:alchemy-policy", alchemy);
  api.onCustomEvent("league:fragment-tick", unchainedTalent);
};

module.exports._test = { allAtOnce, produced, mix, moreRunes, keepPlanks, enchantPieces, spinFlax, alchemy, unchainedTalent };
