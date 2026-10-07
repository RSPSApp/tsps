/**
 * Obor's and Bryophyta's lairs: what the units share - the plugin api, the data from
 * data/definitions/giant-boss-lairs.json, tick timing and the saved attributes.
 */
const fs = require("fs");
const path = require("path");

const OBOR_UNLOCKED_ATTRIBUTE = "giant-lairs:obor-unlocked";
const OBOR_CHESTS_ATTRIBUTE = "giant-lairs:obor-chests-opened";
const BRYOPHYTA_UNLOCKED_ATTRIBUTE = "giant-lairs:bryophyta-unlocked";
const BRYOPHYTA_CHESTS_ATTRIBUTE = "giant-lairs:bryophyta-chests-opened";
const BURY_WITHOUT_ASKING_ATTRIBUTE = "giant-lairs:bury-without-asking";

/** Per lair: its gate is unlocked for good / how many of its chests were opened. */
const UNLOCKED_ATTRIBUTE = { obor: OBOR_UNLOCKED_ATTRIBUTE, bryophyta: BRYOPHYTA_UNLOCKED_ATTRIBUTE };
const CHESTS_ATTRIBUTE = { obor: OBOR_CHESTS_ATTRIBUTE, bryophyta: BRYOPHYTA_CHESTS_ATTRIBUTE };

let api = null;
let core = null;
let data = null;
let lairs = null;

/** Set once by the plugin before any unit attaches. */
function init(pluginApi) {
  api = pluginApi;
  core = pluginApi.core;
  const file = path.join(core.GameConstants.DEFINITIONS_DIRECTORY, "giant-boss-lairs.json");
  data = JSON.parse(fs.readFileSync(file, "utf8"));
  lairs = Object.entries(data.lairs).map(([slug, lair]) => Object.assign(lair, { slug }));
}

/** Runs `action` `ticks` ticks from now; the task is returned so it can be stopped. */
function later(ticks, action, key = null) {
  const { Task, TaskManager } = core;
  const task = new (class extends Task {
    constructor() {
      super(Math.max(1, ticks), key, false);
    }
    execute() {
      this.stop();
      action();
    }
  })();
  TaskManager.submit(task);
  return task;
}

const toLocation = ({ x, y, z }) => new core.Location(x, y, z ?? 0);

module.exports = {
  init, later, toLocation,
  UNLOCKED_ATTRIBUTE, CHESTS_ATTRIBUTE, BURY_WITHOUT_ASKING_ATTRIBUTE,
  get api() { return api; },
  get core() { return core; },
  get data() { return data; },
  get lairs() { return lairs; },
};
