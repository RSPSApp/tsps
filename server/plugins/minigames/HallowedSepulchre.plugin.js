/**
 * The Hallowed Sepulchre (https://oldschool.runescape.wiki/w/Hallowed_Sepulchre), from
 * plugins/minigames/data/hallowed-sepulchre.json and the rsprox recordings 1862 and 3299: the lobby
 * under Darkmeyer, five timed floors each in an instance of its own, their Agility and skill
 * obstacles, their traps, the coffins and the obelisks. Each part lives in ./hallowedsepulchre/.
 */
const Common = require("./hallowedsepulchre/Common.HallowedSepulchre");

module.exports = {
  name: "HallowedSepulchre",
  description: "Adds the Hallowed Sepulchre: the lobby under Darkmeyer and five timed floors of Agility obstacles, traps, coffins and obelisks.",
  config: {
    "HallowedSepulchre:agilityRequirements": {
      type: "boolean", label: "Floors need their Agility level", default: true,
      help: "As on the Wiki, entering needs 52 Agility and each floor's stairs the next floor's level (62, 72, 82, 92). Turn off to let any level in and down. The Grand Hallowed Coffin's Thieving or Agility requirement stays.",
    },
  },
  members: true,
  register(api) {
    Common.init(api);
    const { attributes } = Common.data;
    api.persistAttribute(attributes.tutorial, false);
    api.persistAttribute(attributes.entryCheck, false);
    api.persistAttribute(attributes.shards, false);
    api.persistAttribute(attributes.completions);
    api.persistAttribute(attributes.pbs);
    api.persistAttribute(attributes.chests, 0);
    api.persistAttribute(attributes.return);
    require("./hallowedsepulchre/Run.HallowedSepulchre").attachRun(api);
    require("./hallowedsepulchre/Lobby.HallowedSepulchre").attachLobby(api);
    require("./hallowedsepulchre/Obstacles.HallowedSepulchre").attachObstacles(api);
    require("./hallowedsepulchre/Skills.HallowedSepulchre").attachSkills(api);
    require("./hallowedsepulchre/Coffins.HallowedSepulchre").attachCoffins(api);
  },
};
