// Run after `yarn build`: node --test tests/npc-spawn-refine.test.cjs
// Refining spawns from live OSRS captures (scripts/refine-npc-spawns.ts, docs/npc-spawn-captures.md).
const assert = require("node:assert/strict");
const { test } = require("node:test");

const { directionOf, pairSpawns, changesFor } = require("../scripts/npc-spawn-refine.cjs");

const site = (fields) => ({ id: 1, display: "Guard", x: 10, y: 10, z: 0, labels: [], watched: 10, still_share: 1, facing: "south", facing_share: 1, ...fields });

test("facings use the spawn numbering: 1 south, 6 north", () => {
  assert.equal(directionOf("south"), 1);
  assert.equal(directionOf("north"), 6);
  assert.equal(directionOf("south-west"), 0);
  assert.equal(directionOf("north-east"), 7);
  assert.equal(directionOf("up"), null);
});

test("each spawn takes the nearest site of the same NPC, one to one, within reach", () => {
  const spawns = [{ id: 1, name: "Guard", x: 10, y: 10, level: 0 }, { id: 1, name: "Guard", x: 12, y: 10, level: 0 }];
  const sites = [site({ x: 12, y: 10 }), site({ x: 10, y: 11 }), site({ x: 30, y: 30 })];
  const pairs = pairSpawns(spawns, sites, 2).map(({ spawn, site }) => [spawn.x, site.x, site.y]);
  assert.deepEqual(pairs.sort(), [[10, 10, 11], [12, 12, 10]]);
  // Interchangeable copies (another id, same name) pair too; another plane doesn't.
  assert.equal(pairSpawns([{ id: 2, name: "Guard", x: 10, y: 10, level: 0 }], [site({})], 2).length, 1);
  assert.equal(pairSpawns([{ id: 1, name: "Guard", x: 10, y: 10, level: 1 }], [site({})], 2).length, 0);
});

test("a reliable standing site stops the spawn wandering and sets a facing that differs", () => {
  const spawn = { id: 1, name: "Guard", x: 10, y: 10, level: 0 };
  assert.deepEqual(changesFor(spawn, site({}), { defaultDirection: 1 }), { wanderRadius: 0 }, "south is the default already");
  assert.deepEqual(changesFor(spawn, site({ facing: "west" }), { defaultDirection: 1 }), { wanderRadius: 0, direction: 3 });
  assert.deepEqual(changesFor({ ...spawn, wanderRadius: 0, direction: 3 }, site({ facing: "west" }), { defaultDirection: 1 }), {}, "nothing left to change");
  assert.deepEqual(changesFor(spawn, site({ facing: "west", facing_share: 0.33 }), { defaultDirection: 1 }), { wanderRadius: 0 }, "no majority: left alone");
  // A clerk turning to serve players still faces its side of the booth in most sightings.
  assert.deepEqual(changesFor(spawn, site({ facing: "north", facing_share: 0.61 }), { defaultDirection: 1 }), { wanderRadius: 0, direction: 6 });
});

test("labelled, unreliable or wandering sites change nothing", () => {
  const spawn = { id: 1, name: "Guard", x: 10, y: 10, level: 0 };
  for (const fields of [{ labels: ["follower"] }, { labels: ["instance"] }, { watched: 2 }, { still_share: 0.5 }, { still_share: null }]) {
    assert.deepEqual(changesFor(spawn, site({ facing: "west", ...fields }), { defaultDirection: 1 }), {}, JSON.stringify(fields));
  }
});

test("the refined spawns: Iffie stands still, soldiers face their posts, the Grand Exchange faces out", () => {
  const spawns = require("../data/definitions/npc-spawns.json");
  const at = (name, x, y) => spawns.find((spawn) => spawn.name === name && spawn.x === x && spawn.y === y);
  assert.equal(at("Iffie", 3204, 3419).wanderRadius, 0);
  assert.equal(at("Iffie", 3204, 3419).direction, undefined, "south is the default");
  assert.deepEqual([at("Soldier", 1468, 3682).direction, at("Soldier", 1468, 3682).wanderRadius], [3, 0], "west");
  assert.equal(at("Banker", 3163, 3489).direction, 3, "the Grand Exchange's west banker faces west");
  assert.equal(at("Grand Exchange Clerk", 3164, 3491).direction, 6, "its north clerks face north");
  assert.equal(at("Grand Exchange Clerk", 3164, 3488).direction, undefined, "its south clerks keep south");
});

test("the Wiki-added spawns are refined too: Varlamore's guards stand still, the Hunter Guild faces north", () => {
  const spawns = require("../data/definitions/npc-spawns.json");
  const at = (name, x, y) => spawns.find((spawn) => spawn.name === name && spawn.x === x && spawn.y === y);
  assert.equal(at("Guard", 1434, 3123).wanderRadius, 0);
  assert.deepEqual([at("Pellem", 1565, 3035).direction, at("Pellem", 1565, 3035).wanderRadius], [6, 0]);
  assert.deepEqual([at("Guildmaster Apatura", 1555, 3035).direction, at("Shipwright Scott", 1883, 3296).direction], [6, 3]);
});

test("the Shayzien drill formation stands still: the rows face north, the Drill Sergeant south", () => {
  const spawns = require("../data/definitions/npc-spawns.json");
  const formation = spawns.filter((spawn) => spawn.x >= 1503 && spawn.x <= 1517 && [3639, 3641, 3643, 3645].includes(spawn.y)
    && (spawn.x - 1503) % 2 === 0 && spawn.name === "Soldier");
  // Four rows of eight, the second missing (1505, 3641), as in live OSRS.
  assert.equal(formation.length, 31);
  for (const spawn of formation) assert.deepEqual([spawn.direction, spawn.wanderRadius], [6, 0], `${spawn.x},${spawn.y}`);
  const sergeant = spawns.find((spawn) => spawn.x === 1510 && spawn.y === 3647 && spawn.id === 6882);
  assert.deepEqual([sergeant.name, sergeant.direction, sergeant.wanderRadius], ["Drill Sergeant", undefined, 0], "faces the rows: south, the default");
});

test("an NPC that walks and can't be attacked gets the range its sightings stayed in, never wider", () => {
  const spawn = { id: 1, name: "Bartender", x: 10, y: 10, level: 0 };
  const walking = (fields) => site({ still_share: 0.12, range_p90: 2, ...fields });
  assert.deepEqual(changesFor(spawn, walking({}), { attackable: false }), { wanderRadius: 2 }, "the default 5 tightens to 2");
  assert.deepEqual(changesFor(spawn, walking({ range_p90: 0 }), { attackable: false }), { wanderRadius: 1 }, "a walker keeps at least 1");
  assert.deepEqual(changesFor({ ...spawn, wanderRadius: 2 }, walking({}), { attackable: false }), {}, "already there");
  assert.deepEqual(changesFor({ ...spawn, wanderRadius: 1 }, walking({}), { attackable: false }), {}, "never widened");
  assert.deepEqual(changesFor(spawn, walking({ range_p90: 9 }), { attackable: false }), {}, "never past the default either");
  assert.deepEqual(changesFor(spawn, walking({}), { attackable: true }), {}, "a monster's sightings include chases");
  assert.deepEqual(changesFor(spawn, walking({ labels: ["unnamed"] }), { attackable: false }), { wanderRadius: 2 }, "a nameless multinpc parent (Aubury)");
  assert.deepEqual(changesFor(spawn, walking({ labels: ["roaming"] }), { attackable: false }), {});
});

test("the Blue Moon Inn bartender and Aubury stay in their rooms (#1706)", () => {
  const spawns = require("../data/definitions/npc-spawns.json");
  const at = (name, x, y) => spawns.find((spawn) => spawn.name === name && spawn.x === x && spawn.y === y);
  assert.equal(at("Bartender", 3226, 3399).wanderRadius, 2);
  assert.equal(at("Aubury", 3253, 3402).wanderRadius, 3);
});
