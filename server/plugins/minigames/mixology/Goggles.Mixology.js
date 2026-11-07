"use strict";

/**
 * Prescription goggles, the Mixology Rewards' head slot item: worn, they give a 10% chance to
 * save a potion's secondary ingredients when it is mixed (Wiki: Prescription goggles,
 * https://oldschool.runescape.wiki/w/Prescription_goggles; docs/mastering-mixology.md).
 *
 * - The roll is once per potion, not per ingredient, and nothing is said when it saves.
 * - A secondary is any ingredient after the first that is not a potion or a vial: a skill's own
 *   herb in an antidote+ (unf), a haemostatic dressing's squid paste or cotton yarn, a barbarian
 *   potion's caviar or roe, a weapon poison's berries. Every copy the recipe takes is kept (the
 *   Wiki: one per dose, 20 Zulrah's scales on a four-dose anti-venom).
 * - A torstol potion (unf) in a super combat potion or anti-venom+ is saved too, and keeps its
 *   vial. Crystal dust (divine potions) is never saved.
 *
 * Herblore offers each mix to "herblore:mix" before it takes anything: this unit sets what it
 * keeps to nothing.
 */

const Shared = require("./Shared.Mixology");

const GOGGLES = Shared.DATA.goggles;

let resolved = null;

function ids(names) {
  return new Set(names.map((name) => Shared.core().CacheDefinitions.getObjId(name)));
}

function sets() {
  resolved ??= { worn: ids(GOGGLES.worn), alsoSaved: ids(GOGGLES.alsoSaved), neverSaved: ids(GOGGLES.neverSaved) };
  return resolved;
}

function itemName(itemId) {
  return Shared.core().ItemDefinition.forId(itemId)?.getName?.() ?? "";
}

/** A potion, an unfinished one or a vial: what a recipe starts from, not a secondary. */
function isPotionOrVial(itemId) {
  const name = itemName(itemId);
  return /\(\d\)$/.test(name) || /\(unf\)$/i.test(name) || /^vial\b/i.test(name);
}

function wearing(player) {
  const { Equipment } = Shared.core();
  const head = player.getEquipment?.()?.getItems?.()?.[Equipment.HEAD_SLOT];
  return sets().worn.has(Number(head?.getId?.()));
}

function isSecondary(item, index) {
  const { alsoSaved, neverSaved } = sets();
  if (index === 0 || item.count <= 0 || neverSaved.has(item.id)) return false;
  return alsoSaved.has(item.id) || !isPotionOrVial(item.id);
}

/** A kept torstol potion (unf) keeps its vial: the recipe's returned empty vial is one fewer. */
function keepVial(request, item) {
  if (!isPotionOrVial(item.id)) return;
  const vial = request.returns?.find((returned) => returned.count > 0 && /^vial$/i.test(itemName(returned.id)));
  if (vial) vial.count--;
}

function saveSecondaries(request) {
  if (!wearing(request.player)) return;
  // A vial-of-water step (guam leaf, coral) adds the herb to the vial: no secondary at all.
  if (request.recipe?.ingredients?.some(([name]) => name === "vial_water")) return;
  const secondaries = request.consume.filter(isSecondary);
  if (secondaries.length === 0 || Math.random() >= GOGGLES.secondarySaveChance) return;
  for (const item of secondaries) {
    item.count = 0;
    keepVial(request, item);
  }
}

module.exports = function attachGoggles(api) {
  api.onCustomEvent("herblore:mix", saveSecondaries);
};

Object.assign(module.exports, { saveSecondaries });
