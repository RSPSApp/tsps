// From server/: node --test tests/remaining-current-duck-route.test.cjs
//
// Drives the real Current Affairs plugin through PluginManager with a real Player
// and real NPC definitions, then checks the actual emitted npc route range. The
// duck is spawned/stopped by the plugin itself (owner-only World NPC), not a mock
// root API. The generic boat root route is covered by the foundation owner.
const assert = require('node:assert/strict');
const path = require('node:path');
const { test, before } = require('node:test');

const { Server } = require('../dist/Server');
Server.installProductionPathResolver();
const { CachePipeline } = require('../dist/game/cache/CachePipeline');
const { RegionManager } = require('../dist/game/collision/RegionManager');
const { NpcDefinitionLoader } = require('../dist/game/definition/loader/impl/NpcDefinitionLoader');
const { NPC } = require('../dist/game/entity/impl/npc/NPC');
const { Player } = require('../dist/game/entity/impl/player/Player');
const { Item } = require('../dist/game/model/Item');
const { Location } = require('../dist/game/model/Location');
const { World } = require('../dist/game/World');
const { TaskManager } = require('../dist/game/task/TaskManager');
const { PluginManager } = require('../dist/plugins/PluginManager');
const { NPCOptionPacketListener } = require('../dist/net/packet/impl/NPCOptionPacketListener');
const runtime = require('../plugins/quests/QuestRuntime');

const ROOT = path.resolve(__dirname, '..');
const DUCK_MOVING = 15152;
const DUCK_STOPPED = 15153;
const DUCK_ITEM = 31805;
const CHARTED_VARBIT = 18602;
let quest;
let boardAboard = true;

before(async () => {
  await CachePipeline.initialize(ROOT);
  RegionManager.init();
  new NpcDefinitionLoader().load();
  const api = PluginManager.createApi('remaining-current-duck-route-test');
  require('../plugins/npcs/NpcDialogues.plugin').register(api);
  require('../plugins/quests/quests/CurrentAffairs.Quest')(api);
  quest = runtime.getRegisteredQuests().find((entry) => entry.key === 'current_affairs');
  assert.ok(quest, 'Current Affairs registered through the real plugin API');
});

function account(x = 2837, y = 3414) {
  const player = new Player(null);
  const sentVarbits = new Map();
  player.__sentVarbits = sentVarbits;
  const sender = new Proxy({
    getVarbit: (id) => (id === 19136 ? (boardAboard ? 1 : 0) : (sentVarbits.get(id) ?? 0)),
    getVarp: () => 0,
    sendVarbit: (id, value) => { sentVarbits.set(id, value); return sender; },
    sendConfig: () => sender,
    closeInterruptibleInterfaces: () => {},
    isSubInterfaceOpen: () => false,
    isChatboxInterface: () => false,
  }, { get: (target, key) => target[key] ?? (() => sender) });
  player.getPacketSender = () => sender;
  player.moveTo(new Location(x, y, 0));
  player.setNeedsPlacement(false);
  return player;
}

function routeEvent(player, npc, clickType = 1) {
  return {
    player, npc,
    definition: npc.getCurrentDefinition(player),
    npcId: npc.getContentId(player),
    npcIndex: npc.getIndex(),
    clickType,
    location: { x: npc.getLocation().getX(), y: npc.getLocation().getY(), z: npc.getLocation().getZ() },
    handled: false,
    range: 1,
  };
}

function trackedDucks(npcId) {
  const found = [];
  World.getNpcs().forEach((npc) => { if (npc.getId() === npcId) found.push(npc); });
  return found;
}

function releaseDuck(player) {
  quest.setStage(player, 40);
  player.getInventory().adds(DUCK_ITEM, 1);
  const item = new Item(DUCK_ITEM, 1);
  const event = { player, interfaceId: 149, item, itemId: DUCK_ITEM, slot: 0, clickType: 1,
    option: 'Track-current', handled: false };
  PluginManager.emitItemAction(event);
  const moving = trackedDucks(DUCK_MOVING).at(-1);
  assert.ok(moving, 'the plugin spawned the real moving duck');
  assert.equal(moving.isOwnerOnly?.(), true, 'the released duck is owner-only');
  assert.equal(moving.getOwner?.(), player, 'the released duck is owned by the player');
  return moving;
}

test('moving duck cannot be collected from range and stays at normal range', () => {
  const player = account();
  const duck = releaseDuck(player);
  const event = routeEvent(player, duck);
  PluginManager.emitNpcRoute(event);
  assert.equal(event.range, 1, 'the moving duck keeps range 1');
});

test('stopped owned duck widens only the actual Collect click to 12 aboard', () => {
  const player = account();
  const duck = releaseDuck(player);
  for (let tick = 0; tick < 220; tick++) TaskManager.process();
  const stopped = trackedDucks(DUCK_STOPPED).at(-1);
  assert.ok(stopped, 'the moving duck transformed into the stopped duck');
  assert.equal(stopped.getId(), DUCK_STOPPED);

  const collect = routeEvent(player, stopped);
  PluginManager.emitNpcRoute(collect);
  assert.equal(collect.range, 12, 'actual Collect action widens to 12');

  const inspect = routeEvent(player, stopped, 2);
  PluginManager.emitNpcRoute(inspect);
  assert.equal(inspect.range, 1, 'Inspect keeps the normal range');

  const other = account();
  const wrongPlayer = routeEvent(other, stopped);
  PluginManager.emitNpcRoute(wrongPlayer);
  assert.equal(wrongPlayer.range, 1, 'another player cannot widen the owned duck');

  const publicDuck = new NPC(DUCK_STOPPED, new Location(2802, 3322, 0));
  assert.equal(World.getNpcs().add(publicDuck, true), true);
  try {
    const publicEvent = routeEvent(player, publicDuck);
    PluginManager.emitNpcRoute(publicEvent);
    assert.equal(publicEvent.range, 1, 'a public stopped duck is not the deployed duck');
  } finally {
    World.getNpcs().removes(publicDuck);
  }

  boardAboard = false;
  try {
    const ashore = routeEvent(player, stopped);
    PluginManager.emitNpcRoute(ashore);
    assert.equal(ashore.range, 1, 'ashore keeps the normal range');
  } finally {
    boardAboard = true;
  }
});

test('the real Collect interaction retrieves the stopped duck and charts the current', () => {
  const player = account();
  const duck = releaseDuck(player);
  for (let tick = 0; tick < 220; tick++) TaskManager.process();
  const stopped = trackedDucks(DUCK_STOPPED).at(-1);
  assert.ok(stopped);
  player.moveTo(new Location(2802, 3322, 0));

  const event = routeEvent(player, stopped);
  PluginManager.emitNpcRoute(event);
  assert.equal(event.range, 12);

  player.moveTo(new Location(2802, 3322, 0));
  NPCOptionPacketListener.operate(player, stopped, stopped.getIndex(), 1, stopped.getCurrentDefinition(player), 'collect');
  assert.equal(player.getInventory().getAmount(DUCK_ITEM), 1, 'the duck item the player carried is retained, not duplicated');
  assert.equal(player.__sentVarbits.get(CHARTED_VARBIT), 1, 'charting varbit set');
  assert.equal(stopped.isRegistered(), false, 'the stopped duck was removed');
  assert.equal(World.getNpcs().contains(stopped), false);
});
