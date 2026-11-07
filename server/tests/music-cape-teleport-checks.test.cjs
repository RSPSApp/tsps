// Run after `yarn build`: node --test tests/music-cape-teleport-checks.test.cjs
// The music cape's Teleport skipped TeleportHandler.checkReqs, so it left from any Wilderness level, through a
// teleblock, and out of instances and duels. It makes the usual checks now, as the other skill capes do. Real
// engine: every plugin loaded, a real Player, the cape's own item action.
const assert = require("node:assert/strict");
const path = require("node:path");
const { before, after, test } = require("node:test");
require("../dist/Server").Server.installProductionPathResolver();
const { CachePipeline } = require("../dist/game/cache/CachePipeline");
const { PluginManager: PM } = require("../dist/plugins/PluginManager");
const { Player } = require("../dist/game/entity/impl/player/Player");
const { PlayerSession } = require("../dist/net/PlayerSession");

let core;
let Music;
let Progress;
before(async () => {
  await CachePipeline.initialize(path.resolve(__dirname, ".."));
  PM.loadFromDirectory(path.resolve(__dirname, "../plugins"));
  core = PM.getCoreApi();
  Music = require("../plugins/world/Music.plugin")._test;
  Progress = require("../plugins/world/Progress.Music");
  PM.emitServerStartup({});
});
after(() => PM.emitServerShutdown({}));

function caped(t, location) {
  const channel = { kind: "test", remoteAddress: "127.0.0.1", isOpen: () => true, send: () => true, close() {}, onData() {}, onError() {}, onClose() {} };
  const p = new Player(new PlayerSession(channel));
  p.setIndex(9050); p.setUsername("cape9050"); p.setRegistered(true); p.setAttribute("bot-skip-persistence", true);
  p.setLocation(location);
  // The area manager sets this as the player walks; a test player is placed straight there.
  if (core.Wilderness.isIn(p)) p.setWildernessLevel(core.Wilderness.levelAt(location.getX(), location.getY()));
  t.after(() => p.setRegistered(false));
  const cape = new core.Item(core.ItemIdentifiers.MUSIC_CAPE, 1);
  p.getEquipment().setItem(core.Equipment.CAPE_SLOT, cape);
  t.mock.method(core.WorldDefinition, "isMembersWorld", () => true);
  t.mock.method(Progress, "allUnlocked", () => true);
  const teleports = [];
  t.mock.method(core.TeleportHandler, "teleport", (_p, to) => { teleports.push(to); });
  Music.capeAction({ player: p, item: cape, itemId: cape.getId(), option: "Teleport", handled: false });
  return teleports;
}

test("the music cape won't teleport from deep Wilderness", (t) => {
  const teleports = caped(t, new core.Location(3100, 3800, 0));
  assert.ok(core.Wilderness.levelAt(3100, 3800) > 20, "past level 20");
  assert.equal(teleports.length, 0, "no teleport");
});

test("outside the Wilderness it still teleports", (t) => {
  const teleports = caped(t, new core.Location(3222, 3218, 0));
  assert.equal(teleports.length, 1);
  assert.deepEqual([teleports[0].getX(), teleports[0].getY()], [2689, 3550]);
});
