// Run after `yarn build`: node --test tests/gerardus-charting.test.cjs
//
// Gerardus's charting reward (Wiki: Gerardus, Charred key; his transcript): the charred key for a
// fully charted Unquiet Ocean, once, and again from "spare trinkets" while it's lost and unused.
const assert = require('node:assert/strict');
const { test, before } = require('node:test');

const { Server } = require('../dist/Server');
Server.installProductionPathResolver();

const { CachePipeline } = require('../dist/game/cache/CachePipeline');
const { PluginManager } = require('../dist/plugins/PluginManager');

let core, common, gerardus;
const conditions = [];
const actions = [];
let chestUnlocked = false;

before(() => {
  CachePipeline.initialize();
  core = PluginManager.getCoreApi();
  const api = new Proxy({
    core,
    onNpcDialogueCondition: (fn) => conditions.push(fn),
    onCustomEvent: (name, fn) => { if (name === 'npc-dialogue:action') actions.push(fn); },
    emitCustomEvent: (name, request) => { if (name === 'charred-island:old-chest-unlocked') request.unlocked = chestUnlocked; },
  }, { get: (target, key) => (key in target ? target[key] : () => {}) });
  common = require('../plugins/skills/sailing/charting/Common.Charting');
  gerardus = require('../plugins/skills/sailing/charting/Gerardus.Charting');
  gerardus(api);
});

const npcId = () => core.CacheDefinitions.getNpcId('port_roberts_gerardus');
const obj = (name) => core.CacheDefinitions.getObjId(name);
const KEY = () => obj('sailing_gerardus_unquiet_trinket');
const { STEP } = require('../plugins/skills/sailing/charting/Gerardus.Charting')._test;

let nextIndex = 1500;
function player(t, { log = true } = {}) {
  const { Player } = require('../dist/game/entity/impl/player/Player');
  const p = new Player(null);
  p.lines = [];
  t.mock.method(p, 'getSession', () => ({ sendClientPacket: () => true, write: () => true }));
  t.mock.method(p.getInventory(), 'refreshItems', () => p.getInventory());
  t.mock.method(p, 'sendMessage', (m) => p.lines.push(m));
  if (log) p.getInventory().add(new core.Item(obj('sailing_log'), 1));
  p.setIndex(++nextIndex);
  p.setRegistered(true);
  t.after(() => p.setRegistered(false));
  return p;
}

const ask = (p, stepId) => conditions.map((fn) => fn({ player: p, npcId: npcId(), stepId })).find((answer) => answer != null);
function say(p, stepId) {
  const event = { player: p, npcId: npcId(), stepId, kind: 'message', text: 'line', handled: false };
  for (const fn of actions) fn(event);
  return event;
}
function chartOcean(p, name) {
  const ocean = [...common.allSeas().values()].find((sea) => sea.type === common.SEA_TYPE.OCEAN && sea.name === name);
  assert.ok(ocean, name);
  common.updateProgress(p, (saved) => { saved.charted = [...new Set([...saved.charted, ...common.oceanSpots(ocean).map((spot) => spot.uid)])]; });
}

test('without the captain\'s log he sees no charts; with it but the Unquiet Ocean uncharted, nothing new', (t) => {
  const noLog = player(t, { log: false });
  assert.equal(ask(noLog, STEP.NO_LOG), true);
  assert.equal(ask(noLog, STEP.CHARTS), false);
  const p = player(t);
  assert.equal(ask(p, STEP.NO_LOG), false);
  assert.equal(ask(p, STEP.CHARTS), false);
  assert.equal(ask(p, STEP.NOTHING_NEW), true);
  assert.equal(ask(p, STEP.SPARE_OPTION), false, 'no spare trinkets before he has given one');
});

test('a fully charted Unquiet Ocean: the log shown, then the charred key in a box, once', (t) => {
  const p = player(t);
  chartOcean(p, 'Unquiet Ocean');
  assert.equal(ask(p, STEP.CHARTS), true);
  assert.deepEqual(say(p, STEP.SHOW).box.items, [obj('sailing_log')]);
  for (const other of ['5qaYl8', 'saTpWp', 'PCS897']) assert.equal(say(p, other).handled, true, `${other} is skipped`);
  const keyLine = say(p, 'Qz_mPA');
  assert.equal(keyLine.handled, false);
  assert.deepEqual(keyLine.box.items, [KEY()]);
  assert.equal(p.getInventory().getAmount(KEY()), 1);
  assert.equal(ask(p, STEP.CHARTS), false);
  assert.equal(ask(p, STEP.NOTHING_NEW), true, 'shown already');
  assert.equal(say(p, 'Qz_mPA').handled, true, 'no second key');
  assert.equal(p.getInventory().getAmount(KEY()), 1);
  assert.equal(ask(p, STEP.SPARE_OPTION), true);
});

test('spare trinkets: a lost, unused key comes back; one still owned or used on the chest does not', (t) => {
  const p = player(t);
  chartOcean(p, 'Unquiet Ocean');
  say(p, 'Qz_mPA');
  assert.equal(ask(p, STEP.ALL_USED), true, 'still carried');
  p.getInventory().delete(KEY(), 1);
  chestUnlocked = true;
  assert.equal(ask(p, STEP.ALL_USED), true, 'used for paint');
  chestUnlocked = false;
  assert.equal(ask(p, STEP.MISSING), true);
  const back = say(p, STEP.HAND_BACK);
  assert.equal(back.text, 'Gerardus hands you another burned key.');
  assert.deepEqual(back.box.items, [KEY()]);
  assert.equal(p.getInventory().getAmount(KEY()), 1);
  assert.equal(ask(p, STEP.MISSING), false);
});

test('another NPC\'s lines and conditions are left alone', (t) => {
  const p = player(t);
  assert.equal(conditions.map((fn) => fn({ player: p, npcId: npcId() + 1, stepId: STEP.NO_LOG })).find((a) => a != null), undefined);
  const event = { player: p, npcId: npcId() + 1, stepId: 'Qz_mPA', kind: 'message', handled: false };
  for (const fn of actions) fn(event);
  assert.equal(event.handled, false);
  assert.equal(event.box, undefined);
});
