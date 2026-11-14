/**
 * Drygore blowpipe (https://oldschool.runescape.wiki/w/Drygore_blowpipe), a Leagues VI (Demonic
 * Pacts) echo item from Echo Kalphite Queen: a two-handed thrown weapon loaded with darts and
 * nothing else, no poisoned ones (the ToxicBlowpipe plugin loads, unloads and fires it; RangedData
 * DRYGORE_BLOWPIPE). +50 ranged attack, +10 ranged strength loaded; 3 ticks (2 on Rapid), 6 tiles
 * (8 on Longrange): the cache's. Its attack plays drygore_blowpipe_attack and the dart's own
 * projectile, as the Raging Echoes League's version (the same item, without the burn) does live.
 *
 * Passives, a Leagues VI character's only (Wiki: Drygore blowpipe; Demonic Pacts League/Echo
 * bosses and echo equipment):
 * - Accuracy: as Osmumten's fang, two attack rolls against the one defence roll; the attack hits
 *   if either beats it. onCombatHitRoll can only force a hit, so it forces one at the chance that
 *   lifts the core's single roll to the two-roll chance: (p2 - p1) / (1 - p1). Every ranged roll
 *   made with the pipe wielded has it, a pact echo's too.
 * - Burn: a 25% chance on a landed hit to start a burn (Burns plugin, its usual damage). Ours:
 *   not from a pact echo (no attack of the pipe's).
 */
const BURN_CHANCE = 0.25;
const ATTACK_SEQUENCE = "drygore_blowpipe_attack";

let core;
let pluginApi;

/** Leagues VI (Demonic Pacts) item: its effects are a Leagues VI character's only (LeagueMode's `league:profile`). */
const LEAGUE_VI = 6;
function inLeagueSix(player) {
  const query = { player, league: null };
  pluginApi.emitCustomEvent("league:profile", query);
  return Number(query.league) === LEAGUE_VI;
}

function wieldsDrygore(player) {
  const weapon = player?.getEquipment?.().get?.(core.Equipment.WEAPON_SLOT);
  return weapon?.getId?.() === core.ItemIdentifiers.DRYGORE_BLOWPIPE && inLeagueSix(player);
}

/**
 * The chance a uniform attack roll in [0, attack] beats a uniform defence roll in [0, defence]
 * (the core's roll: attack > defence) when the attack is rolled `rolls` times and the highest kept.
 * P(miss) is the mean over the defence roll d of P(every attack roll <= d) = ((min(d, attack) + 1) / (attack + 1))^rolls.
 */
function hitChance(attack, defence, rolls) {
  const a = Math.max(0, Math.floor(attack));
  const d = Math.max(0, Math.floor(defence));
  const below = Math.min(d, a) + 1;
  // sum over k = 1..below of k^rolls, then (d - a) more defence rolls that every attack roll is under.
  const powerSum = rolls === 1 ? (below * (below + 1)) / 2 : (below * (below + 1) * (2 * below + 1)) / 6;
  const rest = Math.max(0, d - a) * Math.pow(a + 1, rolls);
  return 1 - (powerSum + rest) / (Math.pow(a + 1, rolls) * (d + 1));
}

/** Two attack rolls against one defence roll: forces the hit at the extra chance the second roll gives. */
function doubleAccuracy(event) {
  const { attacker, target } = event;
  if (event.forceAccurate || event.combatType !== core.CombatType.RANGED || !attacker?.isPlayer?.() || !target) return;
  if (!wieldsDrygore(attacker.getAsPlayer())) return;
  const rolls = core.AccuracyFormulasDpsCalc.specialRolls(attacker, target, core.CombatType.RANGED);
  if (!rolls) return;
  const single = hitChance(rolls.attack, rolls.defence, 1);
  if (single >= 1) return;
  const double = hitChance(rolls.attack, rolls.defence, 2);
  if (Math.random() < (double - single) / (1 - single)) event.forceAccurate = true;
}

function isPactEcho(hit) {
  const query = { hit, echo: false };
  pluginApi.emitCustomEvent("league:pact-echo-hit", query);
  return query.echo === true;
}

/** Whether the hit was fired from the pipe (its fired-shot snapshot; unknown is not). */
function firedFromDrygore(hit) {
  return hit?.getFiredRangedShot?.()?.weapon?.getId?.() === core.ItemIdentifiers.DRYGORE_BLOWPIPE;
}

/** A landed hit fired from the pipe may set the target burning, whatever is worn when it lands. */
function burnOnHit({ attacker, target, hit }) {
  if (!attacker?.isPlayer?.() || !target || hit?.getCombatType?.() !== core.CombatType.RANGED || !hit.isAccurate?.()) return;
  if (!firedFromDrygore(hit) || !inLeagueSix(attacker.getAsPlayer()) || isPactEcho(hit) || target.getHitpoints() <= 0) return;
  if (Math.random() >= BURN_CHANCE) return;
  pluginApi.emitCustomEvent("combat:burn", { attacker, target });
}

function initialize(api) {
  core = api.core;
  pluginApi = api;
  const animation = core.CacheDefinitions.getSeqId(ATTACK_SEQUENCE);
  if (animation !== null) {
    api.registerWeaponProfile({
      itemIds: [core.ItemIdentifiers.DRYGORE_BLOWPIPE, core.ItemIdentifiers.DRYGORE_BLOWPIPE_EMPTY_],
      attackAnimation: animation,
    });
  }
}

module.exports = {
  name: "DrygoreBlowpipe",
  members: true,
  register(api) {
    initialize(api);
    api.onCombatHitRoll(doubleAccuracy);
    api.onCombatHitResolved(burnOnHit);
  },
  _test: { hitChance, doubleAccuracy, burnOnHit },
};
