/**
 * Farming: the shared `api.core`, filled in by the plugin before the other farming files load
 * (Data reads its tables as it loads). The files read it as `core.X` when they run.
 */
module.exports = {
  init(api) {
    Object.assign(module.exports, api.core);
  },
};
