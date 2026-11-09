/**
 * The escape crystal (22517, tob_teleport) outside the Theatre of Blood and the Tombs of Amascut,
 * whose own units keep theirs (Wiki: Escape crystal). Units:
 *  - Common: the crystal, its settings (the Theatre unit's `escape-crystal:settings`), Auto-afk and
 *    ring-of-life checks
 *  - Activation: Teleport, firing on a hit, and where it works (activities, the Wilderness up to
 *    level 30, anywhere a game mode allows)
 */
const Common = require("./escapecrystal/Common.EscapeCrystal");

module.exports = {
  name: "EscapeCrystal",
  register(api) {
    Common.bind(api);
    require("./escapecrystal/Activation.EscapeCrystal")(api);
  },
};
