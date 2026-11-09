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
  'BeneathCursedSands', 'CurseOfArrav', 'DeathToTheDorgeshuun', 'DefenderOfVarrock',
  'EaglesPeak', 'EyesOfGlouphrie', 'GrimTales', 'InAidOfTheMyreque', 'Pandemonium',
  'PerilousMoons', 'PryingTimes', 'SecretsOfTheNorth', 'SwanSong',
];
// WhatLiesBelow installs no world object since 475e73669: its Tunnel of Chaos statue is the cache map's own (the
// installed copy was a duplicate), and its startup hook now only spawns Surok.

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

test('TempleOfTheEye leaves its earned owner-only portal out of global world installation', () => {
  const { api, hooks } = capturingApi();
  assert.equal(countRegistrations(() => require('../plugins/quests/quests/TempleOfTheEye.Quest')(api)), 0);
  const startup = () => { for (const handler of hooks.onServerStartup ?? []) handler({ timestamp: Date.now() }); };
  assert.equal(countRegistrations(startup), 0, 'the portal is created only for its player after the captured chant');
});
