// Run after `yarn build`: node --test tests/colossal-pouch-degraded.test.cjs
// A degraded colossal pouch holds less than an intact one (Wiki, Colossal pouch: "holds less essence, starting at 35",
// at 85 Runecraft where it holds 40), never more than the player's level allows (8 at 25). Real engine: every plugin
// loaded, a real Player, Fill through ItemActionPacketListener.
const assert = require("node:assert/strict");
const path = require("node:path");
const { before, after, test } = require("node:test");
process.env.DISABLE_PLAYER_BOTS = "1";
require("../dist/Server").Server.installProductionPathResolver();
const { CachePipeline } = require("../dist/game/cache/CachePipeline");
const { PluginManager: PM } = require("../dist/plugins/PluginManager");
const { Player } = require("../dist/game/entity/impl/player/Player");
const { PlayerSession } = require("../dist/net/PlayerSession");
const { ItemActionPacketListener } = require("../dist/net/packet/impl/ItemActionPacketListener");
const { Inventory } = require("../dist/game/model/container/impl/Inventory");

let core, Pouches;
const players = [], tasks = new Set(), errors = [];
let oldSubmit, oldError;
before(async () => {
  core = PM.getCoreApi();
  oldSubmit = core.TaskManager.submit;
  oldError = console.error;
  core.TaskManager.submit = function (task, ...args) {
    tasks.add(task);
    return oldSubmit.call(this, task, ...args);
  };
  console.error = (...args) => { errors.push(args.map(String).join(" ")); oldError(...args); };
  await CachePipeline.initialize(path.resolve(__dirname, ".."));
  assert.equal(require("../dist/game/definition/WorldDefinition").isMembersWorld(), true);
  PM.loadFromDirectory(path.resolve(__dirname, "../plugins"));
  core.RegionManager.init();
  core.RegionManager.loadMapFiles(3222, 3218);
  PM.emitServerStartup({});
  Pouches = require("../plugins/skills/runecrafting/Pouches.Runecrafting");
});
after(() => {
  const failures = [];
  const safely = (fn) => { try { fn(); } catch (error) { failures.push(String(error)); } };
  try {
    for (const player of players) safely(() => {
      if (player.isRegistered()) core.World.getPlayers().removes(player);
    });
    safely(() => PM.emitServerShutdown({}));
    for (const task of tasks) safely(() => { if (task.isRunning()) task.stop(); });
    safely(() => core.World.process());
    for (const task of tasks) safely(() => { if (task.isRunning()) task.stop(); });
  } finally {
    if (oldSubmit) core.TaskManager.submit = oldSubmit;
    if (oldError) console.error = oldError;
  }
  assert.deepEqual(failures, [], "native teardown completes");
  assert.deepEqual(errors, [], "no caught plugin errors");
});

let next = 9950;
function actor(level) {
  const channel = { kind: "test", remoteAddress: "127.0.0.1", isOpen: () => true, send: () => true, close() {}, onData() {}, onError() {}, onClose() {} };
  const p = new Player(new PlayerSession(channel));
  players.push(p);
  p.setUsername("colossal" + next++);
  p.setLongUsername(core.Misc.stringToLongBigInt(p.getUsername()));
  p.setAttribute("bot-skip-persistence", true);
  p.setLocation(new core.Location(3222, 3218, 0)); p.needsPlacement = false;
  assert.equal(core.RegionManager.blocked(p.getLocation(), null), false);
  assert.equal(core.World.getPlayers().add(p), true);
  p.getSkillManager().setExperiences(core.Skill.RUNECRAFTING, core.SkillManager.getExperienceForLevel(level), false);
  p.getSkillManager().setMaxLevels(core.Skill.RUNECRAFTING, level, false).setCurrentLevel(core.Skill.RUNECRAFTING, level, false);
  assert.equal(p.getSkillManager().getMaxLevel(core.Skill.RUNECRAFTING), level);
  assert.equal(p.getSkillManager().getCurrentLevel(core.Skill.RUNECRAFTING), level);
  assert.equal(core.SkillManager.getLevelForExperience(p.getSkillManager().getExperience(core.Skill.RUNECRAFTING)), level);
  return p;
}

function action(p, item, option) {
  const slot = p.getInventory().getSlotForItemId(item);
  const definition = core.CacheDefinitions.getItem(item);
  const op = definition.inventoryActions.indexOf(option) + 1;
  assert.ok(slot >= 0 && op > 0, `${option} is a carried cache-backed action`);
  assert.equal(ItemActionPacketListener.handleAction(p, Inventory.INTERFACE_ID, item, slot, op), true);
}

function fill(t, level, degradedPouch) {
  const p = actor(level);
  const pouch = core.CacheDefinitions.getObjId(degradedPouch ? "rcu_pouch_colossal_degrade" : "rcu_pouch_colossal");
  const essence = core.CacheDefinitions.getObjId("blankrune_high");
  p.getInventory().add(new core.Item(pouch, 1), true);
  for (let i = 0; i < 26; i++) p.getInventory().add(new core.Item(essence, 1), true);
  action(p, pouch, "Fill");
  return Pouches._test.states(p).colossal?.amount ?? 0;
}

test("at 25 Runecraft a degraded colossal pouch takes no more than the intact one's 8", (t) => {
  assert.equal(fill(t, 25, false), 8, "intact: 8 at 25");
  assert.equal(fill(t, 25, true), 8, "degraded: not 35");
  assert.equal(fill(t, 85, true), 26, "at 85 the degraded pouch still takes all 26 held (its cap is 35)");
});

// Wiki: Essence pouch, Degrading. Newly filled excess stays in inventory; excess already
// stored is returned only when all of it fits. The existing deterministic first-decay
// counters are checkpoint seeds here; this does not test retail decay probability.
function boundary({ key = "medium", essenceName = "blankrune_high", type = 2,
  capacity = 6, degradedCapacity = 3, threshold = 270, fillers = 0 } = {}) {
  const p = actor(85), inventory = p.getInventory();
  const obj = (name) => {
    const id = core.CacheDefinitions.getObjId(name);
    assert.ok(Number.isInteger(id) && id >= 0, name);
    return id;
  };
  const pouch = obj(`rcu_pouch_${key}`), degraded = obj(`rcu_pouch_${key}_degrade`);
  const essence = obj(essenceName);
  inventory.add(new core.Item(pouch, 1), true);
  // Reach the stored-essence precondition through Fill, from a prior-use checkpoint.
  p.setAttribute(Pouches.POUCHES_ATTRIBUTE, {
    [key]: { amount: 0, type: 0, decay: threshold - capacity },
  });
  let remaining = capacity - 1;
  while (remaining > 0) {
    const amount = Math.min(remaining, inventory.getFreeSlots());
    assert.ok(amount > 0);
    inventory.add(new core.Item(essence, amount), true);
    assert.equal(inventory.getAmount(essence), amount);
    action(p, pouch, "Fill");
    assert.equal(inventory.getAmount(essence), 0);
    remaining -= amount;
  }
  const state = () => structuredClone(Pouches._test.states(p)[key]);
  assert.deepEqual(state(), { amount: capacity - 1, type, decay: threshold - 1 });
  assert.equal(inventory.getAmount(pouch), 1, "control: the pre-boundary pouch remains intact");
  const filler = core.ItemIdentifiers.BRONZE_AXE;
  inventory.add(new core.Item(filler, fillers), true);
  assert.equal(inventory.getAmount(filler), fillers);
  inventory.add(new core.Item(essence, 1), true);
  assert.equal(inventory.getAmount(essence), 1);
  const xp = p.getSkillManager().getExperience(core.Skill.RUNECRAFTING);
  action(p, pouch, "Fill");
  assert.equal(inventory.getAmount(pouch), 0);
  assert.equal(inventory.getAmount(degraded), 1, "the target fill really degrades the pouch");
  assert.deepEqual(state(), { amount: degradedCapacity, type, decay: threshold });
  assert.equal(p.getSkillManager().getExperience(core.Skill.RUNECRAFTING), xp, "filling gives no XP");
  return { p, inventory, essence, degraded, state, capacity, degradedCapacity };
}

test("degradation returns stored excess when exactly enough inventory slots are available", () => {
  const f = boundary({ fillers: 24 });
  assert.equal(f.inventory.getAmount(f.essence), 3, "all three excess essence return instead of disappearing");
  assert.equal(f.state().amount + f.inventory.getAmount(f.essence), 6, "the boundary conserves essence");
  f.inventory.delete(core.ItemIdentifiers.BRONZE_AXE, 3);
  assert.equal(f.inventory.getFreeSlots(), 3, "make room to empty the remaining three essence");
  action(f.p, f.degraded, "Empty");
  assert.equal(f.inventory.getAmount(f.essence), 6);
  assert.equal(f.state().amount, 0);
  assert.equal(f.state().type, 0);
});

test("a fill from empty leaves the new excess in inventory when the pouch degrades", () => {
  const p = actor(85), inventory = p.getInventory();
  const pouch = core.CacheDefinitions.getObjId("rcu_pouch_medium");
  const degraded = core.CacheDefinitions.getObjId("rcu_pouch_medium_degrade");
  const essence = core.CacheDefinitions.getObjId("blankrune_high");
  inventory.add(new core.Item(pouch, 1), true);
  inventory.add(new core.Item(essence, 6), true);
  p.setAttribute(Pouches.POUCHES_ATTRIBUTE, { medium: { amount: 0, type: 0, decay: 264 } });
  assert.equal(inventory.getAmount(essence), 6);
  action(p, pouch, "Fill");
  assert.equal(inventory.getAmount(degraded), 1);
  assert.deepEqual(Pouches._test.states(p).medium, { amount: 3, type: 2, decay: 270 });
  assert.equal(inventory.getAmount(essence), 3, "the three essence that do not fit remain in inventory");
});

test("degradation does not partially return stored excess when it cannot all fit", () => {
  const f = boundary({ fillers: 25 });
  assert.equal(f.inventory.getFreeSlots(), 2, "three excess essence cannot fit in two slots");
  assert.equal(f.inventory.getAmount(f.essence), 0, "Wiki: excess already stored is lost if insufficient room");
  action(f.p, f.degraded, "Empty");
  assert.equal(f.inventory.getAmount(f.essence), 2, "ordinary Empty still returns what fits");
  assert.equal(f.state().amount, 1);
});

for (const config of [
  { key: "medium", essenceName: "blankrune", type: 1, capacity: 6, degradedCapacity: 3, threshold: 270 },
  { key: "large", essenceName: "blankrune_high", type: 2, capacity: 9, degradedCapacity: 7, threshold: 261 },
  { key: "giant", essenceName: "blankrune_daeyalt", type: 3, capacity: 12, degradedCapacity: 9, threshold: 120 },
  { key: "colossal", essenceName: "blankrune_high", type: 2, capacity: 40, degradedCapacity: 35, threshold: 320 },
]) {
  test(`${config.key} pouch returns excess of its original essence kind`, () => {
    const f = boundary(config);
    assert.equal(f.inventory.getAmount(f.essence), config.capacity - config.degradedCapacity);
    const total = f.state().amount + f.inventory.getAmount(f.essence);
    assert.equal(total, config.capacity);
    action(f.p, f.degraded, "Empty");
    assert.equal(f.state().amount + f.inventory.getAmount(f.essence), total, "partial or complete empty conserves the returned essence");
  });
}
