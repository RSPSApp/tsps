/** The Barrows brothers' fights. The chest's tasks are the Barrows plugin's. */
const BROTHERS = ["Ahrim the Blighted", "Dharok the Wretched", "Guthan the Infested", "Karil the Tainted", "Torag the Corrupted", "Verac the Defiled"];

module.exports = function attachBarrowsTasks(_api, Fights) {
  for (const brother of BROTHERS) Fights.onKill(brother, { "Defence? What Defence?": (fight) => fight.only("MAGIC") });
  Fights.onKill("Karil the Tainted", { "Just Like That": (fight) => fight.onlySpecials() });
};
