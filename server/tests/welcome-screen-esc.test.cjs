// Run after `yarn build`: node --test tests/welcome-screen-esc.test.cjs
// Esc on the welcome screen (welcome_screen:esckey op1) enters the game as Play does: live answers
// it with the same close and gameframe restore (rsprox_transcripts/233/00747.txt, 235/03353.txt).
const assert = require("node:assert/strict");
const path = require("node:path");
const { test, before, after } = require("node:test");

const { Server } = require("../dist/Server");
Server.installProductionPathResolver();

const { CachePipeline } = require("../dist/game/cache/CachePipeline");
const { PluginManager: PM } = require("../dist/plugins/PluginManager");
const { Player } = require("../dist/game/entity/impl/player/Player");
const { PlayerSession } = require("../dist/net/PlayerSession");
const { ClientConnection } = require("../dist/net/NetworkBuilder");
const { encodeWidgetSetRoot } = require("../dist/net/protocol/ClientProtocol");

const WELCOME_SCREEN = 378;
let core;
let index = 2100;

before(async () => {
  process.env.DISABLE_PLAYER_BOTS = "1";
  await CachePipeline.initialize(path.resolve(__dirname, ".."));
  PM.loadFromDirectory(path.resolve(__dirname, "../plugins"));
  core = PM.getCoreApi();
  core.RegionManager.init();
  PM.emitServerStartup({});
});
after(() => PM.emitServerShutdown({}));

const flush = () => new Promise(resolve => setImmediate(resolve));

function actor(t) {
  const channel = { kind: "test", remoteAddress: "127.0.0.1", isOpen: () => true, send: () => true, close() {}, onData() {}, onError() {}, onClose() {} };
  const session = new PlayerSession(channel);
  const p = new Player(session), c = new ClientConnection(channel);
  c.player = p;
  const frames = [];
  const send = session.sendClientPacket.bind(session);
  session.sendClientPacket = (frame) => { frames.push(Buffer.from(frame)); return send(frame); };
  p.setUsername("welcomeesc" + index++);
  p.setLongUsername(core.Misc.stringToLongBigInt(p.getUsername()));
  p.setAttribute("bot-skip-persistence", true);
  p.setLocation(new core.Location(3222, 3218, 0));
  assert.equal(core.World.getPlayers().add(p), true);
  p.setNeedsPlacement(false);
  t.after(() => {
    PM.emitPlayerLogout({ player: p, username: p.getUsername() });
    core.World.getPlayers().remove(p);
    core.TaskManager.cancelTasks(p);
  });
  return { p, c, frames };
}

function captureEvents(t, name) {
  const seen = [];
  const emit = PM.emitCustomEvent;
  PM.emitCustomEvent = function (eventName, payload) {
    if (eventName === name) seen.push(payload.player);
    return emit.apply(this, arguments);
  };
  t.after(() => { PM.emitCustomEvent = emit; });
  return seen;
}

async function click(f, uid, buttonNum = 1) {
  await f.c.dispatch([{ type: "widget_action", widgetId: uid, groupId: uid >>> 16, childId: uid & 0xffff, buttonNum, slot: -1, itemId: -1 }]);
  f.c.processTurnPackets();
  await flush();
}

const roots = (f) => f.frames.filter(frame => [WELCOME_SCREEN, 161, 164, 165, 601].some(id => frame.equals(encodeWidgetSetRoot(id))));

test("Esc on the welcome screen enters the game as Play does, once", async t => {
  const esc = core.CacheDefinitions.getComponentId("welcome_screen:esckey");
  assert.equal(esc, (WELCOME_SCREEN << 16) | 3, "PRE: the cache's esckey component");
  const ready = captureEvents(t, "gameframe:ready");
  const f = actor(t);
  PM.emitPlayerLogin({ player: f.p, username: f.p.getUsername(), isNewAccount: false });
  await flush();
  assert.ok(roots(f).at(-1)?.equals(encodeWidgetSetRoot(WELCOME_SCREEN)), "PRE: the welcome screen is the root");
  const before = ready.filter(p => p === f.p).length;

  await click(f, esc, 2);
  assert.equal(ready.filter(p => p === f.p).length, before, "only op1 is Close");
  await click(f, esc);
  assert.equal(ready.filter(p => p === f.p).length, before + 1, "Esc restores the gameframe");
  assert.ok(!roots(f).at(-1).equals(encodeWidgetSetRoot(WELCOME_SCREEN)), "the gameframe root replaces the welcome screen");

  const frames = f.frames.length;
  await click(f, esc);
  assert.equal(ready.filter(p => p === f.p).length, before + 1, "a second Esc after entering does nothing");
  assert.equal(roots(f).length, roots({ frames: f.frames.slice(0, frames) }).length);
});
