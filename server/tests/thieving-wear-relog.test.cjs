// Run after `yarn build`: node --test tests/thieving-wear-relog.test.cjs
// The gloves of silence's failure count and the dodgy necklace's charges were kept only in memory, so a relog
// refilled the necklace to 10 and reset the gloves' 62-failure wear. Real engine: every plugin loaded, a real Player,
// a reload through the real PlayerSave and JSON codec.
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
let codec;
before(async () => {
  await CachePipeline.initialize(path.resolve(__dirname, ".."));
  PM.loadFromDirectory(path.resolve(__dirname, "../plugins"));
  core = PM.getCoreApi();
    PM.emitServerStartup({});
  JsonPersistence.register({
    getSkillManager: () => require("../dist/game/content/skill/SkillManager").SkillManager,
    setPlayerPersistence: (backend) => { codec = backend; }, log() {},
  });
});
after(() => PM.emitServerShutdown({}));

function thief(t, name) {
  const channel = { kind: "test", remoteAddress: "127.0.0.1", isOpen: () => true, send: () => true, close() {}, onData() {}, onError() {}, onClose() {} };
  const p = new Player(new PlayerSession(channel));
  p.setIndex(8961); p.setUsername(name); p.setRegistered(true);
  t.after(() => p.setRegistered(false));
  return p;
}

test("the gloves' wear and the necklace's charges survive a relog", (t) => {
  const p = thief(t, "thief8961");
  p.setAttribute("thieving.gloves-of-silence-failures", 61);
  p.setAttribute("thieving.dodgy-necklace-charges", 1);
  const raw = JSON.parse(JSON.stringify(PlayerSave.fromPlayer(p), codec.replacer.bind(codec)), codec.reviver.bind(codec));
  const again = thief(t, "thief8961");
  codec.hydratePlayerSave(raw).applyToPlayer(again);
  assert.equal(again.getAttribute("thieving.gloves-of-silence-failures"), 61, "one failure from wearing out");
  assert.equal(again.getAttribute("thieving.dodgy-necklace-charges"), 1, "one charge left");
});
