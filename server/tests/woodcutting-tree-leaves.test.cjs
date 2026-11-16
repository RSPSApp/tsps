// Run after `yarn build`: node --test tests/woodcutting-tree-leaves.test.cjs
// Oak, willow, maple, yew and magic trees drop one of their leaves on a quarter of logs while a Forestry
// kit is carried or worn; the leaves go into the kit with the recorded line (Wiki tree drop tables;
// rsprox recording 293, rev 229: 202 lines on 919 willow logs, each straight after its log line).
const assert = require('node:assert/strict');
const path = require('node:path');
const { before, after, test } = require('node:test');
require('../dist/Server').Server.installProductionPathResolver();
const { CachePipeline } = require('../dist/game/cache/CachePipeline');
const { PluginManager: PM } = require('../dist/plugins/PluginManager');
const { Player } = require('../dist/game/entity/impl/player/Player');
const { PlayerSession } = require('../dist/net/PlayerSession');
const { ClientConnection } = require('../dist/net/NetworkBuilder');
let core, next = 9980;
const bots = process.env.DISABLE_PLAYER_BOTS;
before(async () => {
  process.env.DISABLE_PLAYER_BOTS = '1';
  await CachePipeline.initialize(path.resolve(__dirname, '..'));
  PM.loadFromDirectory(path.resolve(__dirname, '../plugins'));
  core = PM.getCoreApi();
  core.RegionManager.init(); core.RegionManager.loadMapFiles(3222, 3218);
  PM.emitServerStartup({});
});
after(() => {
  PM.emitServerShutdown({});
  if (bots === undefined) delete process.env.DISABLE_PLAYER_BOTS; else process.env.DISABLE_PLAYER_BOTS = bots;
});

const line = (name) => `Some ${name} leaves fall to the ground and you place them into your Forestry kit.`;

/** A members chopper whose log roll wins; `leaves` decides the leaves roll, every other roll misses. */
function chopper(t, { leaves = true, kit = 'carried' } = {}) {
  const channel = { kind: 'test', remoteAddress: '127.0.0.1', isOpen: () => true, send: () => true, close() {}, onData() {}, onError() {}, onClose() {} };
  const p = new Player(new PlayerSession(channel));
  p.setIndex(next++); p.setUsername('treeleaves' + next); p.setRegistered(true); p.setLocation(new core.Location(3222, 3218, 0)); p.needsPlacement = false;
  const c = new ClientConnection(channel); c.player = p;
  t.after(() => { p.setRegistered(false); core.TaskManager.cancelTasks(p.getIndex()); });
  const skills = p.getSkillManager();
  skills.setMaxLevel(core.Skill.WOODCUTTING, 99); skills.setCurrentLevel(core.Skill.WOODCUTTING, 99);
  p.getInventory().add(new core.Item(core.ItemIdentifiers.DRAGON_AXE), true);
  const kitItem = new core.Item(kit === 'basket' ? core.ItemIdentifiers.FORESTRY_BASKET : core.ItemIdentifiers.FORESTRY_KIT);
  if (kit === 'basket') p.getInventory().add(kitItem, true);
  if (kit === 'carried') p.getInventory().add(kitItem, true);
  if (kit === 'worn') p.getEquipment().setItem(core.Equipment.CAPE_SLOT, kitItem);
  t.mock.method(core.WorldDefinition, 'isMembersWorld', () => true);
  const wins = leaves ? /rollLog|rollTreeLeaves/ : /rollLog/;
  t.mock.method(Math, 'random', () => wins.test(new Error().stack) ? 0 : 0.999);
  t.mock.method(core.ItemOnGroundManager, 'registers', () => {});
  const spam = [];
  const sender = p.getPacketSender();
  const typed = sender.sendTypedMessage.bind(sender);
  t.mock.method(sender, 'sendTypedMessage', (type, m, from) => { spam.push(m); return typed(type, m, from); });
  return { p, c, spam, kitItem };
}

let row = 0;
async function chopOnce(t, f, objectId) {
  const y = 3212 + (row++ % 12);
  f.p.setLocation(new core.Location(3222, y, 0));
  const tree = new core.GameObject(objectId, new core.Location(3223, y, 0), 10, 0, null);
  core.ObjectManager.register(tree, true);
  t.after(() => { core.ObjectManager.deregister(tree, true); });
  await f.c.dispatch([{ type: 'object_option', id: objectId, x: 3223, y, action: core.CacheDefinitions.getObject(objectId).actions[0] }]);
  f.c.processTurnPackets();
  // Until the first log lands, then stop so one roll is counted.
  for (let i = 0; i < 12 && !f.spam.some((m) => /^You get some /.test(m)); i++) {
    core.TaskManager.processWalkTo(f.p.getIndex()); f.p.getMovementQueue().process(); core.TaskManager.process();
  }
}

function kitAmount(f, itemId) {
  // Every kit copy shares one store, the basket's included; the basket's own contents are its logs.
  const request = { player: f.p, item: new core.Item(core.ItemIdentifiers.FORESTRY_KIT), contents: [], handled: false };
  PM.emitCustomEvent('storage:contents', request);
  assert.equal(request.handled, true);
  return request.contents.find((x) => x.id === itemId)?.amount ?? 0;
}

for (const [tree, logs, leaves, name] of [
  ['OAK_TREE_10', 'OAK_LOGS', 'OAK_LEAVES', 'oak'],
  ['WILLOW_TREE_11', 'WILLOW_LOGS', 'WILLOW_LEAVES', 'willow'],
  ['MAPLE_TREE', 'MAPLE_LOGS', 'MAPLE_LEAVES', 'maple'],
  ['YEW_TREE_14', 'YEW_LOGS', 'YEW_LEAVES', 'yew'],
  ['MAGIC_TREE', 'MAGIC_LOGS', 'MAGIC_LEAVES', 'magic'],
]) {
  test(`a winning leaves roll on a ${name} log puts one ${name} leaf in the carried kit, after the log line`, async (t) => {
    const f = chopper(t);
    await chopOnce(t, f, core.ObjectIdentifiers[tree]);
    const ids = core.ItemIdentifiers;
    assert.equal(f.p.getInventory().getAmount(ids[logs]), 1, 'the log still lands');
    assert.equal(kitAmount(f, ids[leaves]), 1, 'one leaf, in the kit');
    assert.equal(f.p.getInventory().getAmount(ids[leaves]), 0, 'none in the pack');
    const logLine = f.spam.findIndex((m) => /^You get some /.test(m));
    assert.equal(f.spam[logLine + 1], line(name), 'the leaves line straight after the log line');
  });
}

test('a worn kit takes the leaves too', async (t) => {
  const f = chopper(t, { kit: 'worn' });
  await chopOnce(t, f, core.ObjectIdentifiers.WILLOW_TREE_11);
  assert.equal(kitAmount(f, core.ItemIdentifiers.WILLOW_LEAVES), 1);
  assert.ok(f.spam.includes(line('willow')));
});

test('a forestry basket in the pack (it carries a kit) takes the leaves', async (t) => {
  const f = chopper(t, { kit: 'basket' });
  await chopOnce(t, f, core.ObjectIdentifiers.WILLOW_TREE_11);
  assert.equal(kitAmount(f, core.ItemIdentifiers.WILLOW_LEAVES), 1, 'in the basket\'s kit');
  assert.equal(f.p.getInventory().getAmount(core.ItemIdentifiers.WILLOW_LEAVES), 0);
  assert.ok(f.spam.includes(line('willow')));
});

test('without a Forestry kit no leaves drop and no line is sent', async (t) => {
  const f = chopper(t, { kit: null });
  await chopOnce(t, f, core.ObjectIdentifiers.WILLOW_TREE_11);
  assert.equal(f.p.getInventory().getAmount(core.ItemIdentifiers.WILLOW_LOGS), 1);
  assert.equal(f.p.getInventory().getAmount(core.ItemIdentifiers.WILLOW_LEAVES), 0);
  assert.ok(!f.spam.some((m) => /leaves fall/.test(m)));
});

test('a losing leaves roll gives the log alone', async (t) => {
  const f = chopper(t, { leaves: false });
  await chopOnce(t, f, core.ObjectIdentifiers.WILLOW_TREE_11);
  assert.equal(kitAmount(f, core.ItemIdentifiers.WILLOW_LEAVES), 0);
  assert.ok(!f.spam.some((m) => /leaves fall/.test(m)));
});

test('regular trees have no leaves', async (t) => {
  const f = chopper(t);
  await chopOnce(t, f, core.ObjectIdentifiers.TREE);
  assert.equal(f.p.getInventory().getAmount(core.ItemIdentifiers.LOGS), 1);
  assert.equal(kitAmount(f, core.ItemIdentifiers.LEAVES), 0);
  assert.ok(!f.spam.some((m) => /leaves fall/.test(m)));
});
