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

const WorldDefinition = require('../dist/game/definition/WorldDefinition');
const { CacheDefinitions } = require('../dist/game/cache/CacheDefinitions');
const { DefinitionLoader } = require('../dist/game/definition/loader/DefinitionLoader');
let membershipProviderRows = [];
DefinitionLoader.registerSource('ground_items', 'MembershipBoundaryTest', {
  name: 'membership-boundary-fixture', load: () => membershipProviderRows,
});
const membershipRow = (x, extra = {}) => ({
  id: 556, location: { x, y: 3217, z: 0 }, amt: 3, respawn: 100, ...extra,
});
function isolatedMembershipLoader(t, coreRows, providerRows) {
  const items = World.getItems(), previous = items.splice(0);
  membershipProviderRows = providerRows;
  t.after(() => { membershipProviderRows = []; items.splice(0, items.length, ...previous); });
  const loader = new GroundItemSpawnDefinitionLoader();
  t.mock.method(loader, 'readCoreDefinitions', () => coreRows);
  return { loader, items };
}

for (const membersWorld of [true, false]) test(
  'ground loader uses row membership on ' + (membersWorld ? 'member' : 'free-to-play') + ' worlds, for core and contributed rows', t => {
    assert.equal(CacheDefinitions.getItem(556).isMembers, false, 'air rune itself is a free-to-play item');
    const coreRows = [membershipRow(6101), membershipRow(6102, { members: false }), membershipRow(6103, { members: true })];
    const providerRows = [membershipRow(6111), membershipRow(6112, { members: false }), membershipRow(6113, { members: true })];
    const { loader, items } = isolatedMembershipLoader(t, coreRows, providerRows);
    t.mock.method(WorldDefinition, 'isMembersWorld', () => membersWorld);
    assert.equal(loader.load(), true);
    const actual = items.filter(p => p.getPosition().getX() >= 6100 && p.getPosition().getX() < 6120);
    assert.deepEqual(actual.map(p => p.getPosition().getX()).sort(),
      membersWorld ? [6101, 6102, 6103, 6111, 6112, 6113] : [6101, 6102, 6111, 6112]);
    for (const pile of actual) {
      assert.equal(pile.getItem().getAmount(), 3);
      assert.equal(pile.getRespawnTimer(), 100);
      assert.equal(pile.isStaticSpawn(), true);
      assert.equal(pile.getState(), State.SEEN_BY_EVERYONE);
    }
  }
);

test('malformed source membership fails closed with the existing invalid-row diagnostic in either world', t => {
  const values = [null, 'true', 'false', 0, 1, [], {}];
  const rows = values.map((members, index) => membershipRow(6200 + index, { members }));
  const { loader, items } = isolatedMembershipLoader(t, rows.slice(0, 4), rows.slice(4));
  const warnings = [];
  t.mock.method(console, 'warn', text => warnings.push(text));
  let membersWorld = true;
  t.mock.method(WorldDefinition, 'isMembersWorld', () => membersWorld);
  for (const mode of [true, false]) {
    membersWorld = mode;
    items.splice(0);
    assert.equal(loader.load(), true, 'malformed rows are skipped under the existing loader policy');
    assert.equal(items.filter(p => p.getPosition().getX() >= 6200 && p.getPosition().getX() < 6210).length, 0);
    assert.match(warnings.at(-1), /invalid=7/);
  }
});

function questInteractionFixture(t, file, key, at) {
  const { api, hooks } = captureApi('Quests/InteractionTest' + file);
  require('../plugins/quests/quests/' + file + '.Quest')(api);
  const core = api.core;
  const quest = require('../plugins/quests/QuestRuntime').getRegisteredQuests().find(q => q.key === key);
  const player = new (require('../dist/game/entity/impl/player/Player').Player)(null, new core.Location(...at));
  player.setUsername('interactiontest'); player.setRegistered(true);
  t.mock.method(player, 'getSession', () => ({ sendClientPacket: () => true, write: () => true }));
  const tasks = [];
  t.mock.method(core.TaskManager, 'submit', task => { task.setRunning(true); tasks.push(task); });
  const tick = () => { for (let i = 0; i < 20; i++) for (const task of [...tasks]) if (task.isRunning()) task.execute(); };
  t.after(() => { player.setRegistered(false); for (const task of tasks) task.stop(); });
  return { core, hooks, quest, player, tick };
}

test('Watchtower battlement checks the cake, crosses both ways and selects the correct guard roles', t => {
  const { core, hooks, quest, player, tick } = questInteractionFixture(t, 'Watchtower', 'watchtower', [2506, 3011, 0]);
  quest.setStage(player, 4); core.ObjectDefinition.init(); core.RegionManager.loadMapFiles(2507, 3011);
  const object = core.MapObjects.get(core.ObjectIdentifiers.BATTLEMENT, new core.Location(2507, 3011, 0), null);
  assert.ok(object);
  const click = () => hooks.onObjectInteraction.find(h => h.name === 'handleObjectInteraction')({
    player, object, objectId: object.getId(), clickType: 1, handled: false,
  });
  click(); assert.equal(player.getLocation().getX(), 2506);
  const variant = hooks.onNpcDialogueVariant[0];
  assert.match(variant({ player, npcId: core.NpcIdentifiers.OGRE_GUARD_7 }), /southern-ogre-guard/);
  assert.match(variant({ player, npcId: core.NpcIdentifiers.OGRE_GUARD_6 }), /entering-gu-tanoth-ogre-guard/);
  player.setAttribute('quest.watchtower.bits', (player.getAttribute('quest.watchtower.bits') ?? 0) | (1 << 11));
  click(); tick(); assert.equal(player.getLocation().getX(), 2508);
  player.setAttribute('quest.watchtower.bits', 0);
  click(); tick(); assert.equal(player.getLocation().getX(), 2506, 'exit does not require another gift');
});

test('Watchtower bridge takes its toll before the north jump, with a free return', t => {
  const { core, hooks, quest, player, tick } = questInteractionFixture(t, 'Watchtower', 'watchtower', [2530, 3026, 0]);
  quest.setStage(player, 4);
  const objectHook = hooks.onObjectInteraction.find(h => h.name === 'handleObjectInteraction');
  const action = hooks.onCustomEvent.find(h => h.name === 'handleAction');
  const jump = objectId => objectHook({ player, objectId, handled: false });
  jump(core.ObjectIdentifiers.GAP);
  action({ player, stepId: 'rEZMuS', step: { type: 'action' } }); tick();
  assert.equal(player.getLocation().getY(), 3026, 'no money: no crossing');
  player.getInventory().adds(core.ItemIdentifiers.COINS, 20);
  action({ player, stepId: 'rEZMuS', step: { type: 'action' } }); tick();
  assert.deepEqual([player.getLocation().getX(), player.getLocation().getY()], [2530, 3029]);
  assert.equal(player.getInventory().getAmount(core.ItemIdentifiers.COINS), 0);
  jump(core.ObjectIdentifiers.GAP_2); tick();
  assert.deepEqual([player.getLocation().getX(), player.getLocation().getY()], [2531, 3026]);
  core.ObjectDefinition.init(); core.RegionManager.loadMapFiles(2530, 3026);
  for (const [id, x, y] of [[core.ObjectIdentifiers.GAP, 2530, 3026], [core.ObjectIdentifiers.GAP_2, 2531, 3029]]) {
    assert.ok(core.MapObjects.get(id, new core.Location(x, y, 0), null));
  }
});

test('Watchtower east-gate guards never take the bridge toll or walk the player to the gap', t => {
  const { core, hooks, quest, player, tick } = questInteractionFixture(t, 'Watchtower', 'watchtower', [2548, 3030, 0]);
  quest.setStage(player, 4);
  player.getInventory().adds(core.ItemIdentifiers.COINS, 20);
  const variant = hooks.onNpcDialogueVariant[0];
  const action = hooks.onCustomEvent.find(h => h.name === 'handleAction');
  assert.equal(variant({ player, npcId: core.NpcIdentifiers.OGRE_GUARD_4 }), null, 'gate guard is not the bridge toll');
  action({ player, stepId: 'rEZMuS', step: { type: 'action' } }); tick(); tick();
  assert.deepEqual([player.getLocation().getX(), player.getLocation().getY()], [2548, 3030]);
  assert.equal(player.getInventory().getAmount(core.ItemIdentifiers.COINS), 20);
  player.moveTo(new core.Location(2530, 3025, 0));
  assert.match(variant({ player, npcId: core.NpcIdentifiers.OGRE_GUARD_4 }), /crossing-the-bridge$/);
});

test('Watchtower enclave consumes a distraction on entry and allows completed quests through', t => {
  const { core, hooks, quest, player } = questInteractionFixture(t, 'Watchtower', 'watchtower', [2530, 3040, 0]);
  quest.setStage(player, 7);
  const objectHook = hooks.onObjectInteraction.find(h => h.name === 'handleObjectInteraction');
  const itemHook = hooks.onItemOnNpc.find(h => h.name === 'handleItemOnNpc');
  const action = hooks.onCustomEvent.find(h => h.name === 'handleAction');
  const enter = () => objectHook({ player, objectId: core.ObjectIdentifiers.CAVE_ENTRANCE_5, handled: false });
  enter(); assert.equal(player.getLocation().getY(), 3040);
  player.getInventory().adds(core.ItemIdentifiers.CAVE_NIGHTSHADE, 1);
  itemHook({ player, itemId: core.ItemIdentifiers.CAVE_NIGHTSHADE, npcId: core.NpcIdentifiers.ENCLAVE_GUARD, handled: false });
  action({ player, stepId: 'Z7N4ZW' });
  assert.deepEqual([player.getLocation().getX(), player.getLocation().getY()], [2588, 9410]);
  assert.equal(player.getInventory().getAmount(core.ItemIdentifiers.CAVE_NIGHTSHADE), 0);
  player.moveTo(new core.Location(2530, 3040, 0));
  enter(); assert.equal(player.getLocation().getY(), 3040, 'another entry needs another distraction');
  quest.setStage(player, 12);
  enter(); assert.equal(player.getLocation().getY(), 9410);
});
