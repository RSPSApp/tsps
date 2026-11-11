// From server/: node --test tests/kings-ransom-grail-boxes.test.cjs (after yarn build and yarn ensure-cache).
//
// King's Ransom: the grail table opens the cache's box-selection interface (group 390, kr_jewellery_boxes) instead of a
// chatbox menu. The real plugins load (PluginManager.loadFromDirectory), the table is searched through the real
// object dispatch and a box is picked through the real interface click dispatch, on a real Player; the packet
// sender is wrapped to record what the server sends. Not a client run; the interface's own drawing is the cache's
// CS2 171/67, and the choice of the eighth box is the Wiki's ("second last box counting from left to right").
'use strict';

const assert = require('node:assert/strict');
const path = require('node:path');
const { before, after, test } = require('node:test');
require('../dist/Server').Server.installProductionPathResolver();
const { CachePipeline } = require('../dist/game/cache/CachePipeline');
const { PluginManager: PM } = require('../dist/plugins/PluginManager');
const { Player } = require('../dist/game/entity/impl/player/Player');
const { PlayerSession } = require('../dist/net/PlayerSession');
const runtime = require('../plugins/quests/QuestRuntime');

const GROUP = 390;
const uid = child => (GROUP << 16) | child;
const SHOW_BUTTON = uid(8);
const STAGE_CELL_OPEN = 65;
const STAGE_GRAIL = 70;
const TABLE = 2650;
const RIDDLE_SCRIPT = 171;
let core;
let next = 6000;

before(async () => {
  await CachePipeline.initialize(path.resolve(__dirname, '..'));
  PM.loadFromDirectory(path.resolve(__dirname, '../plugins'));
  core = PM.getCoreApi();
  PM.emitServerStartup({});
});
after(() => PM.emitServerShutdown({}));

function actor(t, name) {
  const channel = { kind: 'test', remoteAddress: '127.0.0.1', isOpen: () => true, send: () => true, close() {}, onData() {}, onError() {}, onClose() {} };
  const p = new Player(new PlayerSession(channel));
  p.setIndex(next++);
  p.setUsername(`${name}${p.getIndex()}`);
  p.setRegistered(true);
  p.setLocation(new core.Location(1900, 4283, 2));
  p.needsPlacement = false;
  for (const skill of core.Skill.values()) p.getSkillManager().setMaxLevels(skill, 60, false).setCurrentLevels(skill, 60, false);
  const sent = [];
  const sender = p.getPacketSender();
  for (const method of ['sendInterface', 'sendClientScript', 'sendInterfaceRemoval']) {
    const original = sender[method].bind(sender);
    sender[method] = (...args) => { sent.push([method, ...args]); return original(...args); };
  }
  t.after(() => {
    PM.emitPlayerLogout({ player: p, username: p.getUsername() });
    p.setRegistered(false);
    core.TaskManager.cancelTasks(p.getIndex());
  });
  return { p, sent };
}

const quest = () => runtime.questNamed("King's Ransom");

function searchTable(f) {
  const definition = { getName: () => 'Table', getActions: () => ['Search'], getInteractions: () => ['Search'] };
  const object = { getId: () => TABLE, getDefinition: () => definition };
  return PM.emitObjectInteraction({ player: f.p, object, objectId: TABLE, clickType: 1, definition, location: { x: 1900, y: 4283, z: 2 }, handled: false });
}

const click = (f, child) => PM.emitInterfaceActionClick({ player: f.p, buttonId: uid(child), action: 0, opId: 1, handled: false });
const names = f => f.sent.map(row => row[0]);

test("searching the table opens the nine-box interface and runs the riddle script; no chatbox menu", t => {
  const f = actor(t, 'krbox');
  quest().setStage(f.p, STAGE_CELL_OPEN);
  assert.equal(searchTable(f), true);
  assert.ok(f.sent.some(row => row[0] === 'sendInterface' && row[1] === GROUP), 'interface 390 is sent');
  assert.ok(f.sent.some(row => row[0] === 'sendClientScript' && row[1] === RIDDLE_SCRIPT), 'CS2 171 draws it');
  assert.ok(!f.p.getDialogueManager().getCurrent(), 'no Box 1..9 chatbox prompt');
});

test('Show riddle runs the toggle script again and chooses nothing', t => {
  const f = actor(t, 'krshow');
  quest().setStage(f.p, STAGE_CELL_OPEN);
  searchTable(f);
  const scripts = () => f.sent.filter(row => row[0] === 'sendClientScript' && row[1] === RIDDLE_SCRIPT).length;
  const before = scripts();
  click(f, 8);
  assert.equal(scripts(), before + 1);
  assert.equal(quest().getStage(f.p), STAGE_CELL_OPEN);
  assert.equal(f.sent.filter(row => row[0] === 'sendInterfaceRemoval').length, 0);
});

const GRAIL = 19;
const have = (f, id) => f.p.getInventory().getAmount(id);

/** Plays the open conversation through (the grail's box transcript ends in "Sxgy3n": the grail drops into the pack). */
function playOut(f) {
  for (let guard = 0; guard < 60 && f.p.getDialogueManager().getCurrent(); guard++) {
    const current = f.p.getDialogueManager().getCurrent();
    if (current.constructor.name === 'OptionDialogue') break;
    f.p.getDialogueManager().advance();
  }
}

test('the eighth box from the left (component 16) is the grail: the interface closes, the talk plays and the grail arrives', t => {
  const f = actor(t, 'krgrail');
  quest().setStage(f.p, STAGE_CELL_OPEN);
  searchTable(f);
  assert.equal(have(f, GRAIL), 0);
  click(f, 16);
  assert.ok(names(f).includes('sendInterfaceRemoval'), 'the interface closes');
  playOut(f);
  assert.equal(have(f, GRAIL), 1, 'the Holy Grail dropped into the pack');
  assert.equal(quest().getStage(f.p), STAGE_GRAIL);
  assert.equal(f.p.getLocation().getX(), 1900, 'not sent to the Ardougne cave');
});

test('a player who lost the grail (stage 70, none held) goes through the riddle again and the eighth box gives it back', t => {
  const f = actor(t, 'krlost');
  quest().setStage(f.p, STAGE_GRAIL);
  assert.equal(have(f, GRAIL), 0);
  searchTable(f);
  assert.ok(f.sent.some(row => row[0] === 'sendInterface' && row[1] === GROUP), 'the table still opens the interface');
  click(f, 16);
  playOut(f);
  assert.equal(have(f, GRAIL), 1, 'the grail is given again');
  assert.equal(quest().getStage(f.p), STAGE_GRAIL, 'the stage does not move back');
});

test('a wrong box (each of the other eight) is the trap: 5 damage is queued and the player is sent to the Ardougne cave', t => {
  for (const child of [9, 10, 11, 12, 13, 14, 15, 17]) {
    const f = actor(t, `krwrong${child}`);
    quest().setStage(f.p, STAGE_CELL_OPEN);
    searchTable(f);
    const damage = [];
    const queue = f.p.getCombat().getHitQueue();
    const original = queue.addPendingDamage.bind(queue);
    queue.addPendingDamage = hits => { damage.push(...hits.map(hit => hit.getDamage())); return original(hits); };
    click(f, child);
    assert.ok(damage.includes(5), `box at component ${child}: 5 damage queued (${damage})`);
    assert.equal(f.p.getLocation().getX(), 2611, `box at component ${child}: the cave north of the monastery`);
    assert.equal(have(f, GRAIL), 0);
  }
});

test('controls: another player, no search first, and a click once the grail is held do nothing', t => {
  const a = actor(t, 'kropen'), b = actor(t, 'krother');
  quest().setStage(a.p, STAGE_CELL_OPEN);
  quest().setStage(b.p, STAGE_CELL_OPEN);
  searchTable(a);
  click(b, 17);
  assert.equal(b.p.getLocation().getX(), 1900, 'a player who never opened it is not trapped');
  assert.equal(b.sent.length, 0);
  // A claim that outlives the table search: the grail arrived another way, so the riddle is no longer asked.
  a.p.getInventory().adds(GRAIL, 1);
  click(a, 17);
  assert.equal(a.p.getLocation().getX(), 1900, 'with the grail held a stale click does not trap');
  assert.equal(have(a, GRAIL), 1);
});
