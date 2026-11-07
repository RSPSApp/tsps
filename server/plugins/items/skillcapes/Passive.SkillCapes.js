/**
 * Skillcape perks that hook another plugin's or the core's event (Wiki: Cape of Accomplishment):
 *
 * - Mining: a worn Mining cape gives a 5% chance of an extra ore from rocks up to adamantite
 *   ("mining:extra-ore").
 * - Hitpoints: a worn Hitpoints cape heals a point every 30 seconds instead of every minute, as
 *   Rapid Heal does; the two do not stack ("stats:hitpoints-regen").
 *
 * The rest are asked for by their own plugins through "skillcape:has-perk".
 */
const Capes = require("./Common.SkillCapes");

const EXTRA_ORE_CHANCE = 0.05;
const EXTRA_ORE_MAX_LEVEL = 70;
// rsprox captures 3139 and 3165 (rev 232), spam after the ore line.
const EXTRA_ORE_MESSAGE = "Your cape allows you to mine an additional ore.";

function extraOre(request) {
  if (request.rockLevel > EXTRA_ORE_MAX_LEVEL || !Capes.hasPerk(request.player, "MINING")) return;
  if (Math.random() < EXTRA_ORE_CHANCE) {
    request.bonuses.push({ message: EXTRA_ORE_MESSAGE });
  }
}

function hitpointsRegen(regen) {
  if (Capes.hasPerk(regen.player, "HITPOINTS")) regen.fast = true;
}

module.exports = function attachPassive(api) {
  api.onCustomEvent("mining:extra-ore", extraOre);
  api.onCustomEvent("stats:hitpoints-regen", hitpointsRegen);
};

module.exports._test = { extraOre, hitpointsRegen };
