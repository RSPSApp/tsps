// Run with: node --test server/tests/vorkath-combat.test.cjs
// Pure Vorkath combat math: no server boot needed.
const assert = require("node:assert/strict");
const { test } = require("node:test");
const Shared = require("../plugins/bosses/vorkath/Shared.Vorkath");
const Area = require("../plugins/bosses/vorkath/Area.Vorkath");

test("crater bounds cover the arena but not the wall line", () => {
  const at = (x, y, z = 0) => ({ getX: () => x, getY: () => y, getZ: () => z });
  assert.equal(Area.insideCrater(at(2272, 4054)), true);
  assert.equal(Area.insideCrater(at(2269, 4062)), true);
  assert.equal(Area.insideCrater(at(2282, 4075)), true);
  assert.equal(Area.insideCrater(at(2272, 4053)), false);
  assert.equal(Area.insideCrater(at(2272, 4052)), false);
  assert.equal(Area.insideCrater(at(2272, 4054, 1)), false);
  assert.equal(Area.insideCrater(null), false);
});

test("standard attacks follow the captured mix", () => {
  // From range (rsprox captures): ranged 30, magic 24, dragonfire 15, venom 11, fireball 11, prayer 8.
  const away = (roll) => Shared.chooseStandard({ adjacent: false, roll: () => roll });
  assert.equal(away(0), "ranged");
  assert.equal(away(29), "ranged");
  assert.equal(away(30), "magic");
  assert.equal(away(53), "magic");
  assert.equal(away(54), "dragonfire");
  assert.equal(away(69), "venom");
  assert.equal(away(80), "fireball");
  assert.equal(away(91), "prayer");
  assert.equal(away(98), "prayer");
  // In melee distance, melee comes first with 19 of 118 (about 16%, as captured).
  const adjacent = (roll) => Shared.chooseStandard({ adjacent: true, roll: () => roll });
  assert.equal(adjacent(0), "melee");
  assert.equal(adjacent(18), "melee");
  assert.equal(adjacent(19), "ranged");
  assert.equal(adjacent(117), "prayer");
});

test("her shots leave her head and land 70 + 5 cycles a tile later", () => {
  const { Location } = require("../dist/game/model/Location");
  const { Projectile } = require("../dist/game/model/Projectile");
  const core = { Projectile, Location };
  const npc = { getLocation: () => new Location(2269, 4062, 0), getSize: () => 7 };
  const south = { getLocation: () => new Location(2272, 4058, 0) };
  const head = Shared.headTile(core, npc, south);
  assert.deepEqual([head.getX() - 2269, head.getY() - 4062], [3, 1], "captured: (3, 1) for a target to the south");
  assert.equal(Shared.SHOT.base + Shared.SHOT.perTile * head.getDistance(south.getLocation()), 95, "5 tiles: 95, as captured");
  assert.equal(Shared.shotHitDelay(80), 2);
  assert.equal(Shared.shotHitDelay(115), 3);
});

test("dragonfire caps follow the shield/prayer/potion pipeline", () => {
  const caps = (shield, prayer, potion, variant) =>
    Shared.dragonfireCaps({ shield, prayer, potion, variant });
  assert.deepEqual(caps(false, false, "none", "normal"), { cap: 80, resistedCap: 50, reduction: 0, variantPenalty: 0 });
  assert.deepEqual(caps(false, true, "none", "normal").cap, 30);
  assert.deepEqual(caps(true, false, "none", "normal"), { cap: 20, resistedCap: 20, reduction: 0, variantPenalty: 0 });
  assert.deepEqual(caps(false, false, "super", "normal").reduction, 20);
  assert.deepEqual(caps(false, false, "antifire", "normal").reduction, 10);
  assert.deepEqual(caps(true, true, "super", "venom").variantPenalty, 5);
  // Shield + super antifire fully absorbs every variant.
  for (const variant of ["normal", "venom", "prayer"]) {
    const c = caps(true, true, "super", variant);
    assert.ok(c.cap - c.reduction - c.variantPenalty <= 0, variant);
  }
});

test("fireball damage falls off with distance", () => {
  assert.equal(Shared.fireballDamage(121, 0), 121);
  assert.equal(Shared.fireballDamage(121, 1), 60);
  assert.equal(Shared.fireballDamage(121, 2), 0);
  assert.equal(Shared.fireballDamage(0, 0), 0);
});

test("spawn explosion scales with remaining hitpoints", () => {
  assert.equal(Shared.spawnExplosionDamage(38), 60);
  assert.equal(Shared.spawnExplosionDamage(19), 30);
  assert.equal(Shared.spawnExplosionDamage(1), 1);
  assert.equal(Shared.spawnExplosionDamage(0), 0);
  assert.equal(Shared.spawnExplosionDamage(999), 60);
  assert.equal(Shared.spawnExplosionDamage(-5), 0);
});

test("acid pools cover the grid, the player tile, and never the boss", () => {
  const walkable = () => true;
  const pools = Shared.acidPoolTiles(2269, 4062, 2272, 4058, walkable, () => 0);
  // 48 cells, 8 edge tiles and the player's tile, which may coincide with a cell pick:
  // 56 or 57, as captured.
  assert.ok(pools.length === 56 || pools.length === 57, `count ${pools.length}`);
  const keys = new Set(pools.map(([x, y]) => `${x},${y}`));
  assert.equal(keys.size, pools.length);
  assert.ok(keys.has("2272,4058"));
  for (const [x, y] of pools) {
    assert.ok(!Shared.underBoss(2269, 4062, x, y), `pool under boss at ${x},${y}`);
  }
});

test("the edge pools sit one tile outside the grid, two a side (captured)", () => {
  const pools = Shared.acidPoolTiles(2269, 4062, 2272, 4058, () => true, () => 0);
  const keys = new Set(pools.map(([x, y]) => `${x},${y}`));
  // Grid origin (2262, 4055), 21 tiles a side; pick 0 takes offsets 4 and 14.
  for (const tile of ["2266,4054", "2276,4054", "2266,4076", "2276,4076", "2261,4059", "2261,4069", "2283,4059", "2283,4069"]) {
    assert.ok(keys.has(tile), tile);
  }
});

test("spawn landing needs a clear straight path around her body", () => {
  const walkable = () => true;
  // South of her, same corridor as the observed live landing: clear.
  assert.equal(Shared.hasClearPath(2262, 4062, 2272, 4061, 2269, 4062, walkable), true);
  // Through her body: blocked.
  assert.equal(Shared.hasClearPath(2272, 4071, 2272, 4061, 2269, 4062, walkable), false);
  // Blocked tile on the way: rejected.
  assert.equal(Shared.hasClearPath(2262, 4062, 2272, 4061, 2269, 4062, (x) => x < 2268), false);
});

test("acid pools skip unwalkable tiles", () => {
  const walkable = (x, y) => (x + y) % 2 === 0;
  const pools = Shared.acidPoolTiles(2269, 4062, 2272, 4058, walkable, () => 0);
  for (const [x, y] of pools) {
    assert.ok((x + y) % 2 === 0, `pool on blocked tile ${x},${y}`);
    assert.ok(!Shared.underBoss(2269, 4062, x, y));
  }
});

test("breath messages name the protection and the breath, as captured", () => {
  require("../dist/Server").Server.installProductionPathResolver();
  const { breathMessages } = require("../plugins/bosses/vorkath/Combat.Vorkath")._test;
  assert.deepEqual(breathMessages({ prayer: true, shield: false, potion: "super" }, "dragonfire"), [
    "Your prayers resist some of the dragon's fiery breath!",
    "Your super antifire potion helps to protect you from the dragon's fiery breath!",
  ]);
  assert.deepEqual(breathMessages({ prayer: false, shield: true, potion: "antifire" }, "venom"), [
    "Your shield absorbs most of the dragon's venomous breath!",
    "Your antifire potion helps to protect you from the dragon's breath!",
  ]);
  assert.deepEqual(breathMessages({ prayer: false, shield: false, potion: "super" }, "prayer"), [
    "You're horribly burnt by the dragon's corrupting breath!",
    "Your super antifire potion helps to protect you from the dragon's corrupting breath!",
  ]);
});

test("each shot plays its launch sounds and an impact sound timed to its landing (captured)", () => {
  const played = [];
  const player = { getPacketSender: () => ({ sendSoundEffect: (id, loops, delay) => played.push([id, delay]) }) };
  Shared.playShotSounds(player, "ranged", 115);
  assert.deepEqual(played, [[408, 10], [1965, 20], [3403, 115]]);
  played.length = 0;
  Shared.playShotSounds(player, "prayer", 80);
  assert.deepEqual(played, [[284, 0], [3750, 15], [135, 80]]);
});

test("the boss bar shows her at 750 and follows her hitpoints (captured)", () => {
  const Hud = require("../plugins/bosses/vorkath/Hud.Vorkath");
  const events = [];
  let hp = 750;
  const npc = { getHitpoints: () => hp };
  const player = { isRegistered: () => true };
  Hud.attach({ core: { Task: class {}, TaskManager: { submit() {} } }, emitCustomEvent: (name, payload) => events.push([name, payload]) });
  Hud.show(npc, player);
  assert.deepEqual(events[0], ["boss-hud:show", { player, npcId: 8061, current: 750, maximum: 750 }]);
  Hud.tick();
  assert.equal(events.length, 1, "nothing sent while her hitpoints stay");
  hp = 713;
  Hud.tick();
  assert.deepEqual(events[1], ["boss-hud:update", { player, current: 713 }]);
  Hud.dropFor(player);
  assert.deepEqual(events[2], ["boss-hud:hide", { player, fade: false, afterTicks: 0 }]);
});

test("her loot lands on the nearest walkable tile one step out from her body (captured)", () => {
  require("../dist/Server").Server.installProductionPathResolver();
  const { lootTile } = require("../plugins/bosses/vorkath/Wake.Vorkath");
  const base = { x: 2269, y: 4062 };
  const at = (x, y) => ({ getLocation: () => ({ getX: () => x, getY: () => y }) });
  const all = () => true;
  assert.deepEqual(lootTile(base, at(2272, 4058), all), [2272, 4061], "south of her: the middle of her south side");
  assert.deepEqual(lootTile(base, at(2263, 4060), all), [2268, 4061], "south-west: her south-west corner");
  // The south middle blocked: the next nearest, never under her.
  assert.deepEqual(lootTile(base, at(2272, 4058), (x, y) => !(x === 2272 && y === 4061), () => 0), [2268, 4061]);
  assert.equal(lootTile(base, at(2272, 4058), () => false), null);
});
