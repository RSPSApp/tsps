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

  // Issue #3610: captures 1579/4101 show spotanim 19 (the arrow on the bow) on the
  // guard with the shot, beside human_bow 426.
  assert.equal(guard.getGraphic().getId(), 19, "arrow drawn on the bow");
  assert.equal(guard.getGraphic().getDelay(), 0);
  assert.equal(guard.getGraphic().getHeight(), 96, "captured draw height");

  assert.equal(sent.length, 1);
  const [, , , end, projectileId, , , , delay] = sent[0];
  assert.equal(projectileId, 10, "bronze arrow travel spotanim");
  assert.equal(delay, 41, "bow launch");
  assert.equal(end, 46 + 5 * 2, "two tiles of arrow flight");
});

// Issue #3610: every archer's flight projectile and the draw spotanim it plays on the
// shot's tick, as captured in rsprox (NPC id: [capture ids, projectile, launch spotanim]).
const CAPTURED_ARCHERS = {
  796: [[101, 1788, 3015], 13, 22],
  3160: [[801, 1463], 15, 24],
  3274: [[1377, 1433, 1540, 1579], 10, 19],
  3428: [[2967, 2969], 249, 250],
  4096: [[1685], 9, 18],
  7420: [[821, 822], 12, 21],
  7421: [[821, 822], 12, 21],
  11947: [[1377, 1579, 4101], 10, 19],
  13467: [[470, 471, 472, 473, 474, 475], 14, 23],
  13468: [[471, 472, 474, 475, 476, 1698], 14, 23],
  14407: [[1162, 3128], 9, 18],
  14408: [[3128], 9, 18],
  14665: [[1105], 9, 18],
  14666: [[1098], 9, 18],
  // Not captured by id: the cache id of the same Falador longbow guard as 11947 (#2453).
  3272: [[1377, 1579, 4101], 10, 19],
};

test("captured archers fire their captured projectile and draw spotanim", () => {
  for (const [id, [, projectile, launch]] of Object.entries(CAPTURED_ARCHERS)) {
    const definition = NpcDefinition.forId(Number(id));
    assert.equal(definition.getProjectileId(), projectile, `npc ${id} projectile`);
    assert.equal(definition.getLaunchGraphicId(), launch, `npc ${id} launch spotanim`);
    assert.equal(definition.getAttackType(), CombatType.RANGED, `npc ${id} is ranged`);
  }
});

test("an archer's shot plays its draw spotanim and sends its projectile", () => {
  const archer = NPC.create(14665, new Location(3202, 3200, 0));
  const sent = [];
  const target = {
    getIndex: () => 7, isPlayer: () => true, isNpc: () => false,
    getLocation: () => new Location(3200, 3200, 0), getSize: () => 1, getPrivateArea: () => null,
  };
  const recipient = {
    getPrivateArea: () => null, getLocation: () => new Location(3200, 3200, 0), getNpcViewDistance: () => 15,
    getPacketSender: () => ({ sendProjectile: (...args) => sent.push(args) }),
  };
  const original = World.forEachNetworkPlayer;
  World.forEachNetworkPlayer = (visit) => visit(recipient);
  try {
    archer.getCombatMethod().start(archer, target);
  } finally {
    World.forEachNetworkPlayer = original;
  }
  assert.equal(archer.getGraphic().getId(), 18, "iron arrow drawn on the bow");
  assert.equal(sent[0][4], 9, "iron arrow flight");
});
