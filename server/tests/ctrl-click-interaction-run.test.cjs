// Run after `yarn build`: node --test tests/ctrl-click-interaction-run.test.cjs
// All Settings row 207 ("Ctrl+click to invert run mode"): a Ctrl-click on an NPC, object, ground
// item or player inverts the run mode for the walk to it, as a Ctrl-click walk does.
const assert = require('node:assert/strict');
const { test, before, after, describe } = require('node:test');
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
    getCombat: () => ({ getTarget: () => character.target ?? null }),
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
  queue.endClickRunOverrideWhenIdle();
  assert.equal(queue.isRunToggled(), true, 'still following a player');
  character.following = null;
  character.target = {};
  queue.endClickRunOverrideWhenIdle();
  assert.equal(queue.isRunToggled(), true, 'still fighting');
  character.target = null;

  const walkTo = new (class extends Task { execute() {} })(0, 4242, false);
  walkTo.type = TaskType.WALK_TO;
  TaskManager.submit(walkTo);
  t.after(() => TaskManager.cancelTasks(4242));
  queue.endClickRunOverrideWhenIdle();
  assert.equal(queue.isRunToggled(), true, 'still walking to an NPC or object');
  walkTo.stop();

  queue.endClickRunOverrideWhenIdle();
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

// Real players and NPCs below: packets go through ClientConnection.dispatch, turns through Player.process.
describe('in a player\'s turns', () => {
  process.env.DISABLE_PLAYER_BOTS = '1';
  const path = require('node:path');
  const { PluginManager: PM } = require('../dist/plugins/PluginManager');
  const { Player } = require('../dist/game/entity/impl/player/Player');
  const { PlayerSession } = require('../dist/net/PlayerSession');
  const { ClientConnection } = require('../dist/net/NetworkBuilder');
  let core;
  let next = 7810;
  const npcs = [];

  before(() => {
    PM.loadFromDirectory(path.resolve(__dirname, '../plugins'));
    core = PM.getCoreApi();
    core.RegionManager.init();
  });
  after(() => {
    for (const npc of npcs) core.World.getNpcs().remove(npc);
    PM.emitServerShutdown({});
  });

  // Lumbridge, north of the castle: open grass.
  function actor(t) {
    const channel = { kind: 'test', remoteAddress: '127.0.0.1', isOpen: () => true, send: () => true, close() {}, onData() {}, onError() {}, onClose() {} };
    const session = new PlayerSession(channel);
    const p = new Player(session);
    p.setIndex(next++);
    p.setUsername('runqa' + p.getIndex());
    p.setRegistered(true);
    p.setLocation(new core.Location(3222, 3240, 0));
    p.needsPlacement = false;
    const c = new ClientConnection(channel);
    c.player = p;
    session.setTurnPacketProcessor(() => c.processTurnPackets());
    p.setRunning(false);
    p.getPacketSender().sendVarbit(RUN_INVERT_MODE_VARBIT, 3); // Always
    t.after(() => { p.setRegistered(false); core.TaskManager.cancelTasks(p.getIndex()); });
    return { p, c };
  }
  function npcAt(x, y) {
    const npc = core.NPC.create(3106, new core.Location(x, y, 0)); // Man
    core.World.getNpcs().add(npc);
    npcs.push(npc);
    return npc;
  }
  const turns = (f, n = 1) => { for (let i = 0; i < n; i++) f.p.process(); };
  async function click(f, packet) {
    await f.c.dispatch([packet]);
    turns(f);
  }
  const attackOp = (npc, f) => npc.getCurrentDefinition(f.p).getActions().findIndex((a) => a === 'Attack') + 1;
  const running = (f) => f.p.getMovementQueue().isRunToggled();

  test('a Ctrl-clicked Attack runs to the NPC, and once the fight is over a retaliation chase walks', async (t) => {
    const f = actor(t);
    const npc = npcAt(3222, 3250);
    await click(f, { type: 'npc_option', index: npc.getIndex(), clickType: attackOp(npc, f), modifierFlags: 1 });
    assert.equal(running(f), true, 'Ctrl-click with run off: runs to the target');
    f.p.getCombat().reset(); // the fight ends (the NPC died) while the player stands still
    turns(f, 5);
    assert.equal(f.p.getMovementQueue().hasPendingWork(), false, 'idle');
    assert.equal(running(f), false, 'idle after the fight: back to the run setting');
    f.p.getCombat().attack(npcAt(3226, 3246), true);
    assert.equal(running(f), false, 'a later retaliation chase walks');
  });

  test('a Ctrl-click walk does not carry into a retaliation chase', async (t) => {
    const f = actor(t);
    await click(f, { type: 'move', worldX: 3222, worldY: 3252, modifierFlags: 1 });
    assert.equal(running(f), true, 'the Ctrl-click walk runs');
    f.p.getCombat().attack(npcAt(3218, 3244), true);
    assert.equal(running(f), false, 'the retaliation chase walks');
  });

  test('a Ctrl-click on a missing NPC leaves a walk in progress walking; a plain NPC click walks', async (t) => {
    const f = actor(t);
    await click(f, { type: 'move', worldX: 3222, worldY: 3252, modifierFlags: 0 });
    await click(f, { type: 'npc_option', index: 32000, clickType: 1, modifierFlags: 1 });
    assert.equal(running(f), false, 'the walk keeps walking');
    const npc = npcAt(3230, 3240);
    await click(f, { type: 'npc_option', index: npc.getIndex(), clickType: 1 });
    assert.equal(running(f), false, 'a plain click follows the run setting');
  });
});
