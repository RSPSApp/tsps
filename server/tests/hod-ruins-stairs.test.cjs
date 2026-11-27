// Run after `yarn build`: node --test tests/hod-ruins-stairs.test.cjs
// The Heart of Darkness owns the Ruins of Tapoyauik entrance stairs (loc 54525, "Climb-down"):
// pre-quest the entrance is sealed (Wiki: not accessible before quest completion) with a
// message instead of a silent no-op; after the quest the click is left to the generic climb,
// where the declared pair in data/climb-links.json carries the player into the ruins.
const assert = require("node:assert/strict");
const { test, before } = require("node:test");
const path = require("node:path");
const { Server } = require("../dist/Server");
Server.installProductionPathResolver();

const { CachePipeline } = require("../dist/game/cache/CachePipeline");
const { PluginManager } = require("../dist/plugins/PluginManager");
const { Player } = require("../dist/game/entity/impl/player/Player");
const { Location } = require("../dist/game/model/Location");

const RUINS_STAIRS_ID = 54525;
const STAGE_KEY = "quest.the_heart_of_darkness.stage";
const S = { BELOW: 56, BANISHED: 74 };
const SEALED_MESSAGE = "You can't enter the Ruins of Tapoyauik until you complete The Heart of Darkness.";

let climbHandler;

before(async () => {
  await CachePipeline.initialize(path.resolve(__dirname, ".."));
  const core = PluginManager.getCoreApi();
  const custom = {};
  const api = new Proxy({
    core,
    persistAttribute() {},
    emitCustomEvent: (name, payload) => {
      for (const handler of custom[name] ?? []) handler(payload);
    },
    onCustomEvent: (name, handler) => {
      (custom[name] ??= []).push(handler);
    },
  }, { get: (target, key) => (key in target ? target[key] : () => {}) });
  require("../plugins/quests/quests/TheHeartOfDarkness.Quest")(api);
  climbHandler = custom["ladders:climb"]?.[0];
  assert.equal(typeof climbHandler, "function", "the quest claims the ladders:climb event");
});

/** A player beside the surface stairs, at the given quest stage. */
function climber(stage) {
  const player = new Player(null);
  const messages = [];
  player.setAttribute("username", "stairs-tester");
  player.setLocation(new Location(1693, 3231, 0));
  player.setAttribute(STAGE_KEY, stage);
  player.sendMessage = (message) => {
    messages.push(message);
  };
  player.getPacketSender = () => ({
    sendMessage: () => {}, sendVarbit: () => {}, sendConfig: () => {}, setSkill: () => {}, updateHud: () => {},
  });
  return { player, messages };
}

/** Click "Climb-down" on the surface stairs as a player at `stage`. */
function climb(stage) {
  const { player, messages } = climber(stage);
  const event = { player, object: null, objectId: RUINS_STAIRS_ID, clickType: 0, handled: false };
  climbHandler(event);
  return { handled: event.handled, messages };
}

test("pre-quest the ruins entrance is sealed with a message, not a silent no-op", () => {
  const { handled, messages } = climb(0);
  assert.equal(handled, true);
  assert.deepEqual(messages, [SEALED_MESSAGE]);
});

test("after the quest the stairs are left to the generic climb (the declared link descends into the ruins)", () => {
  const { handled, messages } = climb(S.BANISHED);
  assert.equal(handled, false, "the quest must not claim the post-quest click");
  assert.equal(messages.length, 0);
});
