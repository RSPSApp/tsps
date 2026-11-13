// Run after yarn build: node --test tests/regicide-trip-wire-arrow-trap.test.cjs
// A snagged Regicide trip wire fires its four arrow traps: rsprox_transcripts/230/02969.txt tick 157
// (snag line, poison, arrowtrip on each regicide_trap_arrowtrip, iron_arrow_travel at the player,
// tripwire_with_arrows) and tick 161 (two 5 hits); 230/02972.txt and 237/01105.txt repeat it.
const assert = require("node:assert/strict");
const path = require("node:path");
const { before, test } = require("node:test");
require("../dist/Server").Server.installProductionPathResolver();
const { CachePipeline } = require("../dist/game/cache/CachePipeline");
const { PluginManager } = require("../dist/plugins/PluginManager");
const { Player } = require("../dist/game/entity/impl/player/Player");
const { PlayerSession } = require("../dist/net/PlayerSession");
let core;
const WIRE = { x: 2251, y: 3168, z: 0 };

before(async () => {
  await CachePipeline.initialize(path.resolve(__dirname, ".."));
  PluginManager.loadFromDirectory(path.resolve(__dirname, "../plugins"));
  core = PluginManager.getCoreApi();
  core.ObjectDefinition.init();
  core.RegionManager.init();
  core.RegionManager.loadMapFiles(WIRE.x, WIRE.y);
  PluginManager.emitServerStartup({});
});

function snag(t) {
  const channel = { kind: "test", remoteAddress: "127.0.0.1", isOpen: () => true,
    send: () => true, close() {}, onData() {}, onError() {}, onClose() {} };
  const player = new Player(new PlayerSession(channel));
  player.setIndex(4700);
  player.setUsername("tripwire");
  player.setRegistered(true);
  player.setLocation(new core.Location(2250, 3168, 0));
  player.setNeedsPlacement(false);
  const messages = [], sounds = [], hits = [], anims = [], arrows = [];
  player.sendMessage = (text) => messages.push(text);
  const sender = player.getPacketSender();
  sender.sendSoundEffect = (id, loops, delay) => { sounds.push([id, delay]); return sender; };
  t.mock.method(player.getCombat().getHitQueue(), "addPendingDamage", (list) => hits.push(list.map((hit) => hit.getDamage())));
  t.mock.method(core.CombatFactory, "poisonEntity", () => {});
  t.mock.method(core.GameObject.prototype, "performAnimation", function (animation) {
    anims.push([this.getLocation().getX(), this.getLocation().getY(), this.getId(), animation.getId()]);
  });
  t.mock.method(core.Projectile.prototype, "sendProjectile", function () {
    arrows.push([this.start.getX(), this.start.getY(), this.projectileId, this.lockon === player, this.end.getX(), this.end.getY()]);
  });
  t.mock.method(Math, "random", () => 0.99);
  const object = core.MapObjects.get(core.ObjectIdentifiers.TRIPWIRE, new core.Location(WIRE.x, WIRE.y, 0), null);
  assert.ok(object, "the cache wire at 2251,3168");
  const event = { player, object, objectId: object.getId(), clickType: 1, location: { ...WIRE },
    definition: object.getDefinition(), handled: false };
  PluginManager.emitObjectInteraction(event);
  assert.equal(event.handled, true);
  assert.deepEqual([player.getLocation().getX(), player.getLocation().getY()], [2253, 3168], "a snag still steps over");
  return { player, messages, sounds, hits, anims, arrows };
}

test("a snag fires the wire's four arrow traps at the player", (t) => {
  const { messages, sounds, hits, anims, arrows } = snag(t);
  const C = core.CacheDefinitions;
  const trap = C.getLocId("regicide_trap_arrowtrip");
  const corners = [[2250, 3167], [2250, 3169], [2253, 3167], [2253, 3169]];
  assert.deepEqual(messages, ["You snag the trip wire as you step over it."]);
  assert.deepEqual(anims.map(([x, y, id, seq]) => [x, y, id, seq]).sort(),
    corners.map(([x, y]) => [x, y, trap, C.getSeqId("arrowtrip")]).sort());
  assert.deepEqual(arrows.sort(), corners.map(([x, y]) => [x, y, C.getSpotanimId("iron_arrow_travel"), true, 2253, 3168]).sort(),
    "aimed at the landing tile");
  assert.deepEqual(sounds, [[1360, 20]], "tripwire_with_arrows");
  assert.deepEqual(hits, [], "the arrows are still in the air");
});

test("the two 5 hits land 4 ticks after the snag", (t) => {
  const { hits } = snag(t);
  for (let tick = 1; tick <= 3; tick++) {
    core.TaskManager.process();
    assert.deepEqual(hits, [], `tick ${tick}`);
  }
  core.TaskManager.process();
  assert.deepEqual(hits, [[5, 5]]);
  core.TaskManager.process();
  assert.deepEqual(hits, [[5, 5]], "only once");
});
