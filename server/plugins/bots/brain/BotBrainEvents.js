"use strict";

const PROGRESS_EVENTS = Object.freeze([
  "woodcutting:success",
  "mining:success",
  "firemaking:success",
  "smelting:success",
]);

/**
 * Produces are announced by the skill plugins. Resetting the matching brain
 * frame's stall timer here means activities stop polling inventory and XP every
 * tick to decide whether they are still making progress.
 */
function registerBrainProgressEvents(options = {}) {
  const { api, runtime } = options;
  if (!api?.onCustomEvent || !runtime) {
    return;
  }
  const onProduce = (event) => {
    const username = event?.player?.getUsername?.();
    if (!username) {
      return;
    }
    const brain = runtime.entriesByUsername?.get?.(username)?.brain;
    brain?.noteProgress?.(Date.now());
  };
  for (const eventName of PROGRESS_EVENTS) {
    api.onCustomEvent(eventName, onProduce);
  }
}

module.exports = {
  registerBrainProgressEvents,
  PROGRESS_EVENTS,
};
