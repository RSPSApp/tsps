/**
 * The Crazy archaeologist's Combat Achievement that the fight decides. I'd Rather Not Learn (Wiki:
 * "Kill the Crazy Archaeologist without anyone being hit by his 'Rain of Knowledge' attack"): the
 * boss (CrazyArchaeologist.plugin.js) stamps the tick a book last landed on any player. The task
 * holds when none landed since this player's fight began, so a bystander's hit during the fight
 * breaks it too ("anyone"), and a hit before the fight started (an earlier fight) does not.
 * "Mage of the Ruins" (only magical attacks) needs no unit: DerivedRules reads it from its description.
 */
const { RAIN_HIT_ATTRIBUTE } = require("../../../bosses/CrazyArchaeologist.plugin");

module.exports = function attachCrazyArchaeologistTasks(api, Fights) {
  Fights.onKill("Crazy Archaeologist", {
    "I'd Rather Not Learn": (fight) => {
      const lastRainHit = fight.npc.getAttribute?.(RAIN_HIT_ATTRIBUTE);
      const fightStart = api.core.World.getProcessCycle() - fight.ticks;
      return !(Number(lastRainHit) >= fightStart);
    },
  });
};
