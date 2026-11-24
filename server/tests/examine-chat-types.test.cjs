// Run after `yarn build`: node --test tests/examine-chat-types.test.cjs
// Examines go out with their own chat types, as live sends them: objects as loc_examine (29, rsprox
// 237/01098.txt:334474) and NPCs as npc_examine (28). The native examine packets through the
// connection's real dispatch, on a real Player.
process.env.DISABLE_PLAYER_BOTS = '1';
const assert = require('node:assert/strict');
const path = require('node:path');
const { before, test } = require('node:test');
require('../dist/Server').Server.installProductionPathResolver();
const { CachePipeline } = require('../dist/game/cache/CachePipeline');
const { PluginManager: PM } = require('../dist/plugins/PluginManager');
const { Player } = require('../dist/game/entity/impl/player/Player');
const { PlayerSession } = require('../dist/net/PlayerSession');
const { ClientConnection } = require('../dist/net/NetworkBuilder');
const { ObjectDefinition } = require('../dist/game/definition/ObjectDefinition');
const { NpcDefinitionLoader } = require('../dist/game/definition/loader/impl/NpcDefinitionLoader');

let core;
before(async () => {
  await CachePipeline.initialize(path.resolve(__dirname, '..'));
  ObjectDefinition.init();
  new NpcDefinitionLoader().load();
  core = PM.getCoreApi();
});

function examiner(t) {
  const channel = { kind: 'test', remoteAddress: '127.0.0.1', isOpen: () => true, send: () => true, close() {}, onData() {}, onError() {}, onClose() {} };
  const p = new Player(new PlayerSession(channel));
  p.setUsername('examiner');
  const conn = new ClientConnection(channel);
  conn.player = p;
  const typed = [];
  const plain = [];
  t.mock.method(p.getPacketSender(), 'sendTypedMessage', (type, text) => { typed.push([type, text]); return p.getPacketSender(); });
  t.mock.method(p.getPacketSender(), 'sendMessage', (text) => { plain.push(text); return p.getPacketSender(); });
  return { conn, typed, plain };
}

test('an object examine is a loc_examine line (29)', async (t) => {
  const f = examiner(t);
  await f.conn.dispatch([{ type: 'examine_object', id: 1276 }], true);
  assert.deepEqual(f.plain, []);
  assert.deepEqual(f.typed, [[core.ChatType.LOC_EXAMINE, 'One of the most common trees in Gielinor.']]);
  assert.equal(core.ChatType.LOC_EXAMINE, 29);
});

test('an NPC examine is an npc_examine line (28)', async (t) => {
  const f = examiner(t);
  await f.conn.dispatch([{ type: 'examine_npc', id: core.NpcIdentifiers.MAN }], true);
  assert.deepEqual(f.plain, []);
  assert.equal(f.typed.length, 1);
  assert.equal(f.typed[0][0], 28);
  assert.equal(typeof f.typed[0][1], 'string');
});

const MonsterExamine = require('../plugins/interface/MonsterExamine.entry');
const { NPC } = require('../dist/game/entity/impl/npc/NPC');
const { World } = require('../dist/game/World');

function contextualExaminer(t, enabled = true) {
  const f = examiner(t);
  const p = f.conn.player;
  p.setRegistered(true);
  p.setNeedsPlacement(false);
  const npc = new NPC(core.NpcIdentifiers.HOBGOBLIN, p.getLocation().clone());
  npc.setIndex(123);
  npc.setRegistered(true);
  const list = World.getNpcs();
  const old = list.characters[123];
  list.characters[123] = npc;
  p.getLocalNpcs().push(npc);
  t.after(() => { list.characters[123] = old; });
  const strings = new Map();
  const sender = p.getPacketSender();
  t.mock.method(sender, 'sendString', (value, uid) => { strings.set(uid, value); return sender; });
  const opens = [];
  const scripts = [];
  t.mock.method(sender, 'sendSubInterface', (...args) => { opens.push(args); return sender; });
  t.mock.method(sender, 'sendInterfaceScript', (...args) => { scripts.push(args); return sender; });
  const original = PM.emitCustomEvent.bind(PM);
  t.mock.method(PM, 'emitCustomEvent', (name, event) => {
    if (enabled && name === 'world:npc-examine') MonsterExamine._test.examine({ core, emitCustomEvent: PM.emitCustomEvent.bind(PM) }, event);
    else original(name, event);
  });
  const examine = (overrides = {}) => f.conn.dispatch([{ type: 'plugin_message', channel: 'entity-examine',
    data: { kind: 'npc', id: npc.getContentId(p), index: npc.getIndex(), ...overrides } }], true);
  return { ...f, p, npc, strings, opens, scripts, examine };
}

test('enabled monster examine opens a native model and live stats without consuming combat or rolling RNG', async (t) => {
  const f = contextualExaminer(t);
  const combat = f.p.getCombat();
  const weapon = combat.getRangedWeapon(), ammo = combat.getAmmunition(), target = combat.getTarget();
  f.npc.setHitpoints(1);
  t.mock.method(Math, 'random', () => { throw new Error('examine must never roll'); });
  await f.examine();
  const { Layout } = MonsterExamine._test;
  assert.equal(f.p.getInterfaceId(), Layout.GROUP_ID);
  assert.equal(f.opens.length, 1);
  assert.deepEqual(f.scripts, [[MonsterExamine._test.MAINMODAL_BACKGROUND_SCRIPT, [-1, MonsterExamine._test.EXPANDED_MODAL_SIZE]]]);
  assert.deepEqual(f.typed, []);
  const facts = f.strings.get(Layout.uid(Layout.C.FACTS));
  assert.match(facts, /Hitpoints: <col=ff8f83>1\//);
  for (const style of ['Melee', 'Ranged', 'Magic']) assert.match(facts,
    new RegExp(`<col=ffd27f>${style}</col> base hit chance: <col=80df91>[\\d.]+%`));
  assert.doesNotMatch(facts, /Current gear, levels and prayers|Special attacks, random equipment|Snapshot at examine|Boss attacks can vary/);
  assert.match(facts, /Combat levels.*Attacks.*Attack bonuses.*Defence bonuses.*Your accuracy.*Requirements & traits/);
  assert.match(f.strings.get(Layout.uid(Layout.C.SUMMARY)), /Level .*HP.*1\//);
  assert.equal(combat.getRangedWeapon(), weapon);
  assert.equal(combat.getAmmunition(), ammo);
  assert.equal(combat.getTarget(), target);
  assert.match(f.strings.get(Layout.uid(Layout.C.NOTE)), /unavailable/);
});

test('disabled monster plugin preserves ordinary contextual and native text examine', async (t) => {
  const { resolvePluginEnabled, pluginNameFromFile } = require('../dist/plugins/PluginManager');
  const { switches, defaultEnabled } = PM.parsePluginSwitches({ plugins: { MonsterExamine: false } });
  assert.equal(resolvePluginEnabled(switches, defaultEnabled, MonsterExamine.name,
    pluginNameFromFile('MonsterExamine.plugin.js'), MonsterExamine.enabled), false);
  const f = contextualExaminer(t, false);
  await f.examine();
  await f.conn.dispatch([{ type: 'examine_npc', id: f.npc.getContentId(f.p) }], true);
  assert.equal(f.opens.length, 0);
  assert.equal(f.typed.length, 2);
  assert.equal(f.typed[0][0], core.ChatType.NPC_EXAMINE);
  assert.equal(f.typed[0][1], f.npc.getCurrentDefinition(f.p).getExamine());
});

test('ordinary non-attackable NPCs retain text', async (t) => {
  const f = contextualExaminer(t);
  t.mock.method(f.npc.getCurrentDefinition(f.p), 'isAttackable', () => false);
  await f.examine();
  assert.equal(f.opens.length, 0);
  assert.equal(f.typed.length, 1);
});

test('bank examine does not replace the protected interface', async (t) => {
  const f = contextualExaminer(t);
  f.p.setInterfaceId(12);
  await f.examine();
  assert.equal(f.p.getInterfaceId(), 12);
  assert.equal(f.opens.length, 0);
  assert.equal(f.typed.length, 1);
});

test('invalid, stale, remote, private and unauthenticated entity requests do nothing', async (t) => {
  const f = contextualExaminer(t);
  for (const overrides of [{ id: -1 }, { id: 1.5 }, { index: -1 }, { index: 124 }, { id: f.npc.getId() + 1 }]) await f.examine(overrides);
  f.npc.setRegistered(false); await f.examine(); f.npc.setRegistered(true);
  f.p.getLocalNpcs().length = 0; await f.examine(); f.p.getLocalNpcs().push(f.npc);
  f.npc.setArea({ getObjects() {}, countsAsMainWorld: () => false }); await f.examine(); f.npc.setArea(null);
  f.npc.getLocation().setX(f.p.getLocation().getX() + 100); await f.examine();
  f.conn.player = undefined; await f.examine({ id: core.NpcIdentifiers.RAT });
  assert.equal(f.opens.length, 0);
  assert.equal(f.typed.length, 0);
});

test('formula previews skip hit-time proc and encounter callbacks', (t) => {
  const f = contextualExaminer(t);
  const events = [];
  t.mock.method(PM, 'emitCustomEvent', name => events.push(name));
  core.AccuracyFormulasDpsCalc.specialRolls(f.p, f.npc, core.CombatType.MAGIC,
    undefined, undefined, undefined, true);
  assert.ok(!events.some(name => name.startsWith('combat:')));
  core.AccuracyFormulasDpsCalc.specialRolls(f.p, f.npc, core.CombatType.MAGIC);
  assert.ok(events.includes('combat:magic-defence-roll'));
  assert.ok(events.includes('combat:defence-roll'));
});


test('transformed NPC examines reject the old type and preserve ordinary text for the visible noncombat form', async (t) => {
  const f = contextualExaminer(t);
  const oldId = f.npc.getContentId(f.p);
  f.npc.setNpcTransformationId(core.NpcIdentifiers.RAT);
  await f.examine({ id: oldId });
  assert.equal(f.typed.length, 0);
  await f.examine();
  assert.equal(f.opens.length, 0);
  assert.equal(f.typed[0][1], f.npc.getCurrentDefinition(f.p).getExamine());
});

test('dialogue, animation holds and repeated requests cannot replace protected interactions or flood rows', async (t) => {
  const f = contextualExaminer(t);
  const dialogue = t.mock.method(f.p.getDialogueManager(), 'isActive', () => true);
  await f.examine();
  assert.equal(f.opens.length, 0);
  dialogue.mock.restore();
  const stalled = t.mock.method(f.p.getCombat(), 'isAnimationStalled', () => true);
  await f.examine();
  assert.equal(f.opens.length, 0);
  stalled.mock.restore();
  await f.examine();
  await f.examine();
  assert.equal(f.opens.length, 1);
});
