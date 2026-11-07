// Run after `yarn build`: node --test tests/yell-cooldown-relog.test.cjs
// The donator ::yell delay was kept only in memory, so a relog skipped it and the next yell went out at once.
// Real engine: every plugin loaded, a real donator Player, the real ::yell command, and a reload through the real
// PlayerSave and JSON codec.
const assert = require("node:assert/strict");
const path = require("node:path");
const { before, after, test } = require("node:test");
require("../dist/Server").Server.installProductionPathResolver();
const { CachePipeline } = require("../dist/game/cache/CachePipeline");
const { PluginManager: PM } = require("../dist/plugins/PluginManager");
const { Player } = require("../dist/game/entity/impl/player/Player");
const { PlayerSave } = require("../dist/game/entity/impl/player/persistence/PlayerSave");
const { PlayerSession } = require("../dist/net/PlayerSession");
const { DonatorRights } = require("../dist/game/model/rights/DonatorRights");
const JsonPersistence = require("../plugins/persistence/JsonPlayerPersistence.plugin");

let core;
let codec;
let next = 9600;
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

function donator(t, name) {
  const channel = { kind: "test", remoteAddress: "127.0.0.1", isOpen: () => true, send: () => true, close() {}, onData() {}, onError() {}, onClose() {} };
  const p = new Player(new PlayerSession(channel));
  p.setIndex(next++);
  p.setUsername(name);
  p.setRegistered(true);
  p.setHostAddress("127.0.0.1"); // as login sets it; the mute check reads it
  p.setDonatorRights(DonatorRights.REGULAR_DONATOR); // a 40-second yell delay
  const messages = [];
  t.mock.method(p, "sendMessage", (message) => { messages.push(message); });
  t.after(() => p.setRegistered(false));
  return { p, messages };
}

const yell = (p, text) => PM.emitCommand({ player: p, raw: `yell ${text}`, base: "yell", parts: ["yell", ...text.split(" ")], handled: false });

test("a relog keeps the yell delay", (t) => {
  const first = donator(t, "yeller1");
  assert.ok(first.p.isDonator(), "a donator");
  yell(first.p, "hello");
  assert.ok(Number(first.p.getAttribute("yell:until")) > Date.now(), "the yell starts the delay");
  const raw = JSON.parse(JSON.stringify(PlayerSave.fromPlayer(first.p), codec.replacer.bind(codec)), codec.reviver.bind(codec));
  const again = donator(t, "yeller1");
  again.p.setDonatorRights(DonatorRights.REGULAR_DONATOR);
  codec.hydratePlayerSave(raw).applyToPlayer(again.p);
  yell(again.p, "hello again");
  assert.ok(again.messages.some((message) => /^You must wait another \d+ seconds to do that\.$/.test(message)), "the delay survives the relog");
});
