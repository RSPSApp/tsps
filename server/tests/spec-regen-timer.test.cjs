// Run after `yarn build`: node --test tests/spec-regen-timer.test.cjs
// The special attack orb's restore ring: live runs `spec_regen_timer` (script 4721) with
// [period, map_clock tick] each time a restore period begins (docs/special-attack-energy.md):
// spending energy from full (doom-wave1-5 ticks 62 and 400), every restore including the one that
// fills the bar (ticks 87, 112, 338), with 25 for the Lightbearer, and on the respawn tick
// (yama-first-time-fighting-and-second-time tick 317). Real Player, real restore task and death task.
const assert = require("node:assert/strict");
const path = require("node:path");
const { before, test } = require("node:test");
require("../dist/Server").Server.installProductionPathResolver();
const { CachePipeline } = require("../dist/game/cache/CachePipeline");
const { PluginManager } = require("../dist/plugins/PluginManager");
const { Player } = require("../dist/game/entity/impl/player/Player");
const { World } = require("../dist/game/World");
const { TaskManager } = require("../dist/game/task/TaskManager");
const { CombatSpecial } = require("../dist/game/content/combat/CombatSpecial");
const { RestoreSpecialAttackTask, SPEC_REGEN_TIMER_SCRIPT } = require("../dist/game/task/impl/RestoreSpecialAttackTask");
const { PlayerDeathTask } = require("../dist/game/task/impl/PlayerDeath");
const { GameConstants } = require("../dist/game/GameConstants");
const { Equipment } = require("../dist/game/model/container/impl/Equipment");
const { ItemIdentifiers } = require("../dist/util/ItemIdentifiers");
const { Item } = require("../dist/game/model/Item");
const Effects = require("../dist/game/content/combat/EquipmentEffects");
const Lightbearer = require("../plugins/items/Lightbearer.plugin");

Lightbearer.register({
  core: { Equipment, ItemIdentifiers, CombatSpecial },
  registerSpecialEnergyRestoreModifier: Effects.registerSpecialEnergyRestoreModifier,
  onCustomEvent() {},
  onPlayerLogin() {},
});

before(async () => {
  await CachePipeline.initialize(path.resolve(__dirname, ".."));
});

/** A player whose packets are dropped except the regen script, the world at `clock.now`, tasks run by hand. */
function setup(t, options = {}) {
  const clock = { now: 464100 };
  t.mock.method(World, "getProcessCycle", () => clock.now);
  const tasks = [];
  t.mock.method(TaskManager, "submit", (task) => { task.setRunning(true); tasks.push(task); });
  t.after(() => tasks.forEach((task) => task.stop()));
  const p = new Player(null);
  p.setUsername("spec-regen");
  const sent = [];
  const sender = new Proxy({}, {
    get: (_, name) => name === "sendClientScript"
      ? (id, ...args) => { if (id === SPEC_REGEN_TIMER_SCRIPT) sent.push(args); return sender; }
      : () => sender,
  });
  t.mock.method(p, "getPacketSender", () => sender);
  if (options.session !== false) t.mock.method(p, "getSession", () => ({}));
  t.mock.method(p, "sendMessage", () => {});
  t.mock.method(p, "isRegistered", () => true);
  const tick = (count = 1) => {
    for (let i = 0; i < count; i++) {
      clock.now++;
      tasks.filter((task) => task.isRunning()).forEach((task) => task.tick());
    }
  };
  return { p, sent, tick, clock };
}

test("spending energy from full starts the orb's ring at this tick", (t) => {
  const { p, sent } = setup(t);
  p.setSpecialPercentage(100);
  CombatSpecial.drain(p, 30, false);
  assert.deepEqual(sent, [[50, 464100]]);
});

test("spending more while restoring leaves the ring's period alone", (t) => {
  const { p, sent, tick } = setup(t);
  p.setSpecialPercentage(100);
  CombatSpecial.drain(p, 20, false);
  tick(12);
  CombatSpecial.drain(p, 30, false);
  assert.deepEqual(sent, [[50, 464100]]);
});

test("every restore starts the next period, the one that fills the bar included", (t) => {
  const { p, sent, tick } = setup(t);
  p.setSpecialPercentage(100);
  CombatSpecial.drain(p, 20, false);
  tick(50);
  assert.equal(p.getSpecialPercentage(), 90);
  assert.deepEqual(sent.at(-1), [50, 464150]);
  tick(50);
  assert.equal(p.getSpecialPercentage(), 100);
  assert.deepEqual(sent, [[50, 464100], [50, 464150], [50, 464200]]);
  tick(50);
  assert.equal(sent.length, 3, "a full bar runs no ring");
});

test("the Lightbearer's ring runs 25-tick periods", (t) => {
  const { p, sent, tick } = setup(t);
  p.getEquipment().setItem(Equipment.RING_SLOT, new Item(ItemIdentifiers.LIGHTBEARER, 1));
  p.setSpecialPercentage(100);
  CombatSpecial.drain(p, 50, false);
  tick(25);
  assert.deepEqual(sent, [[25, 464100], [25, 464125]]);
});

test("a period carried over is dated from when it began", (t) => {
  const { p, sent } = setup(t);
  p.setSpecialPercentage(50);
  TaskManager.submit(new RestoreSpecialAttackTask(p, 20));
  assert.deepEqual(sent, [[50, 464070]], "20 of 50 ticks left: it began 30 ticks ago");
});

test("the respawn tick restarts the restore timer and the ring", (t) => {
  const { p, sent, tick } = setup(t);
  t.mock.method(PluginManager, "emitShouldDropItemsOnDeath", () => false);
  t.mock.method(GameConstants.PLAYER_PERSISTENCE, "requestSave", () => {});
  p.setSpecialPercentage(100);
  CombatSpecial.drain(p, 50, false);
  tick(30);
  const death = new PlayerDeathTask(p);
  for (let i = 0; i < 5; i++) death.execute(); // the animation, then the respawn four ticks on
  assert.equal(p.getSpecialPercentage(), 50, "a death restores no energy");
  assert.deepEqual(sent, [[50, 464100], [50, 464130]]);
  assert.equal(CombatSpecial.restoreTicksRemaining(p), 50);
  tick(49);
  assert.equal(p.getSpecialPercentage(), 50);
  tick(1);
  assert.equal(p.getSpecialPercentage(), 60, "the first 10% comes a full period after the respawn");
});

test("a player without a session starts the restore timer without sending the ring", (t) => {
  const { p, sent } = setup(t, { session: false });
  p.setSpecialPercentage(50);
  assert.doesNotThrow(() => TaskManager.submit(new RestoreSpecialAttackTask(p)));
  assert.equal(p.isRecoveringSpecialAttack(), true);
  assert.deepEqual(sent, []);
});
