/**
 * Blackjack combat stun (https://oldschool.runescape.wiki/w/Blackjack#Combat_mechanics): a
 * damaging melee hit rolls 0..damage against 0..the opponent's current hitpoints, and a higher
 * first roll delays their next attack by 1 (oak), 2 (willow) or 3 (maple) ticks. Stuns stack,
 * offensive/defensive (o)/(d) variants share their base tier, and a zero hit never stuns.
 * The thieving knock-out (Lure/Knock-out) is a separate interaction, not a combat effect.
 */
const { asPlayer, weaponName } = require("./GearChecks.EquipmentEffects");

let core;

const STUN_TICKS = [
  ["oak blackjack", 1],
  ["willow blackjack", 2],
  ["maple blackjack", 3],
];

const randomInt = (max) => Math.floor(Math.random() * (max + 1));

function stunTicks(player) {
  const name = weaponName(player);
  return STUN_TICKS.find(([prefix]) => name.startsWith(prefix))?.[1] ?? 0;
}

function stunOpponent({ attacker, target, hit }) {
  const player = asPlayer(attacker);
  const ticks = player ? stunTicks(player) : 0;
  const damage = hit.getTotalDamage?.() ?? 0;
  if (!ticks || damage <= 0 || hit.getCombatType?.() !== core.CombatType.MELEE) return;
  if (randomInt(damage) > randomInt(target.getHitpoints())) target.getCombat().delayAttack(ticks);
}

module.exports = function registerBlackjackEffects(api) {
  core = api.core;
  api.onCombatHitResolved(stunOpponent);
};

module.exports._test = { stunOpponent, stunTicks };
