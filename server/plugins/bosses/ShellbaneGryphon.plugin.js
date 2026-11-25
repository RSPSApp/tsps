/**
 * The Shellbane gryphon (https://oldschool.runescape.wiki/w/Shellbane_gryphon), from
 * plugins/bosses/data/shellbane-gryphon.json: its private cave under the Great Conch, its attacks,
 * the knockback, spit and whirlwind specials, the kill, and Elder Nama's rules and scoreboard. Each lives in ./shellbane/.
 */
const Common = require("./shellbane/Common.ShellbaneGryphon");
const Cave = require("./shellbane/Cave.ShellbaneGryphon");
const Combat = require("./shellbane/Combat.ShellbaneGryphon");
const Kills = require("./shellbane/Kills.ShellbaneGryphon");
const Nama = require("./shellbane/Nama.ShellbaneGryphon");
const Scoreboard = require("./shellbane/Scoreboard.ShellbaneGryphon");


function describeEncounters({ npcIds }) {
  npcIds.add(Common.ids.npcs.boss);
}

module.exports = {
  name: "ShellbaneGryphon",
  description: "The Shellbane gryphon: its private cave under the Great Conch, its attacks, knockback, spit and whirlwind specials, the kill, and Elder Nama's clue-step entry and Statistics scoreboard.",
  members: true,
  register(api) {
    api.onCustomEvent("bestiary:encounters", describeEncounters);
    Common.init(api);
    Cave.attach(api);
    Combat.attach(api);
    Kills.attach(api);
    Nama.attachNama(api);
    Scoreboard.attachScoreboard(api);
  },
};
