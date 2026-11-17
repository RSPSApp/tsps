// Seeded house/quest prerequisites; real acquisition, containers, native widget/drop dispatch and saves.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { before, after, test } = require('node:test');
process.env.DISABLE_PLAYER_BOTS = '1';
const localWorld = path.resolve(__dirname, '../data/definitions/world.local.json');
const previousWorld = fs.existsSync(localWorld) ? fs.readFileSync(localWorld) : null;
const config = previousWorld ? JSON.parse(previousWorld.toString('utf8')) : {};
// Official local world configuration: gameplay/startup hooks run; the unrelated HTTP admin stays off.
fs.writeFileSync(localWorld, JSON.stringify({ ...config, plugins: { ...config.plugins, WorldAdmin: false, FreeToPlay: false } }));
require('../dist/Server').Server.installProductionPathResolver();
const { CachePipeline } = require('../dist/game/cache/CachePipeline');
const { PluginManager: PM } = require('../dist/plugins/PluginManager');
const { Player } = require('../dist/game/entity/impl/player/Player');
const { PlayerSession } = require('../dist/net/PlayerSession');
const { ClientConnection } = require('../dist/net/NetworkBuilder');
const { Inventory } = require('../dist/game/model/container/impl/Inventory');
const { Bank } = require('../dist/game/model/container/impl/Bank');
const { PlayerSave } = require('../dist/game/entity/impl/player/persistence/PlayerSave');
const { ShopManager } = require('../dist/game/model/container/shop/ShopManager');
const { MapObjects } = require('../dist/game/entity/impl/object/MapObjects');
const Runtime = require('../plugins/quests/QuestRuntime');
const FOUND = 'construction:books-found';
let core, House, Instance, next = 1;
const errors = [], originalError = console.error;
before(async () => {
  console.error = (...args) => { errors.push(args.map(String).join(' ')); originalError(...args); };
  await CachePipeline.initialize(path.resolve(__dirname, '..'));
  PM.loadFromDirectory(path.resolve(__dirname, '../plugins'));
  core = PM.getCoreApi(); core.RegionManager.init();
  const { ShopDefinitionLoader } = require('../dist/game/definition/loader/impl/ShopDefinitionLoader');
  assert.equal(new ShopDefinitionLoader().load(), true);
  ShopManager.initialize();
  core.RegionManager.loadMapFiles(3366, 3335);
  PM.emitServerStartup({});
  House = require('../plugins/skills/construction/House.Construction');
  Instance = require('../plugins/skills/construction/Instance.Construction');
  assert.equal(core.CacheDefinitions.getEnumValues(5210).get(45), 7162);
});
after(() => {
  PM.emitServerShutdown({}); console.error = originalError;
  if (previousWorld) fs.writeFileSync(localWorld, previousWorld); else fs.unlinkSync(localWorld);
  assert.deepEqual(errors, [], 'required gameplay hooks must not fail');
});

function actor(t) {
  const channel = { kind: 'test', remoteAddress: '127.0.0.1', isOpen: () => true,
    send: () => true, close() {}, onData() {}, onError() {}, onClose() {} };
  const p = new Player(new PlayerSession(channel));
  p.setUsername(`bookqa${next++}`); p.setLongUsername(core.Misc.stringToLongBigInt(p.getUsername()));
  p.setAttribute('bot-skip-persistence', true);
  assert.equal(core.World.getPlayers().add(p), true);
  p.setLocation(new core.Location(3366, 3335, 0)); p.setNeedsPlacement(false);
  const c = new ClientConnection(channel); c.player = p;
  p.getSession().setPlayer(p); p.getSession().setTurnPacketProcessor(() => c.processTurnPackets());
  const configs = new Map(), messages = [];
  const sender = p.getPacketSender(), sendConfig = sender.sendConfig.bind(sender), sendMessage = sender.sendMessage.bind(sender);
  t.mock.method(sender, 'sendConfig', (id, value) => { configs.set(id, value); return sendConfig(id, value); });
  t.mock.method(sender, 'sendMessage', (message, ...rest) => { messages.push(message); return sendMessage(message, ...rest); });
  t.after(() => {
    p.getPacketSender().sendInterfaceRemoval(); House.releaseHouse(p, true);
    core.TaskManager.cancelTasks(p); core.TaskManager.cancelTasks(p.getIndex());
    for (const ground of [...core.World.getItems()]) if (ground.getOwner() === p.getUsername()) core.ItemOnGroundManager.deregister(ground);
    if (p.isRegistered()) core.World.getPlayers().remove(p);
  });
  return { p, c, configs, messages };
}
const quest = key => { const q = Runtime.getRegisteredQuests().find(q => q.key === key); assert.ok(q, key); return q; };
const held = (f, id) => f.p.getInventory().getAmount(id);
async function input(f, packet) { await f.c.dispatch([packet]); f.c.processTurnPackets(); }
async function drop(f, id) {
  const slot = f.p.getInventory().getSlotForItemId(id); assert.ok(slot >= 0);
  await input(f, { type: 'widget_action', widgetId: 149 << 16, groupId: 149, childId: 0, buttonNum: 7, slot, itemId: id });
  assert.equal(held(f, id), 0, 'actual native Drop removes the book');
}
function ownHouse(f) {
  const save = Instance.createDefaultHouseSave();
  Object.assign(save, { owned: true, location: 1, style: 0, locked: false });
  save.rooms[1][4][5].furniture.BOOKCASE = 'WOODEN_BOOKCASE';
  f.p.setAttribute('construction:house', save);
  assert.equal(House.enterHouse(f.p, false), true);
  const house = House.houseFor(f.p);
  const object = house.furnitureObjects.find(o => o.getId() === 6768);
  assert.ok(object, 'real seeded house draws its bookcase');
  return object;
}
function search(f, object) {
  const at = object.getLocation();
  assert.equal(PM.emitObjectInteraction({ player: f.p, object, objectId: object.getId(), definition: object.getDefinition(),
    location: { x: at.getX(), y: at.getY(), z: at.getZ() }, clickType: 1, option: 'Search', handled: false }), true);
  assert.equal(f.p.getInterfaceId(), 910, 'real Search opens the cache bookcase');
}
const shown = (f, slot) => !!((f.configs.get([805, 261, 262, 263, 264, 265, 266, 1037][slot >>> 5]) ?? 0) & (1 << (slot & 31)));
async function take(f, slot, itemId) {
  await input(f, { type: 'widget_action', widgetId: (910 << 16) | 5, groupId: 910, childId: 5,
    buttonNum: 1, slot, itemId });
}
function buyPieBook(f) {
  f.p.getInventory().adds(995, 5);
  assert.equal(ShopManager.open(f.p, 1496), true, 'actual Pie Shop opens');
  assert.equal(ShopManager.handleItemContainerAction(f.p, { kind: 'buy_sell', containerId: ShopManager.ITEMS_INTERFACE_ID,
    slot: 0, itemId: 7162, amount: 1 }), true);
  assert.equal(held(f, 7162), 1, 'real shop receipt acquired the book');
  assert.equal(held(f, 995), 0, 'actual price paid');
  ShopManager.close(f.p); f.p.getPacketSender().sendInterfaceRemoval();
}

test('a purchased book dropped before the first Search remains retrievable and saved', async t => {
  const f = actor(t); buyPieBook(f); await drop(f, 7162);
  const object = ownHouse(f); search(f, object);
  assert.equal(shown(f, 45), true, 'bookcase remembers actual acquisition even after native disposal');
  await take(f, 45, 7162); assert.equal(held(f, 7162), 1);
  await take(f, 45, 7162); assert.equal(held(f, 7162), 1, 'duplicate retrieval gives no extra book');
  await drop(f, 7162);
  const saved = PlayerSave.fromPlayer(f.p), restored = actor(t);
  saved.applyToPlayer(restored.p); restored.p.setNeedsPlacement(false);
  assert.equal(held(restored, 7162), 0);
  const restoredObject = ownHouse(restored); search(restored, restoredObject);
  assert.equal(shown(restored, 45), true, 'registered slot history survives a real save round trip');
  await take(restored, 45, 7162); assert.equal(held(restored, 7162), 1);
});

test('actual Exam Centre recovery before EWII completion cannot unlock premature POH retrieval', async t => {
  const f = actor(t), q = quest('elemental_workshop_ii'); q.setStage(f.p, 1);
  const location = new core.Location(3366, 3335, 0);
  const object = MapObjects.getObjectsAt(location, null).find(o => o.getId() === 17382);
  assert.ok(object, 'actual cache Exam Centre bookcase');
  assert.equal(PM.emitObjectInteraction({ player: f.p, object, objectId: 17382, definition: object.getDefinition(),
    location: { x: 3366, y: 3335, z: 0 }, clickType: 1, option: 'Search', handled: false }), true);
  assert.equal(held(f, 9717), 1, 'existing quest source supplies the beaten book');
  const bookcase = ownHouse(f); search(f, bookcase);
  assert.equal(shown(f, 61), false, 'owning the book does not bypass the source-backed completion requirement');
  await drop(f, 9717); search(f, bookcase); await take(f, 61, 9717);
  assert.equal(held(f, 9717), 0, 'native retrieval cannot bypass the display gate');
  q.setStage(f.p, 12); search(f, bookcase);
  assert.equal(shown(f, 61), true, 'completion makes the observed acquisition eligible');
  await take(f, 61, 9717); assert.equal(held(f, 9717), 1);
});

for (const [key, stage, slot, itemId] of [['the_dig_site', 9, 4, 711], ['grand_tree', 160, 9, 784]]) {
  test(`${key} completion gates both legacy found flags and recovery`, async t => {
    const f = actor(t), q = quest(key); q.setStage(f.p, 1);
    f.p.setAttribute(FOUND, [slot]); // A legacy save may already contain the premature flag.
    const object = ownHouse(f); search(f, object);
    assert.equal(shown(f, slot), false, 'legacy memory is masked until completion');
    await take(f, slot, itemId); assert.equal(held(f, itemId), 0);
    assert.deepEqual(f.p.getAttribute(FOUND), [slot], 'eligibility never destroys acquisition history');
    q.setStage(f.p, stage); search(f, object); assert.equal(shown(f, slot), true);
    await take(f, slot, itemId); assert.equal(held(f, itemId), 1);
  });
}

function acquisitions(t, f, nested) {
  const events = [], emit = PM.emitCustomEvent;
  // Observe, never replace, the real event dispatcher. Optional nested mutation challenges quantities.
  t.mock.method(PM, 'emitCustomEvent', function(name, event) {
    if (name === 'inventory:acquired' && event.player === f.p) {
      events.push([event.itemId, event.amount]);
      nested?.(event);
    }
    return emit.call(this, name, event);
  });
  return events;
}

test('accepted additions report partial quantities once, before refresh, even without refresh', t => {
  const f = actor(t), inv = f.p.getInventory();
  for (let i = 0; i < 27; i++) inv.adds(954, 1);
  const events = acquisitions(t, f);
  inv.add(new core.Item(7162, 3), false);
  assert.deepEqual(events, [[7162, 1]], 'one partial acceptance, not the requested quantity');
  assert.equal(held(f, 7162), 1);
  inv.add(new core.Item(7162, 1), true);
  inv.add(new core.Item(-1, 1), false); inv.add(new core.Item(7162, 0), false);
  assert.deepEqual(events, [[7162, 1]], 'full/invalid/zero requests emit nothing');
  inv.deleteNumber(954, 1);
  const refresh = inv.refreshItems.bind(inv);
  t.mock.method(inv, 'refreshItems', () => {
    assert.deepEqual(events.at(-1), [7162, 1], 'observation precedes refresh'); return refresh();
  });
  inv.add(new core.Item(7162, 1), true);
  assert.deepEqual(events, [[7162, 1], [7162, 1]]);
});

test('clamped stack merges retain identity and report only accepted quantity; nested adds stay separate', t => {
  const f = actor(t), inv = f.p.getInventory();
  inv.add(new core.Item(995, 2147483646, { origin: 'kept' }), false);
  const stack = inv.forSlot(0);
  const events = acquisitions(t, f, event => {
    if (event.itemId === 995) inv.add(new core.Item(7162, 1), false);
  });
  inv.add(new core.Item(995, 7, { origin: 'kept' }), false);
  assert.deepEqual(events, [[995, 1], [7162, 1]]);
  assert.equal(inv.forSlot(0), stack, 'normal live-stack merge keeps its original identity');
  assert.deepEqual(stack.getMeta(), { origin: 'kept' });
  assert.equal(stack.getAmount(), 2147483647);
  inv.add(new core.Item(995, 1, { origin: 'kept' }), false);
  assert.deepEqual(events, [[995, 1], [7162, 1]], 'a saturated stack accepts nothing');
});

test('scratch inventories, save snapshots, direct imports and reorders do not announce acquisitions', t => {
  const f = actor(t), events = acquisitions(t, f);
  const preview = new Inventory(f.p); preview.add(new core.Item(7162, 1), false);
  f.p.getInventory().setItem(0, new core.Item(7162, 1));
  f.p.getInventory().swap(0, 1);
  PlayerSave.fromPlayer(f.p);
  assert.deepEqual(events, []);
  assert.deepEqual(f.p.getAttribute(FOUND) ?? [], [], 'planning and snapshot copies cannot discover a book');
  const object = ownHouse(f); search(f, object);
  assert.equal(shown(f, 45), true, 'settled held items still migrate at Search');
});

test('the optional inventory observer preserves bootstrap and minimal owner compatibility', () => {
  const detached = new Inventory(); detached.add(new core.Item(7162, 1), false);
  assert.equal(detached.getAmount(7162), 1);
  const owner = { getUsername: () => 'bootstrap' };
  const bootstrap = new Inventory(owner); bootstrap.add(new core.Item(7162, 1), false);
  assert.equal(bootstrap.getAmount(7162), 1, 'authority cannot be proved, so notification is skipped');
});

test('a zero-quantity bank placeholder is not an acquired book during legacy migration', t => {
  const f = actor(t);
  f.p.getBank(0).setItem(0, new core.Item(7162, 0));
  const object = ownHouse(f); search(f, object);
  assert.equal(shown(f, 45), false);
});

test('real Bank transfers preserve metadata and discovery after the last copy is dropped', async t => {
  const f = actor(t), inv = f.p.getInventory();
  inv.add(new core.Item(7162, 1, { origin: 'bank-test' }), false);
  const original = inv.forSlot(inv.getSlotForItemId(7162));
  f.p.getBank(0).open();
  Bank.deposit(f.p, 7162, inv.getSlotForItemId(7162), 1, false);
  assert.equal(held(f, 7162), 0);
  const tab = Bank.getTabForItem(f.p, 7162), bank = f.p.getBank(tab);
  assert.equal(bank.getAmount(7162), 1);
  Bank.withdraw(f.p, 7162, bank.getSlotForItemId(7162), 1, tab);
  const returned = inv.forSlot(inv.getSlotForItemId(7162));
  assert.notEqual(returned, original, 'a removed item identity is not revived');
  assert.deepEqual(returned.getMeta(), { origin: 'bank-test' });
  assert.equal(bank.getAmount(7162), 0);
  f.p.getPacketSender().sendInterfaceRemoval(); await drop(f, 7162);
  const object = ownHouse(f); search(f, object); assert.equal(shown(f, 45), true);
  while (inv.getFreeSlots()) inv.add(new core.Item(954, 1), false);
  await take(f, 45, 7162); assert.equal(held(f, 7162), 0, 'full inventory refuses without consuming discovery');
  inv.deleteNumber(954, 1); await take(f, 45, 7162); assert.equal(held(f, 7162), 1);
});

test('native pickup credits discovery once and refuses a second pickup of the same ground source', async t => {
  const f = actor(t), at = f.p.getLocation();
  const pile = core.ItemOnGroundManager.registers(f.p, new core.Item(7162, 1, { origin: 'ground-test' }));
  t.after(() => { if (!pile.isPendingRemoval()) core.ItemOnGroundManager.deregister(pile); });
  const events = acquisitions(t, f);
  await input(f, { type: 'ground_item_action', itemId: 7162, stackId: pile.getId(), x: at.getX(), y: at.getY(), option: 'Take' });
  for (let i = 0; i < 4; i++) {
    f.p.setNeedsPlacement(false); core.TaskManager.processWalkTo(f.p.getIndex());
    f.p.getMovementQueue().process(); core.TaskManager.process();
  }
  assert.equal(held(f, 7162), 1); assert.equal(pile.isPendingRemoval(), true);
  assert.deepEqual(f.p.getInventory().forSlot(0).getMeta(), { origin: 'ground-test' });
  core.ItemOnGroundManager.pickup(f.p, pile);
  assert.deepEqual(events, [[7162, 1]], 'removed source cannot notify twice');
  await drop(f, 7162); const object = ownHouse(f); search(f, object);
  assert.equal(shown(f, 45), true);
});

test('real native two-screen trade discovers the recipient book while rejecting an untradeable book', async t => {
  const giver = actor(t), recipient = actor(t);
  buyPieBook(giver); giver.p.getInventory().adds(9717, 1);
  giver.p.getTrading().requestTrade(recipient.p); recipient.p.getTrading().requestTrade(giver.p);
  await input(giver, { type: 'trade_action', action: 'offer', itemId: 9717, quantity: 1, slot: giver.p.getInventory().getSlotForItemId(9717) });
  assert.equal(giver.p.getTrading().getContainer().getAmount(9717), 0, 'untradeable policy still refuses the offer');
  await input(giver, { type: 'trade_action', action: 'offer', itemId: 7162, quantity: 1, slot: giver.p.getInventory().getSlotForItemId(7162) });
  assert.equal(giver.p.getTrading().getContainer().getAmount(7162), 1);
  assert.equal(held(recipient, 7162), 0);
  await input(giver, { type: 'trade_action', action: 'accept' });
  await input(recipient, { type: 'trade_action', action: 'accept' });
  assert.equal(giver.p.getInterfaceId(), 334, 'both first-screen accepts reach confirmation');
  // Only the trade button clock is controlled; transfer/container/persistence owners are real.
  giver.p.getTrading().getButtonDelay().stop(); recipient.p.getTrading().getButtonDelay().stop();
  await input(giver, { type: 'trade_action', action: 'confirm_accept' });
  await input(recipient, { type: 'trade_action', action: 'confirm_accept' });
  assert.equal(held(giver, 7162), 0); assert.equal(held(recipient, 7162), 1);
  assert.equal(held(giver, 9717), 1);
  await drop(recipient, 7162); const object = ownHouse(recipient); search(recipient, object);
  assert.equal(shown(recipient, 45), true, 'confirmed recipient acquisition survives disposal');
});
