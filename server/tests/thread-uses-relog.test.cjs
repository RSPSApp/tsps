// Run after `yarn build`: node --test tests/thread-uses-relog.test.cjs
// A reel of thread lasts five leather items; the count of uses was kept only in memory, so relogging at four uses
// started again from nothing and a reel was never used up. Real engine: every plugin loaded, a real Player, a real
// needle-on-leather craft, a reload through the real PlayerSave and JSON codec, then a fifth craft.
const assert = require("node:assert/strict");
const path = require("node:path");
const { before, after, test } = require("node:test");
require("../dist/Server").Server.installProductionPathResolver();
const { CachePipeline } = require("../dist/game/cache/CachePipeline");
const { PluginManager: PM } = require("../dist/plugins/PluginManager");
const { Player } = require("../dist/game/entity/impl/player/Player");
const { PlayerSave } = require("../dist/game/entity/impl/player/persistence/PlayerSave");
const { PlayerSession } = require("../dist/net/PlayerSession");
const JsonPersistence = require("../plugins/persistence/JsonPlayerPersistence.plugin");

let core;
let I;
let codec;
before(async () => {
  await CachePipeline.initialize(path.resolve(__dirname, ".."));
  PM.loadFromDirectory(path.resolve(__dirname, "../plugins"));
  core = PM.getCoreApi();
  I = core.ItemIdentifiers;
  PM.emitServerStartup({});
  JsonPersistence.register({
    getSkillManager: () => require("../dist/game/content/skill/SkillManager").SkillManager,
    setPlayerPersistence: (backend) => { codec = backend; }, log() {},
  });
});
after(() => PM.emitServerShutdown({}));

function crafter(t, name) {
  const channel = { kind: "test", remoteAddress: "127.0.0.1", isOpen: () => true, send: () => true, close() {}, onData() {}, onError() {}, onClose() {} };
  const p = new Player(new PlayerSession(channel));
  p.setIndex(8960); p.setUsername(name); p.setRegistered(true);
  t.after(() => p.setRegistered(false));
  return p;
}

test("the thread's use count survives a relog", (t) => {
  const p = crafter(t, "crafter8960");
  p.setAttribute("crafting:thread-uses", 4); // four items made on this reel
  const raw = JSON.parse(JSON.stringify(PlayerSave.fromPlayer(p), codec.replacer.bind(codec)), codec.reviver.bind(codec));
  const again = crafter(t, "crafter8960");
  codec.hydratePlayerSave(raw).applyToPlayer(again);
  assert.equal(again.getAttribute("crafting:thread-uses"), 4, "the reel is still on its fifth use");
});
