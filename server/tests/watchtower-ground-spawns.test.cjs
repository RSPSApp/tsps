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

test('Watchtower rope crossing consumes one rope, returns without one, and restores its scenery on cancellation', (t) => {
  const { api, hooks } = captureApi('WatchtowerRopeTest');
  require('../plugins/quests/quests/Watchtower.Quest')(api);
  const core = api.core;
  const tasks = [];
  t.mock.method(core.TaskManager, 'submit', task => { tasks.push(task); });
  const player = new (require('../dist/game/entity/impl/player/Player').Player)(null, new core.Location(2501, 3087, 0));
  player.setUsername('watchtower_rope_test');
  player.setRegistered(true);
  t.mock.method(player, 'getSession', () => ({ sendClientPacket: () => true }));
  const messages = [], scenery = [];
  t.mock.method(player, 'sendMessage', message => messages.push(message));
  t.mock.method(player.getPacketSender(), 'sendObject', object => scenery.push(object.getId()));
  const branch = core.MapObjects.get(core.ObjectIdentifiers.BRANCH, new core.Location(2499, 3087, 0), null);
  const itemHook = hooks.onItemOnObject.find(fn => fn.name === 'handleItemOnObject');
  const objectHook = hooks.onObjectInteraction.find(fn => fn.name === 'handleObjectInteraction');
  const use = () => {
    const event = { player, object: branch, objectId: branch.getId(), itemId: core.ItemIdentifiers.ROPE, handled: false };
    itemHook(event); return event;
  };
  assert.equal(use().handled, true);
  assert.equal(tasks.length, 0, 'no carried rope means no crossing');
  player.getInventory().adds(core.ItemIdentifiers.ROPE, 2);
  player.moveTo(new core.Location(2505, 3087, 0));
  use();
  assert.equal(tasks.length, 0, 'cannot enter from the island side');
  assert.equal(player.getInventory().getAmount(core.ItemIdentifiers.ROPE), 2);
  player.moveTo(new core.Location(2501, 3087, 0));
  use();
  use();
  assert.equal(tasks.length, 1, 'a repeated click cannot consume another rope or start another task');
  assert.equal(player.getMovementQueue().isMovementBlocked(), true);
  for (let tick = 0; tick < 12; tick++) tasks.at(-1).execute();
  assert.deepEqual([player.getLocation().getX(), player.getLocation().getY()], [2505, 3087]);
  assert.equal(player.getInventory().getAmount(core.ItemIdentifiers.ROPE), 1);
  assert.deepEqual(scenery, [23571, 23638]);
  assert.ok(messages.includes('You tie the rope to the tree...'));
  assert.ok(messages.includes('You skillfully swing across.'));
  player.getInventory().deleteNumber(core.ItemIdentifiers.ROPE, 1);
  player.moveTo(new core.Location(2511, 3092, 0));
  const rope = core.MapObjects.get(core.ObjectIdentifiers.ROPESWING_9, new core.Location(2511, 3090, 0), null);
  objectHook({ player, object: rope, objectId: rope.getId(), clickType: 1, handled: false });
  for (let tick = 0; tick < 12; tick++) tasks.at(-1).execute();
  assert.deepEqual([player.getLocation().getX(), player.getLocation().getY()], [2511, 3096]);
  assert.equal(player.getInventory().getAmount(core.ItemIdentifiers.ROPE), 0);
  player.moveTo(new core.Location(2501, 3087, 0));
  player.getInventory().adds(core.ItemIdentifiers.ROPE, 1);
  use();
  tasks.at(-1).execute(); tasks.at(-1).execute();
  tasks.at(-1).stop();
  assert.equal(scenery.at(-1), 23638);
  assert.equal(player.getMovementQueue().isMovementBlocked(), false);
  player.moveTo(new core.Location(2501, 3087, 0));
  if (!player.getInventory().contains(core.ItemIdentifiers.ROPE)) player.getInventory().adds(core.ItemIdentifiers.ROPE, 1);
  use();
  const lostRopeTask = tasks.at(-1);
  lostRopeTask.execute();
  player.getInventory().deleteNumber(core.ItemIdentifiers.ROPE, 1);
  const swapsBefore = scenery.length;
  for (let tick = 0; tick < 12; tick++) lostRopeTask.execute();
  assert.deepEqual([player.getLocation().getX(), player.getLocation().getY()], [2501, 3087], 'losing the rope during the windup cancels the crossing');
  assert.equal(scenery.slice(swapsBefore).includes(23571), false, 'no roped model without payment');
  assert.equal(player.getMovementQueue().isMovementBlocked(), false);
  assert.equal(player.getAttribute('agility.obstacle'), null);
  const runner = require('../plugins/skills/agility/ObstacleRunner.Agility');
  player.moveTo(new core.Location(2501, 3087, 0));
  player.getInventory().adds(core.ItemIdentifiers.ROPE, 1);
  use();
  tasks.at(-1).execute();
  runner.completeNow(player);
  assert.deepEqual([player.getLocation().getX(), player.getLocation().getY()], [2505, 3087], 'logout completes a paid crossing');
  assert.equal(player.getInventory().getAmount(core.ItemIdentifiers.ROPE), 0, 'logout during the throw still consumes one rope');
  assert.equal(player.getMovementQueue().isMovementBlocked(), false);
  player.moveTo(new core.Location(2501, 3087, 0));
  player.getInventory().adds(core.ItemIdentifiers.ROPE, 1);
  use();
  tasks.at(-1).execute();
  player.getInventory().deleteNumber(core.ItemIdentifiers.ROPE, 1);
  runner.completeNow(player);
  assert.deepEqual([player.getLocation().getX(), player.getLocation().getY()], [2501, 3087], 'logout cannot finish an unpaid crossing');
  assert.equal(player.getMovementQueue().isMovementBlocked(), false);
  assert.equal(player.getAttribute('agility.obstacle'), null);
  player.setRegistered(false);
});
