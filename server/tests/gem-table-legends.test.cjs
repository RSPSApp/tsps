// Run after `yarn build`: node --test tests/gem-table-legends.test.cjs
//
// Wiki (Gem drop table, note 4): "The Mega-rare drop table is replaced by a talisman if Legends' Quest is not
// completed" - the gem table's talisman: nature above ground, chaos underground. Through the rare drop table's own
// mega-rare slot nothing is needed (Wiki, Rare drop table).
const assert = require("node:assert/strict");
const { test, before } = require("node:test");
require("../dist/Server").Server.installProductionPathResolver();
const { CachePipeline } = require("../dist/game/cache/CachePipeline");
const { PluginManager } = require("../dist/plugins/PluginManager");
const { Location } = require("../dist/game/model/Location");
const Drops = require("../plugins/npcs/NpcDrops.plugin");

let legends = false;
before(() => {
  CachePipeline.initialize();
  const core = PluginManager.getCoreApi();
  const api = new Proxy({
    core,
    emitCustomEvent: (name, event) => { if (name === "quest:is-complete" && event.key === "legends_quest") event.complete = legends; },
    getPluginConfig: (_key, fallback) => fallback,
  }, { get: (target, key) => (key in target ? target[key] : () => {}) });
  Drops.register(api);
  Drops._test.loadDrops();
});

const player = (x, y) => ({ getLocation: () => new Location(x, y, 0), getEquipment: () => ({ get: () => null, getItems: () => [] }) });

/** Rolls `table` with every roll the last slot (the gem table's mega-rare slot is its last, 1/128). */
function lastSlot(t, table, who) {
  t.mock.method(Math, "random", () => 0.999999);
  try { return Drops._test.rollSharedTable(table, who); } finally { t.mock.restoreAll(); }
}

test("gem table -> mega-rare without Legends' Quest: a nature talisman above ground, chaos underground", (t) => {
  legends = false;
  const NATURE = 1462, CHAOS = 1452;
  assert.deepEqual(lastSlot(t, "gem", player(3222, 3218)), [{ itemId: NATURE, amount: 1, noted: false }]);
  assert.deepEqual(lastSlot(t, "gem", player(3222, 9618)), [{ itemId: CHAOS, amount: 1, noted: false }]);
});

test("with Legends' Quest the gem table reaches the mega-rare table", (t) => {
  legends = true;
  const drop = lastSlot(t, "gem", player(3222, 3218));
  const megaIds = new Set(Drops._test.sharedTables.get("megaRare").filter((e) => e.itemId).map((e) => e.itemId));
  assert.ok(drop.length === 0 || megaIds.has(drop[0].itemId), JSON.stringify(drop));
  assert.ok(![1462, 1452].includes(drop[0]?.itemId), "not the talisman");
});

test("a templated instance's talisman follows the map it copies, not its slot's y", (t) => {
  legends = false;
  const NATURE = 1462, CHAOS = 1452;
  const { TemplatedInstanceArea } = require("../dist/game/model/areas/impl/TemplatedInstanceArea");
  const areas = [];
  t.after(() => { for (const area of areas) area.destroy(); });
  // Slots fill a row at a time; take them until one sits at y 6400+ (row 22 on).
  let area;
  do { area = new TemplatedInstanceArea(1, 1); areas.push(area); } while (area.getBaseY() < 6400);
  const inside = (z = 0) => ({ ...player(area.getBaseX() + 3, area.getBaseY() + 4), getLocation: () => area.tile(3, 4, z), getPrivateArea: () => area });
  area.setChunk(0, 0, 0, { sourceChunkX: 3222 >> 3, sourceChunkY: 3218 >> 3, sourcePlane: 0, rotation: 1 });
  assert.deepEqual(lastSlot(t, "gem", inside()), [{ itemId: NATURE, amount: 1, noted: false }], "a copy of Lumbridge is above ground");
  area.setChunk(0, 0, 0, { sourceChunkX: 3222 >> 3, sourceChunkY: 9618 >> 3, sourcePlane: 0, rotation: 0 });
  assert.deepEqual(lastSlot(t, "gem", inside()), [{ itemId: CHAOS, amount: 1, noted: false }], "a copy of a dungeon is underground");
  // A low slot copying a dungeon is underground too.
  const low = areas[0];
  low.setChunk(0, 0, 0, { sourceChunkX: 3222 >> 3, sourceChunkY: 9618 >> 3, sourcePlane: 0, rotation: 0 });
  assert.ok(low.getBaseY() < 6400);
  assert.deepEqual(lastSlot(t, "gem", { ...player(0, 0), getLocation: () => low.tile(1, 1, 0), getPrivateArea: () => low }), [{ itemId: CHAOS, amount: 1, noted: false }]);
  // Outside any instance (or on a tile no chunk was copied to) the tile's own y still decides.
  assert.deepEqual(lastSlot(t, "gem", { ...player(3222, 9618), getPrivateArea: () => null }), [{ itemId: CHAOS, amount: 1, noted: false }]);
});
