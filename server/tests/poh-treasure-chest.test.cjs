// Run after `yarn build`: node --test tests/poh-treasure-chest.test.cjs
// A guest who beats a POH dungeon in challenge mode opens the treasure chest. Only what the inventory can hold
// comes out; the rest stays in the chest (it was zeroed first, so a full inventory lost it all). Real engine:
// every plugin loaded, a real Player and inventory; the house is a stand-in from House.houseFor.
const assert = require("node:assert/strict");
const path = require("node:path");
const { before, after, test } = require("node:test");
require("../dist/Server").Server.installProductionPathResolver();
const { CachePipeline } = require("../dist/game/cache/CachePipeline");
const { PluginManager: PM } = require("../dist/plugins/PluginManager");
const { Player } = require("../dist/game/entity/impl/player/Player");
const { PlayerSession } = require("../dist/net/PlayerSession");

let core, I, House, Dungeon;
before(async () => {
  await CachePipeline.initialize(path.resolve(__dirname, ".."));
  PM.loadFromDirectory(path.resolve(__dirname, "../plugins"));
  core = PM.getCoreApi();
  I = core.ItemIdentifiers;
  House = require("../plugins/skills/construction/House.Construction");
  Dungeon = require("../plugins/skills/construction/Dungeon.Construction");
  PM.emitServerStartup({});
});
after(() => PM.emitServerShutdown({}));

let next = 9730;
function guest(t) {
  const channel = { kind: "test", remoteAddress: "127.0.0.1", isOpen: () => true, send: () => true, close() {}, onData() {}, onError() {}, onClose() {} };
  const p = new Player(new PlayerSession(channel));
  p.setIndex(next++);
  p.setUsername("pohguest" + p.getIndex());
  p.setRegistered(true);
  p.setAttribute("bot-skip-persistence", true);
  t.after(() => p.setRegistered(false));
  return p;
}

function houseWithTreasure(t, player, coins) {
  const house = {
    owner: null,
    save: { treasure: { coins, addedAt: 0 } },
    getFurnitureAt: () => ({ buildableKey: "MAGIC_CHEST" }),
    getRoomPositionAt: () => ({ x: 0, y: 0, plane: 0 }),
    furnitureEntries: () => [],
  };
  t.mock.method(House, "houseFor", (who) => (who === player ? house : null));
  t.mock.method(House, "saveHouse", () => {});
  Dungeon.setChallengeMode(house, true);
  return house;
}

const open = (player) => Dungeon.openChest({ player, location: new core.Location(0, 0, 0), objectId: 1, object: null });

test("a full inventory takes nothing from the treasure chest, and the treasure stays", (t) => {
  const player = guest(t);
  const house = houseWithTreasure(t, player, 100000);
  for (let slot = 0; slot < 28; slot++) player.getInventory().setItem(slot, new core.Item(I.BRONZE_SWORD, 1));
  assert.equal(open(player), true);
  assert.equal(house.save.treasure.coins, 100000, "the treasure is still in the chest");
  assert.equal(player.getInventory().getAmount(I.COINS), 0);
});

test("a coin stack near the cap takes only what fits; the rest stays in the chest", (t) => {
  const player = guest(t);
  const house = houseWithTreasure(t, player, 100000);
  player.getInventory().setItem(0, new core.Item(I.COINS, 2147483647 - 40000));
  open(player);
  assert.equal(player.getInventory().getAmount(I.COINS), 2147483647);
  assert.equal(house.save.treasure.coins, 60000);
});

test("room for it all empties the chest", (t) => {
  const player = guest(t);
  const house = houseWithTreasure(t, player, 75000);
  open(player);
  assert.equal(player.getInventory().getAmount(I.COINS), 75000);
  assert.equal(house.save.treasure.coins, 0);
});


// Real Player.appendDeath and PlayerDeathTask boundary: an active house is safe
// before ordinary item-loss/defeat observers, on every floor and for both occupants.
function activeHouse(t, owner, visitor) {
  const Instance = require("../plugins/skills/construction/Instance.Construction");
  const save = Instance.createDefaultHouseSave();
  save.owned = true;
  save.location = 1;
  const house = new Instance.PlayerHouseInstance(save);
  house.owner = owner;
  house.enter(owner);
  if (visitor !== owner) house.enter(visitor);
  visitor.setLocation(new core.Location(house.allocation.baseX + 52, house.allocation.baseY + 52, 0));
  t.after(() => { if (!house.isDestroyed()) house.destroy(); });
  return house;
}

test("active house deaths retain items, restore all stats and exit before the ordinary death task", (t) => {
  const { PlayerDeathTask } = require("../dist/game/task/impl/PlayerDeath");
  const queued = [];
  const submit = core.TaskManager.submit;
  t.mock.method(core.TaskManager, "submit", function(task) { queued.push(task); return submit.call(this, task); });
  for (const ownerDies of [false, true]) for (const plane of [0, 1, 2, 3]) {
    const owner = guest(t), p = ownerDies ? owner : guest(t);
    const house = activeHouse(t, owner, p);
    p.setLocation(new core.Location(house.allocation.baseX + 52, house.allocation.baseY + 52, plane));
    p.getInventory().setItem(0, new core.Item(I.COINS, 123));
    p.getEquipment().setItem(core.Equipment.HEAD_SLOT, new core.Item(I.IRON_FULL_HELM, 1));
    p.getSkillManager().setCurrentLevels(core.Skill.ATTACK, 0);
    p.getSkillManager().setCurrentLevels(core.Skill.HITPOINTS, 0);
    p.getCombat().getHitQueue().addPendingDamage([new core.HitDamage(50, core.HitMask.RED)]);
    const before = queued.filter(task => task instanceof PlayerDeathTask).length;
    p.appendDeath();
    assert.equal(queued.filter(task => task instanceof PlayerDeathTask).length, before, "no unsafe task/observers");
    assert.equal(p.getPrivateArea(), null);
    assert.deepEqual([p.getLocation().getX(), p.getLocation().getY(), p.getLocation().getZ()], [2954, 3224, 0]);
    assert.equal(p.getInventory().getAmount(I.COINS), 123);
    assert.equal(p.getEquipment().get(core.Equipment.HEAD_SLOT).getId(), I.IRON_FULL_HELM);
    for (const skill of core.Skill.values()) assert.equal(p.getSkillManager().getCurrentLevel(skill), p.getSkillManager().getRestingLevel(skill));
    assert.equal(p.getCombat().getHitQueue().hasPendingWork(), false);
    assert.equal(p.isDying, false);
    assert.equal(p.getMovementQueue().isMovementBlocked(), false);
  }
});

test("outside a house still runs the actual unsafe death task and drops items", (t) => {
  const { PlayerDeathTask } = require("../dist/game/task/impl/PlayerDeath");
  const p = guest(t), killer = guest(t);
  p.setLocation(new core.Location(3100, 3600, 0));
  p.setAttribute("ironman:mode", "hardcore");
  p.getCombat().addDamage(killer, 10);
  for (let slot = 0; slot < 8; slot++) p.getInventory().setItem(slot, new core.Item(I.IRON_PLATEBODY, 1));
  const drops = [];
  const original = PlayerDeathTask.dropItems;
  t.mock.method(PlayerDeathTask, "dropItems", function(...args) { drops.push(args); return original.apply(this, args); });
  const tasks = [];
  const submit = core.TaskManager.submit;
  t.mock.method(core.TaskManager, "submit", function(task) { if (task instanceof PlayerDeathTask) tasks.push(task); return submit.call(this, task); });
  p.getSkillManager().setCurrentLevels(core.Skill.HITPOINTS, 0);
  p.appendDeath();
  assert.equal(tasks.length, 1);
  for (let tick = 0; tick < 6; tick++) core.TaskManager.process();
  assert.equal(drops.length, 1);
  assert.ok(p.getInventory().getAmount(I.IRON_PLATEBODY) < 8);
  assert.equal(p.getAttribute("ironman:mode"), "ironman", "unsafe Hardcore observer still runs");
});


test("the existing combat-ring defeat stays inside the house and does not run the whole-house reset", (t) => {
  const owner = guest(t), p = guest(t);
  const house = activeHouse(t, owner, p);
  const mat = require("../plugins/skills/construction/Ids.Construction").loc("poh_combat_mat_middle");
  const at = p.getLocation().clone();
  house.furnitureObjects.push(new core.GameObject(mat, at, 10, 0, house));
  p.getInventory().setItem(0, new core.Item(I.COINS, 77));
  p.getSkillManager().setCurrentLevels(core.Skill.ATTACK, 0);
  p.getSkillManager().setCurrentLevels(core.Skill.HITPOINTS, 0);
  p.appendDeath();
  assert.equal(p.getPrivateArea(), house);
  assert.equal(p.getHitpoints(), p.getSkillManager().getMaxLevel(core.Skill.HITPOINTS));
  assert.equal(p.getSkillManager().getCurrentLevel(core.Skill.ATTACK), 0, "ring behavior unchanged");
  assert.equal(p.getInventory().getAmount(I.COINS), 77);
  assert.notEqual(p.isDying, true);
});

test("safe-house defeat does not downgrade Hardcore or notify ordinary death observers", (t) => {
  const owner = guest(t), p = guest(t);
  activeHouse(t, owner, p);
  p.setAttribute("ironman:mode", "hardcore");
  let ordinary = 0, defeated = 0, bones = 0;
  t.mock.method(PM, "emitPlayerDeath", () => { ordinary++; return false; });
  t.mock.method(PM, "emitPlayerDefeated", () => { defeated++; });
  const emit = PM.emitCustomEvent;
  t.mock.method(PM, "emitCustomEvent", function(name, ...args) { if (name === "player:death-bones") bones++; return emit.call(this, name, ...args); });
  p.getSkillManager().setCurrentLevels(core.Skill.HITPOINTS, 0);
  p.appendDeath();
  for (let tick = 0; tick < 6; tick++) core.TaskManager.process();
  assert.equal(ordinary, 0);
  assert.equal(defeated, 0);
  assert.equal(bones, 0);
  assert.equal(p.getAttribute("ironman:mode"), "hardcore");
  assert.equal(p.getPrivateArea(), null);
});


test("destroyed or nonmember house pointers do not suppress the ordinary death task", (t) => {
  const { PlayerDeathTask } = require("../dist/game/task/impl/PlayerDeath");
  const owner = guest(t), p = guest(t);
  const house = activeHouse(t, owner, owner);
  const tasks = [];
  t.after(() => tasks.forEach(task => task.stop()));
  const submit = core.TaskManager.submit;
  t.mock.method(core.TaskManager, "submit", function(task) { if (task instanceof PlayerDeathTask) tasks.push(task); return submit.call(this, task); });
  p.setArea(house);
  p.getSkillManager().setCurrentLevels(core.Skill.HITPOINTS, 0);
  p.appendDeath();
  assert.equal(tasks.length, 1, "a nonmember pointer is not a house occupant");
  core.TaskManager.cancelTasks(p);
  house.destroy();
  const other = guest(t);
  other.setArea(house);
  other.getSkillManager().setCurrentLevels(core.Skill.HITPOINTS, 0);
  other.appendDeath();
  assert.equal(tasks.length, 2, "a destroyed house is not safe");
  core.TaskManager.cancelTasks(other);
});


test("a queued second lethal hit cannot follow the restored guest outside", (t) => {
  const owner = guest(t), p = guest(t);
  activeHouse(t, owner, p);
  const queue = p.getCombat().getHitQueue();
  p.getSkillManager().setCurrentLevels(core.Skill.HITPOINTS, 1);
  queue.addPendingDamage([new core.HitDamage(50, core.HitMask.RED), new core.HitDamage(50, core.HitMask.RED)]);
  queue.process(90001); // setHitpoints invokes appendDeath on the first lethal hit.
  assert.equal(p.getPrivateArea(), null);
  queue.process(90002);
  assert.equal(p.getHitpoints(), p.getSkillManager().getRestingLevel(core.Skill.HITPOINTS));
  assert.equal(queue.hasPendingWork(), false);
});
