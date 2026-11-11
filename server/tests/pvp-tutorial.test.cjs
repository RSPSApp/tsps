// Run after `yarn build`: node --test tests/pvp-tutorial.test.cjs
const assert = require("node:assert/strict");
const { test, before } = require("node:test");

const { Server } = require("../dist/Server");
Server.installProductionPathResolver();
const { CachePipeline } = require("../dist/game/cache/CachePipeline");
const { PluginManager } = require("../dist/plugins/PluginManager");

let PvpTutorial;
let core;

before(() => {
  CachePipeline.initialize();
  core = PluginManager.getCoreApi();
  PvpTutorial = require("../plugins/combat/PvpTutorial.plugin");
  const hooks = [];
  PvpTutorial.register({ core, onPlayerLogin: (handler) => hooks.push(handler) });
  assert.deepEqual(hooks, [PvpTutorial._test.noActiveTutorial]);
});

test("login sets pvptut_active_tutorial to -1, so spells count the player's own runes on a boat", () => {
  const varp = core.CacheDefinitions.getVarpId("pvptut_active_tutorial");
  assert.notEqual(varp, null, "the cache names the varp");
  const sent = [];
  const sender = { sendConfig: (id, value) => { sent.push([id, value]); return sender; } };
  PvpTutorial._test.noActiveTutorial({ player: { getPacketSender: () => sender } });
  assert.deepEqual(sent, [[varp, -1]]);
});
