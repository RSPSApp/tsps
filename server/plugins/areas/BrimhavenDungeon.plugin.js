/**
 * The Brimhaven Dungeon: Saniboch's entry fee, the dungeon entrance and the vines.
 *
 * - The entry: Entry.BrimhavenDungeon.js (Saniboch's Talk-to conditions and payments, his Pay
 *   option and the entrance's, and Enter).
 * - The back entrance: Backdoor.BrimhavenDungeon.js (Banisoch's 5,000 trading sticks, the hole's
 *   rope down to the bronze dragons with his warning, and the crevice back up).
 * - The vines: Vines.BrimhavenDungeon.js (Chop-down, with an axe going deeper, by hand going out).
 *
 * The exit is a loc teleport (plugins/world/data/loc-teleports.json, karam_dungeon_exit).
 */
const Entry = require("./brimhavendungeon/Entry.BrimhavenDungeon");
const Backdoor = require("./brimhavendungeon/Backdoor.BrimhavenDungeon");
const Vines = require("./brimhavendungeon/Vines.BrimhavenDungeon");

module.exports = {
  name: "BrimhavenDungeon",
  description: "Brimhaven Dungeon access: Saniboch's entry fee, the dungeon entrance, Banisoch's back entrance to the bronze dragons and the vines that need an axe to go deeper.",
  members: true,
  _test: { Entry, Backdoor, Vines },
  register(api) {
    Entry.attach(api);
    Backdoor.attach(api);
    Vines.attach(api);
  },
};
