/**
 * Cerberus' fight tasks (cache task structs; Wiki: Cerberus/Strategies). Her souls and lava pools
 * hit as plain damage, not as her attacks, so Fight.Cerberus.js keeps what these read (lifeOf):
 * - Arooo No More: "Kill Cerberus without any of the Summoned Souls being spawned.";
 * - Ghost Buster: "Kill Cerberus after successfully negating 6 or more attacks from Summoned Souls."
 *   A soul's attack is negated by praying against it as it attacks (Wiki);
 * - Unrequired Antifire: "Kill Cerberus without taking damage from any lava pools.";
 * - Anti-Bite Mechanics: "Kill Cerberus without taking any melee damage." Her bites (the triple
 *   attack's last hit among them) and the melee soul's hit both count.
 * Her kill-count tasks are counted with her kills (Kills.Cerberus.js).
 */
const { lifeOf } = require("../../../bosses/cerberus/Fight.Cerberus");

const GHOST_BUSTER_NEGATED = 6;

const life = (fight) => lifeOf(fight.npc);
const mine = (map, player) => map?.get(player) ?? 0;

module.exports = function attachCerberusTasks(_api, Fights) {
  Fights.onKill("Cerberus", {
    "Arooo No More": (fight) => life(fight)?.soulsSummoned === 0,
    "Ghost Buster": (fight) => mine(life(fight)?.negated, fight.player) >= GHOST_BUSTER_NEGATED,
    "Unrequired Antifire": (fight) => Boolean(life(fight)) && mine(life(fight).lavaDamage, fight.player) === 0,
    "Anti-Bite Mechanics": (fight) => Boolean(life(fight)) && fight.damageTakenOfType("MELEE") === 0
      && mine(life(fight).meleeSoulDamage, fight.player) === 0,
  });
};

module.exports._test = { GHOST_BUSTER_NEGATED };
