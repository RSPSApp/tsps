// Run after `yarn build`: node --test tests/zogre-barricade.test.cjs
// Zogre Flesh Eaters: the guard's crush used to register the crushed barricade and only then
// despawn the original. The removal was the last loc packet for each tile, so the client went
// on showing the closed barricade until the next scene load (players had to relog). One
// loc_add_change per tile now replaces the original in place (ObjectManager.replaceInPlace).
const assert = require("node:assert/strict");
const path = require("node:path");
const { before, after, test } = require("node:test");

require("../dist/Server").Server.installProductionPathResolver();
const { CachePipeline } = require("../dist/game/cache/CachePipeline");
const { PluginManager: PM } = require("../dist/plugins/PluginManager");
const { Player } = require("../dist/game/entity/impl/player/Player");
const { PlayerSession } = require("../dist/net/PlayerSession");
const { ClientConnection } = require("../dist/net/NetworkBuilder");
const { Location } = require("../dist/game/model/Location");
const QuestRuntime = require("../plugins/quests/QuestRuntime");

const BARRICADE_STAGE = 3;
const CRUSHED = 6881;
const CRUSHED_2 = 6882;

let core;
before(async () => {
  await CachePipeline.initialize(path.resolve(__dirname, ".."));
  PM.loadFromDirectory(path.resolve(__dirname, "../plugins"));
  core = PM.getCoreApi();
  core.RegionManager.init();
  core.RegionManager.loadMapFiles(2456, 3048);
  PM.emitServerStartup({});
});
after(() => PM.emitServerShutdown({}));

function actor(t) {
  const channel = {
    kind: "test", remoteAddress: "127.0.0.1", isOpen: () => true, send: () => true,
    close() {}, onData() {}, onError() {}, onClose() {},
  };
  const p = new Player(new PlayerSession(channel));
  p.setUsername("zogrebarricade");
  p.setLocation(new Location(2456, 3048, 0));
  p.needsPlacement = false;
  const connection = new ClientConnection(channel);
  connection.player = p;
  assert.equal(core.World.getPlayers().add(p), true);
  t.after(() => {
    core.World.getPlayers().remove(p);
    p.setRegistered(false);
    core.TaskManager.cancelTasks(p.getIndex());
  });
  return p;
}

test("the guard's crush replaces each barricade loc, with no removal last", (t) => {
  const p = actor(t);
  const quest = QuestRuntime.getRegisteredQuests().find((q) => q.key === "zogre_flesh_eaters");
  assert.ok(quest, "the quest is registered");
  quest.setStage(p, BARRICADE_STAGE);

  const sender = p.getPacketSender();
  const packets = [];
  t.mock.method(sender, "sendObject", (object) => {
    packets.push([object.getLocation().getX(), object.getLocation().getY(), object.getId()]);
    return sender;
  });
  t.mock.method(sender, "sendObjectRemoval", (object) => {
    packets.push([object.getLocation().getX(), object.getLocation().getY(), -1]);
    return sender;
  });
  t.mock.method(p.getSession(), "isTileInScene", () => true);

  PM.emitPlayerLogin({ player: p, username: p.getUsername() });

  const row = [
    [2456, 3044, CRUSHED], [2456, 3045, CRUSHED], [2456, 3046, CRUSHED],
    [2456, 3047, CRUSHED], [2456, 3048, CRUSHED], [2456, 3049, CRUSHED],
    [2456, 3050, CRUSHED], [2456, 3051, CRUSHED], [2456, 3052, CRUSHED],
    [2458, 3046, CRUSHED_2], [2458, 3047, CRUSHED_2], [2458, 3048, CRUSHED_2],
    [2458, 3049, CRUSHED_2], [2458, 3050, CRUSHED_2],
  ];
  for (const [x, y, id] of row) {
    const at = packets.filter(([px, py]) => px === x && py === y);
    assert.ok(at.length > 0, `a loc packet for ${x},${y}`);
    assert.deepEqual(at.at(-1), [x, y, id], `the last packet for ${x},${y} is the crushed barricade`);
  }

  // A later scene load sends the crushed loc, not the map's closed barricade.
  assert.equal(core.MapObjects.get(6858, new Location(2456, 3044, 0), null), null,
    "the original barricade is gone from the map");
  assert.ok(core.MapObjects.get(CRUSHED, new Location(2456, 3044, 0), null),
    "the crushed barricade stands in its place");
});
