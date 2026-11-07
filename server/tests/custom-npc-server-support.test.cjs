const assert = require("node:assert/strict");
const { test } = require("node:test");

const { Server } = require("../dist/Server");
Server.installProductionPathResolver();
const { CacheDefinitions } = require("../dist/game/cache/CacheDefinitions");
const { CombatType } = require("../dist/game/content/combat/CombatType");
const { NpcDefinitionLoader } = require("../dist/game/definition/loader/impl/NpcDefinitionLoader");
const { withCustomNpcRecolors } = require("../plugins/tools/cache-editor/CustomNpcOverrides.CacheEditor.cjs");

test("custom NPC recolours compose with the base without changing it or stock rows", () => {
  const base = { recolorFrom: [10, 20, 30], recolorTo: [40, 40, 50] };
  const stock = { kind: "npc", id: 42, baseId: 1, fields: { name: "Stock" } };
  const custom = { kind: "npc", id: 50000, baseId: 42, fields: { name: "Custom" } };
  const document = { version: 1, rows: [stock, custom] };
  const core = { CacheDefinitions: { getNpc: (id) => id === 42 ? base : null } };
  const combat = { npcs: {
    42: { recolorFrom: [40], recolorTo: [99] },
    50000: { recolorFrom: [40, 50], recolorTo: [60, 70] },
  } };
  const result = withCustomNpcRecolors(core, document, combat);
  assert.equal(result.rows[0], stock);
  assert.deepEqual(result.rows[1].fields, { name: "Custom", recolorFrom: [10, 20, 30], recolorTo: [60, 60, 70] });
  assert.deepEqual(base, { recolorFrom: [10, 20, 30], recolorTo: [40, 40, 50] });
  assert.equal(custom.fields.recolorFrom, undefined);
});

test("custom combat changes never apply to a stock NPC", () => {
  const original = CacheDefinitions.hasCustomDefinition;
  CacheDefinitions.hasCustomDefinition = (kind, id) => kind === "npc" && id === 50000;
  try {
    const stock = { maxHit: 9, attackType: CombatType.MELEE, attackStyle: "crush" };
    const custom = { ...stock };
    const config = { maxHit: 35, attackType: "fire" };
    NpcDefinitionLoader.applyCustomCombat(42, stock, config);
    NpcDefinitionLoader.applyCustomCombat(50000, custom, config);
    assert.deepEqual(stock, { maxHit: 9, attackType: CombatType.MELEE, attackStyle: "crush" });
    assert.deepEqual(custom, { maxHit: 35, attackType: CombatType.MAGIC, attackStyle: "fire" });
    NpcDefinitionLoader.applyCustomCombat(50000, custom, { maxHit: 10001, attackType: "unknown" });
    assert.equal(custom.maxHit, 35);
    assert.equal(custom.attackType, CombatType.MAGIC);
  } finally {
    CacheDefinitions.hasCustomDefinition = original;
  }
});
