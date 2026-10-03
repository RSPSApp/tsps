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
const world = (extra) => ({ spawn: { x: 3222, y: 3219, z: 0 }, zones: [{ tags: [] }], disabledPlugins: [], ...extra });

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

test('allow hooks: first answer wins, no answer is null', () => {
  const api = PluginManager.createApi('MembersHookTest');
  assert.equal(PluginManager.emitCanGainExperience({}, 'agility', 10), null);
  api.onCanGainExperience(() => {});
  api.onCanGainExperience((event) => { event.allow = event.skill !== 'agility'; });
  api.onCanGainExperience((event) => { event.allow = true; });
  assert.equal(PluginManager.emitCanGainExperience({}, 'agility', 10), false);
  assert.equal(PluginManager.emitCanGainExperience({}, 'mining', 10), true);

  api.onCanUseItem((event) => { if (event.option !== 'Drop') event.allow = false; });
  assert.equal(PluginManager.emitCanUseItem({}, 1, 'action', 'Wield'), false);
  assert.equal(PluginManager.emitCanUseItem({}, 1, 'action', 'Drop'), null);

  api.onCanSpawnNpc((event) => { event.allow = event.npcId !== 7; });
  assert.equal(PluginManager.emitCanSpawnNpc(7, {}), false);
  api.onCanStockItem((event) => { event.allow = event.itemId !== 9; });
  assert.equal(PluginManager.emitCanStockItem(1, 9), false);

  api.onPrayerDisabled((event) => { if (event.prayer.requirement > 45) { event.disabled = true; event.message = 'no'; } });
  assert.equal(PluginManager.emitPrayerDisabled({}, { requirement: 70 }), 'no');
  assert.equal(PluginManager.emitPrayerDisabled({}, { requirement: 1 }), null);
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
