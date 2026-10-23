// Run after `yarn build`: node --test tests/npc-spawns-sync.test.cjs
// The Wiki spawn sync (scripts/sync-npc-spawns.ts, docs/npc-spawns.md): reading the Wiki's
// coordinates, adding only what's missing, and the Wyrmscraig spawns it wrote.
const assert = require('node:assert/strict');
const path = require('node:path');
const { test } = require('node:test');

const { versionIds, parsePoint, parseInfoboxMaps, parseBox, inBoxes, planAdditions, parseLocLines, locationName } = require('../scripts/npc-spawn-matching.cjs');

test("reads the Wiki's coordinate forms", () => {
  assert.deepEqual(parsePoint('x:2580,y:8589'), { x: 2580, y: 8589 });
  assert.deepEqual(parsePoint('2615,8625'), { x: 2615, y: 8625 });
  assert.equal(parsePoint('zoom=3'), null);
  // Cormac: a square around one tile; Mortimer: named coordinates on a plane.
  assert.deepEqual(parseInfoboxMaps('|map = {{Map|2576,2253|mtype=square|r=3|zoom=3}}'),
    [{ version: null, points: [{ x: 2576, y: 2253 }], plane: 0, mapId: null }]);
  assert.deepEqual(parseInfoboxMaps('|map2 = {{Map|x=2589|y=8614|plane=1|r=4|mapID=-1|mtype=pin}}'),
    [{ version: 2, points: [{ x: 2589, y: 8614 }], plane: 1, mapId: -1 }]);
  // Muriel: a polygon outlining an area is one spawn at its centre.
  assert.deepEqual(parseInfoboxMaps('|map = {{Map|2584,2255|2589,2255|2589,2264|2586,2264|2586,2261|2584,2261|mtype=polygon|r=3|zoom=3}}'),
    [{ version: null, points: [{ x: 2587, y: 2260 }], plane: 0, mapId: null }]);
  const box = parseBox('2640,2290,2530,2190');
  assert.ok(inBoxes({ x: 2576, y: 2253, level: 2 }, [box]), 'every plane unless given');
  assert.ok(!inBoxes({ x: 2576, y: 2253, level: 2 }, [parseBox('2530,2190,2640,2290,0')]));
});

test("reads the place names monster LocLines and NPC infoboxes give", () => {
  assert.deepEqual(parseLocLines('{{LocLine|name=Wyrm|location=[[Wyrmscraig Cavern|the cavern]]|plane=0|x:2615,y:8625|x:2614,y:8619}}'),
    [{ location: 'Wyrmscraig Cavern', plane: 0, points: [{ x: 2615, y: 8625 }, { x: 2614, y: 8619 }] }]);
  assert.deepEqual(parseLocLines('{{LocLine\n|location=North of [[Varrock]]\n|plane=1\n|x:3200,y:3500}}')[0].location, 'Varrock');
  assert.equal(locationName('[[Lumbridge Castle]] kitchen'), 'Lumbridge Castle');
});

test('lines up a Wiki map layer with existing spawns, square by square', () => {
  const { alignLayers } = require('../scripts/npc-spawn-matching.cjs');
  const wiki = (name, x, y, mapId, level = 0) => ({ name, x, y, level, mapId });
  const existing = [{ name: 'Aviansie', x: 2835, y: 5271, level: 2 }, { name: 'Aviansie', x: 2840, y: 5268, level: 2 },
    { name: 'Ankou', x: 2315, y: 5229, level: 0 }, { name: 'Ankou', x: 2317, y: 5226, level: 0 }];
  const spawns = [wiki('Aviansie', 2835, 5271, 7), wiki('Aviansie', 2840, 5268, 7), wiki('Gorak', 2860, 5300, 7),
    wiki('Ankou', 1963, 4941, 18), wiki('Ankou', 1965, 4938, 18), wiki('Ankou', 2100, 4941, 18), wiki('Ankou', 2101, 4944, 18), wiki('Imp', 1500, 4500, 18)];
  // Fake a second place on layer 18 with its own shift.
  existing.push({ name: 'Ankou', x: 2120, y: 4941, level: 0 }, { name: 'Ankou', x: 2121, y: 4944, level: 0 });
  const { shiftOf } = alignLayers(spawns, existing);
  assert.deepEqual(shiftOf(spawns[2]), { dx: 0, dy: 0, dz: 2 }, 'one shift on layer 7: its empty squares take it too');
  assert.deepEqual(shiftOf(spawns[3]), { dx: 352, dy: 288, dz: 0 });
  assert.deepEqual(shiftOf(spawns[5]), { dx: 20, dy: 0, dz: 0 }, 'another place on the same layer, its own shift');
  assert.equal(shiftOf(spawns[7]), null, 'a square of a mixed layer without evidence stays unaligned');
  assert.deepEqual(shiftOf(wiki('Man', 3200, 3200, 0)), { dx: 0, dy: 0, dz: 0 }, 'the surface is in game coordinates');
});

test('adds only what the existing spawns lack, so a second run adds nothing', () => {
  const at = (name, x, y, level = 0) => ({ name, x, y, level });
  const wiki = [at('Wyrm', 10, 10), at('Wyrm', 20, 10), at('Wyrm', 30, 10), at('Wyrm', 40, 10), at('Bat', 5, 5)];
  // One wyrm 2 tiles off the Wiki's, one elsewhere in the same map square: both count; the bat is missing.
  const existing = [at('wyrm', 12, 11), at('Wyrm', 60, 60), at('Bat', 5, 5, 1)];
  const { add, report } = planAdditions(wiki, existing, 4);
  assert.deepEqual(report.find((row) => row.name === 'Wyrm'), { name: 'Wyrm', level: 0, wiki: 4, existing: 2, added: 2 });
  // The two added are the Wiki spawns furthest from any existing wyrm.
  assert.deepEqual(add.filter((spawn) => spawn.name === 'Wyrm').map((spawn) => spawn.x).sort(), [30, 40]);
  // A wyrm in another map square doesn't stand in for one missing here.
  const far = planAdditions(wiki, [at('wyrm', 12, 11), at('Wyrm', 100, 100)], 4);
  assert.equal(far.add.filter((spawn) => spawn.name === 'Wyrm').length, 3);
  assert.equal(add.filter((spawn) => spawn.name === 'Bat').length, 1, 'a bat on another plane is a different spawn');
  assert.equal(planAdditions(wiki, [...existing, ...add], 4).add.length, 0);
});

test('Wyrmscraig spawns come from the Wiki, with ids in the cache and their drops', async () => {
  const { Server } = require('../dist/Server');
  Server.installProductionPathResolver();
  await require('../dist/game/cache/CachePipeline').CachePipeline.initialize(path.resolve(__dirname, '..'));
  const { CacheDefinitions } = require('../dist/game/cache/CacheDefinitions');
  const spawns = require('../data/definitions/npc-spawns.json');
  const drops = require('../data/definitions/npc-drops.json').npcs;
  const island = spawns.filter((spawn) => spawn.source === 'wiki' && inBoxes(spawn, [parseBox('2520,2170,2660,2310'), parseBox('2560,8560,2640,8660')]));
  assert.ok(island.length >= 80, `${island.length} Wyrmscraig spawns`);
  for (const spawn of island) {
    const npc = CacheDefinitions.getNpc(spawn.id);
    assert.equal(npc.name, spawn.name, `${spawn.id} at ${spawn.x},${spawn.y}`);
    if (npc.combatLevel > 0) assert.ok(drops[spawn.id], `${spawn.name} (${spawn.id}) has a drop table`);
  }
  const names = new Set(island.map((spawn) => spawn.name));
  for (const name of ['Cormac', 'Ffion', 'Mortimer', 'Wyrmling', 'Mountain troll', 'Lava Strykewyrm']) assert.ok(names.has(name), name);
  assert.equal(spawns.filter((spawn) => spawn.name === 'Mad Angel').length, 1, 'the Mad Angel is not doubled');
  // Fishing spots stand still like the existing ones; Mortimer and the broken golem have no walk animation.
  for (const spawn of island.filter((entry) => ['Fishing spot', 'Mortimer', 'Broken golem'].includes(entry.name))) {
    assert.equal(spawn.wanderRadius, 0, `${spawn.name} at ${spawn.x},${spawn.y}`);
  }
});

test('Varlamore spawns come from the Wiki, without the NPCs plugins spawn themselves', () => {
  const spawns = require('../data/definitions/npc-spawns.json');
  const varlamore = spawns.filter((spawn) => spawn.source === 'wiki' && inBoxes(spawn, [parseBox('1024,2752,1919,3455')]));
  assert.ok(varlamore.length >= 2300, `${varlamore.length} Varlamore spawns`);
  for (const name of ['Citizen', 'Guard', 'Knight of Varlamore', 'Capybara']) assert.ok(varlamore.some((spawn) => spawn.name === name), name);
  // The Gemstone Crab plugin spawns its crab; the Colosseum run spawns Sol Heredit.
  assert.deepEqual(varlamore.filter((spawn) => ['Gemstone Crab', 'Sol Heredit'].includes(spawn.name)), []);
  // Disguised sand crabs stand still, as the existing ones do.
  assert.ok(varlamore.filter((spawn) => spawn.name === 'Sandy rocks').every((spawn) => spawn.wanderRadius === 0));
});

test('the Sailing islands and seas, without minigame, plugin and Group Ironman NPCs', () => {
  const spawns = require('../data/definitions/npc-spawns.json');
  const conch = spawns.filter((spawn) => spawn.source === 'wiki' && inBoxes(spawn, [parseBox('3072,2240,3391,2623,0')]));
  assert.ok(conch.length >= 150, `${conch.length} on The Great Conch`);
  const left = ['Tempoross', '<col=00ffff>Ammunition crate</col>', 'Avatar of Creation', 'Group Ironman tutor', 'D3ad1i F15her'];
  assert.deepEqual(spawns.filter((spawn) => spawn.source === 'wiki' && left.includes(spawn.name)), []);
  // Pest Control's island is the plugin's: no Wiki Void Knight or squire there.
  assert.deepEqual(spawns.filter((spawn) => spawn.source === 'wiki' && inBoxes(spawn, [parseBox('2624,2560,2687,2623,0')])), []);
});

test("Varlamore's underground, without the bosses that have no fight yet", () => {
  const spawns = require('../data/definitions/npc-spawns.json');
  const below = spawns.filter((spawn) => (spawn.source === 'wiki' || spawn.source === 'capture-1693') && inBoxes(spawn, [parseBox('1216,9344,1727,9855')]));
  assert.ok(below.length >= 450, `${below.length} spawns`);
  assert.ok(below.some((spawn) => spawn.name === 'Banker' && spawn.level === 1), "Cam Torum's bank");
  assert.ok(below.filter((spawn) => spawn.name === 'Wyrmling').every((spawn) => spawn.id === 13031), "Neypotzli's own wyrmlings");
  assert.deepEqual(spawns.filter((spawn) => ['Blood Moon', 'Blue Moon', 'Eclipse Moon', 'Amoxliatl', 'Araxxor'].includes(spawn.name) && spawn.source === 'wiki'), []);
});

test('open monster dungeons, without raid, minigame and quest props', () => {
  const spawns = require('../data/definitions/npc-spawns.json');
  const wiki = spawns.filter((spawn) => spawn.source === 'wiki');
  for (const name of ['Araxyte', 'Gryphon', 'Tormented Demon', 'Elite Black Knight', 'Locust rider']) assert.ok(wiki.some((spawn) => spawn.name === name), name);
  assert.deepEqual(wiki.filter((spawn) => spawn.name.startsWith('<col=')), [], 'coloured-name props');
  for (const name of ['Kephri', 'The Jormungand', 'Skotizo', 'Scurrius', 'Phantom Muspah', 'Abyssal Sire']) {
    assert.ok(!wiki.some((spawn) => spawn.name === name), `${name} is left to its content`);
  }
});

test("an infobox's map N belongs to its id N, whatever order the data bucket lists the versions in", () => {
  const infobox = "|id1 = 13426\n|id2 = 12931\n|id3 = 12932, 13400\n|map1 = {{Map|x=1548|y=3048|r=4}}\n|map2 = {{Map|x=1623|y=2982}}";
  assert.deepEqual(versionIds(infobox), { 1: [13426], 2: [12931], 3: [12932, 13400] });
  assert.deepEqual(parseInfoboxMaps(infobox).map((map) => [map.version, map.points[0].x]), [[1, 1548], [2, 1623]]);
  assert.deepEqual(versionIds("|id = 1, 2"), { 0: [1, 2] });
});

test("multi-version NPCs: each place has its own version, and quest stages are left out", () => {
  const spawns = require("../data/definitions/npc-spawns.json");
  const ids = (x, y, level = 0) => spawns.filter((spawn) => spawn.x === x && spawn.y === y && (spawn.level ?? 0) === level).map((spawn) => spawn.id).sort();
  // The Hunter Guild has Guild Hunter Fox after At First Light, not the quest's injured hunter;
  // in live OSRS he walks within about 2 tiles.
  const fox = spawns.find((spawn) => spawn.x === 1548 && spawn.y === 3048);
  assert.deepEqual([fox.id, fox.name, fox.wanderRadius], [13426, "Guild Hunter Fox", 2]);
  assert.deepEqual(ids(1623, 2982), [], "the injured hunter in the Avium Savannah is a quest stage");
  assert.deepEqual(ids(1647, 3093), [14241], "Forebearer Janus at home, as a civilian");
  assert.deepEqual(ids(1435, 3124), [], "Attala moved to Cam Torum after Perilous Moons");
  assert.deepEqual(ids(1297, 9753), [], "Shas and Etz are injured only during the quest");
  // One Achilka per stop, each with that stop's id.
  assert.deepEqual([ids(1389, 3075), ids(1259, 3124), ids(1399, 3245)], [[14727], [14728], [14729]]);
  assert.deepEqual([ids(2415, 4451), ids(2410, 4456)], [[5843], [5844]], "Zanaris's grey and light-grey sheep");
  assert.deepEqual([ids(1703, 3142), ids(3277, 3411)], [[12889], [12888]], "Primio at both ends of his route");
});

test("pairs closest first: a Wiki spawn on an existing one isn't added on top of it", () => {
  // The Wiki's first spawn is a tile off the existing one, its second exactly on it: pairing in
  // Wiki order let the first take it and added the second on top.
  const wiki = [{ name: 'Spider', level: 0, x: 11, y: 10 }, { name: 'Spider', level: 0, x: 10, y: 10 }, { name: 'Spider', level: 0, x: 40, y: 40 }];
  const { add } = planAdditions(wiki, [{ name: 'Spider', level: 0, x: 10, y: 10 }], 4);
  assert.deepEqual(add.map((spawn) => [spawn.x, spawn.y]).sort(), [[11, 10], [40, 40]]);
});

test('no Wiki spawn stands on another spawn of its name, except the bards camping together', () => {
  const spawns = require('../data/definitions/npc-spawns.json');
  const tiles = new Map();
  for (const spawn of spawns) {
    const key = `${spawn.name}@${spawn.x},${spawn.y},${spawn.level ?? 0}`;
    tiles.set(key, [...(tiles.get(key) ?? []), spawn]);
  }
  const doubled = [...tiles].filter(([, here]) => here.length > 1 && here.some((spawn) => spawn.source === 'wiki') && here[0].name !== 'Bard');
  assert.deepEqual(doubled.map(([key]) => key), []);
});
