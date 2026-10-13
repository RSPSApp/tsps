/** Obor's and Bryophyta's fights; their chests and free-world kills are the lairs' (GiantLairs). */
module.exports = function attachGiantLairsTasks(_api, Fights) {
  Fights.onKill("Bryophyta", { "Protection from Moss": (fight) => fight.prayedAtKill("PROTECT_FROM_MAGIC") });
  Fights.onKill("Obor", { "Squashing the Giant": (fight) => fight.damageTakenOffPrayer() === 0 });
};
