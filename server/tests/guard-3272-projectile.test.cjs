// Run after `yarn build`: node --test tests/guard-3272-projectile.test.cjs
// Issue #2453: cache NPC 3272 is FAI_FALADOR_GUARD4, a level-22 Falador longbow
// guard. The Wiki writes its id as "11947,hist3272"; dropping the historical id
// made the generated dump fall back to the Guard page's first infobox (the
// level-21 Edgeville swordsman), so the NPC fought in melee while drawing a bow
// and no arrow ever appeared.
const assert = require("node:assert/strict");
const { before, test } = require("node:test");
const { Server } = require("../dist/Server");
Server.installProductionPathResolver();

const { CachePipeline } = require("../dist/game/cache/CachePipeline");
const { CombatFactory } = require("../dist/game/content/combat/CombatFactory");
const { CombatType } = require("../dist/game/content/combat/CombatType");
const { NpcDefinition } = require("../dist/game/definition/NpcDefinition");
const { NpcDefinitionLoader } = require("../dist/game/definition/loader/impl/NpcDefinitionLoader");
const { NPC } = require("../dist/game/entity/impl/npc/NPC");
const { Location } = require("../dist/game/model/Location");
const { World } = require("../dist/game/World");

before(async () => {
  await CachePipeline.initialize(process.cwd());
  new NpcDefinitionLoader().load();
});

test("guard 3272 uses the Falador longbow guard's ranged stats and animation", () => {
  const definition = NpcDefinition.forId(3272);
  assert.equal(definition.getName(), "Guard");
  assert.equal(definition.getCombatLevel(), 22);
  assert.equal(definition.getAttackType(), CombatType.RANGED);
  assert.equal(definition.getStats()[3], 26, "ranged level");
  assert.equal(definition.getAttackSpeed(), 6);
  assert.equal(definition.getAttackAnim(), 426, "human_bow");
});

test("guard 3272's selected combat method fires the bronze-arrow projectile", () => {
  const guard = NPC.create(3272, new Location(3202, 3200, 0));
  assert.equal(guard.getCombatMethod(), CombatFactory.RANGED_COMBAT);

  const sent = [];
  const target = {
    getIndex: () => 7,
    isPlayer: () => true,
    isNpc: () => false,
    getLocation: () => new Location(3200, 3200, 0),
    getSize: () => 1,
    getPrivateArea: () => null,
  };
  const recipient = {
    getPrivateArea: () => null,
    getLocation: () => new Location(3200, 3200, 0),
    getNpcViewDistance: () => 15,
    getPacketSender: () => ({ sendProjectile: (...args) => sent.push(args) }),
  };
  const original = World.forEachNetworkPlayer;
  World.forEachNetworkPlayer = (visit) => visit(recipient);
  try {
    guard.getCombatMethod().start(guard, target);
  } finally {
    World.forEachNetworkPlayer = original;
  }

  assert.equal(sent.length, 1);
  const [, , , end, projectileId, , , , delay] = sent[0];
  assert.equal(projectileId, 10, "bronze arrow travel spotanim");
  assert.equal(delay, 41, "bow launch");
  assert.equal(end, 46 + 5 * 2, "two tiles of arrow flight");
});
