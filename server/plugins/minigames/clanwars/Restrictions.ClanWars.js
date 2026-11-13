/** Negotiated consumption/prayer/melee-special restrictions; Wiki15379109/cache242 enums919..926. */
const C = require("./Common.ClanWars");
const Food = require("../../items/Food.plugin");
const Potions = require("../../items/Potions.plugin");
// The four canonical producers share the Wiki's Power of Death. This is the
// Magic Disabled guard, not a claim about No Staff's taxonomy with Magic enabled.
const POWER_OF_DEATH_SPECIAL_IDS = new Set([
  "staff_of_the_dead", "toxic_staff_of_the_dead", "staff_of_light", "staff_of_balance",
]);

function gameOf(player) {
  const game = C.matches.get(player);
  return game && game.phase !== "over" && game.members.has(player) && player.getArea() === game.area ? game : null;
}
function prayerForbidden(rules, prayer) {
  return rules.prayer === 2 || rules.prayer === 1 && prayer.hint !== -1;
}
function canEat(event) {
  const game = gameOf(event.player);
  if (!game) return;
  const food = Food.foodBite(event.itemId)?.food;
  // Food's canonical backend also owns Drink-option consumables. Potions that
  // already request food permission retain that existing healing-drink policy.
  // Passive consumers are not reclassified as food by this activity.
  if (food?.option === "Drink" && game.rules.drinks === 1
    || game.rules.food === 1 && (food || Potions.isPotionItem(event.itemId))) event.allow = false;
}
function canDrink(event) {
  if (gameOf(event.player)?.rules.drinks === 1) event.allow = false;
}
function noPrayer(event) {
  const game = gameOf(event.player);
  if (!game || !prayerForbidden(game.rules, event.prayer)) return;
  event.disabled = true;
  event.message = game.rules.prayer === 1 ? "Overhead prayers are disabled in this Clan Wars battle."
    : "Prayers are disabled in this Clan Wars battle.";
}
function noSpecial(event) {
  const game = gameOf(event.player);
  if (!game) return;
  if (game.rules.specialattacks === 2) {
    event.disabled = true;
    event.message = "Special attacks are disabled in this Clan Wars battle.";
  } else if (game.rules.magic === MAGIC_DISABLED && POWER_OF_DEATH_SPECIAL_IDS.has(event.specialAttackId)) {
    // Utility specials run before ordinary target-attack policy. The event names
    // the resolved special, so a staff does not wrongly block a shield's utility.
    event.disabled = true;
    event.message = "Power of Death is unavailable while Magic is disabled in this Clan Wars battle.";
  }
}
// Rev242 clanwars_setup magic choices: All spellbooks, Standard spells, Classic F2P, Binding only, Disabled.
const MAGIC_DISABLED = 4;
/**
 * Magic Disabled (Wiki: "No magical combat is allowed"): combat spells are refused by the arena's canAttack, but
 * Lunar, Ancient and Arceuus spells cast on oneself or a teammate (Vengeance, Vengeance Other, Heal Other, thralls)
 * never reach it. The Wiki's "Standard spells" choice already allows only the standard spellbook, so the stricter
 * Disabled refuses every other book, in staging too (a Vengeance cast there reflects in the battle).
 */
function noSpellbookMagic(event) {
  const game = gameOf(event.player);
  if (!game || game.rules.magic !== MAGIC_DISABLED || event.spellbook === C.core.MagicSpellbook.NORMAL) return;
  event.disabled = true;
  // No capture of the live refusal; worded as the plugin's other restriction messages.
  event.player.sendMessage("Magic is disabled in this Clan Wars battle.");
}
function prepare(player, rules) {
  const { PrayerData, PrayerHandler, CombatSpecial } = C.core;
  // Activation checks do not revisit prayers already active on entry.
  for (const [id, prayer] of PrayerData.prayerData) {
    if (player.getPrayerActive()[id] && prayerForbidden(rules, prayer)) PrayerHandler.deactivatePrayer(player, id, false);
  }
  // Combat.reset() clears a target/queued swing, but does not disarm the toggle.
  if (rules.specialattacks === 2 && player.isSpecialActivated()) {
    player.setSpecialActivated(false);
    CombatSpecial.updateBar(player);
  }
}
function attach(api) {
  api.onCanEat(canEat);
  api.onCanDrink(canDrink);
  api.onPrayerDisabled(noPrayer);
  api.onSpecialAttackDisabled(noSpecial);
  api.onSpellDisabled(noSpellbookMagic);
}
module.exports = { prepare, attach };
