/**
 * Revenants: the plugin api the units share.
 */
let api = null;
let core = null;

/** Set once by the plugin before any unit attaches. */
function init(pluginApi) {
  api = pluginApi;
  core = pluginApi.core;
}

module.exports = {
  init,
  get api() { return api; },
  get core() { return core; },
};
