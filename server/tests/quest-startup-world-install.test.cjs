'use strict';
// Quests whose world objects don't depend on any player install them at server startup.
// Installing them in the first login's hooks loaded each far-off region's collision data
// inside that login tick (about 640 ms in a profile of a real save), stalling the world.
const assert = require('node:assert/strict');
const { test, before } = require('node:test');
const { Server } = require('../dist/Server');
Server.installProductionPathResolver();

before(async () => {
  await require('../dist/game/cache/CachePipeline').CachePipeline.initialize(require('node:path').resolve(__dirname, '..'));
  require('../dist/game/collision/RegionManager').RegionManager.init();
});

const { PluginManager } = require('../dist/plugins/PluginManager');
const { ObjectManager } = require('../dist/game/entity/impl/object/ObjectManager');

const WORLD_INSTALLER_QUESTS = [
  'AKingdomDivided', 'BeneathCursedSands', 'CurseOfArrav', 'DeathToTheDorgeshuun', 'DefenderOfVarrock',
  'DesertTreasureI', 'EaglesPeak', 'EnakhrasLament', 'GrimTales', 'InAidOfTheMyreque',
  'Pandemonium', 'PryingTimes', 'SecretsOfTheNorth', 'SwanSong',
];
// WhatLiesBelow installs no world object since 475e73669: its Tunnel of Chaos statue is the cache map's own (the
// installed copy was a duplicate), and it spawns no Surok of its own: the library's npc-spawns.json one is his.
// PerilousMoons installs no world object since #5199: its Building Supplies are per-player locs in the antechamber's copy.
// EyesOfGlouphrie installs no world object since #5994: Oaknock's machine and exchanger are cache map locs.

/** The real plugin api, except that hook registrations are captured instead of installed. */
function capturingApi() {
  const hooks = {};
  const api = PluginManager.createApi('Quests');
  const proxy = new Proxy(api, {
    get(target, property) {
      if (typeof property === 'string' && /^on[A-Z]/.test(property)) {
        return (...args) => {
          const handler = args.find((arg) => typeof arg === 'function');
          (hooks[property] ??= []).push(handler);
        };
      }
      const value = target[property];
      return typeof value === 'function' ? value.bind(target) : value;
    },
  });
  return { api: proxy, hooks };
}

function countRegistrations(run) {
  const original = ObjectManager.register;
  let count = 0;
  ObjectManager.register = function (...args) {
    count++;
    return original.apply(this, args);
  };
  try {
    run();
  } finally {
    ObjectManager.register = original;
  }
  return count;
}

for (const quest of WORLD_INSTALLER_QUESTS) {
  test(`${quest} installs its world objects at server startup, once`, () => {
    const { api, hooks } = capturingApi();
    require(`../plugins/quests/quests/${quest}.Quest`)(api);
    assert.ok(hooks.onServerStartup?.length, `${quest} has no server startup hook`);
    const startup = () => { for (const handler of hooks.onServerStartup) handler({ timestamp: Date.now() }); };
    assert.ok(countRegistrations(startup) > 0, `${quest} registered no world objects at startup`);
    assert.equal(countRegistrations(startup), 0, `${quest} installed its world objects twice`);
  });
}

test('EyesOfGlouphrie uses the cache map machine and exchanger instead of startup objects', () => {
  const { api, hooks } = capturingApi();
  assert.equal(countRegistrations(() => require('../plugins/quests/quests/EyesOfGlouphrie.Quest')(api)), 0);
  assert.equal(hooks.onServerStartup?.length ?? 0, 0, 'no startup hook is left to add duplicate locs');

  const { MapObjects } = require('../dist/game/entity/impl/object/MapObjects');
  const { Location } = require('../dist/game/model/Location');
  const machine = MapObjects.get(17282, new Location(2390, 9826, 0), null);
  const exchanger = MapObjects.get(17283, new Location(2391, 9826, 0), null);
  assert.equal(machine?.getId(), 17282, 'the scene machine is the cache map loc');
  assert.equal(exchanger?.getId(), 17283, 'the scene exchanger is the cache map loc');
});

test('TempleOfTheEye leaves its earned owner-only portal out of global world installation', () => {
  const { api, hooks } = capturingApi();
  assert.equal(countRegistrations(() => require('../plugins/quests/quests/TempleOfTheEye.Quest')(api)), 0);
  const startup = () => { for (const handler of hooks.onServerStartup ?? []) handler({ timestamp: Date.now() }); };
  assert.equal(countRegistrations(startup), 0, 'the portal is created only for its player after the captured chant');
});

test('WhatLiesBelow spawns no Surok Magis of its own, since the library already has one (issue 4123)', () => {
  const { api, hooks } = capturingApi();
  const target = PluginManager.createApi('Quests');
  const spawned = [];
  const spying = new Proxy(api, {
    get: (_t, property) => property === 'spawnNpc' ? (def) => { spawned.push(def); } : api[property],
  });
  require('../plugins/quests/quests/WhatLiesBelow.Quest')(spying);
  for (const handler of hooks.onServerStartup ?? []) handler({ timestamp: Date.now() });
  assert.ok(target, 'api available');
  assert.equal(hooks.onServerStartup?.length ?? 0, 0, 'no startup hook is left to spawn him');
  assert.deepEqual(spawned, [], 'nothing spawned while registering or at startup');
  const spawns = JSON.parse(require('node:fs').readFileSync(require('node:path').join(__dirname, '../data/definitions/npc-spawns.json'), 'utf8'));
  const library = spawns.filter((spawn) => spawn.name === 'Surok Magis' && spawn.level === 0 && spawn.x >= 3200 && spawn.x <= 3215);
  assert.equal(library.length, 1, "npc-spawns.json places exactly one Surok Magis in the Varrock Palace Library");
});
