/**
 * The PvP tutorial's active-tutorial varp, `pvptut_active_tutorial`: -1 while no tutorial runs. The
 * client's spell-requirement script (cache script 19, through script 234) counts the tutorial's
 * own runes instead of the player's while it isn't -1 and the player stands in an instance
 * (x >= 6400), which includes every boat deck. Varps start at 0 on login, so it is set to -1 then.
 * Ours: this server has no PvP tutorial, so no tutorial is ever active.
 */
const ACTIVE_TUTORIAL_VARP = "pvptut_active_tutorial";
const NO_TUTORIAL = -1;

let core;

function noActiveTutorial({ player }) {
  const varp = core.CacheDefinitions.getVarpId(ACTIVE_TUTORIAL_VARP);
  if (varp !== null) player.getPacketSender().sendConfig(varp, NO_TUTORIAL);
}

module.exports = {
  name: "PvpTutorial",
  description: "No PvP tutorial is active, so spells count the player's own runes in instances and on boats.",
  register(api) {
    core = api.core;
    api.onPlayerLogin(noActiveTutorial);
  },
  _test: { noActiveTutorial },
};
