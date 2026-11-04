/**
 * Idle Mode (docs/idle-mode.md): an account flag, set with `::idle on`, or on every new account
 * of an idle world (world.json `"pluginConfig": { "IdleMode:newAccounts": true }`). An idle
 * account's woodcutting, mining and fishing never stop: the resources go to the bank, trees and
 * rocks stay standing, fishing spots stay put and random events leave it alone (Gathering). Logging
 * out mid-session keeps going at the rate the player had, paid on the next login (Offline). When
 * the gathering stops, the character walks back to the same kind of tree, rock or spot nearby and
 * starts again (Auto). The same goes for fighting a kind of monster, eating and banking the loot
 * (Combat). Idle XP earns points that buy upgrades (Progression).
 * Settings are plugins/modes/data/idle-mode.json.
 */
const Common = require("./idle/Common.IdleMode");

module.exports = {
  name: "IdleMode",
  register(api) {
    Common.init(api);
    require("./idle/Account.IdleMode")(api);
    require("./idle/Gathering.IdleMode")(api);
    require("./idle/Offline.IdleMode")(api);
    require("./idle/Auto.IdleMode")(api);
    require("./idle/Progression.IdleMode")(api);
    require("./idle/Combat.IdleMode")(api);
  },
};
