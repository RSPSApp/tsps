'use strict';

const assert = require('node:assert/strict');
const { test, before } = require('node:test');
const { Server } = require('../dist/Server');
Server.installProductionPathResolver();

before(async () => {
  await require('../dist/game/cache/CachePipeline').CachePipeline.initialize(require('node:path').resolve(__dirname, '..'));
  require('../dist/game/collision/RegionManager').RegionManager.init();
});

const { PluginManager } = require('../dist/plugins/PluginManager');
const { GroundItemSpawnDefinitionLoader } = require('../dist/game/definition/loader/impl/GroundItemSpawnDefinitionLoader');
const { State } = require('../dist/game/entity/impl/grounditem/ItemOnGround');
const { GroundItemRespawnTask } = require('../dist/game/task/impl/GroundItemRespawnTask');
const { TaskManager } = require('../dist/game/task/TaskManager');
const { World } = require('../dist/game/World');

function captureApi(pluginName) {
  const hooks = {};
  const target = PluginManager.createApi(pluginName);
  let api;
  api = new Proxy(target, {
    get(object, property) {
      if (typeof property === 'string' && /^on[A-Z]/.test(property)) {
        return (...args) => {
          const handler = args.find((arg) => typeof arg === 'function');
          (hooks[property] ??= []).push(handler);
        };
      }
      if (property === 'withProfileLabel') return () => api;
      const value = object[property];
      return typeof value === 'function' ? value.bind(object) : value;
    },
  });
  return { api, hooks };
}

test('Watchtower ground spawns load as public respawning world items, outside login hooks', () => {
  const worldItems = World.getItems();
  const previousItems = worldItems.splice(0);
  const { api } = captureApi('Quests');
  try {
    assert.equal(api.core.WorldDefinition.isMembersWorld(), true, 'Watchtower spawns require a members world');
    require('../plugins/quests/Quests.plugin').register(api);
    new GroundItemSpawnDefinitionLoader().load();

    const identifiers = api.core.ItemIdentifiers;
    const expected = [
      { id: identifiers.DEATH_RUNE, x: 2500, y: 2967, respawn: 200 },
      { id: identifiers.CAVE_NIGHTSHADE, x: 2528, y: 9415, respawn: 100 },
      { id: identifiers.CAVE_NIGHTSHADE, x: 2530, y: 9462, respawn: 100 },
    ];
    const spawnAt = (x, y) => worldItems.filter((ground) =>
      ground.getPosition().getX() === x && ground.getPosition().getY() === y
    );

    for (const spawn of expected) {
      const [ground] = spawnAt(spawn.x, spawn.y);
      assert.equal(spawnAt(spawn.x, spawn.y).length, 1, `one spawn at ${spawn.x},${spawn.y}`);
      assert.equal(ground.getItem().getId(), spawn.id);
      assert.equal(ground.getItem().getAmount(), 1);
      assert.equal(ground.getState(), State.SEEN_BY_EVERYONE);
      assert.equal(ground.getOwner(), undefined);
      assert.equal(ground.getPrivateArea(), null);
      assert.equal(ground.getRespawnTimer(), spawn.respawn);
      assert.equal(ground.isStaticSpawn(), true);
      assert.equal(ground.getPosition().getZ(), 0);
    }

    const { api: watchtowerApi, hooks } = captureApi('Quests/Watchtower');
    require('../plugins/quests/quests/Watchtower.Quest')(watchtowerApi);
    const login = hooks.onPlayerLogin.find((handler) => handler.name === 'handleLogin');
    assert.ok(login, 'Watchtower login handler is registered');

    const deathRune = spawnAt(2500, 2967)[0];
    worldItems.splice(worldItems.indexOf(deathRune), 1);
    const respawn = new GroundItemRespawnTask(deathRune, 200);
    TaskManager.submit(respawn);
    const player = {
      getAttribute: () => undefined,
      getPrivateArea: () => ({}),
      getLocation: () => new api.core.Location(2500, 2967, 0),
      getPacketSender: () => new Proxy({}, { get: () => () => {} }),
    };
    login({ player });
    login({ player });
    assert.equal(spawnAt(2500, 2967).length, 0, 'logins do not add a second item while its respawn is pending');

    respawn.execute();
    assert.equal(spawnAt(2500, 2967).length, 1, 'the respawn task can restore the public spawn');
    assert.equal(spawnAt(2500, 2967)[0].getRespawnTimer(), 200);
  } finally {
    worldItems.splice(0, worldItems.length, ...previousItems);
  }
});
