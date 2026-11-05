const assert = require('node:assert/strict');
const path = require('node:path');
const { before, after, test } = require('node:test');
require('../dist/Server').Server.installProductionPathResolver();
const { CachePipeline } = require('../dist/game/cache/CachePipeline');
const { PluginManager } = require('../dist/plugins/PluginManager');
const { Player } = require('../dist/game/entity/impl/player/Player');
const { PlayerSession } = require('../dist/net/PlayerSession');
const { ClientConnection } = require('../dist/net/NetworkBuilder');
const { decodeClientPackets } = require('../dist/net/protocol/ClientProtocol');
const { ItemIdentifiers: Items } = require('../dist/util/ItemIdentifiers');
const { Item } = require('../dist/game/model/Item');
const { ItemOnGroundManager } = require('../dist/game/entity/impl/grounditem/ItemOnGroundManager');
const { PrivateArea } = require('../dist/game/model/areas/impl/PrivateArea');
const { MultiChatboxPrompt } = require('../dist/game/model/menu/MultiChatboxPrompt');
const { PickupItemPacketListener } = require('../dist/net/packet/impl/PickupItemPacketListener');
const { SecondGroundItemOptionPacketListener } = require('../dist/net/packet/impl/SecondGroundItemOptionPacketListener');
const { GameConstants } = require('../dist/game/GameConstants');

let core;
let nextIndex = 9000;
let experienceMultiplier;
before(async () => {
  experienceMultiplier = GameConstants.EXPERIENCE_MULTIPLIER;
  GameConstants.EXPERIENCE_MULTIPLIER = 1;
  await CachePipeline.initialize(path.resolve(__dirname, '..'));
  PluginManager.loadFromDirectory(path.resolve(__dirname, '../plugins'));
  core = PluginManager.getCoreApi();
  core.RegionManager.init();
  core.RegionManager.loadMapFiles(3222, 3218);
  PluginManager.emitServerStartup({});
});
after(() => {
  GameConstants.EXPERIENCE_MULTIPLIER = experienceMultiplier;
  PluginManager.emitServerShutdown({});
});

function actor(t, privateArea = false) {
  const channel = { kind: 'test', remoteAddress: '127.0.0.1', isOpen: () => true, send: () => true, close() {}, onData() {}, onError() {}, onClose() {} };
  const player = new Player(new PlayerSession(channel));
  player.setIndex(nextIndex++);
  player.setUsername(`groundrouting${nextIndex}`);
  player.setRegistered(true);
  player.setLocation(new core.Location(3222, 3218, 0));
  player.getSkillManager().setCurrentLevel(core.Skill.HITPOINTS, 99, false);
  const area = privateArea ? new PrivateArea() : null;
  if (area) player.setArea(area);
  player.needsPlacement = false;
  const connection = new ClientConnection(channel);
  connection.player = player;
  t.after(() => { PluginManager.emitPlayerLogout({ player, username: player.getUsername() }); player.setRegistered(false); core.TaskManager.cancelTasks(player.getIndex()); });
  return { player, connection, area };
}

function nativeOp3(itemId, x = 3222, y = 3218) {
  return Buffer.from([103, itemId & 255, itemId >>> 8, (x & 255) + 128 & 255, x >>> 8, y >>> 8, (y & 255) + 128 & 255, 128]);
}

function nativeOp4(itemId, x = 3222, y = 3218) {
  return Buffer.from([56, itemId >>> 8, (itemId & 255) + 128 & 255, y >>> 8, (y & 255) + 128 & 255, 0, (x & 255) + 128 & 255, x >>> 8]);
}

function nativeOp5(itemId, x = 3222, y = 3218) {
  return Buffer.from([82, (itemId & 255) + 128 & 255, itemId >>> 8, x & 255, x >>> 8, y & 255, y >>> 8, 128]);
}

function browserAction({ itemId, x = 3222, y = 3218, option, optionIndex = 3 }) {
  const optionBytes = Buffer.from(option, 'utf8');
  const payload = Buffer.alloc(4 + 2 + 2 + 1 + 2 + 4 + optionBytes.length + 1 + 1);
  let offset = 0;
  payload.writeInt32BE(1, offset); offset += 4;
  payload.writeUInt16BE(x, offset); offset += 2;
  payload.writeUInt16BE(y, offset); offset += 2;
  payload[offset++] = 0;
  payload.writeUInt16BE(itemId, offset); offset += 2;
  payload.writeInt32BE(1, offset); offset += 4;
  optionBytes.copy(payload, offset); offset += optionBytes.length;
  payload[offset++] = 0;
  payload[offset++] = optionIndex;
  return Buffer.concat([Buffer.from([232, payload.length]), payload]);
}

async function dispatch(t, frame, privateArea = false) {
  const { connection } = actor(t, privateArea);
  const decoded = decodeClientPackets(frame);
  assert.equal(decoded.length, 1);
  await connection.dispatch(decoded, true);
  return decoded[0];
}

function assertGroundAction(itemId, option, actionIndex = 2) {
  const actions = core.CacheDefinitions.getItem(itemId)?.groundActions ?? [];
  assert.equal(actions[actionIndex]?.toLowerCase(), option.toLowerCase(), `cache op${actionIndex + 1} for ${itemId}`);
}

test('native op3 routes Bull bones Bury by the cached action, not the Take slot convention', async t => {
  const id = Items.BULL_BONES;
  assert.equal(id, 33115);
  assertGroundAction(id, 'Bury');
  const seen = t.mock.method(SecondGroundItemOptionPacketListener, 'interact', () => {});
  const pickup = t.mock.method(PickupItemPacketListener, 'pickup', () => {});
  const decoded = await dispatch(t, nativeOp3(id), true);
  assert.equal(decoded.optionIndex, 3);
  assert.equal(seen.mock.calls.length, 1);
  assert.equal(seen.mock.calls[0].arguments[4], 3);
  assert.equal(pickup.mock.calls.length, 0);
});

test('native op3 picks up ordinary Take and the client synthesized Take fallback', async t => {
  const ordinaryId = Items.BONES;
  const defaultTakeId = Items.COINS;
  assertGroundAction(ordinaryId, 'Take');
  const ordinary = t.mock.method(PickupItemPacketListener, 'pickup', () => {});
  const secondary = t.mock.method(SecondGroundItemOptionPacketListener, 'interact', () => {});
  await dispatch(t, nativeOp3(ordinaryId), true);
  const getItem = core.CacheDefinitions.getItem.bind(core.CacheDefinitions);
  t.mock.method(core.CacheDefinitions, 'getItem', itemId => {
    if (itemId !== defaultTakeId) return getItem(itemId);
    const definition = getItem(itemId);
    return { ...definition, groundActions: [null, null, null, null, null] };
  });
  await dispatch(t, nativeOp3(defaultTakeId), true);
  assert.equal(ordinary.mock.calls.length, 2);
  assert.equal(secondary.mock.calls.length, 0);
});

test('native op3 dispatches Giant bones Bury', async t => {
  const giantId = Items.GIANT_BONES;
  assert.equal(giantId, 30898);
  assertGroundAction(giantId, 'Bury');
  const secondary = t.mock.method(SecondGroundItemOptionPacketListener, 'interact', () => {});
  const pickup = t.mock.method(PickupItemPacketListener, 'pickup', () => {});
  await dispatch(t, nativeOp3(giantId));
  assert.equal(secondary.mock.calls.length, 1);
  assert.equal(pickup.mock.calls.length, 0);
});

test('native op4 takes Giant bones from the cached Take slot', async t => {
  const id = Items.GIANT_BONES;
  assertGroundAction(id, 'Take', 3);
  const pickup = t.mock.method(PickupItemPacketListener, 'pickup', () => {});
  const secondary = t.mock.method(SecondGroundItemOptionPacketListener, 'interact', () => {});
  const decoded = await dispatch(t, nativeOp4(id), true);
  assert.deepEqual([decoded.itemId, decoded.x, decoded.y, decoded.optionIndex], [id, 3222, 3218, 4]);
  assert.equal(pickup.mock.calls.length, 1);
  assert.equal(secondary.mock.calls.length, 0);
});

test('native op4 and op5 preserve non-Take actions in private areas', async t => {
  const logs = Items.LOGS;
  const furniture = Items.MAHOGANY_EAGLE;
  assertGroundAction(logs, 'Light', 3);
  assertGroundAction(furniture, 'Remove', 4);
  const secondary = t.mock.method(SecondGroundItemOptionPacketListener, 'interact', () => {});
  const pickup = t.mock.method(PickupItemPacketListener, 'pickup', () => {});
  const light = decodeClientPackets(nativeOp4(logs));
  const remove = decodeClientPackets(nativeOp5(furniture));
  assert.deepEqual([light[0].itemId, light[0].x, light[0].y, light[0].optionIndex], [logs, 3222, 3218, 4]);
  assert.deepEqual([remove[0].itemId, remove[0].x, remove[0].y, remove[0].optionIndex], [furniture, 3222, 3218, 5]);
  await dispatch(t, nativeOp4(logs), true);
  await dispatch(t, nativeOp5(furniture), true);
  assert.deepEqual(secondary.mock.calls.map(call => call.arguments[4]), [4, 5]);
  assert.equal(pickup.mock.calls.length, 0);
});

test('named high-level Bury resolves through the cached action in a private-area player context', async t => {
  const id = Items.BULL_BONES;
  assertGroundAction(id, 'Bury');
  const secondary = t.mock.method(SecondGroundItemOptionPacketListener, 'interact', () => {});
  const pickup = t.mock.method(PickupItemPacketListener, 'pickup', () => {});
  const decoded = await dispatch(t, browserAction({ itemId: id, option: 'Bury' }), true);
  assert.equal(decoded.option, 'Bury');
  assert.equal(secondary.mock.calls.length, 1);
  assert.equal(secondary.mock.calls[0].arguments[4], 3);
  assert.equal(pickup.mock.calls.length, 0);
});

test('named high-level action rejects an op number that conflicts with the cache', async t => {
  const id = Items.BULL_BONES;
  assertGroundAction(id, 'Bury');
  const secondary = t.mock.method(SecondGroundItemOptionPacketListener, 'interact', () => {});
  const pickup = t.mock.method(PickupItemPacketListener, 'pickup', () => {});
  await dispatch(t, browserAction({ itemId: id, option: 'Bury', optionIndex: 4 }));
  assert.equal(secondary.mock.calls.length, 0);
  assert.equal(pickup.mock.calls.length, 0);
});

test('named high-level Take still uses pickup for Giant bones', async t => {
  const id = Items.GIANT_BONES;
  assertGroundAction(id, 'Bury');
  const secondary = t.mock.method(SecondGroundItemOptionPacketListener, 'interact', () => {});
  const pickup = t.mock.method(PickupItemPacketListener, 'pickup', () => {});
  const decoded = await dispatch(t, browserAction({ itemId: id, option: 'Take', optionIndex: 3 }));
  assert.equal(decoded.option, 'Take');
  assert.equal(pickup.mock.calls.length, 1);
  assert.equal(secondary.mock.calls.length, 0);
});

test('native Giant bones Bury reaches the live ground-item listener and removes the instance stack', async t => {
  const f = actor(t, true);
  const id = Items.GIANT_BONES;
  assertGroundAction(id, 'Bury');
  f.player.setAttribute('giant-lairs:bury-without-asking', true);
  const beforeXp = f.player.getSkillManager().getExperience(core.Skill.PRAYER);
  assert.ok(f.player.getHitpoints() > 0);
  assert.equal(f.player.busy(), false);
  assert.equal(f.player.getLastItemPickup().elapsedTime(300), true);
  const ground = ItemOnGroundManager.registerLocation(
    f.player, new Item(id), f.player.getLocation().clone(), f.area,
  );
  assert.equal(f.player.getPrivateArea(), f.area);
  assert.equal(f.player.getLocation().equals(ground.getPosition()), true);
  assert.equal(ItemOnGroundManager.getGroundItem(
    f.player.getUsername(), id, ground.getPosition(), f.area,
  ), ground);
  const interactions = [];
  const groundEvents = [];
  const emitGroundItemInteraction = PluginManager.emitGroundItemInteraction.bind(PluginManager);
  t.mock.method(PluginManager, 'emitGroundItemInteraction', event => {
    groundEvents.push(event);
    return emitGroundItemInteraction(event);
  });
  const messages = [];
  t.mock.method(f.player, 'sendMessage', message => messages.push(message));
  const interact = SecondGroundItemOptionPacketListener.interact.bind(SecondGroundItemOptionPacketListener);
  t.mock.method(SecondGroundItemOptionPacketListener, 'interact', (...args) => {
    interactions.push(args);
    return interact(...args);
  });

  const decoded = decodeClientPackets(nativeOp3(id));
  assert.deepEqual([decoded[0].itemId, decoded[0].x, decoded[0].y, decoded[0].optionIndex], [id, 3222, 3218, 3]);
  await f.connection.dispatch(decoded, true);

  assert.equal(interactions.length, 1);
  assert.deepEqual(interactions[0].slice(1), [id, 3222, 3218, 3]);
  assert.equal(groundEvents.length, 1);
  assert.equal(groundEvents[0].handled, true, messages.join(' | '));
  assert.equal(ground.isPendingRemoval(), true);
  assert.equal(f.player.getSkillManager().getExperience(core.Skill.PRAYER) - beforeXp, 150);
});

test('unknown named action is ignored even if it carries a valid op number', async t => {
  const id = Items.BULL_BONES;
  const secondary = t.mock.method(SecondGroundItemOptionPacketListener, 'interact', () => {});
  const pickup = t.mock.method(PickupItemPacketListener, 'pickup', () => {});
  await dispatch(t, browserAction({ itemId: id, option: 'Dance' }));
  assert.equal(secondary.mock.calls.length, 0);
  assert.equal(pickup.mock.calls.length, 0);
});

test('native Bull bones Bury opens its confirmation and removes the private-area stack on selection', async t => {
  const f = actor(t, true);
  const other = actor(t, true);
  const id = Items.BULL_BONES;
  assertGroundAction(id, 'Bury');
  assert.notEqual(f.area, other.area);
  const ground = ItemOnGroundManager.registerLocation(
    f.player, new Item(id), f.player.getLocation().clone(), f.area,
  );
  const otherGround = ItemOnGroundManager.registerLocation(
    other.player, new Item(id), other.player.getLocation().clone(), other.area,
  );
  const prayerXp = f.player.getSkillManager().getExperience(core.Skill.PRAYER);
  assert.ok(f.player.getHitpoints() > 0);
  assert.equal(f.player.busy(), false);

  const decoded = decodeClientPackets(nativeOp3(id));
  await f.connection.dispatch(decoded, true);

  const prompt = MultiChatboxPrompt.getPending(f.player);
  assert.ok(prompt, 'ground-item interaction should open the Bury confirmation');
  assert.match(prompt.title, /bury/i);
  assert.equal(core.World.getItems().includes(ground), true);
  assert.equal(PluginManager.emitInterfaceActionClick({
    player: f.player,
    buttonId: MultiChatboxPrompt.OPTIONS_WIDGET_ID,
    groupId: 219,
    action: 1,
    slot: 1,
    handled: false,
  }), true);
  assert.equal(ground.isPendingRemoval(), true);
  assert.equal(otherGround.isPendingRemoval(), false);
  assert.equal(f.player.getSkillManager().getExperience(core.Skill.PRAYER) - prayerXp, 40);
});

test('named browser Giant bones Take reaches the pickup guard without removing the private stack', async t => {
  const f = actor(t, true);
  const id = Items.GIANT_BONES;
  assertGroundAction(id, 'Bury');
  const ground = ItemOnGroundManager.registerLocation(
    f.player, new Item(id), f.player.getLocation().clone(), f.area,
  );
  const messages = [];
  t.mock.method(f.player, 'sendMessage', message => messages.push(message));

  const decoded = decodeClientPackets(browserAction({ itemId: id, option: 'Take' }));
  await f.connection.dispatch(decoded, true);

  assert.ok(messages.some(message => /backpack/i.test(message)));
  assert.equal(core.World.getItems().includes(ground), true);
});
