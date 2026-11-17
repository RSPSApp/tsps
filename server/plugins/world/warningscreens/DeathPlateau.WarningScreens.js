/**
 * The Death Plateau notice (warning 24, cws_warning_24 581): it opens as the player walks into the
 * trail's map zone north of Burthorpe, 2832-2839 x 3592-3599. The four rsprox recordings that show it
 * (local 1001676 and 1001683, rev 241; 1001997 and 1001800, rev 242) open it on the first step into that
 * zone, from the west (2831,3597 to 2833,3599 at 1001800 tick 25304) and from the south (2839,3591 to
 * 2839,3593 in 1001997), and again on later visits (1001676 counts it 4 to 5). Each opens the tick after
 * that step (1001800 25304 -> 25305, 1001997 24697 -> 24698, 1001683 3711 -> 3712, 1001676 3428 -> 3429).
 * It only informs, so Screens.WarningScreens.js opens it and lets the player walk on.
 */
const DEATH_PLATEAU_WARNING = 24;
const OPEN_DELAY_TICKS = 1;

function warn(api, mobile, area) {
  if (!mobile.isPlayer()) return;
  const player = mobile.getAsPlayer();
  const { TaskManager, CountdownTask } = api.core;
  TaskManager.submit(new CountdownTask(player, OPEN_DELAY_TICKS, () => {
    // Walked straight back out, or logged out, meanwhile: nothing to warn about.
    if (!player.isRegistered?.() || player.getArea?.() !== area) return;
    api.emitCustomEvent("warning-screen:show", { player, warning: DEATH_PLATEAU_WARNING });
  }));
}

function createArea(api) {
  class DeathPlateauWarningArea extends api.core.Area {
    postEnter(mobile) {
      warn(api, mobile, this);
    }
  }
  return new DeathPlateauWarningArea([new api.core.Boundary(2832, 2839, 3592, 3599, 0)]);
}

module.exports = function attach(api) {
  api.registerArea(createArea(api));
};
