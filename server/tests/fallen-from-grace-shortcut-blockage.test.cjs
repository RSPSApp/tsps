// FFG's captured post-cathedral shortcut: blocked Rocks 62263 -> mine with a pickaxe ->
// climbable Rocks 62265 -> normal Cormac side. Real cache/map definitions are used.
const assert = require('node:assert/strict');
const path = require('node:path');
const { before, test } = require('node:test');
const { Server } = require('../dist/Server');
Server.installProductionPathResolver();
const { PluginManager } = require('../dist/plugins/PluginManager');
const { CachePipeline } = require('../dist/game/cache/CachePipeline');
const { RegionManager } = require('../dist/game/collision/RegionManager');
const { ObjectDefinition } = require('../dist/game/definition/ObjectDefinition');
const { MapObjects } = require('../dist/game/entity/impl/object/MapObjects');
const { RsmodRouteFinding } = require('../dist/game/model/movement/path/RsmodRouteFinding');
const runtime = require('../plugins/quests/QuestRuntime');
const ObstacleRunner = require('../plugins/skills/agility/ObstacleRunner.Agility');
const core = PluginManager.getCoreApi();
const I = core.ItemIdentifiers;

before(async () => {
  await CachePipeline.initialize(path.resolve(__dirname, '..'));
  ObjectDefinition.init();
  RegionManager.init();
  RegionManager.loadMapFiles(2551, 2209, true);
});

function setup() {
  const hooks = { objects: [], itemOnObject: [], custom: new Map(), logins: [], logouts: [] };
  const api = new Proxy({
    core,
    persistAttribute() {},
    onObjectInteraction(fn) { hooks.objects.push(fn); },
    onItemOnObject(fn) { hooks.itemOnObject.push(fn); },
    onCustomEvent(name, fn) { const list = hooks.custom.get(name) ?? []; list.push(fn); hooks.custom.set(name, list); },
    onNpcDialogueVariant() {}, onNpcDialogueCondition() {}, onNpcInteraction() {}, onItemOnItem() {},
    onItemOnNpc() {}, onItemAction() {}, onGroundItemClick() {}, onGroundItemPickup() {}, onNpcDeath() {},
    onZoneEnter() {}, onPlayerLogin(fn) { hooks.logins.push(fn); }, onPlayerLogout(fn) { hooks.logouts.push(fn); },
    getItemOnGroundManager() { return { getGroundItem() {}, registerLocation() {} }; },
  }, { get: (target, key) => target[key] ?? (() => {}) });
  require('../plugins/quests/quests/FallenFromGrace.Quest')(api);
  const quest = runtime.getRegisteredQuests().filter((entry) => entry.key === 'fallen_from_grace').at(-1);
  const attrs = new Map(), items = new Map(), varbits = new Map(), messages = [];
  const sender = new Proxy({
    sendVarbit(id, value) { varbits.set(id, value); return sender; },
    sendInterfaceRemoval() { return sender; }, sendConfig(id, value) { varbits.set(id, value); return sender; },
  }, { get: (target, key) => target[key] ?? (() => sender) });
  let location = new core.Location(2550, 2209, 0);
  const player = {
    attrs, items, varbits, messages,
    getAttribute: (key) => attrs.get(key), setAttribute(key, value) { attrs.set(key, value); },
    getPacketSender: () => sender, sendMessage: (text) => messages.push(text),
    getLocation: () => location, moveTo(next) { location = next; },
    getInventory: () => ({
      contains: (id) => (items.get(id) ?? 0) > 0, getAmount: (id) => items.get(id) ?? 0,
      getFreeSlots: () => 28, isFull: () => false, adds: (id, n = 1) => items.set(id, (items.get(id) ?? 0) + n),
      deleteNumber: (id, n = 1) => items.set(id, Math.max(0, (items.get(id) ?? 0) - n)),
    }),
    getEquipment: () => ({ getItems: () => [], get: () => null }),
    getSkillManager: () => ({ getMaxLevel: () => 99, getCurrentLevel: () => 99, addExperiences() {} }),
    getUsername: () => 'ShortcutTest', getIndex: () => 1,
    isPlayer: () => true, isRegistered: () => true, isPlayerBot: () => false,
    performAnimation() {}, setPositionToFace() {}, setSkillAnimation() {},
    getMovementQueue: () => ({ reset() { return this; }, setBlockMovement() { return this; }, handleRegionChange() {} }),
    getUpdateFlag: () => ({ flag() {} }),
    getArea: () => null, setArea() {}, getPrivateArea: () => null,
  };
  const object = (objectId) => {
    const event = { player, objectId, clickType: 1, handled: false, object: null };
    for (const fn of hooks.objects) fn(event);
    return event;
  };
  const useOn = (itemId, objectId) => {
    const event = { player, itemId, objectId, handled: false };
    for (const fn of hooks.itemOnObject) fn(event);
    return event;
  };
  return { hooks, quest, player, object, useOn, items, varbits, messages };
}

test('real cache/map exposes the captured blockage then climbable rocks', () => {
  const player = { getPacketSender: () => ({ getVarbit: (id) => id === 15720 ? 0 : 19, getVarp: () => 0 }) };
  const blocked = ObjectDefinition.forPlayer(62263, player);
  assert.equal(blocked?.id, 62264);
  assert.equal(blocked?.getName(), 'Rocks');
  assert.deepEqual(blocked?.getInteractions()?.filter(Boolean), ['Mine']);
  assert.ok(MapObjects.get(62263, new core.Location(2551, 2209, 0), null), 'real blockage loc');
  player.getPacketSender = () => ({ getVarbit: (id) => id === 15720 ? 1 : 19, getVarp: () => 0 });
  const climbed = ObjectDefinition.forPlayer(62265, player);
  assert.equal(climbed?.id, 62266);
  assert.equal(climbed?.getName(), 'Rocks');
  assert.deepEqual(climbed?.getInteractions()?.filter(Boolean), ['Climb']);
});

test('stage 19 pickaxe-on-object clears 62263, opens climb and reaches Cormac side', () => {
  const h = setup();
  h.quest.setStage(h.player, 19);
  h.player.items.set(I.BRONZE_PICKAXE, 1);
  const event = h.useOn(I.BRONZE_PICKAXE, 62263);
  assert.equal(event.handled, true);
  assert.equal(h.player.attrs.get('fallen-from-grace:shortcut-cleared'), true);
  assert.equal(h.varbits.get(15720), 1);
  assert.ok(h.player.messages.includes('You swing your pickaxe at the rocks...'));

  const climbed = [];
  const original = { isBusy: ObstacleRunner.isBusy, run: ObstacleRunner.run };
  ObstacleRunner.isBusy = () => false;
  ObstacleRunner.run = (_context, steps) => { climbed.push(steps); return {}; };
  try {
    const climb = h.object(62265);
    assert.equal(climb.handled, true);
    assert.equal(climbed.length, 1);
    assert.ok(JSON.stringify(climbed[0]).includes('2554'), 'climb heads to the Cormac side');
  } finally {
    ObstacleRunner.isBusy = original.isBusy;
    ObstacleRunner.run = original.run;
  }

  const route = new RsmodRouteFinding((x, y, z, area) => RegionManager.getClipping(x, y, z, area));
  const out = route.findRoute({
    level: 0, srcX: 2554, srcY: 2209, srcSize: 1, destX: 2564, destY: 2217,
    destWidth: 1, destLength: 1, moveNear: false, privateArea: null, maxWaypoints: 10000,
  });
  assert.equal(out.success, true, 'climb landing has a normal Cormac-side route');
  assert.equal(out.alternative, false);
});

test('no pickaxe or pre-cathedral stage does not clear the blockage', () => {
  const h = setup();
  h.quest.setStage(h.player, 19);
  const noTool = h.useOn(995, 62263);
  assert.equal(noTool.handled, false);
  assert.equal(h.player.attrs.get('fallen-from-grace:shortcut-cleared'), undefined);

  h.quest.setStage(h.player, 18);
  h.player.items.set(I.BRONZE_PICKAXE, 1);
  const wrongStage = h.useOn(I.BRONZE_PICKAXE, 62263);
  assert.equal(wrongStage.handled, false);
  assert.equal(h.player.attrs.get('fallen-from-grace:shortcut-cleared'), undefined);
  assert.notEqual(h.varbits.get(15720), 1);
});
