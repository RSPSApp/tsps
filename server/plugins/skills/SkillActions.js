/** Holds a skill's existing session through a level-up dialogue, without restarting its work. */
function pauseForLevelUp(event, sessions, stop, onResume) {
  const { player } = event;
  const session = sessions.get(player);
  if (!session) return;
  if (!event.pause) return stop(player);
  session.levelUpPaused = true;
  event.pause(session, () => {
    if (sessions.get(player) !== session) return;
    session.levelUpPaused = false;
    onResume?.(session);
  }, () => {
    if (sessions.get(player) === session) stop(player);
  });
}

/**
 * A gathering session skips this tick, keeping its state: a level-up dialogue holds it
 * (pauseForLevelUp), and so does a busy main modal (the diary journal, the CA overview), which
 * live pauses a chop, a catch or a swing under and resumes after closing without a re-click
 * (rsprox 227/01757 t8544-8548, 227/00555 t24898-24918, 227/00562 t153-177;
 * docs/interface-interruption.md). Its clocks are not advanced, so a roll that fell due goes off
 * on the first tick after.
 */
function isPaused(session, player) {
  return session.levelUpPaused === true || player?.inBusyModal?.() === true;
}

/**
 * Ticks to a skill's next repeated action (a roll, a made item, an offering, a cast):
 * `ticks` unless content lowers it ("skills:action-interval" { player, skill, kind, ticks },
 * a league relic's 2-tick pace). `emitter` is the plugin api (or anything with emitCustomEvent);
 * `kind` names the loop. `saving` is a tool's ticks off the pace (a fletching knife's one), taken
 * after content's answer so the two stack. Never under 1.
 */
function actionInterval(emitter, player, skill, kind, ticks, saving = 0) {
  const request = { player, skill, kind, ticks };
  emitter?.emitCustomEvent("skills:action-interval", request);
  return Math.max(1, (request.ticks | 0) - saving);
}

module.exports = { pauseForLevelUp, isPaused, actionInterval };
