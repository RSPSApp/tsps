// Fallen From Grace: the shipped golem Investigation runs at captured stage 13
// (11 -> 13 on Mortimer's rockfall, 13 -> 14 on the golem condition).
const assert = require('node:assert/strict');
const path = require('node:path');
const { before, test } = require('node:test');
const { Server } = require('../dist/Server');
Server.installProductionPathResolver();
const { PluginManager } = require('../dist/plugins/PluginManager');
const { DialogueManager } = require('../dist/game/model/dialogues/DialogueManager');
const { CachePipeline } = require('../dist/game/cache/CachePipeline');
const { NpcDefinitionLoader } = require('../dist/game/definition/loader/impl/NpcDefinitionLoader');
const { RegionManager } = require('../dist/game/collision/RegionManager');
const { RsmodRouteFinding } = require('../dist/game/model/movement/path/RsmodRouteFinding');
const { MapObjects } = require('../dist/game/entity/impl/object/MapObjects');
const runtime = require('../plugins/quests/QuestRuntime');
const core = PluginManager.getCoreApi();
const I = core.ItemIdentifiers;

before(async () => {
  await CachePipeline.initialize(path.resolve(__dirname, '..'));
  RegionManager.init();
  new NpcDefinitionLoader().load();
});

function setup() {
  const hooks = { conditions: [], named: new Map(), custom: new Map(), itemOnNpc: [], zones: [] };
  const api = new Proxy({
    core,
    persistAttribute() {},
    onNpcDialogueVariant() {}, onNpcDialogueCondition(fn) { hooks.conditions.push(fn); },
    onNpcInteraction(target, actions) { if (typeof target === 'string') hooks.named.set(target, actions); },
    onCustomEvent(name, fn) { const list = hooks.custom.get(name) ?? []; list.push(fn); hooks.custom.set(name, list); },
    emitCustomEvent(name, event) { for (const fn of hooks.custom.get(name) ?? []) fn(event); },
    onObjectInteraction() {}, onItemOnItem() {}, onItemOnNpc(fn) { hooks.itemOnNpc.push(fn); }, onItemAction() {},
    onGroundItemClick() {}, onGroundItemPickup() {}, onNpcDeath() {}, onZoneEnter(zone, fn) { hooks.zones.push({ zone, fn }); },
    onPlayerLogin() {}, onPlayerLogout() {},
    getItemOnGroundManager() { return { getGroundItem() {}, registerLocation() {} }; },
  }, { get: (target, key) => target[key] ?? (() => {}) });
  require('../plugins/quests/quests/FallenFromGrace.Quest')(api);
  PluginManager.emitNpcDialogueCondition = (event) => {
    for (const fn of hooks.conditions) {
      const answer = fn(event);
      if (answer !== null && answer !== undefined) return answer;
    }
    return null;
  };
  const quest = runtime.getRegisteredQuests().filter((entry) => entry.key === 'fallen_from_grace').at(-1);
  const attrs = new Map(), items = new Map(), messages = [];
  const sender = new Proxy({
    sendVarbit() { return sender; }, sendSubInterface() { return sender; },
    sendInterface() { return sender; }, sendInterfaceScript() { return sender; },
    sendInterfaceRemoval() { return sender; }, sendConfig() { return sender; },
  }, { get: (target, key) => target[key] ?? (() => sender) });
  const player = {
    attrs, items, messages,
    getAttribute: (key) => attrs.get(key), setAttribute: (key, value) => attrs.set(key, value),
    getPacketSender: () => sender, sendMessage: (text) => messages.push(text),
    getInventory: () => ({
      getAmount: (id) => items.get(id) ?? 0, getFreeSlots: () => 28, isFull: () => false,
      adds: (id, amount = 1) => items.set(id, (items.get(id) ?? 0) + amount),
      deleteNumber: (id, amount = 1) => items.set(id, Math.max(0, (items.get(id) ?? 0) - amount)),
    }),
    getEquipment: () => ({ get: () => null, getItems: () => [] }),
    getSkillManager: () => ({ getMaxLevel: () => 99, getCurrentLevel: () => 99, addExperiences() {} }),
    getLocation: () => player.location, moveTo(next) { player.location = next; },
    getUsername: () => 'GolemStage', getIndex: () => 1,
    isPlayer: () => true, isRegistered: () => true, isPlayerBot: () => false,
    setPositionToFace() {}, performAnimation() {},
    getMovementQueue: () => ({ reset() { return this; }, setBlockMovement() { return this; } }),
    getArea: () => null, setArea() {}, getPrivateArea: () => null,
  };
  player.location = new core.Location(2573, 8651, 0);
  player.manager = new DialogueManager(player);
  player.getDialogueManager = () => player.manager;
  return { hooks, quest, player };
}

function investigate(h) {
  const action = h.hooks.named.get('Broken golem')?.Investigate;
  assert.equal(typeof action, 'function', 'Broken golem Investigate handler is registered');
  const event = { player: h.player, npcId: 16321, handled: false };
  action(event);
  assert.equal(event.handled, true);
  while (h.player.manager.getCurrent()) h.player.manager.advance();
}

test('stage 13 golem investigation opens the shipped condition, grants core once and advances to 14', () => {
  const h = setup();
  h.quest.setStage(h.player, 13);
  investigate(h);
  assert.equal(h.quest.getStage(h.player), 14);
  assert.equal(h.player.items.get(I.DULL_SUNSTONE_CORE), 1);

  // A repeat at the same stage cannot duplicate the core.
  investigate(h);
  assert.equal(h.player.items.get(I.DULL_SUNSTONE_CORE), 1);
  assert.equal(h.quest.getStage(h.player), 14);
});

test('feeding the sunstone core moves to the captured south side and consumes it once', () => {
  const h = setup();
  const player = h.player;
  h.quest.setStage(player, 14);
  player.location = new core.Location(2573, 8650, 0);
  player.items.set(I.SUNSTONE_CORE, 1);
  const event = { player, itemId: I.SUNSTONE_CORE, npcId: 16321, handled: false };
  h.hooks.itemOnNpc[0](event);
  assert.equal(event.handled, true);
  assert.equal(h.quest.getStage(player), 15);
  assert.equal(player.items.get(I.SUNSTONE_CORE) ?? 0, 0, 'captured core is consumed');
  assert.deepEqual([player.location.getX(), player.location.getY()], [2573, 8655]);
  while (player.manager.getCurrent()) player.manager.advance();
});

test('front pocket reaches the normal Cave Exit and surface landing stays adjacent', () => {
  const route = new RsmodRouteFinding((x, y, z, area) => RegionManager.getClipping(x, y, z, area));
  RegionManager.loadMapFiles(2572, 8650, true);
  RegionManager.loadMapFiles(2562, 8629, true);
  const out = route.findRoute({
    level: 0, srcX: 2572, srcY: 8650, srcSize: 1, destX: 2564, destY: 8630,
    destWidth: 1, destLength: 1, moveNear: false, privateArea: null, maxWaypoints: 10000,
  });
  assert.equal(out.success, true, 'front pocket reaches the normal Cave Exit landing');
  assert.deepEqual([out.endX, out.endY], [2564, 8630]);
  RegionManager.loadMapFiles(2529, 2206, true);
  assert.ok(MapObjects.get(62219, new core.Location(2529, 2206, 0), null), 'normal Cave Enter exists');
  assert.equal(Math.max(Math.abs(2530 - 2529), Math.abs(2205 - 2206)), 1,
    'Cave Exit landing is adjacent to the normal Cave Enter object');
});
