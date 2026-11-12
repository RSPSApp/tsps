// Run after `yarn build`: node --test tests/woodcutting-nest-trees.test.cjs
// Regular, achey and redwood trees give clue nests but never the other bird nests (Wiki: Tree, Woodcutting).
// Pest Control's trees give the log and XP with no log line, stump countdown or logs-chopped count.
const assert = require('node:assert/strict');
const path = require('node:path');
const { before, after, test } = require('node:test');
require('../dist/Server').Server.installProductionPathResolver();
const { CachePipeline } = require('../dist/game/cache/CachePipeline');
const { PluginManager: PM } = require('../dist/plugins/PluginManager');
const { Player } = require('../dist/game/entity/impl/player/Player');
const { PlayerSession } = require('../dist/net/PlayerSession');
const { ClientConnection } = require('../dist/net/NetworkBuilder');
let core, next = 9940;
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

const BIRD_NEST_FALLS = "<col=ff0000>A bird's nest falls out of the tree.</col>";

function chopper(t, { nests = true } = {}) {
  const channel = { kind: 'test', remoteAddress: '127.0.0.1', isOpen: () => true, send: () => true, close() {}, onData() {}, onError() {}, onClose() {} };
  const p = new Player(new PlayerSession(channel));
  p.setIndex(next++); p.setUsername('nesttree' + next); p.setRegistered(true); p.setLocation(new core.Location(3222, 3218, 0)); p.needsPlacement = false;
  const c = new ClientConnection(channel); c.player = p;
  t.after(() => { p.setRegistered(false); core.TaskManager.cancelTasks(p.getIndex()); });
  const skills = p.getSkillManager();
  skills.setMaxLevel(core.Skill.WOODCUTTING, 99); skills.setCurrentLevel(core.Skill.WOODCUTTING, 99);
  p.getInventory().add(new core.Item(core.ItemIdentifiers.DRAGON_AXE), true);
  t.mock.method(core.WorldDefinition, 'isMembersWorld', () => true);
  // The log and (unless `nests` is false) bird nest rolls win; the rest (clue nests, pet) miss.
  const wins = nests ? /rollLog|maybeDropBirdNest|rollBirdNestId/ : /rollLog/;
  t.mock.method(Math, 'random', () => wins.test(new Error().stack) ? 0 : 0.999);
  const dropped = [];
  t.mock.method(core.ItemOnGroundManager, 'registers', (_player, item) => { dropped.push(item.getId()); });
  const sent = { messages: [], spam: [], scripts: [], xp: 0 };
  const sender = p.getPacketSender();
  const message = sender.sendMessage.bind(sender), typed = sender.sendTypedMessage.bind(sender), script = sender.sendClientScript.bind(sender);
  t.mock.method(sender, 'sendMessage', (m) => { sent.messages.push(m); return message(m); });
  t.mock.method(sender, 'sendTypedMessage', (type, m, from) => { sent.spam.push(m); return typed(type, m, from); });
  t.mock.method(sender, 'sendClientScript', (id, ...args) => { sent.scripts.push(id); return script(id, ...args); });
  const add = skills.addExperiences.bind(skills);
  t.mock.method(skills, 'addExperiences', (skill, amount) => { if (skill === core.Skill.WOODCUTTING) sent.xp += amount; return add(skill, amount); });
  return { p, c, dropped, sent };
}

let row = 0;
async function chop(t, f, objectId) {
  // A tile of its own each time: a felled tree leaves its stump behind.
  const y = 3212 + (row++ % 12);
  f.p.setLocation(new core.Location(3222, y, 0));
  const tree = new core.GameObject(objectId, new core.Location(3223, y, 0), 10, 0, null);
  core.ObjectManager.register(tree, true);
  t.after(() => { core.ObjectManager.deregister(tree, true); });
  await f.c.dispatch([{ type: 'object_option', id: objectId, x: 3223, y, action: core.CacheDefinitions.getObject(objectId).actions[0] }]);
  f.c.processTurnPackets();
  for (let i = 0; i < 12; i++) { core.TaskManager.processWalkTo(f.p.getIndex()); f.p.getMovementQueue().process(); core.TaskManager.process(); }
}

const LOGS_CHOPPED = 'woodcutting:logs-chopped';
const STUMP_TIMER_SCRIPT = 5474;

for (const [name, id, logName] of [
  ['a regular tree', 'TREE', 'LOGS'],
  ['a dead tree', 'DEAD_TREE', 'LOGS'],
  ['an achey tree', 'ACHEY_TREE', 'ACHEY_TREE_LOGS'],
  ['a redwood', 'REDWOOD_TREE', 'REDWOOD_LOGS'],
]) {
  test(`${name} drops no bird nest on a winning roll and gives the log`, async (t) => {
    const f = chopper(t);
    await chop(t, f, core.ObjectIdentifiers[id]);
    assert.deepEqual(f.dropped, [], 'nothing falls to the ground');
    assert.equal(f.sent.messages.includes(BIRD_NEST_FALLS), false);
    assert.ok(f.p.getInventory().getAmount(core.ItemIdentifiers[logName]) >= 1, 'the log comes instead');
  });
}

test('control: an oak drops a bird nest on the same roll', async (t) => {
  const f = chopper(t);
  await chop(t, f, core.CacheDefinitions.getLocId('oaktree'));
  assert.equal(f.dropped.length >= 1, true, 'a nest falls');
  assert.ok(f.sent.messages.includes(BIRD_NEST_FALLS));
});

test('a Pest Control tree gives the log and XP with no log line, stump countdown or logs-chopped count', async (t) => {
  for (const id of [core.ObjectIdentifiers.TREE_59, core.ObjectIdentifiers.TREE_60]) {
    const f = chopper(t);
    await chop(t, f, id);
    assert.equal(f.p.getInventory().getAmount(core.ItemIdentifiers.LOGS), 1, 'one log, and the tree falls');
    assert.equal(f.sent.xp, 25);
    assert.ok(f.sent.spam.includes('You swing your axe at the tree.'));
    assert.equal(f.sent.spam.includes('You get some logs.'), false, 'no log line');
    assert.equal(f.sent.scripts.includes(STUMP_TIMER_SCRIPT), false, 'no stump countdown');
    assert.equal(f.p.getAttribute(LOGS_CHOPPED) ?? 0, 0, 'the logs-chopped count stays');
    assert.deepEqual(f.dropped, [], 'no bird nest');
  }
});

test('control: a regular tree outside Pest Control sends the log line, countdown and count', async (t) => {
  const f = chopper(t, { nests: false });
  await chop(t, f, core.ObjectIdentifiers.TREE);
  assert.ok(f.sent.spam.includes('You get some logs.'));
  assert.ok(f.sent.scripts.includes(STUMP_TIMER_SCRIPT));
  assert.equal(f.p.getAttribute(LOGS_CHOPPED), 1);
});
