/**
 * The gadderhammer against shades (Wiki: Gadderhammer, Shade (attribute)): each hit has a
 * 1 in 20 chance of dealing double damage, and otherwise deals 25% more. It scales the max hit
 * like the keris does against kalphites, so it stacks with a salve amulet (e) and Void Knight
 * equipment. Shades are the monsters carrying the Wiki's "shade" attribute (Loar, Phrin, Riyl,
 * Asyn, Fiyr and Urium); the Catacombs, Stronghold of Security and Temple Trekking shades do not.
 */
const { Misc } = require("../../../src/main/typescript/elvarg/util/Misc");
const { asPlayer, weaponName, targetHasAttribute, scale } = require("./GearChecks.EquipmentEffects");

const GADDERHAMMER = new Set(["gadderhammer"]);
const SHADE_ATTRIBUTE = "shade";
const DOUBLE_DAMAGE_CHANCE = 20;

function gadderhammerDamage(entity, maxHit) {
  const player = asPlayer(entity);
  if (!player || !GADDERHAMMER.has(weaponName(player)) || !targetHasAttribute(entity, SHADE_ATTRIBUTE)) {
    return maxHit;
  }
  return Misc.randomInclusive(1, DOUBLE_DAMAGE_CHANCE) === 1 ? maxHit * 2 : scale(maxHit, 5, 4);
}

module.exports = function registerGadderhammerEffects(api) {
  api.registerMeleeHitModifier(gadderhammerDamage);
};

module.exports._test = { gadderhammerDamage };
