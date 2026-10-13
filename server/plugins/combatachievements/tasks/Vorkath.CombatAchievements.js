/** Vorkath's fight rules; her timing, specials and streaks are the Vorkath plugin's. */
module.exports = function attachVorkathTasks(_api, Fights) {
  Fights.onKill("Vorkath", {
    "Stick 'em With the Pointy End": (fight) => fight.onlyMelee(),
    "The Fremennik Way": (fight) => fight.onlyMelee() && fight.onlyWeapons(-1),
  });
  // Crumble undead is a spell: a kill without magic did not use it.
  Fights.onKill("Zombified Spawn", { "Zombie Destroyer": (fight) => fight.dealt.length > 0 && !fight.dealt.some((hit) => hit.type === "MAGIC") });
};
