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
const { Player } = require("../dist/game/entity/impl/player/Player");
const { NPC } = require("../dist/game/entity/impl/npc/NPC");
const { Item } = require("../dist/game/model/Item");
const { Equipment } = require("../dist/game/model/container/impl/Equipment");

let legends = false;
const listeners = new Map();
before(() => {
  CachePipeline.initialize();
  const core = PluginManager.getCoreApi();
  const api = new Proxy({
    core,
    emitCustomEvent: (name, event) => { if (name === "quest:is-complete" && event.key === "legends_quest") event.complete = legends; },
    getPluginConfig: (_key, fallback) => fallback,
    onCustomEvent: (name, handler) => listeners.set(name, handler),
  }, { get: (target, key) => (key in target ? target[key] : () => {}) });
  Drops.register(api);
  Drops._test.loadDrops();
});

test("ordinary gem talisman slots use the source NPC map, with ring and Legends independent", (t) => {
  const actor = new Player(null);
  const npc = new NPC(1, new Location(3222, 3218, 0));
  for (const ring of [false, true]) {
    actor.getEquipment().setItem(Equipment.RING_SLOT, ring ? new Item(2572, 1) : null);
    const denominator = ring ? 65 : 128;
    const first = ring ? 56 : 119;
    for (const complete of [false, true]) {
      legends = complete;
      for (const underground of [false, true]) {
        npc.setLocation(new Location(3222, underground ? 9618 : 3218, 0));
        actor.setLocation(new Location(3222, underground ? 3218 : 9618, 0));
        for (let slot = first; slot < first + 3; slot++) {
          t.mock.method(Math, "random", () => (slot + 0.5) / denominator);
          const request = { player: actor, npc, table: "gem", drops: [] };
          listeners.get("npc-drops:roll-shared")(request);
          assert.deepEqual(request.drops, [{ itemId: underground ? 1452 : 1462, amount: 1, noted: false }], `ring=${ring} quest=${complete} slot=${slot}`);
          t.mock.restoreAll();
        }
      }
    }
  }
});

test("gem slot boundaries and the genuine Waterbirth table keep their own rewards", (t) => {
  const actor = new Player(null);
  for (const ring of [false, true]) {
    actor.getEquipment().setItem(Equipment.RING_SLOT, ring ? new Item(2572, 1) : null);
    const denominator = ring ? 65 : 128;
    for (const [slot, expected] of [[ring ? 55 : 118, 1619], [ring ? 59 : 122, 1617]]) {
      t.mock.method(Math, "random", () => (slot + 0.5) / denominator);
      assert.equal(Drops._test.rollSharedTable("gem", actor)[0].itemId, expected);
      t.mock.restoreAll();
    }
  }
  t.mock.method(Math, "random", () => 0);
  assert.equal(Drops._test.rollSharedTable("talisman", actor)[0].itemId, 1438, "Waterbirth still begins with air talismans");
});

test("NPC table dispatch carries the source through nested gem rolls and Legends fallback", (t) => {
  const actor = new Player(null);
  actor.setLocation(new Location(3222, 9618, 0));
  const npc = new NPC(1, new Location(3222, 3218, 0));
  for (const slot of [119, 127]) {
    legends = false;
    // Bones' fixed quantity roll, Molanisk's actual 7/128 gem access, then gem slot.
    const rolls = [0, 127.5 / 128, (slot + 0.5) / 128];
    t.mock.method(Math, "random", () => rolls.shift() ?? 0.99);
    const request = { player: actor, npc, npcId: 1, drops: [] };
    listeners.get("npc-drops:roll-table")(request);
    assert.ok(request.drops.some(drop => drop.itemId === 1462), JSON.stringify(request.drops));
    assert.ok(!request.drops.some(drop => drop.itemId === 1452));
    t.mock.restoreAll();
  }
});

test("an ordinary talisman follows the NPC's copied map chunk", (t) => {
  const { TemplatedInstanceArea } = require("../dist/game/model/areas/impl/TemplatedInstanceArea");
  const area = new TemplatedInstanceArea(1, 1);
  t.after(() => area.destroy());
  const actor = new Player(null);
  actor.setLocation(new Location(3222, 3218, 0));
  const npc = new NPC(1, area.tile(2, 2, 0));
  npc.setArea(area);
  area.setChunk(0, 0, 0, { sourceChunkX: 3222 >> 3, sourceChunkY: 9618 >> 3, sourcePlane: 0, rotation: 1 });
  t.mock.method(Math, "random", () => 119.5 / 128);
  const request = { player: actor, npc, table: "gem", drops: [] };
  listeners.get("npc-drops:roll-shared")(request);
  assert.deepEqual(request.drops, [{ itemId: 1452, amount: 1, noted: false }]);
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
