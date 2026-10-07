/**
 * The Edgeville Dungeon: what the units share - the plugin api and the data from
 * data/definitions/edgeville-dungeon.json.
 */
const fs = require("fs");
const path = require("path");

let api = null;
let core = null;
let data = null;

/** Set once by the plugin before any unit attaches. */
function init(pluginApi) {
  api = pluginApi;
  core = pluginApi.core;
  const file = path.join(core.GameConstants.DEFINITIONS_DIRECTORY, "edgeville-dungeon.json");
  data = JSON.parse(fs.readFileSync(file, "utf8"));
}

module.exports = {
  init,
  get api() { return api; },
  get core() { return core; },
  get data() { return data; },
};
