// Run after `yarn build`: node --test tests/sorceress-garden-shelves.test.cjs
const assert = require("node:assert/strict");
const { test } = require("node:test");

const { Server } = require("../dist/Server");
Server.installProductionPathResolver();

const { PluginManager } = require("../dist/plugins/PluginManager");
const plugin = require("../plugins/minigames/SorceresssGarden.plugin");

const core = PluginManager.getCoreApi();
const SHELVES = 21794;
const BEER_GLASS = 1919;

const submitted = [];
const handlers = new Map();
// The whole plugin registers against this stub: Shelves' Search is whatever it hooked.
const api = new Proxy({
  core,
  getTaskManager: () => ({ submit: (task) => submitted.push(task) }),
  onObjectInteraction(name, options) {
    if (typeof name === "string") handlers.set(name, options);
  },
}, {
  get: (target, prop) => (prop in target ? target[prop] : () => {}),
});
plugin.register(api);

function player({ freeSlots = 28 } = {}) {
  const added = [];
  return {
    added,
    messages: [],
    getIndex: () => 7,
    getInventory: () => ({
      getFreeSlots: () => freeSlots,
      add: (item) => added.push([item.getId(), item.getAmount()]),
    }),
    sendMessage(message) {
      this.messages.push(message);
    },
  };
}

/** Ticks the last submitted task until it stops; returns the ticks it took. */
function runLastTask() {
  const task = submitted.at(-1);
  task.setRunning(true); // as TaskManager.submit does
  let ticks = 0;
  while (task.isRunning() && ticks < 20) {
    ticks++;
    task.tick();
  }
  return ticks;
}

test("Search is hooked by the Shelves name and leaves other shelves to their content", () => {
  assert.equal(typeof handlers.get("Shelves")?.Search, "function");
  submitted.length = 0;
  const p = player();
  assert.equal(handlers.get("Shelves").Search({ player: p, objectId: 37999 }), false);
  assert.deepEqual(p.messages, []);
  assert.equal(submitted.length, 0);
});

test("searching the house shelves finds one empty beer glass three ticks after the first message", () => {
  const p = player();
  assert.equal(handlers.get("Shelves").Search({ player: p, objectId: SHELVES }), true);
  assert.deepEqual(p.messages, ["You search the shelves ..."]);
  assert.deepEqual(p.added, [], "nothing until the search finishes");
  assert.equal(submitted.at(-1).key, 7, "keyed to the player, so walking away cancels it");
  assert.equal(runLastTask(), 3);
  assert.deepEqual(p.added, [[BEER_GLASS, 1]]);
  assert.deepEqual(p.messages, [
    "You search the shelves ...",
    "... and among the strange paraphernalia, you find an empty beer glass.",
  ]);

  handlers.get("Shelves").Search({ player: p, objectId: SHELVES });
  runLastTask();
  assert.deepEqual(p.added, [[BEER_GLASS, 1], [BEER_GLASS, 1]], "every search gives another glass");
});

test("a full backpack gets no glass", () => {
  const p = player({ freeSlots: 0 });
  handlers.get("Shelves").Search({ player: p, objectId: SHELVES });
  runLastTask();
  assert.deepEqual(p.added, []);
  assert.equal(p.messages.at(-1), "You don't have enough inventory space.");
});
