/**
 * The Alchemical Hydra's fight tasks (cache task structs; Wiki: Alchemical Hydra/Strategies). Its
 * poison, lightning and fire hit as plain damage, not as its attacks, so Fight.AlchemicalHydra.js
 * keeps what these read (lifeOf), and the chamber counts its kills since the player came in:
 * - Unrequired Antipoisons, Lightning Lure, Don't Flame Me: "... without being hit by the acid pool
 *   / lightning / flame wall attack." The acid's splash and its pools, a current reaching the player,
 *   and the fire's walls, tracking flame and burn are each that attack's hits;
 * - Mixing Correctly: "Kill the Alchemical Hydra without empowering it." (the wrong vent);
 * - The Flame Skipper: "... without letting it spawn a flame wall attack.";
 * - Alcleanical Hydra: "... without taking any damage.", its specials' damage included;
 * - No Pressure: "... using only Dharok's Greataxe as a weapon whilst having no more than 10
 *   Hitpoints throughout the entire fight.";
 * - Working Overtime: "Kill the Alchemical Hydra 15 times without leaving the room."
 * The Hydra is one of data/monsters.json's ownRules, as its special damage would pass the derived
 * "without taking any damage" rule, so its two speed tasks are ruled here too.
 */
const { lifeOf, peakHitpointsSince } = require("../../../bosses/alchemicalhydra/Fight.AlchemicalHydra");

/** "in less than 1 minute 45 seconds" and "in less than 1 minute 20 seconds". */
const SPEED_CHASER_SECONDS = 105;
const SPEED_RUNNER_SECONDS = 80;
const NO_PRESSURE_HITPOINTS = 10;
const WORKING_OVERTIME_KILLS = 15;

const life = (fight) => lifeOf(fight.npc);
const notHitBy = (kind) => (fight) => {
  const record = life(fight);
  return Boolean(record) && (record.hits[kind].get(fight.player) ?? 0) === 0;
};

module.exports = function attachAlchemicalHydraTasks(api, Fights) {
  const tick = () => api.core.World.getProcessCycle();
  Fights.onKill("Alchemical Hydra", {
    "Alchemical Speed-Chaser": (fight) => fight.within(SPEED_CHASER_SECONDS),
    "Alchemical Speed-Runner": (fight) => fight.within(SPEED_RUNNER_SECONDS),
    "Unrequired Antipoisons": notHitBy("acid"),
    "Lightning Lure": notHitBy("lightning"),
    "Don't Flame Me": notHitBy("fire"),
    "Mixing Correctly": (fight) => life(fight)?.empowered === false,
    "The Flame Skipper": (fight) => life(fight)?.fireBreaths === 0,
    "Alcleanical Hydra": (fight) => Boolean(life(fight)) && fight.hitsTaken.every((hit) => hit.damage <= 0)
      && (life(fight).damage.get(fight.player) ?? 0) === 0,
    "No Pressure": (fight) => {
      const peak = peakHitpointsSince(life(fight), fight.player, tick() - fight.ticks);
      return peak !== null && peak <= NO_PRESSURE_HITPOINTS && fight.onlyWeaponsNamed("Dharok's greataxe");
    },
    "Working Overtime": (fight) => (fight.npc?.__hydraLair?.recordKill?.(fight.npc) ?? 0) >= WORKING_OVERTIME_KILLS,
  });
};

module.exports._test = { SPEED_CHASER_SECONDS, SPEED_RUNNER_SECONDS, NO_PRESSURE_HITPOINTS, WORKING_OVERTIME_KILLS };
