/**
 * The Brimhaven Dungeon: Saniboch's entry fee, the dungeon entrance and the vines.
 *
 * - The entry: Entry.BrimhavenDungeon.js (Saniboch's Talk-to conditions and payments, his Pay
 *   option and the entrance's, and Enter).
 * - The vines: Vines.BrimhavenDungeon.js (Chop-down, with an axe going deeper, by hand going out).
 *
 * The exit is a loc teleport (plugins/world/data/loc-teleports.json, karam_dungeon_exit).
 */
const Entry = require("./brimhavendungeon/Entry.BrimhavenDungeon");
const Vines = require("./brimhavendungeon/Vines.BrimhavenDungeon");

module.exports = {
  name: "BrimhavenDungeon",
  description: "Brimhaven Dungeon access: Saniboch's entry fee, the dungeon entrance and the vines that need an axe to go deeper.",
  members: true,
  _test: { Entry, Vines },
  register(api) {
    Entry.attach(api);
    Vines.attach(api);
  },
};
