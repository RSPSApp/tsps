// Run after `yarn build`: node --test tests/teleport-spheres.test.cjs
// Oldak's spheres (Dorgesh-kaan, Goblin village, Plain of Mud): Break teleports to a random spot in the sphere's area.
// rsprox captures 3189, 3191, 3196 (rev 232) and 3931 (rev 236): the sphere is used up with "You break the sphere.",
// dorgesh_artifact_spell_human, dorgesh_artifact_spell_spot and synth sound 3496 (each client delay 22) on the click;
// the player lands 11 ticks later. Wiki: no use beyond level 20 Wilderness. Real engine: every plugin loaded, real
// Players, the items' handlers through PluginManager.emitItemAction.
process.env.DISABLE_PLAYER_BOTS = "1";
const assert = require("node:assert/strict");
const path = require("node:path");
const { before, after, test } = require("node:test");
require("../dist/Server").Server.installProductionPathResolver();
const { CachePipeline } = require("../dist/game/cache/CachePipeline");
const { PluginManager: PM } = require("../dist/plugins/PluginManager");
const { Player } = require("../dist/game/entity/impl/player/Player");
const { PlayerSession } = require("../dist/net/PlayerSession");
const { ClientConnection } = require("../dist/net/NetworkBuilder");
const { SPHERES } = require("../plugins/items/TeleportSpheres.plugin");

let core, next = 9700;
before(async () => {
  await CachePipeline.initialize(path.resolve(__dirname, ".."));
  PM.loadFromDirectory(path.resolve(__dirname, "../plugins"));
  core = PM.getCoreApi();
  core.RegionManager.init();
  PM.emitServerStartup({});
});
after(() => PM.emitServerShutdown({}));

const LUMBRIDGE = [3222, 3218, 0];
const DEEP_WILDERNESS = [3093, 3900, 0];
const SPHERE_IDS = () => ({
  "Dorgesh-kaan sphere": core.CacheDefinitions.getObjId("dorgesh_teleport_artifact"),
  "Goblin village sphere": core.CacheDefinitions.getObjId("slice_teleport_artifact"),
  "Plain of Mud sphere": core.CacheDefinitions.getObjId("lotg_teleport_artifact"),
});

function actor(t, at, itemId, amount = 2) {
  const channel = { kind: "test", remoteAddress: "127.0.0.1", isOpen: () => true, send: () => true, close() {}, onData() {}, onError() {}, onClose() {} };
  const p = new Player(new PlayerSession(channel));
  p.setIndex(next++); p.setUsername("sphere" + p.getIndex()); p.setRegistered(true); p.setAttribute("bot-skip-persistence", true);
  core.RegionManager.loadMapFiles(at[0], at[1]);
  p.setLocation(new core.Location(...at)); p.needsPlacement = false;
  const conn = new ClientConnection(channel); conn.player = p;
  t.after(() => { PM.emitPlayerLogout({ player: p, username: p.getUsername() }); core.TaskManager.cancelTasks(p); core.TaskManager.cancelTasks(p.getIndex()); p.setRegistered(false); });
  p.getInventory().add(new core.Item(itemId, amount), false);
  const messages = [], animations = [], graphics = [], sounds = [];
  t.mock.method(p.getPacketSender(), "sendMessage", (m) => { messages.push(m); return p.getPacketSender(); });
  t.mock.method(p.getPacketSender(), "sendSoundEffect", (...args) => { sounds.push(args); return p.getPacketSender(); });
  const animate = p.performAnimation.bind(p), graphic = p.performGraphic.bind(p);
  t.mock.method(p, "performAnimation", (a) => { animations.push(a ? [a.getId(), a.getDelay?.() ?? a.delay] : null); return animate(a); });
  t.mock.method(p, "performGraphic", (g) => { graphics.push(g ? [g.getId(), g.getDelay?.() ?? g.delay] : null); return graphic(g); });
  return { p, conn, messages, animations, graphics, sounds };
}

function use(f, itemId, option = "Break") {
  const slot = f.p.getInventory().getSlotForItemId(itemId);
  const clickType = (core.CacheDefinitions.getItem(itemId).inventoryActions ?? []).indexOf(option) + 1;
  assert.ok(clickType > 0, `the cache's ${option} option`);
  const event = { player: f.p, itemId, slot, item: f.p.getInventory().getItems()[slot], option, clickType, handled: false };
  PM.emitItemAction(event);
  return event;
}

const tick = (n = 1) => { for (let i = 0; i < n; i++) core.TaskManager.process(); };
const at = (f) => [f.p.getLocation().getX(), f.p.getLocation().getY(), f.p.getLocation().getZ()];
const tiles = (name) => SPHERES[name].map(({ tile }) => tile.join(","));

for (const name of ["Dorgesh-kaan sphere", "Goblin village sphere", "Plain of Mud sphere"]) {
  test(`${name}: Break uses it up on the click and lands on a captured tile 11 ticks later`, (t) => {
    const id = SPHERE_IDS()[name];
    assert.ok(id > 0, name);
    const f = actor(t, LUMBRIDGE, id);
    const event = use(f, id);
    assert.equal(event.handled, true);
    assert.equal(f.p.getInventory().getAmount(id), 1, "one sphere used on the click");
    assert.deepEqual(f.messages, ["You break the sphere."]);
    assert.deepEqual(f.animations[0], [core.CacheDefinitions.getSeqId("dorgesh_artifact_spell_human"), 22]);
    assert.deepEqual(f.graphics[0], [core.CacheDefinitions.getSpotanimId("dorgesh_artifact_spell_spot"), 22]);
    assert.ok(f.sounds.some(([soundId, , delay]) => soundId === 3496 && delay === 22), JSON.stringify(f.sounds));
    tick(10);
    assert.deepEqual(at(f), LUMBRIDGE, "still there on tick 10");
    tick(1);
    assert.ok(tiles(name).includes(at(f).join(",")), `landed on ${at(f)}`);
  });
}

test("a sphere doesn't work beyond level 20 Wilderness and is kept", (t) => {
  const id = SPHERE_IDS()["Dorgesh-kaan sphere"];
  const f = actor(t, DEEP_WILDERNESS, id);
  assert.ok(core.Wilderness.isIn(f.p));
  f.p.setWildernessLevel(21);
  use(f, id);
  tick(12);
  assert.equal(f.p.getInventory().getAmount(id), 2, "nothing used up");
  assert.deepEqual(at(f), DEEP_WILDERNESS);
  assert.deepEqual(f.messages, ["You must be below level 20 of Wilderness to use teleportation."]);
});

test("a sphere still works at level 20 Wilderness", (t) => {
  const id = SPHERE_IDS()["Plain of Mud sphere"];
  const f = actor(t, DEEP_WILDERNESS, id);
  f.p.setWildernessLevel(20);
  use(f, id);
  tick(11);
  assert.equal(f.p.getInventory().getAmount(id), 1);
  assert.deepEqual(at(f), [2606, 9837, 0]);
});

test("Another Slice of H.A.M.'s route still answers its own Goblin village sphere Break", (t) => {
  const id = SPHERE_IDS()["Goblin village sphere"];
  const f = actor(t, LUMBRIDGE, id, 1);
  const ham = require("../plugins/quests/QuestRuntime").getRegisteredQuests().find((q) => q.key === "another_slice_of_ham");
  ham.setStage(f.p, 4);
  use(f, id);
  tick(12);
  assert.ok(!f.messages.includes("You break the sphere."), "the quest's line, not ours");
  assert.notEqual(ham.getStage(f.p), 4, "the quest moved on");
});

test("every captured landing tile is walkable", () => {
  for (const entries of Object.values(SPHERES)) {
    for (const { tile: [x, y, z] } of entries) {
      core.RegionManager.loadMapFiles(x, y);
      assert.equal(core.RegionManager.blocked(new core.Location(x, y, z), null), false, `${x},${y},${z}`);
    }
  }
});
