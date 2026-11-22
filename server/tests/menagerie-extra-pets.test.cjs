const assert = require('node:assert/strict'), path = require('node:path');
const {before, after, test} = require('node:test');
const root = path.resolve(__dirname, '..');
require(root + '/dist/Server').Server.installProductionPathResolver();
const {CachePipeline} = require(root + '/dist/game/cache/CachePipeline');
const {PluginManager: PM} = require(root + '/dist/plugins/PluginManager');
const {Player} = require(root + '/dist/game/entity/impl/player/Player');
const {PlayerSession} = require(root + '/dist/net/PlayerSession');
const {ClientConnection} = require(root + '/dist/net/NetworkBuilder');

// Issue #6511: pet houses store the menagerie's extras (pet rocks, cats, dogs, fishbowls, ...) in
// inventory poh_menagerie_pets (517), and every pet house tier holds its limit (rsprox captures
// 2779 and 2782, rev 229; Wiki: Menagerie).
let core, House, MaxHouse, Data, next = 1850;
const EXTRAS_ATTRIBUTE = 'construction:menagerie-extras';
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

const obj = name => core.CacheDefinitions.getObjId(name);
const npcId = name => core.CacheDefinitions.getNpcId(name);
const enumSize = () => Math.max(...core.CacheDefinitions.getEnumValues(985).keys()) + 1;

function actor(t) {
  const channel = {kind: 'test', remoteAddress: '127.0.0.1', isOpen: () => true, send: () => true, close() {}, onData() {}, onError() {}, onClose() {}};
  const p = new Player(new PlayerSession(channel));
  p.setIndex(next++); p.setUsername('menagextra' + next); p.setRegistered(true);
  p.setLocation(new core.Location(3222, 3218, 0)); p.needsPlacement = false;
  const c = new ClientConnection(channel); c.player = p;
  const sender = p.getPacketSender(), log = [];
  const messages = [];
  t.mock.method(sender, 'sendMessage', m => { messages.push(m); return sender; });
  const inventory = sender.sendInventory.bind(sender), iface = sender.sendInterface.bind(sender), flags = sender.sendInterfaceFlagsRange.bind(sender);
  t.mock.method(sender, 'sendInventory', (...a) => { log.push(['inventory', ...a]); return inventory(...a); });
  t.mock.method(sender, 'sendInterface', (...a) => { log.push(['interface', ...a]); return iface(...a); });
  t.mock.method(sender, 'sendInterfaceFlagsRange', (...a) => { log.push(['flags', ...a]); return flags(...a); });
  t.after(() => {
    House.releaseHouse(p, true);
    PM.emitPlayerLogout({player: p, username: p.getUsername()});
    p.setRegistered(false);
    core.TaskManager.cancelTasks(p.getIndex());
  });
  return {p, c, messages, log};
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

/** The owner in a max house next to its indoor menagerie's pet house, optionally of another tier. */
function menagerie(t, tier = null) {
  const f = actor(t);
  MaxHouse.maxHouse({player: f.p});
  if (tier) {
    for (const room of f.p.getAttribute(Data.HOUSE_ATTRIBUTE).rooms.flat(2)) {
      for (const furniture of Object.values(room?.furnitureByLocation ?? {})) {
        if (/^(OAK|TEAK|MAHOGANY|CONSECRATED|DESECRATED|NATURE)_HOUSE$/.test(furniture.buildableKey)) furniture.buildableKey = tier;
      }
    }
  }
  House.enterHouse(f.p, false);
  const h = House.houseFor(f.p);
  const e = h.furnitureEntries().find(e => e.room.roomKey === 'MENAGERIE_INDOORS' && /HOUSE$/.test(e.furniture.buildableKey));
  const object = h.furnitureObjects.find(o => o.getLocation().equals(e.location) && Data.BUILDABLE_BY_KEY.get(e.furniture.buildableKey).objectIds.includes(o.getId()));
  assert.ok(object, 'the pet house stands');
  f.p.setLocation(e.location.clone().add(-1, 0)); f.p.needsPlacement = false;
  f.messages.length = 0;
  return {...f, h, object};
}

async function use(f, name) {
  const itemId = obj(name);
  f.p.getInventory().add(new core.Item(itemId), true);
  await send(f, {type: 'item_on_object', objectId: f.object.getId(), x: f.object.getLocation().getX(), y: f.object.getLocation().getY(), itemId, slot: f.p.getInventory().getSlotForItemId(itemId), widgetId: 149 << 16});
  return itemId;
}

const view = f => send(f, {type: 'object_option', id: f.object.getId(), x: f.object.getLocation().getX(), y: f.object.getLocation().getY(), action: 'View'});
const take = (f, slot) => send(f, {type: 'widget_action', widgetId: (211 << 16) | 7, groupId: 211, childId: 7, slot, buttonNum: 1});
const roaming = (f, name) => f.h.getNpcs().filter(n => n.isRegistered() && n.getId() === npcId(name));

test('the pet rock moves into the pet house with no message and roams the menagerie', async t => {
  const f = menagerie(t);
  const rock = await use(f, 'vt_useless_rock');
  assert.equal(f.p.getInventory().getAmount(rock), 0);
  assert.deepEqual(f.messages, []);
  assert.equal(f.p.getAttribute(EXTRAS_ATTRIBUTE)[0], rock);
  assert.equal(roaming(f, 'poh_rock').length, 1);
});

test('View sends the extras inventory before the interface and opens every list child', async t => {
  const f = menagerie(t);
  const rock = await use(f, 'vt_useless_rock');
  f.log.length = 0;
  await view(f);
  const inv = f.log.findIndex(([kind, id]) => kind === 'inventory' && id === core.CacheDefinitions.getInventoryId('poh_menagerie_pets'));
  const open = f.log.findIndex(([kind, id]) => kind === 'interface' && id === 211);
  assert.ok(inv >= 0 && inv < open, 'inventory 517 goes out first');
  const [, , capacity, items] = f.log[inv];
  assert.equal(capacity, 12);
  assert.deepEqual(items[0], {id: rock, amount: 1});
  const flags = f.log.filter(([kind]) => kind === 'flags').at(-1);
  assert.equal(flags[3], enumSize() + 12, 'enum size + 12, as 2779 sends 0-75 for 63 slots');
});

test('taking an extra back empties only its slot and its roaming pet leaves', async t => {
  const f = menagerie(t);
  const rock = await use(f, 'vt_useless_rock'), cat = await use(f, 'growncatobject_black');
  assert.deepEqual(f.p.getAttribute(EXTRAS_ATTRIBUTE).slice(0, 2), [rock, cat]);
  assert.equal(roaming(f, 'poh_growncat_black').length, 1);
  await view(f);
  await take(f, enumSize());
  assert.equal(f.p.getInventory().getAmount(rock), 1);
  assert.deepEqual(f.p.getAttribute(EXTRAS_ATTRIBUTE).slice(0, 2), [null, cat], 'the cat keeps slot 1');
  assert.equal(roaming(f, 'poh_rock').length, 0);
  assert.equal(roaming(f, 'poh_growncat_black').length, 1);
  // A second click on the emptied child gives nothing more.
  await take(f, enumSize());
  assert.equal(f.p.getInventory().getAmount(rock), 1);
  await take(f, enumSize() + 1);
  assert.equal(f.p.getInventory().getAmount(cat), 1);
});

test('kittens are turned away', async t => {
  const f = menagerie(t);
  const kitten = await use(f, 'kittenobject_brown');
  assert.equal(f.p.getInventory().getAmount(kitten), 1);
  assert.deepEqual(f.messages, ['Kittens need more personal care and attention than the pet house can provide.']);
  assert.equal(f.p.getAttribute(EXTRAS_ATTRIBUTE)?.some(id => id === kitten) ?? false, false);
});

test('an oak house holds three pets, extras included', async t => {
  const f = menagerie(t, 'OAK_HOUSE');
  await use(f, 'supremepet'); await use(f, 'zamorakpet');
  const rock = await use(f, 'vt_useless_rock');
  assert.equal(f.p.getInventory().getAmount(rock), 0);
  const chick = await use(f, 'chompybird_pet');
  assert.equal(f.p.getInventory().getAmount(chick), 1);
  const dog = await use(f, 'labrador_black_object');
  assert.equal(f.p.getInventory().getAmount(dog), 1);
  assert.deepEqual(f.messages, Array(2).fill('The pet house is full. Only 3 creatures can live in this kind of pet house.'));
});

test('a nature house keeps 12 extras beside its unique pets', async t => {
  const f = menagerie(t);
  await use(f, 'supremepet');
  const dogs = ['labrador_yellow_object', 'chihuahua_tan_object', 'collie_bw_object', 'corgi_tan_object', 'greyhound_grey_object', 'husky_bw_object',
    'pug_fawn_object', 'samoyed_white_object', 'shepard_merle_object', 'shiba_tan_object', 'spaniel_red_object', 'yorkie_brown_object'];
  for (const dog of dogs) await use(f, dog);
  assert.equal(f.p.getAttribute(EXTRAS_ATTRIBUTE).filter(Boolean).length, 12);
  assert.deepEqual(f.messages, []);
  const rock = await use(f, 'vt_useless_rock');
  assert.equal(f.p.getInventory().getAmount(rock), 1);
  assert.equal(f.messages.length, 1);
  // The unique pets still move in.
  const chick = await use(f, 'chompybird_pet');
  assert.equal(f.p.getInventory().getAmount(chick), 0);
});

test('an extra in the menagerie still counts as owned, and Pick-up on the rock ticks the diary event', async t => {
  const f = menagerie(t);
  const rock = await use(f, 'vt_useless_rock');
  const held = {player: f.p, itemId: rock, held: false};
  PM.emitCustomEvent('pets:held-elsewhere', held);
  assert.equal(held.held, true);
  const picked = [];
  const listener = event => picked.push(event.itemId);
  const original = PM.emitCustomEvent.bind(PM);
  t.mock.method(PM, 'emitCustomEvent', (name, payload) => { if (name === 'construction:menagerie-pet-picked-up') listener(payload); return original(name, payload); });
  const [npc] = roaming(f, 'poh_rock');
  const actions = npc.getDefinition().getActions();
  await send(f, {type: 'npc_option', index: npc.getIndex(), clickType: actions.indexOf('Pick-up') + 1});
  assert.equal(f.p.getInventory().getAmount(rock), 1);
  assert.deepEqual(picked, [rock]);
  assert.deepEqual(f.p.getAttribute(EXTRAS_ATTRIBUTE).filter(Boolean), []);
});

test('every extra in the data names a cache obj and house NPC, and the house NPC can be picked up', () => {
  const data = require(root + '/plugins/skills/construction/data/menagerie-extras.json');
  for (const [item, npc] of Object.entries(data.pets)) {
    assert.ok(obj(item) != null, item);
    const id = npcId(npc);
    assert.ok(id != null, npc);
    assert.ok(core.CacheDefinitions.getNpc(id).actions.includes('Pick-up'), npc);
  }
  for (const kitten of data.kittens) assert.ok(obj(kitten) != null, kitten);
});

test('with no pet house built, a pet used on the arena gets the recorded refusal', async t => {
  const f = actor(t);
  MaxHouse.maxHouse({player: f.p});
  for (const room of f.p.getAttribute(Data.HOUSE_ATTRIBUTE).rooms.flat(2)) {
    for (const [key, furniture] of Object.entries(room?.furnitureByLocation ?? {})) {
      if (/_HOUSE$/.test(furniture.buildableKey)) delete room.furnitureByLocation[key];
    }
  }
  House.enterHouse(f.p, false);
  const h = House.houseFor(f.p);
  const e = h.furnitureEntries().find(e => e.room.roomKey === 'MENAGERIE_INDOORS' && /ARENA$/.test(e.furniture.buildableKey));
  assert.ok(e, 'an arena stands');
  const object = h.furnitureObjects.find(o => o.getLocation().equals(e.location) && Data.BUILDABLE_BY_KEY.get(e.furniture.buildableKey).objectIds.includes(o.getId()));
  assert.ok(object);
  f.p.setLocation(e.location.clone().add(-1, 0)); f.p.needsPlacement = false;
  f.messages.length = 0;
  const g = {...f, h, object};
  const pet = await use(g, 'zamorakpet');
  assert.equal(f.p.getInventory().getAmount(pet), 1);
  // rsprox capture 2777 (rev 229) ticks 3172-3173.
  assert.deepEqual(f.messages, ['There does not appear to be a pet house to store pets in this house.']);
});

test('saved extras that are not extras are dropped', async t => {
  const f = menagerie(t);
  const cat = obj('growncatobject_black');
  f.p.setAttribute(EXTRAS_ATTRIBUTE, [-5, cat, 99999999, obj('coins')]);
  f.log.length = 0;
  await view(f);
  const [, , , items] = f.log.find(([kind, id]) => kind === 'inventory' && id === core.CacheDefinitions.getInventoryId('poh_menagerie_pets'));
  assert.deepEqual(items.slice(0, 4), [null, {id: cat, amount: 1}, null, null]);
});
