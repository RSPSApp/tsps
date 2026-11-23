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
 * A gathering session skips this tick, keeping its state, while a level-up dialogue holds it
 * (pauseForLevelUp) or a busy main modal is open (the diary journal, the CA overview).
 */
function isPaused(session, player) {
  return session.levelUpPaused === true || player?.inBusyModal?.() === true;
}

/**
 * What a gathering session does this tick around a busy modal: "paused" while one is open (or a
 * level-up holds it), "restart" on the first tick after it closed, and "run" otherwise. Live
 * starts the action over after the close, without a re-click: its start message and animation,
 * then a full interval to the first roll (rsprox 227/00555 t24917-24920, karambwan:
 * "You lower the Karambwan vessel." on the busy-0 tick; 227/00562 t176-182, mining: a fresh
 * swing two ticks after the close). docs/busy-modals.md.
 */
function modalPause(session, player) {
  if (isPaused(session, player)) {
    if (player?.inBusyModal?.() === true) session.modalPaused = true;
    return "paused";
  }
  if (session.modalPaused) {
    session.modalPaused = false;
    return "restart";
  }
  return "run";
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

module.exports = { pauseForLevelUp, modalPause, actionInterval };
