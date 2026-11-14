// Run after `yarn build`: node --test tests/calcified-deposit.test.cjs
// Calcified deposit (Wiki): used on an anvil with a hammer, it is crushed one at a time, 3 ticks
// apart, for 1 Smithing XP, giving 5-15 blessed bone shards (3/4) or one calcified moth (1/4).
const assert = require("node:assert/strict");
const path = require("node:path");
const { after, before, beforeEach, test } = require("node:test");

const { Server } = require("../dist/Server");
Server.installProductionPathResolver();

const { PluginManager } = require("../dist/plugins/PluginManager");
const core = PluginManager.getCoreApi();
const { CachePipeline } = require("../dist/game/cache/CachePipeline");

let nextIndex = 3200;
const random = Math.random;

before(async () => {
  await CachePipeline.initialize(path.resolve(__dirname, ".."));
  core.ObjectDefinition.init();
  core.RegionManager.init();
  require("../plugins/skills/Smithing.plugin").register(PluginManager.createApi("Smithing"));
});

beforeEach(() => {
  Math.random = random;
});

after(() => {
  Math.random = random;
  core.TaskManager.process();
});

function anvil(name = "Anvil") {
  const id = name === "Anvil" ? core.ObjectIdentifiers.ANVIL_2 : core.ObjectIdentifiers.RANGE_17;
  const object = new core.GameObject(id, new core.Location(3078, 3404, 0), 10, 0);
  assert.equal(object.getDefinition().getName(), name);
  return object;
}

function playerWith(deposits = 3, { hammer = true } = {}) {
  const { Player } = require("../dist/game/entity/impl/player/Player");
  const { PlayerSession } = require("../dist/net/PlayerSession");
  const player = new Player(new PlayerSession({ kind: "test", isOpen: () => true, send: () => true }))
    .setUsername(`calcified${nextIndex}`).setIndex(nextIndex++);
  player.setRegistered(true);
  player.setLocation(new core.Location(3078, 3403, 0));
  player.setNeedsPlacement(false);
  if (hammer) player.getInventory().adds(core.ItemIdentifiers.HAMMER, 1);
  player.getInventory().adds(core.ItemIdentifiers.CALCIFIED_DEPOSIT, deposits);
  return player;
}

function use(player, object) {
  return PluginManager.emitItemOnObject({
    player, object, objectId: object.getId(), itemId: core.ItemIdentifiers.CALCIFIED_DEPOSIT,
    item: player.getInventory().get(0), slot: 0, handled: false,
  });
}

const depositsLeft = (player) => player.getInventory().getAmount(core.ItemIdentifiers.CALCIFIED_DEPOSIT);
const shards = (player) => player.getInventory().getAmount(core.ItemIdentifiers.BLESSED_BONE_SHARDS);
const moths = (player) => player.getInventory().getAmount(core.ItemIdentifiers.CALCIFIED_MOTH);
const smithingXp = (player) => player.getSkillManager().getExperience(core.Skill.SMITHING);

test("a deposit used on an anvil smashes one every 3 ticks until none are left, 1 Smithing XP each", (t) => {
  Math.random = () => 0.5; // shards, 10 a deposit
  const player = playerWith(3);
  t.after(() => { player.setRegistered(false); core.TaskManager.cancelTasks(player.getIndex()); });
  assert.equal(use(player, anvil()), true, "the deposit is handled");

  core.TaskManager.process();
  assert.equal(depositsLeft(player), 2, "the first deposit is crushed at once");
  assert.equal(shards(player), 10);
  assert.equal(smithingXp(player), 1);

  core.TaskManager.process();
  core.TaskManager.process();
  assert.equal(depositsLeft(player), 2, "the next is 3 ticks after the first");

  core.TaskManager.process();
  assert.equal(depositsLeft(player), 1, "three ticks later the second is crushed");
  assert.equal(shards(player), 20);

  core.TaskManager.process();
  core.TaskManager.process();
  core.TaskManager.process();
  assert.equal(depositsLeft(player), 0, "and the third");
  assert.equal(shards(player), 30);
  assert.equal(smithingXp(player), 3);

  core.TaskManager.process();
  assert.equal(shards(player), 30, "nothing more is crushed");
  assert.equal(smithingXp(player), 3);
});

test("three deposits in four give 5-15 shards, the rest a calcified moth", (t) => {
  Math.random = () => 0.9;
  const player = playerWith(2);
  t.after(() => { player.setRegistered(false); core.TaskManager.cancelTasks(player.getIndex()); });
  assert.equal(use(player, anvil()), true);
  for (let i = 0; i < 5; i++) core.TaskManager.process();
  assert.equal(depositsLeft(player), 0);
  assert.equal(shards(player), 0);
  assert.equal(moths(player), 2);
  assert.equal(smithingXp(player), 2);
});

test("without a hammer the deposit is left alone", (t) => {
  const player = playerWith(1, { hammer: false });
  t.after(() => { player.setRegistered(false); core.TaskManager.cancelTasks(player.getIndex()); });
  assert.equal(use(player, anvil()), false, "unhandled, as the ordinary anvil path ignores it");
  core.TaskManager.process();
  assert.equal(depositsLeft(player), 1);
  assert.equal(smithingXp(player), 0);
});

test("another object (a range) does not crush deposits", (t) => {
  const player = playerWith(1);
  t.after(() => { player.setRegistered(false); core.TaskManager.cancelTasks(player.getIndex()); });
  assert.equal(use(player, anvil("Range")), false);
  core.TaskManager.process();
  assert.equal(depositsLeft(player), 1);
});
