// Run after `yarn build`: node --test tests/dizanas-max-cape-death-ammo.test.cjs
// Dizana's max cape holds the quiver's ammo while worn. The Wiki (Dizana's quiver) gives the max cape variant the
// quiver's Wilderness death rules: up to level 20, or unlocked above it, the ammo drops; locked above 20 it is lost.
// The cape's ammo used to outlive the death in the player's quiver attribute. Real engine: every plugin loaded, real
// Players and the real PlayerDeathTask.dropItems.
process.env.DISABLE_PLAYER_BOTS = "1";
const assert = require("node:assert/strict");
const path = require("node:path");
const { before, after, test } = require("node:test");
require("../dist/Server").Server.installProductionPathResolver();
const { CachePipeline } = require("../dist/game/cache/CachePipeline");
const { PluginManager: PM } = require("../dist/plugins/PluginManager");
const { Player } = require("../dist/game/entity/impl/player/Player");
const { PlayerSession } = require("../dist/net/PlayerSession");
const { PlayerDeathTask } = require("../dist/game/task/impl/PlayerDeath");

let core, I;
before(async () => {
  await CachePipeline.initialize(path.resolve(__dirname, ".."));
  PM.loadFromDirectory(path.resolve(__dirname, "../plugins"));
  core = PM.getCoreApi();
  I = core.ItemIdentifiers;
  PM.emitServerStartup({});
});
after(() => PM.emitServerShutdown({}));

let next = 9960;
function actor(t) {
  const channel = { kind: "test", remoteAddress: "127.0.0.1", isOpen: () => true, send: () => true, close() {}, onData() {}, onError() {}, onClose() {} };
  const p = new Player(new PlayerSession(channel));
  p.setIndex(next++);
  p.setUsername("dmc" + p.getIndex());
  p.setRegistered(true);
  p.setAttribute("bot-skip-persistence", true);
  p.needsPlacement = false;
  t.after(() => { p.setRegistered(false); core.TaskManager.cancelTasks(p); });
  return p;
}

const QUIVER_ATTRIBUTE = "dizanas-quiver";

/** The victim, skulled, dies at Wilderness `level` wearing `capeId` with 500 stored dragon arrows. */
function die(t, capeId, y, killer) {
  const victim = actor(t);
  const at = new core.Location(3100, y, 0);
  victim.setLocation(at);
  killer?.setLocation(at);
  core.CombatFactory.skull(victim, core.SkullType.WHITE_SKULL, core.CombatFactory.PVP_SKULL_SECONDS);
  victim.getEquipment().setItem(core.Equipment.CAPE_SLOT, new core.Item(capeId, 1));
  victim.setAttribute(QUIVER_ATTRIBUTE, { id: I.DRAGON_ARROW, amount: 500 });
  const floor = [];
  t.mock.method(core.ItemOnGroundManager, "registerLocation", (_owner, item) => { floor.push([item.getId(), item.getAmount()]); });
  PlayerDeathTask.dropItems(victim, killer, at);
  return { victim, arrows: floor.filter(([id]) => id === I.DRAGON_ARROW) };
}

const LEVEL_11 = 3600; // y in level-11 Wilderness
const LEVEL_30 = 3750; // y in level-30 Wilderness

test("the max cape's stored ammo drops on a Wilderness death and leaves the quiver", (t) => {
  for (const [label, cape, y, killer] of [
    ["unlocked, level 11, NPC", I.DIZANAS_MAX_CAPE, LEVEL_11, null],
    ["unlocked, level 11, player", I.DIZANAS_MAX_CAPE, LEVEL_11, actor(t)],
    ["locked, level 11, player", I.DIZANAS_MAX_CAPE_L_, LEVEL_11, actor(t)],
    ["unlocked, level 30, player", I.DIZANAS_MAX_CAPE, LEVEL_30, actor(t)],
  ]) {
    const { victim, arrows } = die(t, cape, y, killer);
    assert.equal(core.Wilderness.levelAt(3100, y) > 0, true);
    assert.deepEqual(arrows, [[I.DRAGON_ARROW, 500]], `${label}: the 500 arrows drop`);
    assert.equal(victim.getAttribute(QUIVER_ATTRIBUTE), null, `${label}: and are no longer stored`);
  }
});

test("a locked max cape above level 20 loses its stored ammo", (t) => {
  const { victim, arrows } = die(t, I.DIZANAS_MAX_CAPE_L_, LEVEL_30, actor(t));
  assert.deepEqual(arrows, [], "nothing drops");
  assert.equal(victim.getAttribute(QUIVER_ATTRIBUTE), null, "and nothing is still stored");
});

test("outside the Wilderness the max cape's ammo is left alone", (t) => {
  const victim = actor(t);
  const at = new core.Location(3222, 3218, 0);
  victim.setLocation(at);
  victim.getEquipment().setItem(core.Equipment.CAPE_SLOT, new core.Item(I.DIZANAS_MAX_CAPE, 1));
  victim.setAttribute(QUIVER_ATTRIBUTE, { id: I.DRAGON_ARROW, amount: 500 });
  PlayerDeathTask.dropItems(victim, null, at);
  assert.deepEqual(victim.getAttribute(QUIVER_ATTRIBUTE), { id: I.DRAGON_ARROW, amount: 500 });
});
