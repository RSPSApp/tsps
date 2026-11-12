/** Negotiated consumption/prayer/melee-special restrictions; Wiki15379109/cache242 enums919..926. */
const C = require("./Common.ClanWars");
const Food = require("../../items/Food.plugin");
const Potions = require("../../items/Potions.plugin");

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
  if (gameOf(event.player)?.rules.specialattacks !== 2) return;
  event.disabled = true;
  event.message = "Special attacks are disabled in this Clan Wars battle.";
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
}
module.exports = { prepare, attach };
