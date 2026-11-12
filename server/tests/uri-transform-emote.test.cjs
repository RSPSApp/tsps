// Run after `yarn build`: node --test tests/uri-transform-emote.test.cjs
const assert = require("node:assert/strict");
const { test, before } = require("node:test");
const path = require("node:path");

const { Server } = require("../dist/Server");
Server.installProductionPathResolver();

const { CacheDefinitions } = require("../dist/game/cache/CacheDefinitions");
const Runtime = require("../plugins/treasuretrails/trails/Runtime.TreasureTrails");
const LOCKS = require("../plugins/interface/data/emotes.json").locks;

let uriVarbit;

before(async () => {
  const { CachePipeline } = require("../dist/game/cache/CachePipeline");
  await CachePipeline.initialize(path.resolve(__dirname, ".."));
  const { PluginManager } = require("../dist/plugins/PluginManager");
  // Only the core matters to restore; every registration is a no-op.
  const api = new Proxy({ core: PluginManager.getCoreApi() }, { get: (target, key) => key in target ? target[key] : () => {} });
  Runtime(api);
  uriVarbit = CacheDefinitions.getVarbitId("emote_uri_transform");
});

function player(hard) {
  const varbits = new Map();
  const sender = { sendVarbit(id, value) { varbits.set(id, value); return sender; } };
  const attributes = { [Runtime.completedAttribute({ name: "hard" })]: hard };
  return { varbits, getAttribute: (key) => attributes[key], getPacketSender: () => sender };
}

test("the emotes tab locks slot 45 on the Uri transform varbit", () => {
  assert.equal(LOCKS["45"].varbit, "emote_uri_transform");
  assert.ok(uriVarbit != null, "cache has emote_uri_transform");
});

test("300 hard clues unlock the Uri transform emote at login and after a casket", () => {
  for (const [hard, unlocked] of [[0, false], [299, false], [300, true], [412, true]]) {
    const p = player(hard);
    Runtime.restore({ player: p });
    assert.equal(p.varbits.get(uriVarbit) === 1, unlocked, `${hard} hard clues`);
  }
});
