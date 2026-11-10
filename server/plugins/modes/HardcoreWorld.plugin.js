/**
 * Hardcore Worlds (OSRS, 4 November 2026; docs/hardcore-worlds.md): a world where every
 * character is Hardcore. On a world whose plugin config says `"HardcoreWorld:enabled": true`,
 * every login is the account's Hardcore character (its own save), which starts in Death's Office,
 * leaves for Lumbridge with Death's Escape crystal, is announced to the whole world when it dies,
 * and then chooses to Reset (a brand-new character) or Transfer (out of Hardcore). Units:
 *  - Common: the data, ids, state and the resets file
 *  - Account: login, the welcome line, when a new character starts
 *  - Arrival: Death's Office, the way out and the Escape crystal
 *  - Death: the broadcast and the start of the choice
 *  - Choice: hc_death_choice, Reset and Transfer
 *  - EscapeCrystal: the crystal works anywhere and cleanses (UNVERIFIED)
 * A world without the config loads nothing of it.
 */
const Common = require("./hardcoreworld/Common.HardcoreWorld");

module.exports = {
  name: "HardcoreWorld",
  register(api) {
    if (!Common.init(api)) return;
    require("./hardcoreworld/Account.HardcoreWorld")(api);
    require("./hardcoreworld/Arrival.HardcoreWorld")(api);
    require("./hardcoreworld/Death.HardcoreWorld")(api);
    require("./hardcoreworld/Choice.HardcoreWorld")(api);
    require("./hardcoreworld/EscapeCrystal.HardcoreWorld")(api);
  },
};
