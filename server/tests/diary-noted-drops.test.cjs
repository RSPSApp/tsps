// Achievement diary rewards that note an NPC's drops. Run with:
//   node --test tests/diary-noted-drops.test.cjs
const assert = require("node:assert/strict");
const { test } = require("node:test");

const attach = require("../plugins/achievements/diaries/NotedDrops.AchievementDiaries");

const Item = {
  DRAGON_BONES: 536,
  RED_DRAGONHIDE: 1749,
  BRONZE_BAR: 2349,
  IRON_BAR: 2351,
  STEEL_BAR: 2353,
  ADAMANTITE_BAR: 2361,
  MOLE_CLAW: 7416,
  MOLE_SKIN: 7418,
  GOAT_HORN: 9735,
  BIG_BONES: 532,
  COINS: 995,
};

const handlers = new Map();
const wildernessTiles = (location) => location.getY() >= 3523 && location.getY() < 3900 && location.getX() > 2944;
attach({
  core: { ItemIdentifiers: Item, Wilderness: { isInLocation: wildernessTiles } },
  onCustomEvent(name, handler) { handlers.set(name, handler); },
  emitCustomEvent(name, request) {
    if (name === "diary:is-complete") request.complete = request.player.completeTiers.has(`${request.diary}:${request.tier}`);
  },
});

const loc = (x, y, z = 0) => ({ getX: () => x, getY: () => y, getZ: () => z });
const npc = (name, x, y) => ({ getId: () => 1, getDefinition: () => ({ getName: () => name }), getLocation: () => loc(x, y) });
const player = (...tiers) => ({ completeTiers: new Set(tiers), isPlayer: () => true });

function noted(p, n, itemIds) {
  const drops = itemIds.map((itemId) => ({ itemId, amount: 1, noted: false }));
  handlers.get("npc-drops:roll")({ player: p, npc: n, npcId: n.getId(), drops });
  return drops.map((drop) => drop.noted);
}

const GOAT = npc("Goat", 3300, 3000);
const MOLE = npc("Giant Mole", 1760, 5180);
const BRIMHAVEN = { x: 2711, y: 9516 }; // a real red dragon spawn; the iron dragon one is 2714,9449

test("easy Desert Diary notes the goat horn", () => {
  assert.deepEqual(noted(player("desert:easy"), GOAT, [Item.GOAT_HORN, Item.BIG_BONES]), [true, false]);
  assert.deepEqual(noted(player("desert:medium", "desert:hard"), GOAT, [Item.GOAT_HORN]), [false]);
  assert.deepEqual(noted(player("desert:easy"), npc("Billy Goat", 3300, 3000), [Item.GOAT_HORN, Item.BIG_BONES]), [true, false]);
  assert.deepEqual(noted(player("desert:easy"), npc("Cow", 3300, 3000), [Item.GOAT_HORN]), [false]);
});

test("hard Falador Diary notes the Giant Mole's skin and claw", () => {
  assert.deepEqual(noted(player("falador:hard"), MOLE, [Item.MOLE_SKIN, Item.MOLE_CLAW, Item.BIG_BONES]), [true, true, false]);
  assert.deepEqual(noted(player("falador:easy", "falador:medium", "falador:elite"), MOLE, [Item.MOLE_SKIN]), [false]);
});

test("elite Karamja Diary notes red dragonhide and metal dragon bars in the Brimhaven Dungeon", () => {
  const elite = player("karamja:elite");
  assert.deepEqual(noted(elite, npc("Red dragon", BRIMHAVEN.x, BRIMHAVEN.y), [Item.RED_DRAGONHIDE, Item.DRAGON_BONES]), [true, false]);
  for (const [name, bar] of [["Bronze dragon", Item.BRONZE_BAR], ["Iron dragon", Item.IRON_BAR], ["Steel dragon", Item.STEEL_BAR]]) {
    assert.deepEqual(noted(elite, npc(name, BRIMHAVEN.x, BRIMHAVEN.y), [bar, Item.DRAGON_BONES]), [true, false], name);
  }
  assert.deepEqual(noted(elite, npc("Iron dragon", 2714, 9449), [Item.IRON_BAR]), [true]);
  assert.deepEqual(noted(elite, npc("Red dragon", 2724, 9550), [Item.RED_DRAGONHIDE]), [true]);
  assert.deepEqual(noted(player("karamja:hard"), npc("Red dragon", BRIMHAVEN.x, BRIMHAVEN.y), [Item.RED_DRAGONHIDE]), [false]);
  // The same dragons elsewhere (Lithkren, the Catacombs) drop as they always did.
  assert.deepEqual(noted(elite, npc("Red dragon", 1560, 5070), [Item.RED_DRAGONHIDE]), [false]);
  assert.deepEqual(noted(elite, npc("Steel dragon", 1620, 10080), [Item.STEEL_BAR]), [false]);
});

test("elite Wilderness Diary notes dragon bones dropped in the Wilderness, not the King Black Dragon's", () => {
  const elite = player("wilderness:elite");
  assert.deepEqual(noted(elite, npc("Green dragon", 3340, 3680), [Item.DRAGON_BONES, Item.COINS]), [true, false]);
  assert.deepEqual(noted(elite, npc("Black dragon", 3300, 3640), [Item.DRAGON_BONES]), [true]);
  assert.deepEqual(noted(elite, npc("King Black Dragon", 3050, 3700), [Item.DRAGON_BONES]), [false]);
  assert.deepEqual(noted(elite, npc("Green dragon", 3340, 3200), [Item.DRAGON_BONES]), [false]);
  assert.deepEqual(noted(player("wilderness:hard"), npc("Green dragon", 3340, 3680), [Item.DRAGON_BONES]), [false]);
});

test("drops are left alone when no player earned them", () => {
  assert.deepEqual(noted({ isPlayer: () => false, completeTiers: new Set() }, GOAT, [Item.GOAT_HORN]), [false]);
});
