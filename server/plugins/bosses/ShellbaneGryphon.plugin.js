/**
 * The Shellbane gryphon (https://oldschool.runescape.wiki/w/Shellbane_gryphon), from
 * plugins/bosses/data/shellbane-gryphon.json: its private cave under the Great Conch, its attacks,
 * the knockback, spit and whirlwind specials, and the kill. Each lives in ./shellbane/.
 */
const Common = require("./shellbane/Common.ShellbaneGryphon");
const Cave = require("./shellbane/Cave.ShellbaneGryphon");
const Combat = require("./shellbane/Combat.ShellbaneGryphon");
const Kills = require("./shellbane/Kills.ShellbaneGryphon");

module.exports = {
  name: "ShellbaneGryphon",
  description: "The Shellbane gryphon: its private cave under the Great Conch, its attacks, knockback, spit and whirlwind specials, and the kill.",
  members: true,
  register(api) {
    Common.init(api);
    Cave.attach(api);
    Combat.attach(api);
    Kills.attach(api);
  },
};
