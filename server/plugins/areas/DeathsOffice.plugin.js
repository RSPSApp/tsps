/**
 * Death's Office: the Death's Domain entrances near the respawn points, a private copy of the
 * office per visit, Death, his item retrieval for graves that collapsed, and Death's Coffer.
 * The items, fees and Coffer balance are the Gravestones plugin's
 * (plugins/world/Gravestones.plugin.js), reached through `gravestones:*` events. See
 * docs/gravestones.md.
 */
module.exports = {
  name: "DeathsOffice",
  description: "Death's Office: the Death's Domain entrances, a private office per visit, Death's item retrieval for collapsed graves and Death's Coffer.",
  register(api) {
    require("./deathsoffice/Instance.DeathsOffice").attach(api);
    require("./deathsoffice/Entrances.DeathsOffice").attach(api);
    require("./deathsoffice/Death.DeathsOffice").attach(api);
    require("./deathsoffice/Retrieval.DeathsOffice").attach(api);
    require("./deathsoffice/Coffer.DeathsOffice").attach(api);
    require("./deathsoffice/Tutorial.DeathsOffice").attach(api);
  },
};
