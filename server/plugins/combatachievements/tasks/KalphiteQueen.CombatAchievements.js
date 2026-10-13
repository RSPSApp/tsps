/** The Kalphite Queen's fight: both forms are one fight (she transforms, she does not die). */
module.exports = function attachKalphiteQueenTasks(_api, Fights) {
  Fights.onKill("Kalphite Queen", { "Prayer Smasher": (fight) => fight.onlyWeaponsNamed("Verac's flail") });
};
