/**
 * Smithing: the shared `api.core`, filled in when the plugin registers, plus the plugin's own
 * `api`, and the plugin's data loaded with it. The unit files read it when they run, not when
 * they load: the bots and the Blast Furnace require the plugin before it registers.
 */
module.exports = {
  init(api) {
    Object.assign(module.exports, api.core, { api });
    require("./Data.Smithing").load(api.core);
  },
  /** Whether the quest runtime has `key` (e.g. "the_tourist_trap") complete for the player. */
  questComplete(player, key) {
    const request = { player, key, complete: false };
    module.exports.api.emitCustomEvent("quest:is-complete", request);
    return request.complete === true;
  },
};
