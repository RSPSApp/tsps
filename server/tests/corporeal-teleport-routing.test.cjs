// Run after `yarn build`: node --test tests/corporeal-teleport-routing.test.cjs
const assert = require('node:assert/strict');
const path = require('node:path');
const { before, test } = require('node:test');
require('../dist/Server').Server.installProductionPathResolver();
const { CachePipeline } = require('../dist/game/cache/CachePipeline');
const { RegionManager } = require('../dist/game/collision/RegionManager');
const { PluginManager } = require('../dist/plugins/PluginManager');
const { Player } = require('../dist/game/entity/impl/player/Player');
const { PlayerSession } = require('../dist/net/PlayerSession');
const { GameObject } = require('../dist/game/entity/impl/object/GameObject');
const { ObjectDefinition } = require('../dist/game/definition/ObjectDefinition');
const { AreaManager } = require('../dist/game/model/areas/AreaManager');
const { TaskManager } = require('../dist/game/task/TaskManager');
const { SkillManager } = require('../dist/game/content/skill/SkillManager');
const { Item } = require('../dist/game/model/Item');
const { ItemIds } = require('../dist/util/IdEnums');
const { ItemActionPacketListener } = require('../dist/net/packet/impl/ItemActionPacketListener');
const { MAIN_INVENTORY_WIDGET_UID } = require('../dist/net/protocol/ClientProtocol');

let core, api, House, Instance, Lair, TeleportInterface, yanillePortalId;

before(async () => {
  await CachePipeline.initialize(path.resolve(__dirname, '..'));
  RegionManager.init();
  ObjectDefinition.init();
  core = PluginManager.getCoreApi();
  api = PluginManager.createApi('CorpTeleportRoutingTest');
  require('../plugins/modes/ironman/Common.Ironman').init(api);
  require('../plugins/modes/ironman/Setup.Ironman')(api);
  Lair = require('../plugins/bosses/corporealbeast/Lair.CorporealBeast');
  Lair(api);
  require('../plugins/items/Jewellery.plugin').register(api);
  require('../plugins/skills/construction/Core.Construction').init(api);
  House = require('../plugins/skills/construction/House.Construction');
  Instance = require('../plugins/skills/construction/Instance.Construction');
  House.attach(api);
  TeleportInterface = require('../plugins/interface/TeleportInterface.plugin');
  TeleportInterface.register(api);
  yanillePortalId = require('../plugins/skills/construction/Estate.Construction').HOUSE_LOCATIONS
    .find(({ id }) => id === 6).portal;
});

function actor(t, name, mode, combatLevel) {
  const channel = { kind: 'test', remoteAddress: '127.0.0.1', isOpen: () => true,
    send: () => true, close() {}, onData() {}, onError() {}, onClose() {} };
  const player = new Player(new PlayerSession(channel));
  const errors = [], warnings = [];
  const originalWarn = console.warn.bind(console);
  t.mock.method(console, 'error', (...args) => errors.push(args));
  t.mock.method(console, 'warn', (...args) => {
    if (String(args[0]).includes('[plugins]')) warnings.push(args); else originalWarn(...args);
  });
  t.after(() => {
    try {
      TaskManager.cancelTasks(player);
      try { House.releaseHouse(player, true); } finally { core.World.getPlayers().remove(player); }
    } finally {
      TaskManager.cancelTasks(player);
      assert.equal(player.isRegistered(), false, 'player was removed');
      assert.equal(House.houseFor(player), null, 'house was released');
      assert.equal(TaskManager.hasActiveTask(player), false, 'no active player-key task');
      assert.deepEqual(errors, [], 'no hook or cleanup errors');
      assert.deepEqual(warnings, [], 'no swallowed plugin warnings');
    }
  });
  player.setUsername(name);
  player.setLongUsername(core.Misc.stringToLongBigInt(name));
  assert.notEqual(player.getLongUsername(), 0n);
  player.setAttribute('bot-skip-persistence', true);
  const save = Instance.createDefaultHouseSave();
  save.location = 6;
  player.setAttribute('construction:house', save);
  assert.equal(core.World.getPlayers().add(player), true);
  const { Skill } = core;
  const skills = [Skill.ATTACK, Skill.DEFENCE, Skill.STRENGTH, Skill.HITPOINTS, Skill.PRAYER, Skill.RANGED, Skill.MAGIC];
  const levels = combatLevel === 89 ? [70, 70, 70, 70, 70, 70, 70] : [71, 71, 71, 70, 70, 70, 70];
  for (let i = 0; i < skills.length; i++) {
    player.getSkillManager().setMaxLevels(skills[i], levels[i], false)
      .setExperiences(skills[i], SkillManager.getExperienceForLevel(levels[i]), false)
      .setCurrentLevel(skills[i], levels[i], false);
  }
  assert.equal(player.getSkillManager().getCombatLevel(), combatLevel);
  require('../plugins/modes/ironman/Common.Ironman').setMode(player, mode);
  const query = { player, mode: 'none' };
  PluginManager.emitCustomEvent('ironman:mode', query);
  assert.equal(query.mode, mode);
  player.moveTo(new core.Location(3200, 3200, 0));
  AreaManager.process(player);
  PluginManager.updatePlayerZones(player);
  // The normal player update consumes placement before another interaction.
  player.setNeedsPlacement(false);
  assert.equal(player.getPrivateArea(), null);
  assert.ok(player.getHitpoints() > 0);
  assert.equal(player.busy(), false);
  assert.equal(core.TeleportHandler.checkReqs(player, new core.Location(2967, 4381, 2)), true);
  return player;
}

function tickToArrival(player) {
  for (let tick = 0; tick < core.TeleportType.NORMAL.getStartTick() + 2; tick++) {
    TaskManager.process();
    AreaManager.process(player);
    PluginManager.updatePlayerZones(player);
  }
}

const coordinates = (player) => [player.getLocation().getX(), player.getLocation().getY(), player.getLocation().getZ()];

function necklace(player) {
  const item = new Item(ItemIds.GAMES_NECKLACE_8_, 1);
  player.getInventory().setItem(0, item);
  const action = [2, 3, 4, 6, 7]
    .map(op => ItemActionPacketListener.resolveInventoryWidgetAction(item.getId(), op))
    .find(candidate => candidate?.option?.toLowerCase() === 'rub');
  assert.ok(action, 'the native inventory resolver exposes Rub for this necklace');
  const event = { player, item, itemId: item.getId(), slot: 0,
    interfaceId: MAIN_INVENTORY_WIDGET_UID, clickType: action.optionIndex, option: action.option, subOpId: 3, handled: false };
  assert.equal(PluginManager.emitItemAction(event), true);
  return item;
}

for (const [mode, level, y] of [['none', 90, 4253], ['ironman', 89, 4253], ['ironman', 90, 4381]]) {
  test(`games necklace routes ${mode} combat ${level} at actual arrival`, (t) => {
    const player = actor(t, `neck${mode[0]}${level}`, mode, level);
    const item = necklace(player), start = coordinates(player);
    assert.equal(player.getInventory().getItems()[0] === item, true);
    assert.equal(item.getId(), ItemIds.GAMES_NECKLACE_8_);
    tickToArrival(player);
    assert.notDeepEqual(coordinates(player), start);
    assert.equal(player.getInventory().getItems()[0] === item, true);
    assert.equal(player.getInventory().getItems()[0].getId(), ItemIds.GAMES_NECKLACE_7_);
    assert.deepEqual(coordinates(player), [2967, y, 2]);
  });
}

test('cancelled necklace teleport neither moves nor spends a charge', (t) => {
  const player = actor(t, 'neckcancel', 'ironman', 90), start = coordinates(player);
  const item = necklace(player);
  TaskManager.cancelTasks(player);
  tickToArrival(player);
  assert.deepEqual(coordinates(player), start);
  assert.equal(player.getInventory().getItems()[0] === item, true);
  assert.equal(item.getId(), ItemIds.GAMES_NECKLACE_8_);
});

test('blocked movement refuses a necklace without moving or spending a charge', (t) => {
  const player = actor(t, 'neckdeny', 'none', 90), start = coordinates(player);
  player.getMovementQueue().setBlockMovement(true);
  assert.equal(core.TeleportHandler.checkReqs(player, new core.Location(2967, 4381, 2)), false);
  const item = necklace(player);
  tickToArrival(player);
  assert.deepEqual(coordinates(player), start);
  assert.equal(player.getInventory().getItems()[0] === item, true);
  assert.equal(item.getId(), ItemIds.GAMES_NECKLACE_8_);
  player.getMovementQueue().setBlockMovement(false);
});

function objectClick(player, object, definition, clickType) {
  const at = object.getLocation(), source = player.getLocation();
  return PluginManager.emitObjectInteraction({ player, object, objectId: object.getId(), definition,
    clickType, location: { x: at.getX(), y: at.getY(), z: at.getZ() },
    sourceLocation: { x: source.getX(), y: source.getY(), z: source.getZ() }, handled: false });
}

function openBox(player) {
  const save = player.getAttribute('construction:house');
  save.rooms[1][4][6] = { roomKey: 'ACHIEVEMENT_GALLERY', rotation: 0,
    furniture: { JEWELLERY_BOX: 'ORNATE_JEWELLERY_BOX' } };
  const portalLocation = new core.Location(2542, 3097, 0);
  player.moveTo(new core.Location(2542, 3096, 0));
  const portal = new GameObject(yanillePortalId, portalLocation, 10, 2, null);
  const portalDefinition = ObjectDefinition.forPlayer(yanillePortalId, player) ?? ObjectDefinition.forId(yanillePortalId);
  assert.equal(objectClick(player, portal, portalDefinition, 1), true);
  const house = House.houseFor(player);
  assert.equal(house?.owner === player, true);
  const room = house.save.rooms[1][4][6];
  const box = Object.values(room.furnitureByLocation).find(furniture => furniture.hotspotKey === 'JEWELLERY_BOX');
  assert.equal(box?.buildableKey, 'ORNATE_JEWELLERY_BOX');
  const object = house.furnitureObjects.find(candidate => {
    const at = candidate.getLocation();
    return house.getFurnitureAt({ x: at.getX(), y: at.getY(), z: at.getZ() }, candidate.getId(), candidate.getType()) === box;
  });
  assert.ok(object);
  const at = object.getLocation();
  player.moveTo(new core.Location(at.getX() - 1, at.getY(), at.getZ()));
  player.setNeedsPlacement(false);
  const definition = ObjectDefinition.forPlayer(object.getId(), player) ?? ObjectDefinition.forId(object.getId());
  const index = definition.getInteractions().findIndex(option => option?.toLowerCase() === 'teleport menu');
  assert.notEqual(index, -1);
  assert.equal(objectClick(player, object, definition, index + 1), true);
  const groupId = require('../plugins/skills/construction/Ids.Construction').iface('poh_jewellery_box');
  const slot = require('../plugins/skills/construction/data/jewellery-box.json').destinations
    .findIndex(entry => entry.jewellery === 'games' && entry.label === 'Corporeal Beast');
  assert.notEqual(slot, -1);
  assert.equal(PluginManager.emitInterfaceActionClick({ player, buttonId: groupId << 16, groupId, childId: 0,
    action: slot, slot, handled: false }), true);
}

for (const [mode, level, y] of [['none', 90, 4253], ['ironman', 90, 4381]]) {
  test(`jewellery box routes ${mode} at actual arrival`, (t) => {
    const player = actor(t, `box${mode[0]}${level}`, mode, level);
    const request = { player, list: [] };
    PluginManager.emitCustomEvent('construction:jewellery-box-destinations', request);
    const exported = request.list.find(entry => entry.label === 'Corporeal Beast')?.location;
    assert.ok(exported, 'the registered box destination producer includes Corporeal Beast');
    openBox(player);
    tickToArrival(player);
    assert.deepEqual([exported.getX(), exported.getY(), exported.getZ()], coordinates(player));
    assert.deepEqual(coordinates(player), [2967, y, 2]);
  });
}

for (const [mode, level, y] of [['none', 90, 4252], ['ironman', 90, 4380]]) {
  test(`server teleport panel routes ${mode} at actual arrival`, (t) => {
    const player = actor(t, `panel${mode[0]}${level}`, mode, level);
    PluginManager.emitCustomEvent('teleports:open', { player });
    const { GROUP_ID, ROW_UIDS, OP, Destinations } = TeleportInterface._test;
    assert.equal(player.getInterfaceId(), GROUP_ID);
    assert.equal(PluginManager.emitInterfaceActionClick({ player, buttonId: ROW_UIDS[0],
      groupId: GROUP_ID, childId: ROW_UIDS[0] & 0xffff, slot: Destinations.byKey('corporeal-beast').id,
      action: OP.TELEPORT, opId: OP.TELEPORT, handled: false }), true);
    tickToArrival(player);
    assert.deepEqual(coordinates(player), [2966, y, 2]);
  });
}

test('room destination query returns a fresh tile and preserves the supplied anchor', (t) => {
  const player = actor(t, 'anchor', 'none', 90), anchor = [2967, 4381, 2];
  for (let i = 0; i < 2; i++) {
    const request = { player, tile: anchor };
    PluginManager.emitCustomEvent('corporeal:teleport-destination', request);
    assert.notEqual(request.tile, anchor);
    assert.deepEqual(request.tile, [2967, 4253, 2]);
    assert.deepEqual(anchor, [2967, 4381, 2]);
  }
});

test('missing or unhandled jewellery API preserves the existing destination', (t) => {
  const player = actor(t, 'fallback', 'none', 90);
  const games = require('../plugins/items/Teleports.Jewellery').JEWELLERY.find(entry => entry.key === 'games');
  const tile = games.destinations.find(entry => entry.label === 'Corporeal Beast').tile;
  assert.deepEqual(typeof tile === 'function' ? tile(player) : tile, [2967, 4381, 2]);
  if (typeof tile === 'function') {
    let calls = 0;
    assert.deepEqual(tile(player, { emitCustomEvent(name) { calls++; assert.equal(name, 'corporeal:teleport-destination'); } }), [2967, 4381, 2]);
    assert.equal(calls, 1);
  }
});
