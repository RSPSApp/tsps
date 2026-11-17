// Run after `yarn build`: node --test tests/welcome-screen-banner.test.cjs
// The welcome screen's top box (welcome_screen:banner) shows the rsps.app banner, sprite 30000, in
// place of the loading spinner, as live's fallback script1207 shows its own; a click opens the page.
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
const { ContentApi } = require("../dist/net/http/ContentApi");
const { encodeRunClientScript, encodeUrlOpen, encodeWidgetSetRoot } = require("../dist/net/protocol/ClientProtocol");

const WELCOME_SCREEN = 378;
const BANNER_SPRITE = 30000;
let core;
let index = 2300;

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
  p.setUsername("welcomebanner" + index++);
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

async function login(f) {
  PM.emitPlayerLogin({ player: f.p, username: f.p.getUsername(), isNewAccount: false });
  await flush();
}

async function click(f, uid) {
  await f.c.dispatch([{ type: "widget_action", widgetId: uid, groupId: uid >>> 16, childId: uid & 0xffff, buttonNum: 1, slot: -1, itemId: -1 }]);
  f.c.processTurnPackets();
  await flush();
}

const indexOf = (f, packet) => f.frames.findIndex(frame => frame.equals(packet));

test("the welcome screen shows the rsps.app banner in place of the spinner", async t => {
  const banner = core.CacheDefinitions.getComponentId("welcome_screen:banner");
  assert.equal(banner, (WELCOME_SCREEN << 16) | 76, "PRE: the cache's banner component");
  const f = actor(t);
  await login(f);
  const root = indexOf(f, encodeWidgetSetRoot(WELCOME_SCREEN));
  const script = indexOf(f, encodeRunClientScript(1207, [781, BANNER_SPRITE, "Visit rsps.app", 0, 0]));
  assert.ok(root >= 0, "the welcome screen opened");
  assert.ok(script > root, "script1207 runs once the screen (and its spinner) is up");
});

test("clicking the banner opens rsps.app and leaves the player on the welcome screen", async t => {
  const f = actor(t);
  await login(f);
  const ready = [];
  const emit = PM.emitCustomEvent;
  PM.emitCustomEvent = function (name, payload) {
    if (name === "gameframe:ready") ready.push(payload.player);
    return emit.apply(this, arguments);
  };
  t.after(() => { PM.emitCustomEvent = emit; });
  await click(f, (WELCOME_SCREEN << 16) | 76);
  assert.ok(indexOf(f, encodeUrlOpen("https://rsps.app")) >= 0, "url_open sent");
  assert.deepEqual(ready, [], "still on the welcome screen");
});

test("the banner sprite is served to the browser client", () => {
  const list = ContentApi.resolve("GET", "/api/sprites");
  assert.equal(list.status, 200);
  assert.ok(JSON.parse(list.body).includes(BANNER_SPRITE));
  const sprite = ContentApi.resolve("GET", `/api/sprites/${BANNER_SPRITE}`);
  assert.equal(sprite.status, 200);
  const png = Buffer.from(JSON.parse(sprite.body).png, "base64");
  assert.equal(png.subarray(1, 4).toString("latin1"), "PNG");
  // welcome_screen:banner_artcanvas, the banner less its 4-pixel border.
  assert.deepEqual([png.readUInt32BE(16), png.readUInt32BE(20)], [699, 191]);
  assert.equal(ContentApi.resolve("GET", "/api/sprites/30001").status, 404);
});
