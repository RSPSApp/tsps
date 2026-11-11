// Run after `yarn build`: node --test tests/ctrl-click-interaction-run.test.cjs
// All Settings row 207 ("Ctrl+click to invert run mode"): a Ctrl-click on an NPC, object, ground
// item or player inverts the run mode for the walk to it, as a Ctrl-click walk does.
const assert = require('node:assert/strict');
const { test, before } = require('node:test');
const { Server } = require('../dist/Server');
Server.installProductionPathResolver();

const { CachePipeline } = require('../dist/game/cache/CachePipeline');
const { decodeClientPackets } = require('../dist/net/protocol/ClientProtocol');
const { clickRunOverride } = require('../dist/net/NetworkBuilder');
const { MovementQueue } = require('../dist/game/model/movement/MovementQueue');
const { TaskManager } = require('../dist/game/task/TaskManager');
const { Task } = require('../dist/game/task/Task');
const { TaskType } = require('../dist/game/task/TaskType');

const RUN_INVERT_MODE_VARBIT = 13132;

before(async () => {
  await CachePipeline.initialize();
});

// Field encodings as the client writes them: zero for every field, the Ctrl byte as 0 or 1.
const ZERO = { s: [0, 0], sL: [0, 0], sA: [128, 0], sAL: [0, 128], i: [0, 0, 0, 0] };
const CTRL = { b: (k) => k, bA: (k) => (k + 128) & 0xff, bS: (k) => (128 - k) & 0xff, bN: (k) => -k & 0xff };

/** Each interaction packet's opcode and field order; "C:<kind>" is its Ctrl byte. */
const PACKETS = [
  ['OPNPC1 (NPC op 1)', 76, ['C:b', 'sAL']],
  ['OPNPC2', 12, ['sAL', 'C:b']],
  ['OPNPC3', 34, ['sA', 'C:bN']],
  ['OPNPC4', 70, ['C:bN', 'sL']],
  ['OPNPC5', 57, ['C:bA', 'sL']],
  ['OPLOC1', 96, ['sA', 'sL', 'C:bN', 'sAL']],
  ['OPLOC2', 28, ['sAL', 'sAL', 'C:bS', 's']],
  ['OPLOC3', 42, ['sL', 'sL', 'sAL', 'C:bS']],
  ['OPLOC4', 38, ['sA', 'sL', 'sA', 'C:bN']],
  ['OPLOC5', 51, ['s', 'C:bA', 'sA', 'sA']],
  ['OPOBJ1', 102, ['C:bS', 'sL', 'sA', 'sA']],
  ['OPOBJ2', 43, ['sA', 'sL', 's', 'C:b']],
  ['OPOBJ3', 103, ['sL', 'sA', 'sAL', 'C:bS']],
  ['OPOBJ4', 56, ['sAL', 'sAL', 'C:bN', 'sA']],
  ['OPOBJ5', 82, ['sA', 'sL', 'sL', 'C:bS']],
  ['OPPLAYER1', 44, ['C:bS', 's']],
  ['OPPLAYER2', 45, ['C:b', 's']],
  ['OPPLAYER3', 46, ['C:bS', 's']],
  ['OPPLAYER4', 73, ['s', 'C:bN']],
  ['OPPLAYER5', 6, ['sAL', 'C:bS']],
  ['OPPLAYER6', 48, ['s', 'C:bN']],
  ['OPPLAYER7', 10, ['sA', 'C:bS']],
  ['OPPLAYER8', 21, ['C:b', 'sA']],
  ['OPNPC_U', 36, ['sAL', 'C:b', 'i', 'sL', 'sAL']],
  ['OPNPC_T', 75, ['s', 'i', 's', 'sA', 'C:bA']],
  ['OPLOCU', 86, ['sAL', 'sA', 'i', 'C:bS', 'sL', 's', 'sAL']],
  ['OPLOC_T', 2, ['sAL', 'sA', 'sA', 'i', 's', 'sL', 'C:bN']],
  ['OPOBJ_U', 79, ['sAL', 'sA', 'i', 'sA', 'sAL', 'C:bS', 'sL']],
  ['OPOBJ_T', 94, ['i', 'sA', 'sA', 'sAL', 's', 'C:b', 'sAL']],
  ['OPPLAYER_U', 65, ['sAL', 'sAL', 'sA', 'i', 'C:bA']],
  ['OPPLAYER_T', 32, ['C:bN', 'sL', 'sL', 'i', 'sL']],
];

function encode(opcode, fields, ctrl) {
  const bytes = [opcode];
  for (const field of fields) {
    if (field.startsWith('C:')) bytes.push(CTRL[field.slice(2)](ctrl));
    else bytes.push(...ZERO[field]);
  }
  return Buffer.from(bytes);
}

test('every NPC, object, ground item and player click packet carries its Ctrl byte', () => {
  for (const [name, opcode, fields] of PACKETS) {
    const [plain] = decodeClientPackets(encode(opcode, fields, 0));
    const [ctrl] = decodeClientPackets(encode(opcode, fields, 1));
    assert.equal('modifierFlags' in plain, false, `${name}: a plain click has no key byte`);
    assert.equal(ctrl.modifierFlags, 1, `${name}: Ctrl-click`);
    // Reading the Ctrl byte moves no other field.
    const { modifierFlags: _ctrl, ...rest } = ctrl;
    assert.deepEqual(rest, plain, `${name}: other fields`);
  }
});

function player({ mode, running, energy = 100 }) {
  return {
    isRunningReturn: () => running,
    getRunEnergy: () => energy,
    getPacketSender: () => ({ getVarbit: (id) => (id === RUN_INVERT_MODE_VARBIT ? mode : 0) }),
  };
}

test('a Ctrl-click inverts the run mode only where row 207 allows it; a plain click never does', () => {
  const cases = [
    // [option, mode, run on: Ctrl-click runs?, run off: Ctrl-click runs?]
    ['Never', 0, null, null],
    ['Walk -> Run Only', 1, null, true],
    ['Run -> Walk Only', 2, false, null],
    ['Always', 3, false, true],
  ];
  for (const [name, mode, whileRunning, whileWalking] of cases) {
    assert.equal(clickRunOverride(player({ mode, running: true }), 1), whileRunning, `${name}: Ctrl-click while running`);
    assert.equal(clickRunOverride(player({ mode, running: false }), 1), whileWalking, `${name}: Ctrl-click while walking`);
    assert.equal(clickRunOverride(player({ mode, running: true }), 0), null, `${name}: plain click while running`);
    assert.equal(clickRunOverride(player({ mode, running: false }), 0), null, `${name}: plain click while walking`);
  }
  assert.equal(clickRunOverride(player({ mode: 3, running: false, energy: 0 }), 1), false, 'no energy: walks');
});

function queueFor(character) {
  const mobile = {
    isPlayer: () => true,
    getAsPlayer: () => mobile,
    isNpc: () => false,
    getIndex: () => 4242,
    getFollowing: () => character.following ?? null,
    getCombatFollowing: () => character.combatFollowing ?? null,
    isRunningReturn: () => false,
    getLocation: () => null,
  };
  return new MovementQueue(mobile);
}

test("the click's run choice holds through the interaction's re-paths and ends once the player stops", (t) => {
  const character = {};
  const queue = queueFor(character);
  queue.setClickRunOverride(true);
  assert.equal(queue.isRunToggled(), false, 'nothing changes until the click starts its walk');
  queue.reset(false);
  assert.equal(queue.isRunToggled(), true, 'a Ctrl-click with run off runs');
  queue.reset(false);
  assert.equal(queue.isRunToggled(), true, 'a re-path keeps it');

  character.following = {};
  queue.endRunOverrideWhenIdle();
  assert.equal(queue.isRunToggled(), true, 'still following a player');
  character.following = null;
  character.combatFollowing = {};
  queue.endRunOverrideWhenIdle();
  assert.equal(queue.isRunToggled(), true, 'still chasing a target');
  character.combatFollowing = null;

  const walkTo = new (class extends Task { execute() {} })(0, 4242, false);
  walkTo.type = TaskType.WALK_TO;
  TaskManager.submit(walkTo);
  t.after(() => TaskManager.cancelTasks(4242));
  queue.endRunOverrideWhenIdle();
  assert.equal(queue.isRunToggled(), true, 'still walking to an NPC or object');
  walkTo.stop();

  queue.endRunOverrideWhenIdle();
  assert.equal(queue.isRunToggled(), false, 'stopped with nothing to walk to: back to the run setting');

  queue.setClickRunOverride(true);
  queue.setClickRunOverride(null);
  queue.reset(false);
  assert.equal(queue.isRunToggled(), false, 'a plain click replaces a Ctrl-click');
});

test('a Ctrl-click that walks nowhere leaves a walk in progress as it is', () => {
  const queue = queueFor({});
  queue.setClickRunOverride(true);
  queue.dropPendingClickRunOverride(); // the end of the turn: no walk took it up
  queue.reset(false);
  assert.equal(queue.isRunToggled(), false, "a later walk follows the run setting");
});
