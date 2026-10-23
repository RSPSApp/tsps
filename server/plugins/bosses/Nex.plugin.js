/**
 * Nex (https://oldschool.runescape.wiki/w/Nex) and the Ancient Prison under the God Wars Dungeon,
 * from plugins/bosses/data/nex.json, as captured: the prison and its doors, the public chamber and
 * private fights, the five-phase fight with her mages and specials, the loot and reclaim chests,
 * the Ancient Forge and Torva repair, and her Combat Achievements. Each part lives in ./nex/.
 * See docs/nex.md.
 */
const Common = require("./nex/Common.Nex");
const Chamber = require("./nex/Chamber.Nex");
const Prison = require("./nex/Prison.Nex");
const Instance = require("./nex/Instance.Nex");
const Fight = require("./nex/Fight.Nex");
const Specials = require("./nex/Specials.Nex");
const Mages = require("./nex/Mages.Nex");
const Reclaim = require("./nex/Reclaim.Nex");
const Items = require("./nex/Items.Nex");
const Forge = require("./nex/Forge.Nex");
const CombatAchievements = require("./nex/CombatAchievements.Nex");
const Commands = require("./nex/Commands.Nex");

module.exports = {
  name: "Nex",
  members: true,
  register(api) {
    Common.init(api);
    // The chamber's Area first: it lies inside the prison's, and the first match wins.
    Chamber.attachChamber(api);
    Prison.attachPrison(api);
    Instance.attachInstance(api);
    Fight.attachFight(api);
    Specials.attachSpecials(api);
    Mages.attachMages(api);
    Reclaim.attachReclaim(api);
    Items.attachItems(api);
    Forge.attachForge(api);
    CombatAchievements.attachCombatAchievements(api);
    Commands.attachCommands(api);
  },
};
