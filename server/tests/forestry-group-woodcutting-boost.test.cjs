// Run after `yarn build`: node --test tests/forestry-group-woodcutting-boost.test.cjs
// Wiki (Forestry): "Each player will receive a +1 boost to Woodcutting for each player at the tree, up to a maximum
// of +10 with ten players. This bonus does not get applied whilst chopping a normal tree, whilst in the Woodcutting
// Guild, or any tree grown through Farming." (Temporary skill boost: "Between +1 and +10", "for each person chopping
// a tree".) The chop roll had only the Guild's own boost.
const assert = require('node:assert/strict');
const path = require('node:path');
const { before, after, test } = require('node:test');
require('../dist/Server').Server.installProductionPathResolver();
const { CachePipeline } = require('../dist/game/cache/CachePipeline');
const { PluginManager: PM } = require('../dist/plugins/PluginManager');
const { Player } = require('../dist/game/entity/impl/player/Player');
const { PlayerSession } = require('../dist/net/PlayerSession');
const Woodcutting = require('../plugins/skills/Woodcutting.plugin');
let core, next = 9870;
const bots = process.env.DISABLE_PLAYER_BOTS;
const AT = [3222, 3218, 0];
before(async () => {
  process.env.DISABLE_PLAYER_BOTS = '1';
  await CachePipeline.initialize(path.resolve(__dirname, '..'));
  PM.loadFromDirectory(path.resolve(__dirname, '../plugins'));
  core = PM.getCoreApi();
  core.ObjectDefinition.init();
  core.RegionManager.init(); core.RegionManager.loadMapFiles(AT[0], AT[1]);
  PM.emitServerStartup({});
});
after(() => {
  PM.emitServerShutdown({});
  if (bots === undefined) delete process.env.DISABLE_PLAYER_BOTS; else process.env.DISABLE_PLAYER_BOTS = bots;
});
function chopper(t, dx, dy) {
  const channel = { kind: 'test', remoteAddress: '127.0.0.1', isOpen: () => true, send: () => true, close() {}, onData() {}, onError() {}, onClose() {} };
  const p = new Player(new PlayerSession(channel));
  p.setIndex(next++); p.setUsername('forestry' + next); p.setRegistered(true); p.setLocation(new core.Location(AT[0] + dx, AT[1] + dy, 0)); p.needsPlacement = false;
  p.getSkillManager().setCurrentLevel(core.Skill.WOODCUTTING, 60, false).setMaxLevels(core.Skill.WOODCUTTING, 60, false);
  p.getInventory().add(new core.Item(core.ItemIdentifiers.RUNE_AXE, 1), true);
  p.__msgs = [];
  const sender = p.getPacketSender(), tm = sender.sendTypedMessage.bind(sender);
  t.mock.method(sender, 'sendMessage', (m) => { p.__msgs.push(m); return sender; });
  t.mock.method(sender, 'sendTypedMessage', (ty, m, ...r) => { p.__msgs.push(m); return tm(ty, m, ...r); });
  t.after(() => { p.setRegistered(false); core.TaskManager.cancelTasks(p.getIndex()); });
  return p;
}
function tree(t, id, x) {
  const object = new core.GameObject(id, new core.Location(x, AT[1] + 1, 0), 10, 0, null);
  core.ObjectManager.register(object, true);
  t.after(() => core.ObjectManager.deregister(object, true));
  return object;
}
function chop(p, object) {
  const definition = core.ObjectDefinition.forPlayer(object.getId(), p);
  const clickType = definition.getInteractions().findIndex((o) => /chop/i.test(o ?? '')) + 1;
  const loc = object.getLocation();
  PM.emitObjectInteraction({ player: p, object, objectId: object.getId(), definition, clickType, location: { x: loc.getX(), y: loc.getY(), z: 0 }, handled: false });
}
const session = (p) => Woodcutting._test.sessions?.().get(p);
const bonus = (p, s) => Woodcutting._test.groupBonus(p, s);

test('players chopping the same willow each get +1 per player at it; a lone player +1', (t) => {
  const willow = tree(t, core.ObjectIdentifiers.WILLOW_TREE_11, AT[0]);
  const a = chopper(t, 0, 0), b = chopper(t, 1, 0);
  chop(a, willow);
  const sa = session(a);
  assert.ok(sa, `a chops: ${JSON.stringify(a.__msgs)}`);
  assert.equal(bonus(a, sa), 1, 'alone: +1');
  chop(b, willow);
  assert.equal(bonus(a, sa), 2);
  assert.equal(bonus(b, session(b)), 2);
});

test('a normal tree gives no group bonus', (t) => {
  const normal = tree(t, core.ObjectIdentifiers.TREE, AT[0] + 3);
  const a = chopper(t, 3, 0);
  chop(a, normal);
  assert.ok(session(a), 'the normal tree is being chopped');
  assert.equal(bonus(a, session(a)), 0);
});

test('a tree chopped on another plugin\'s request (a farming patch) gives none', (t) => {
  const willow = tree(t, core.ObjectIdentifiers.WILLOW_TREE_11, AT[0] + 5);
  const a = chopper(t, 5, 0);
  PM.emitCustomEvent('woodcutting:chop', { player: a, object: willow, logId: core.ItemIdentifiers.WILLOW_LOGS, handled: false });
  assert.equal(session(a)?.requested, true);
  assert.equal(bonus(a, session(a)), 0);
});

test('"woodcutting:group-bonus" answers the players at the tree, for the buff bar; 0 when not chopping one', (t) => {
  const willow = tree(t, core.ObjectIdentifiers.WILLOW_TREE_11, AT[0] + 7);
  const a = chopper(t, 7, 0), b = chopper(t, 8, 0);
  const players = (p) => { const request = { player: p, players: 0 }; PM.emitCustomEvent('woodcutting:group-bonus', request); return request.players; };
  assert.equal(players(a), 0, 'not chopping');
  chop(a, willow);
  assert.equal(players(a), 1);
  chop(b, willow);
  assert.equal(players(a), 2);
});

test('the bonus stops at +10', () => {
  const state = { objectId: 1, location: new core.Location(1, 1, 0), privateArea: null, tree: { name: 'willow' } };
  const fake = new Map(Array.from({ length: 12 }, (_, i) => [{ isRegistered: () => true, i }, { ...state }]));
  assert.equal(Woodcutting._test.groupBonus({ getLocation: () => state.location, getArea: () => null }, state, fake), 10);
});

test('a chopper paused for a level-up dialogue does not count for the others until it resumes', (t) => {
  const willow = tree(t, core.ObjectIdentifiers.WILLOW_TREE_11, AT[0] + 9);
  const a = chopper(t, 9, 0), b = chopper(t, 10, 0);
  chop(a, willow); chop(b, willow);
  const sa = session(a), sb = session(b);
  assert.ok(sa && sb, 'both chop the willow');
  assert.equal(bonus(a, sa), 2, 'SETUP: two choppers');
  // The level-up popup's own event: Woodcutting holds b's session until the dialogue closes.
  let resume = null;
  PM.emitCustomEvent('level-up:popup-opened', { player: b, pause: (held, onResume) => { assert.equal(held, sb); resume = onResume; } });
  assert.equal(typeof resume, 'function', 'SETUP: the session was held, not stopped');
  assert.equal(session(b), sb, 'SETUP: b keeps its session');
  assert.equal(bonus(a, sa), 1, 'the paused chopper is left out');
  assert.equal(bonus(b, sb), 2, 'the paused chopper still counts itself and the other');
  resume();
  assert.equal(bonus(a, sa), 2, 'it counts again once it resumes');
});
