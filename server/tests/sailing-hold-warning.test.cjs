// Run after `yarn build`: node --test tests/sailing-hold-warning.test.cjs
// All Settings "Port task cargo in hold warning" (467): Disembark at a port while the boat's hold
// still has a crate owed there asks with live's four options; "don't ask again" saves the row,
// "this session" lasts until logout, and "Remain on the boat." stays aboard.
const assert = require('node:assert/strict');
const { test, before } = require('node:test');
const { Server } = require('../dist/Server');
Server.installProductionPathResolver();

const { CachePipeline } = require('../dist/game/cache/CachePipeline');
const { PluginManager } = require('../dist/plugins/PluginManager');
const { OptionDialogue } = require('../dist/game/model/dialogues/entries/impl/OptionDialogue');
const { Sailing } = require('../dist/game/content/sailing/Sailing');
const { TaskManager } = require('../dist/game/task/TaskManager');
const common = require('../plugins/skills/sailing/porttasks/Common.PortTasks');
const HoldWarning = require('../plugins/skills/sailing/porttasks/HoldWarning.PortTasks');

const MUSA_GANGPLANK = { x: 2961, y: 3146, z: 0 };
let core, task, disembark;

before(async () => {
  await CachePipeline.initialize();
  core = PluginManager.getCoreApi();
  common.init({ core });
  task = common.DATA.tasks.find((t) => t.type === 'courier' && t.destination === 'musa_point');
  assert.ok(task);
  const hooks = {};
  require('../plugins/skills/sailing/Gangplank.Sailing').register({
    onObjectInteraction: (name, actions) => { hooks[name] = actions; },
    setUsableFromDeck() {},
  });
  disembark = hooks.Gangplank.Disembark;
});

function player(vars = {}) {
  const log = { dialogues: [], messages: [] };
  const attributes = new Map();
  const sender = {
    getVarbit: (id) => vars[id] ?? 0,
    sendVarbit(id, value) { vars[id] = value; return sender; },
    sendConfig() { return sender; },
    sendSubInterface() { return sender; },
    sendInterfaceRemoval() { return sender; },
    closeChatboxFor: () => true,
    sendTypedMessage(_type, m) { log.messages.push(m); return sender; },
  };
  return {
    log, vars,
    getPacketSender: () => sender,
    getAttribute: (k) => attributes.get(k),
    setAttribute: (k, v) => attributes.set(k, v),
    sendMessage: (m) => log.messages.push(m),
    getDialogueManager: () => ({ startDialogues: (chain) => log.dialogues.push([...chain.getDialogues().values()]) }),
    getSkillManager: () => ({ getCurrentLevel: () => 99 }),
  };
}

/** A player aboard their own boat docked at Musa Point, with one crate for `task` taken. */
function aboard(t, p, hold) {
  p.setAttribute(common.SLOTS_ATTRIBUTE, [{ id: task.id, taken: 1, delivered: 0 }]);
  const boat = { cargo: hold };
  const left = [];
  t.mock.method(Sailing, 'guestBoat', () => undefined);
  t.mock.method(Sailing, 'instanceAboard', () => ({}));
  t.mock.method(Sailing, 'activeBoat', () => boat);
  t.mock.method(Sailing, 'lastPortOf', () => 'musa_point');
  const near = { value: true };
  t.mock.method(Sailing, 'boatNearDock', () => near.value);
  t.mock.method(Sailing, 'disembark', (_p, dock) => { left.push(dock); return null; });
  const submitted = [];
  t.mock.method(TaskManager, 'submit', (task) => submitted.push(task));
  const settings = [];
  t.mock.method(PluginManager, 'emitCustomEvent', (name, payload) => {
    if (name !== 'settings:set') return;
    settings.push([payload.settingId, payload.value]);
    payload.player.vars[HoldWarning.DONT_ASK_VARBIT] = payload.value;
  });
  return { boat, left, submitted, settings, near };
}

test('Disembark with a crate for this port in the hold asks with the captured title and options', (t) => {
  const p = player();
  const { submitted } = aboard(t, p, [{ id: task.crate, amount: 1 }]);
  disembark({ player: p, location: MUSA_GANGPLANK });
  assert.equal(submitted.length, 0, 'nothing moves before an answer');
  const [options] = p.log.dialogues[0];
  assert.ok(options instanceof OptionDialogue);
  assert.equal(options.getTitle(), 'Some cargo for this port is still in the cargo hold.');
  assert.deepEqual(options.getOptions(), ['Disembark anyway.', "Disembark anyway, and don't ask again.",
    "Disembark anyway, and don't ask again this session.", 'Remain on the boat.']);
  options.execute(4);
  assert.equal(submitted.length, 0, '"Remain on the boat." stays aboard');
  options.execute(1);
  assert.equal(submitted.length, 1, '"Disembark anyway." leaves (the fade starts)');
});

test('a boat that sailed off while the question was open is too far at the answer', (t) => {
  const p = player();
  const { submitted, near } = aboard(t, p, [{ id: task.crate, amount: 1 }]);
  disembark({ player: p, location: MUSA_GANGPLANK });
  near.value = false;
  p.log.dialogues[0][0].execute(1);
  assert.equal(submitted.length, 0, 'no fade, still aboard');
  assert.equal(p.log.messages.at(-1), "The boat isn't close enough for you to be able to disembark here.");
});

test("'don't ask again' saves the row (varbit 18144 = 1); later disembarks don't ask", (t) => {
  const p = player();
  const { submitted, settings } = aboard(t, p, [{ id: task.crate, amount: 1 }]);
  disembark({ player: p, location: MUSA_GANGPLANK });
  p.log.dialogues[0][0].execute(2);
  assert.deepEqual(settings, [[467, 1]]);
  assert.equal(submitted.length, 1);
  disembark({ player: p, location: MUSA_GANGPLANK });
  assert.equal(p.log.dialogues.length, 1);
  assert.equal(submitted.length, 2);
});

test("'this session' sets varbit 19120 and stops asking without saving the row", (t) => {
  const p = player();
  const { submitted, settings } = aboard(t, p, [{ id: task.crate, amount: 1 }]);
  disembark({ player: p, location: MUSA_GANGPLANK });
  p.log.dialogues[0][0].execute(3);
  assert.equal(p.vars[HoldWarning.SESSION_VARBIT], 1);
  assert.deepEqual(settings, []);
  disembark({ player: p, location: MUSA_GANGPLANK });
  assert.equal(p.log.dialogues.length, 1);
  assert.equal(submitted.length, 2);
});

test('no question without cargo owed here: empty hold, other cargo, delivered task, or the row off', (t) => {
  for (const [name, hold, slot, vars] of [
    ['empty hold', [], { taken: 1, delivered: 0 }, {}],
    ['other items', [{ id: 31964, amount: 3 }], { taken: 1, delivered: 0 }, {}],
    ['all delivered', [{ id: task.crate, amount: 1 }], { taken: 1, delivered: 1 }, {}],
    ['row off', [{ id: task.crate, amount: 1 }], { taken: 1, delivered: 0 }, { [HoldWarning.DONT_ASK_VARBIT]: 1 }],
  ]) {
    const p = player(vars);
    const { submitted } = aboard(t, p, hold);
    p.setAttribute(common.SLOTS_ATTRIBUTE, [{ id: task.id, ...slot }]);
    disembark({ player: p, location: MUSA_GANGPLANK });
    assert.equal(p.log.dialogues.length, 0, name);
    assert.equal(submitted.length, 1, name);
    t.mock.restoreAll();
  }
});

test('a crate for another port in the hold does not ask at this one', () => {
  const other = common.DATA.tasks.find((t) => t.type === 'courier' && t.destination !== 'musa_point' && t.crate !== task.crate);
  const p = player();
  p.setAttribute(common.SLOTS_ATTRIBUTE, [{ id: other.id, taken: 1, delivered: 0 }]);
  assert.equal(HoldWarning.cargoForPort(p, { cargo: [{ id: other.crate, amount: 1 }] }, 'musa_point'), false);
  assert.equal(HoldWarning.cargoForPort(p, { cargo: [{ id: other.crate, amount: 1 }] }, other.destination), true);
});
