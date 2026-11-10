// Run after `yarn build`: node --test tests/world-members.test.cjs
const assert = require('node:assert/strict');
const { test } = require('node:test');
const { Server } = require('../dist/Server');
Server.installProductionPathResolver();
const {
  parseWorldDefinition,
  WorldDefinitionValidationError,
} = require('../dist/game/definition/WorldDefinition');
const { PluginManager } = require('../dist/plugins/PluginManager');

const f2pZone = { minX: 3200, maxX: 3263, minY: 3200, maxY: 3263, z: 0, tags: ['f2p'] };
const world = (extra) => ({ spawn: { x: 3222, y: 3219, z: 0 }, zones: [{ tags: [] }], ...extra });

test('membersWorld defaults to true', () => {
  assert.equal(parseWorldDefinition(world()).membersWorld, true);
});

test('a free-to-play world needs f2p zones', () => {
  assert.throws(() => parseWorldDefinition(world({ membersWorld: false })), WorldDefinitionValidationError);
  assert.equal(parseWorldDefinition(world({ membersWorld: false, zones: [f2pZone] })).membersWorld, false);
  assert.throws(() => parseWorldDefinition(world({ membersWorld: 'no' })), WorldDefinitionValidationError);
});

test('a free-to-play spawn must be in free land, since members-area players are sent there', () => {
  const outside = { spawn: { x: 2900, y: 3450, z: 0 } };
  assert.throws(() => parseWorldDefinition(world({ membersWorld: false, zones: [f2pZone], ...outside })), WorldDefinitionValidationError);
  assert.equal(parseWorldDefinition(world({ membersWorld: false, zones: [{ tags: ['f2p'] }], ...outside })).membersWorld, false);
});

test('the shipped world.json has f2p zones covering the spawn', () => {
  const shipped = parseWorldDefinition(require('../data/definitions/world.json'));
  const { x, y } = shipped.spawn;
  assert.ok(shipped.zones.some((zone) => zone.tags.includes('f2p') &&
    x >= zone.minX && x <= zone.maxX && y >= zone.minY && y <= zone.maxY));
});

test('shipped Rellekka and Hosidius crab coasts allow multicombat without PvP', () => {
  const { AreaManager } = require('../dist/game/model/areas/AreaManager');
  const { Wilderness } = require('../dist/game/content/wilderness/Wilderness');
  const { Location } = require('../dist/game/model/Location');
  const families = require('../data/definitions/dormant-npcs.json').families;
  const ids = names => new Set(families.filter(family => names.includes(family.name))
    .flatMap(family => [...family.dormant, ...Object.values(family.awake)]));
  const rock = ids(['Rock Crab']), sand = ids(['Sand Crab']);
  const spawns = require('../data/definitions/npc-spawns.json').filter(spawn =>
    (rock.has(spawn.id) && spawn.x >= 2600 && spawn.x <= 2800 && spawn.y >= 3670 && spawn.y <= 3770)
    || (sand.has(spawn.id) && spawn.x >= 1600 && spawn.x <= 1900 && spawn.y >= 3350 && spawn.y <= 3650));
  assert.ok(spawns.length >= 150, 'exercise the actual coastal crab population');
  for (const { x, y } of spawns) {
    const location = new Location(x, y, 0);
    assert.equal(AreaManager.inMulti({ getArea: () => null, getLocation: () => location }), true, `${x},${y}`);
    assert.equal(Wilderness.isPvpArea(location), false, 'PvE multi does not enable player killing');
    assert.equal(Wilderness.isMulti(x, y, 1), false, 'coastal tags apply only to the surface');
  }
  for (const [x, y] of [[2677, 3711], [2704, 3728], [2736, 3712], [1700, 3589], [1800, 3050]]) {
    assert.equal(Wilderness.isMulti(x, y, 0), false, `preserve the single-combat side at ${x},${y}`);
  }
});

test('Fossil Island mapped multicombat coasts retain their boundaries and plane', () => {
  const { AreaManager } = require('../dist/game/model/areas/AreaManager');
  const { Wilderness } = require('../dist/game/content/wilderness/Wilderness');
  const { Location } = require('../dist/game/model/Location');
  // Wiki map polygons use integer vertices; each tile is sampled at its centre.
  for (const [y, first, last] of [[3760, 3801, 3825], [3875, 3655, 3663], [3880, 3712, 3720]]) {
    for (const [x, multi] of [[first - 1, false], [first, true], [last, true], [last + 1, false]]) {
      const location = new Location(x, y, 0);
      assert.equal(AreaManager.inMulti({ getArea: () => null, getLocation: () => location }), multi, `${x},${y}`);
      assert.equal(Wilderness.isPvpArea(location), false, `${x},${y} is not PvP`);
      assert.equal(Wilderness.isMulti(x, y, 1), false, `${x},${y} on plane 1`);
    }
  }
});

test('Falador multicombat follows the city boundary and excludes the ground-floor crypt', () => {
  const { AreaManager } = require('../dist/game/model/areas/AreaManager');
  const { Wilderness } = require('../dist/game/content/wilderness/Wilderness');
  const { Location } = require('../dist/game/model/Location');
  const cityEdges = [
    [2943, 3370, false], [2944, 3370, true],
    [2970, 3455, true], [2970, 3456, false],
    [3007, 3370, true], [3008, 3370, false],
    [3015, 3327, true], [3015, 3328, false], [3016, 3327, false],
    [2990, 3303, false], [2990, 3304, true],
  ];
  for (const z of [0, 1, 2, 3]) {
    const samples = [
      ...cityEdges,
      [3007, 3303, false], [3008, 3302, false],
      [3008, 3303, z === 0], [3015, 3303, z === 0],
      [2959, 3333, true], [2960, 3333, z !== 0],
      [2967, 3333, z !== 0], [2968, 3333, true],
      [2964, 3327, true], [2964, 3328, z !== 0],
      [2964, 3335, z !== 0], [2964, 3336, true],
    ];
    for (const [x, y, multi] of samples) {
      const location = new Location(x, y, z);
      assert.equal(AreaManager.inMulti({ getArea: () => null, getLocation: () => location }), multi, `${x},${y},${z}`);
      assert.equal(Wilderness.isPvpArea(location), false, `${x},${y},${z} is not PvP`);
    }
  }
});

test('allow hooks: first answer wins, no answer is null', () => {
  const api = PluginManager.createApi('MembersHookTest');
  // Experience gains also carry a multiplier (a league profile's rate), so the answer is a pair.
  assert.deepEqual(PluginManager.emitCanGainExperience({}, 'agility', 10), { allow: null, multiplier: 1 });
  api.onCanGainExperience(() => {});
  api.onCanGainExperience((event) => { event.allow = event.skill !== 'agility'; });
  api.onCanGainExperience((event) => { event.allow = true; event.multiplier *= 5; });
  assert.deepEqual(PluginManager.emitCanGainExperience({}, 'agility', 10), { allow: false, multiplier: 1 }, 'a refusal wins');
  assert.deepEqual(PluginManager.emitCanGainExperience({}, 'mining', 10), { allow: true, multiplier: 5 }, 'every hook runs, so a rate set by a later one counts');

  api.onCanUseItem((event) => { if (event.option !== 'Drop') event.allow = false; });
  assert.equal(PluginManager.emitCanUseItem({}, 1, 'action', 'Wield'), false);
  assert.equal(PluginManager.emitCanUseItem({}, 1, 'action', 'Drop'), null);

  api.onCanSpawnNpc((event) => { event.allow = event.npcId !== 7; });
  assert.equal(PluginManager.emitCanSpawnNpc(7, {}), false);
  api.onCanStockItem((event) => { event.allow = event.itemId !== 9; });
  assert.equal(PluginManager.emitCanStockItem(1, 9), false);

  api.onPrayerDisabled((event) => { if (event.prayer.requirement > 45) { event.disabled = true; event.message = 'no'; } });
  assert.deepEqual(PluginManager.emitPrayerDisabled({}, { requirement: 70 }), { message: 'no', messageBox: false });
  assert.equal(PluginManager.emitPrayerDisabled({}, { requirement: 1 }), null);
});

test('attack speed hooks: the resolved speed passes through every hook, never below 1', () => {
  const api = PluginManager.createApi('AttackSpeedHookTest');
  const attacker = { isPlayer: () => true };
  assert.equal(PluginManager.emitAttackSpeed(attacker, {}, 'magic', 5), 5, 'no hook: the speed is what the method said');
  api.onAttackSpeed((event) => { if (event.combatType === 'magic') event.speed = 2; });
  api.onAttackSpeed((event) => { event.speed -= 3; });
  assert.equal(PluginManager.emitAttackSpeed(attacker, {}, 'magic', 5), 1, 'both hooks ran, floored at 1');
  assert.equal(PluginManager.emitAttackSpeed(attacker, {}, 'melee', 4), 1);
  assert.equal(PluginManager.emitAttackSpeed(null, {}, 'melee', 4), 4, 'nothing to ask about');
});

test('isMembersArea map-square index matches a scan of every f2p zone', () => {
  const fs = require('node:fs');
  const os = require('node:os');
  const path = require('node:path');
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'tsps-f2p-index-'));
  const cwd = process.cwd();
  const modulePath = require.resolve('../dist/game/definition/WorldDefinition');
  const shipped = require('../data/definitions/world.json');
  try {
    fs.mkdirSync(path.join(directory, 'data/definitions'), { recursive: true });
    fs.writeFileSync(path.join(directory, 'data/definitions/world.json'),
      JSON.stringify({ ...shipped, membersWorld: false }));
    process.chdir(directory);
    delete require.cache[modulePath];
    const { isMembersArea, zoneContains } = require(modulePath);
    const f2p = shipped.zones.filter((zone) => zone.tags.includes('f2p'));
    for (let i = 0; i < 20000; i++) {
      const x = 1500 + Math.floor(Math.random() * 2500);
      const y = 2700 + Math.floor(Math.random() * 7400);
      const expected = !f2p.some((zone) => zoneContains(zone, x, y));
      assert.equal(isMembersArea(x, y), expected, `(${x}, ${y})`);
    }
    // Box edges, where an off-by-one in the square maths would show.
    for (const zone of f2p) {
      for (const [x, y] of [[zone.minX, zone.minY], [zone.maxX, zone.maxY], [zone.minX - 1, zone.minY], [zone.maxX + 1, zone.maxY]]) {
        assert.equal(isMembersArea(x, y), !f2p.some((other) => zoneContains(other, x, y)), `(${x}, ${y})`);
      }
    }
  } finally {
    process.chdir(cwd);
    delete require.cache[modulePath];
    require(modulePath);
    fs.rmSync(directory, { recursive: true, force: true });
  }
});


test('Wintertodt does not register its prison hooks on a free world', () => {
  const fs = require('node:fs');
  const os = require('node:os');
  const path = require('node:path');
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'tsps-wintertodt-f2p-'));
  const cwd = process.cwd();
  const worldModule = require.resolve('../dist/game/definition/WorldDefinition');
  const managerModule = require.resolve('../dist/plugins/PluginManager');
  const pluginPath = require.resolve('../plugins/minigames/Wintertodt.plugin');
  const plugin = require(pluginPath);
  const register = plugin.register;
  let registrations = 0;
  try {
    fs.mkdirSync(path.join(directory, 'data/definitions'), { recursive: true });
    fs.writeFileSync(path.join(directory, 'data/definitions/world.json'),
      JSON.stringify(world({ membersWorld: false, zones: [f2pZone] })));
    fs.mkdirSync(path.join(directory, 'plugins'));
    fs.symlinkSync(pluginPath, path.join(directory, 'plugins/Wintertodt.plugin.js'));
    plugin.register = () => { registrations++; };
    process.chdir(directory);
    delete require.cache[worldModule];
    delete require.cache[managerModule];
    assert.equal(require(worldModule).isMembersWorld(), false);
    require(managerModule).PluginManager.loadFromDirectory(path.join(directory, 'plugins'));
    assert.equal(registrations, 0, 'the loader must skip Wintertodt before its members-only Herblore dependency is used');
  } finally {
    plugin.register = register;
    process.chdir(cwd);
    delete require.cache[worldModule];
    delete require.cache[managerModule];
    fs.rmSync(directory, { recursive: true, force: true });
  }
});
