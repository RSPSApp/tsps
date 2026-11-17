/**
 * The Death Plateau notice (warning 24, cws_warning_24 581): it opens as the player walks into the
 * trail's map zone north of Burthorpe, 2832-2839 x 3592-3599. The four rsprox recordings that show it
 * (local 1001676 and 1001683, rev 241; 1001997 and 1001800, rev 242) open it on the first step into that
 * zone, from the west (2831,3597 to 2833,3599 at 1001800 tick 25305) and from the south (2839,3591 to
 * 2839,3593 in 1001997), and again on later visits (1001676 counts it 4 to 5). It only informs, so
 * Screens.WarningScreens.js opens it and lets the player walk on.
 */
const DEATH_PLATEAU_WARNING = 24;

function warn(api, mobile) {
  if (!mobile.isPlayer()) return;
  api.emitCustomEvent("warning-screen:show", { player: mobile.getAsPlayer(), warning: DEATH_PLATEAU_WARNING });
}

function createArea(api) {
  class DeathPlateauWarningArea extends api.core.Area {
    postEnter(mobile) {
      warn(api, mobile);
    }
  }
  return new DeathPlateauWarningArea([new api.core.Boundary(2832, 2839, 3592, 3599, 0)]);
}

module.exports = function attach(api) {
  api.registerArea(createArea(api));
};
