const assert = require('node:assert/strict');
const { test } = require('node:test');
const {
  createCombinationLock,
  createDirectionalLock,
  combinationLockAmount,
  directionalLockAmount,
  COMBINATION_GROUP,
  DIRECTIONAL_GROUP,
  COMBINATION_DATASET_NUMERIC,
  COMBINATION_DATASET_ALPHABETIC,
} = require('../plugins/quests/QuestPuzzleLocks');

function harness() {
  const logout = [];
  const death = [];
  const custom = new Map();
  const api = {
    onPlayerLogout(fn) { logout.push(fn); },
    onPlayerDeath(fn) { death.push(fn); },
    onCustomEvent(name, fn) { const list = custom.get(name) ?? []; list.push(fn); custom.set(name, list); },
  };
  const players = new Map();
  const player = (name) => {
    if (players.has(name)) return players.get(name);
    const p = {
      name,
      interfaceId: -1,
      amountAction: null,
      messages: [],
      interfaces: [],
      scripts: [],
      removals: 0,
      setEnteredAmountAction(action) { p.amountAction = action; },
      getEnteredAmountAction() { return p.amountAction; },
      getInterfaceId() { return p.interfaceId; },
      sendMessage(text) { p.messages.push(text); },
      getPacketSender() {
        return {
          sendInterface(id) { p.interfaceId = id; p.interfaces.push(id); return this; },
          sendInterfaceScript(id, args) { p.scripts.push({ id, args }); return this; },
          sendInterfaceRemoval() { p.removals++; p.interfaceId = -1; return this; },
        };
      },
    };
    players.set(name, p);
    return p;
  };
  const emitted = (name, payload) => { for (const fn of custom.get(name) ?? []) fn(payload); };
  return { api, player, logout, death, emitted };
}

test('CS2/capture goldens: directional 1794 North, 1734 FFG chest; no extra UI script', () => {
  assert.equal(directionalLockAmount([3, 0, 3, 2]), 1794);
  assert.equal(directionalLockAmount([1, 3, 2, 2]), 1734);

  const h = harness();
  let solved = 0;
  const lock = createDirectionalLock(h.api, { solution: [1, 3, 2, 2], onSolved: () => solved++ });
  const p = h.player('ffg');
  lock.open(p);
  assert.deepEqual(p.interfaces, [DIRECTIONAL_GROUP]);
  assert.deepEqual(p.scripts, []);
  assert.ok(p.amountAction);
  p.amountAction.execute(1734);
  assert.equal(solved, 1);
  assert.equal(p.interfaceId, -1);
  assert.equal(p.amountAction, null);
});

test('CS2 goldens: 4-dial 7402/2339 sends authenticate 6963 and expects 740200', () => {
  assert.equal(combinationLockAmount([7, 4, 0, 2]), 740200);

  const h = harness();
  let solved = 0;
  const lock = createCombinationLock(h.api, {
    digits: [7, 4, 0, 2],
    datasetRow: COMBINATION_DATASET_NUMERIC,
    onSolved: () => solved++,
  });
  const p = h.player('north-7402');
  lock.open(p);
  assert.deepEqual(p.interfaces, [COMBINATION_GROUP]);
  assert.deepEqual(p.scripts, [{
    id: 6963,
    args: [
      (COMBINATION_GROUP << 16) | 1,
      (COMBINATION_GROUP << 16) | 4,
      4,
      COMBINATION_DATASET_NUMERIC,
      1,
      -1,
    ],
  }]);
  assert.ok(p.amountAction);
  p.amountAction.execute(7402);
  assert.equal(solved, 0, 'raw 7402 is not the client-packed confirm value');
  lock.open(p);
  p.amountAction.execute(740200);
  assert.equal(solved, 1);
});

test('CS2 goldens: 5-dial BLOOD/2340 sends 6963 and expects 359470', () => {
  assert.equal(combinationLockAmount([3, 5, 9, 4, 7]), 359470);

  const h = harness();
  let solved = 0;
  const lock = createCombinationLock(h.api, {
    digits: [3, 5, 9, 4, 7],
    datasetRow: COMBINATION_DATASET_ALPHABETIC,
    onSolved: () => solved++,
  });
  const p = h.player('north-blood');
  lock.open(p);
  assert.deepEqual(p.scripts[0].args.slice(2), [5, COMBINATION_DATASET_ALPHABETIC, 1, -1]);
  p.amountAction.execute(359470);
  assert.equal(solved, 1);
});

test('Wrong, forged, out-of-range and duplicate confirms cannot win; retry works', () => {
  const h = harness();
  let solved = 0;
  const lock = createDirectionalLock(h.api, { solution: [3, 0, 3, 2], onSolved: () => solved++ });
  const p = h.player('retry');
  lock.open(p);
  const staleAction = p.amountAction;
  lock.open(p);
  staleAction.execute(1794);
  assert.equal(solved, 0, 'a previous open action cannot solve after reopen');
  for (const bad of [1793, 1795, -1, 1.5, '1794', 0]) {
    p.amountAction.execute(bad);
    assert.equal(solved, 0);
    lock.open(p);
  }
  p.amountAction.execute(1794);
  assert.equal(solved, 1);
  p.amountAction?.execute(1794);
  assert.equal(solved, 1, 'duplicate confirm is ignored after success');
});

test('Close, logout and death clear only this lock action; unrelated prompt survives', () => {
  const h = harness();
  let solved = 0;
  const lock = createCombinationLock(h.api, {
    digits: [7, 4, 0, 2],
    datasetRow: COMBINATION_DATASET_NUMERIC,
    onSolved: () => solved++,
  });
  const p = h.player('close');

  lock.open(p);
  const stale = p.amountAction;
  h.emitted('interface:closed', { player: p, interfaceId: COMBINATION_GROUP });
  assert.equal(p.amountAction, null);
  stale.execute(740200);
  assert.equal(solved, 0);
  assert.equal(p.removals, 0, 'an interface close does not send a second removal');

  lock.open(p);
  h.emitted('interface:closed', { player: p, interfaceId: 811 });
  assert.ok(p.amountAction, 'another interface closing does not cancel this lock');
  p.amountAction.execute(740200);
  assert.equal(solved, 1);

  lock.open(p);
  const unrelated = { execute() {} };
  p.setEnteredAmountAction(unrelated);
  lock.cancel(p);
  assert.equal(p.amountAction, unrelated, 'cancel leaves an unrelated prompt alone');

  lock.open(p);
  h.logout[0]({ player: p });
  assert.equal(p.amountAction, null);
  assert.equal(p.interfaceId, -1);
  h.death[0]({ player: p });
});

test('Two players have independent state and callbacks fire once each', () => {
  const h = harness();
  const a = h.player('a');
  const b = h.player('b');
  const solved = [];
  const lock = createDirectionalLock(h.api, { solution: [1, 3, 2, 2], onSolved: (p) => solved.push(p.name) });

  lock.open(a);
  lock.open(b);
  a.amountAction.execute(1735);
  assert.deepEqual(solved, []);
  assert.equal(a.interfaceId, -1);
  assert.equal(b.interfaceId, DIRECTIONAL_GROUP, 'b keeps its own interface/state');

  b.amountAction.execute(1734);
  assert.deepEqual(solved, ['b']);
  lock.open(a);
  a.amountAction.execute(1734);
  assert.deepEqual(solved, ['b', 'a']);

  lock.open(a);
  a.amountAction.execute(1734);
  a.amountAction?.execute(1734);
  assert.deepEqual(solved, ['b', 'a', 'a'], 'one callback per open, even on duplicate input');
});

test('Native RESUME_COUNTDIALOG packet path decodes and survives NetworkBuilder action clearing', () => {
  const { decodeClientPackets } = require('../dist/net/protocol/ClientProtocol');
  const h = harness();
  const solved = [];
  const lock = createDirectionalLock(h.api, { solution: [1, 3, 2, 2], onSolved: (p) => solved.push(p.name) });
  const p = h.player('native-amount');

  const nativeAmountPacket = (amount) => {
    const frame = Buffer.alloc(5);
    frame[0] = 192; // RESUME_COUNTDIALOG
    frame.writeInt32BE(amount, 1);
    return decodeClientPackets(frame)[0];
  };
  const networkBuilderAmountBranch = (player, packet) => {
    const action = player.getEnteredAmountAction();
    if (action && packet.amount > 0) action.execute(packet.amount);
    player.setEnteredAmountAction(null); // NetworkBuilder always clears after the branch
  };

  lock.open(p);
  networkBuilderAmountBranch(p, nativeAmountPacket(1735));
  assert.deepEqual(solved, []);
  assert.equal(p.amountAction, null);
  assert.equal(p.interfaceId, -1);

  lock.open(p);
  networkBuilderAmountBranch(p, nativeAmountPacket(1734));
  assert.deepEqual(solved, ['native-amount']);
  assert.equal(p.amountAction, null);
  assert.equal(p.interfaceId, -1);
});

test('Native zero confirm closes the combination lock and reopening accepts 740200', () => {
  const { decodeClientPackets } = require('../dist/net/protocol/ClientProtocol');
  const h = harness();
  let solved = 0;
  const lock = createCombinationLock(h.api, {
    digits: [7, 4, 0, 2],
    datasetRow: COMBINATION_DATASET_NUMERIC,
    onSolved: () => solved++,
  });
  const p = h.player('native-zero');
  const nativeAmountPacket = (amount) => {
    const frame = Buffer.alloc(5);
    frame[0] = 192; // RESUME_COUNTDIALOG
    frame.writeInt32BE(amount, 1);
    return decodeClientPackets(frame)[0];
  };
  const networkBuilderAmountBranch = (player, packet) => {
    const action = player.getEnteredAmountAction();
    if (action && (packet.amount > 0 || (packet.amount === 0 && action.acceptsZero === true))) {
      action.execute(packet.amount);
    }
    player.setEnteredAmountAction(null);
  };

  lock.open(p);
  const stale = p.amountAction;
  networkBuilderAmountBranch(p, nativeAmountPacket(0));
  assert.equal(solved, 0);
  assert.equal(p.interfaceId, -1, 'zero is a wrong attempt and closes its own UI');
  assert.equal(p.amountAction, null);
  stale.execute(740200);
  assert.equal(solved, 0, 'the zero attempt leaves no stale pending action');

  lock.open(p);
  networkBuilderAmountBranch(p, nativeAmountPacket(740200));
  assert.equal(solved, 1);
  assert.equal(p.interfaceId, -1);
  assert.equal(p.amountAction, null);
});

test('Constructors reject malformed puzzle definitions before registering playable state', () => {
  const h = harness();
  assert.throws(() => combinationLockAmount([]), /1\.\.6/);
  assert.throws(() => combinationLockAmount([1, 10]), /0\.\.9/);
  assert.throws(() => directionalLockAmount([4]), /0\.\.3/);
  assert.throws(() => directionalLockAmount(new Array(11).fill(0)), /1\.\.10/);
  assert.throws(() => createCombinationLock(h.api, { digits: [1], datasetRow: -1, onSolved() {} }), /datasetRow/);
  assert.throws(() => createDirectionalLock(h.api, { solution: [1] }), /onSolved/);
});
