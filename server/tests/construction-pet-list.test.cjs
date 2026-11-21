const assert = require('node:assert/strict'), path = require('node:path');
const { before, after, test } = require('node:test');
const root = path.resolve(__dirname, '..');
require(root + '/dist/Server').Server.installProductionPathResolver();
const { CachePipeline } = require(root + '/dist/game/cache/CachePipeline');
const { PluginManager: PM } = require(root + '/dist/plugins/PluginManager');
const { Player } = require(root + '/dist/game/entity/impl/player/Player');
const { PlayerSession } = require(root + '/dist/net/PlayerSession');
const { ClientConnection } = require(root + '/dist/net/NetworkBuilder');

// The menagerie's Pet list Read, as rsprox captures 2581, 2777, 2782, 2793 and 3121 send it.
let core, House, MaxHouse, Data, next = 1650;
before(async () => {
  await CachePipeline.initialize(root);
  PM.loadFromDirectory(root + '/plugins');
  core = PM.getCoreApi();
  core.RegionManager.init();
  core.RegionManager.loadMapFiles(3222, 3218);
  PM.emitServerStartup({});
  House = require(root + '/plugins/skills/construction/House.Construction');
  MaxHouse = require(root + '/plugins/skills/construction/MaxHouse.Construction');
  Data = require(root + '/plugins/skills/construction/Data.Construction');
});
after(() => PM.emitServerShutdown({}));

const PET_LIST_IF = 210, LIST = 3;
const petEnum = () => core.CacheDefinitions.getEnumValues(985);

function actor(t) {
  const channel = { kind: 'test', remoteAddress: '127.0.0.1', isOpen: () => true, send: () => true, close() {}, onData() {}, onError() {}, onClose() {} };
  const p = new Player(new PlayerSession(channel));
  p.setIndex(next++);
  p.setUsername('petlist' + next);
  p.setRegistered(true);
  p.setLocation(new core.Location(3222, 3218, 0));
  p.needsPlacement = false;
  const c = new ClientConnection(channel);
  c.player = p;
  const sender = p.getPacketSender(), log = [], messages = [];
  const scripts = sender.sendInterfaceScript.bind(sender), flags = sender.sendInterfaceFlagsRange.bind(sender), open = sender.sendInterface.bind(sender);
  t.mock.method(sender, 'sendInterfaceScript', (id, args, ...rest) => { log.push(['script', id, args]); return scripts(id, args, ...rest); });
  t.mock.method(sender, 'sendInterfaceFlagsRange', (...args) => { log.push(['flags', ...args]); return flags(...args); });
  t.mock.method(sender, 'sendInterface', id => { log.push(['open', id]); return open(id); });
  t.mock.method(sender, 'sendMessage', m => { messages.push(m); return sender; });
  t.after(() => {
    House.releaseHouse(p, true);
    PM.emitPlayerLogout({ player: p, username: p.getUsername() });
    p.setRegistered(false);
    core.TaskManager.cancelTasks(p.getIndex());
  });
  return { p, c, log, messages };
}

async function send(f, packet) {
  await f.c.dispatch([packet]);
  f.c.processTurnPackets();
  for (let i = 0; i < 15; i++) {
    core.TaskManager.processWalkTo(f.p.getIndex());
    f.p.getMovementQueue().process();
    core.TaskManager.process();
  }
}

function inHouse(t) {
  const f = actor(t);
  MaxHouse.maxHouse({ player: f.p });
  House.enterHouse(f.p, false);
  const h = House.houseFor(f.p);
  const entry = h.furnitureEntries().find(e => e.room.roomKey.startsWith('MENAGERIE') && e.furniture.buildableKey === 'PET_LIST');
  assert.ok(entry, 'the max house has a pet list');
  const id = Data.BUILDABLE_BY_KEY.get('PET_LIST').objectIds[0];
  const object = h.furnitureObjects.find(o => o.getId() === id && o.getLocation().equals(entry.location));
  assert.ok(object);
  f.p.setLocation(entry.location.clone().add(-1, 0));
  f.p.needsPlacement = false;
  return { ...f, h, object };
}

const read = f => send(f, { type: 'object_option', id: f.object.getId(), x: f.object.getLocation().getX(), y: f.object.getLocation().getY(), action: 'Read' });

test('Read opens poh_petlist with Examine on every enum 985 slot and one Owned cell per owned pet', async t => {
  const f = inHouse(t);
  const slots = [...petEnum().keys()], last = Math.max(...slots);
  const ownedSlot = 1, ownedItem = petEnum().get(ownedSlot);
  f.p.setAttribute('pets.owned', [ownedItem]);
  await read(f);
  assert.equal(f.p.getInterfaceId(), PET_LIST_IF);
  const order = f.log.map(([kind, id]) => kind + ':' + id);
  const at = order.indexOf('open:' + PET_LIST_IF);
  assert.deepEqual(f.log[at - 1], ['script', 2524, [-1, -1]]);
  assert.deepEqual(f.log[at + 1], ['flags', (PET_LIST_IF << 16) | LIST, 0, last, 1 << 10]);
  const [, , [text]] = f.log[at + 2];
  assert.equal(f.log[at + 2][1], 647);
  assert.ok(text.endsWith('|'));
  const cells = text.slice(0, -1).split('|');
  assert.equal(cells.length, last + 1);
  cells.forEach((cell, slot) => assert.equal(cell, slot === ownedSlot ? '<col=00ff00>Owned</col>' : '<col=ff0000>Not owned</col>', 'slot ' + slot));
});

test('Examine on an unowned slot sends that pet\'s examine; closed or other ops do nothing', async t => {
  const f = inHouse(t);
  await read(f);
  const slot = 61, itemId = petEnum().get(slot);
  const click = (op) => send(f, { type: 'widget_action', widgetId: (PET_LIST_IF << 16) | LIST, groupId: PET_LIST_IF, childId: LIST, slot, buttonNum: op });
  f.messages.length = 0;
  await click(10);
  const { ItemDefinition } = require(root + '/dist/game/definition/ItemDefinition');
  assert.equal(core.CacheDefinitions.getObjNames().get(itemId), 'amoxliatlpet');
  assert.equal(f.messages[0], ItemDefinition.forId(itemId).getExamine());
  assert.equal(f.messages[0], 'A tiny frost nagua.');
  const count = f.messages.length;
  await click(1);
  assert.equal(f.messages.length, count);
  f.p.getPacketSender().sendInterfaceRemoval();
  await click(10);
  assert.equal(f.messages.length, count);
  assert.equal(f.p.getInventory().getAmount(itemId), 0);
});

test('Read outside a menagerie is not handled as the pet list', async t => {
  const f = inHouse(t);
  const room = f.h.getRoom(f.h.getRoomPositionAt(f.object.getLocation()));
  const key = room.roomKey;
  room.roomKey = 'GARDEN';
  try { await read(f); } finally { room.roomKey = key; }
  assert.notEqual(f.p.getInterfaceId(), PET_LIST_IF);
});
