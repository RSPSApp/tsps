/** The Kalphite Queen's fight: both forms are one fight (she transforms, she does not die). */
module.exports = function attachKalphiteQueenTasks(_api, Fights) {
  Fights.onKill("Kalphite Queen", {
    "Prayer Smasher": (fight) => fight.onlyWeaponsNamed("Verac's flail"),
    // Wiki (Chitin Penetrator): any drain counts, a special attack's, a spell's or a black mask's,
    // and one from her first form still counts (the bone dagger opening the fight).
    "Chitin Penetrator": (fight) => fight.loweredDefenceLast(),
    // Wiki (Insect Deflection): Vengeance Other cast on the player counts too.
    "Insect Deflection": (fight) => fight.killedByVengeance(),
  });
};
