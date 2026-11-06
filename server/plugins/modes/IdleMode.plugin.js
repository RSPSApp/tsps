/**
 * Idle Mode (docs/idle-mode.md): an account flag, set with `::idle on`, or on every new account
 * of an idle world (world.json `"pluginConfig": { "IdleMode:newAccounts": true }`). An idle
 * account's woodcutting, mining, fishing and thieving never stop: the resources go to the bank, trees and
 * rocks stay standing, fishing spots stay put, stalls stay stocked and random events leave it alone (Gathering,
 * Thieving). Logging
 * out mid-session keeps going at the rate the player had, paid on the next login (Offline). When
 * the gathering stops, the character walks back to the same kind of tree, rock or spot nearby and
 * starts again (Auto). The same goes for fighting a kind of monster, eating and banking the loot
 * (Combat), and for making things from the bank: cooking, smithing, fletching, firemaking
 * (Production). Idle XP
 * earns points that buy upgrades (Progression). `::idle` opens a screen with
 * all of it and the switches (Screen), and `::idle travel` teleports to an activity's site, where
 * the character starts by itself (Travel, TravelScreen). The first time an account is idle it gets
 * a starter kit, a welcome and the Idle screen (Onboarding); the journal tab's Idle button opens
 * the screen too. Three daily goals pay idle points (Goals), and so do
 * permanent milestones (Achievements).
 * Settings are plugins/modes/data/idle-mode.json.
 */
const Common = require("./idle/Common.IdleMode");

module.exports = {
  name: "IdleMode",
  register(api) {
    Common.init(api);
    require("./idle/Account.IdleMode")(api);
    require("./idle/Gathering.IdleMode")(api);
    require("./idle/Thieving.IdleMode")(api);
    require("./idle/Offline.IdleMode")(api);
    require("./idle/Auto.IdleMode")(api);
    require("./idle/Progression.IdleMode")(api);
    require("./idle/Combat.IdleMode")(api);
    require("./idle/Bosses.IdleMode")(api);
    require("./idle/Production.IdleMode")(api);
    require("./idle/Bonfires.IdleMode")(api);
    require("./idle/Goals.IdleMode")(api);
    require("./idle/Achievements.IdleMode")(api);
    require("./idle/Hiscores.IdleMode")(api);
    require("./idle/Screen.IdleMode")(api);
    require("./idle/Hud.IdleMode")(api);
    require("./idle/TravelScreen.IdleMode")(api);
    require("./idle/Onboarding.IdleMode")(api);
  },
};
