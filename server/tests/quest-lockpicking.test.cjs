const assert = require('node:assert/strict');
const { test } = require('node:test');
const { createQuestLockpicking, lockpickFeedback } = require('../plugins/quests/QuestLockpicking');

function harness(activePins, target) {
  const tasks = [], logout = [], death = [], messages = [], interfaces = [], scripts = [];
  const custom = new Map();
  let solved = 0;
  const api = {
    core: {
      CountdownTask: class { constructor(key, ticks, run) { Object.assign(this, { key, ticks, run }); } },
      TaskManager: {
        submit(task) { tasks.push(task); },
        cancelTasks(key) { for (let i = tasks.length - 1; i >= 0; i--) if (tasks[i].key === key) tasks.splice(i, 1); },
      },
    },
    onPlayerLogout(fn) { logout.push(fn); },
    onPlayerDeath(fn) { death.push(fn); },
    onCustomEvent(name, fn) { const list = custom.get(name) ?? []; list.push(fn); custom.set(name, list); },
  };
  const player = {
    registered: true,
    amountAction: null,
    setEnteredAmountAction(action) { player.amountAction = action; },
    getEnteredAmountAction() { return player.amountAction; },
    getPacketSender() {
      return {
        sendInterface(id) { interfaces.push(id); return this; },
        sendInterfaceScript(id, args) { scripts.push({ id, args }); return this; },
        sendInterfaceRemoval() { return this; },
      };
    },
    sendMessage(text) { messages.push(text); },
    isRegistered() { return player.registered; },
  };
  const lockpick = createQuestLockpicking(api, { activePins, target, onSolved: () => solved++ });
  const tick = () => { for (const task of [...tasks]) { tasks.splice(tasks.indexOf(task), 1); task.run(); } };
  const emitted = (name, payload) => { for (const fn of custom.get(name) ?? []) fn(payload); };
  return { api, player, lockpick, tasks, logout, death, messages, interfaces, scripts, tick, emitted, solved: () => solved };
}

test('Feedback packs six base-3 digits with exact matches before duplicate-aware wrong positions', () => {
  for (const [guess, feedback] of [
    [4555, 496], [3037, 499], [1525, 660], [2389, 660], [2418, 649], [1424, 677],
  ]) {
    assert.equal(lockpickFeedback(guess, 2306), feedback, `FFG guess ${guess}`);
  }
  for (const [guess, feedback] of [[0, 506], [1518, 506], [3036, 506], [4554, 560],
    [6072, 512], [7368, 674]]) {
    assert.equal(lockpickFeedback(guess, 7152), feedback, `FFG second-session guess ${guess}`);
  }
  for (const [guess, feedback] of [[0, 702], [43, 708], [80, 708], [117, 710]]) {
    assert.equal(lockpickFeedback(guess, 153), feedback, `Final Dawn guess ${guess}`);
  }
});

test('Lockpicking UI sends six-slot attempt/guess/feedback and accepts the first correct guess', () => {
  const h = harness(4, 153);
  h.lockpick.open(h.player);
  assert.deepEqual(h.scripts.at(-1).args.slice(6), [4, 0, 0, 0]);
  assert.ok(h.player.amountAction);
  h.player.amountAction.execute(153);
  assert.equal(h.solved(), 1);
  assert.equal(h.player.amountAction, null);
  h.player.amountAction?.execute(153);
  assert.equal(h.solved(), 1, 'repeated amount after success is ignored');
});

test('Wrong guesses reopen with the actual guess and computed feedback; attempt increments', () => {
  const h = harness(5, 2306);
  h.lockpick.open(h.player);
  const sequence = [[4555, 496], [3037, 499], [1525, 660], [2389, 660], [2418, 649], [1424, 677]];
  for (let i = 0; i < sequence.length; i++) {
    const [guess, feedback] = sequence[i];
    h.player.amountAction.execute(guess);
    assert.equal(h.solved(), 0);
    h.tick();
    assert.deepEqual(h.scripts.at(-1).args.slice(6), [5, i + 1, guess, feedback]);
  }
  h.player.amountAction.execute(2306);
  assert.equal(h.solved(), 1);
  assert.ok(h.messages.includes("That didn't seem to work."));
});

test('Second captured FFG 811 session (secret 7152) feeds back and unlocks', () => {
  const h = harness(5, 7152);
  h.lockpick.open(h.player);
  const sequence = [[0, 506], [1518, 506], [3036, 506], [4554, 560], [6072, 512], [7368, 674]];
  for (let i = 0; i < sequence.length; i++) {
    const [guess, feedback] = sequence[i];
    h.player.amountAction.execute(guess);
    assert.equal(h.solved(), 0);
    h.tick();
    assert.deepEqual(h.scripts.at(-1).args.slice(6), [5, i + 1, guess, feedback]);
  }
  h.player.amountAction.execute(7152);
  assert.equal(h.solved(), 1);
  assert.ok(h.messages.includes("That didn't seem to work."));
});

test('Invalid, forged, unrelated and cancelled counts cannot unlock or clear another prompt', () => {
  const h = harness(4, 153);
  h.lockpick.open(h.player);
  for (const value of [-1, 1296, 1.5, 0]) {
    h.player.amountAction.execute(value);
    assert.equal(h.solved(), 0);
    h.tick();
  }
  const unrelated = { acceptsZero: true, execute() {} };
  h.player.setEnteredAmountAction(unrelated);
  h.lockpick.cancel(h.player);
  assert.equal(h.player.getEnteredAmountAction(), unrelated, 'cancel leaves an unrelated prompt');

  h.lockpick.open(h.player);
  const stale = h.player.amountAction;
  h.lockpick.cancel(h.player);
  stale.execute(153);
  assert.equal(h.solved(), 0, 'stale amount after cancel is ignored');
  h.player.setEnteredAmountAction(unrelated);
  h.lockpick.open(h.player);
  assert.equal(h.player.amountAction === unrelated, false, 'open replaces its own prompt');

  const otherPrompt = harness(4, 153);
  otherPrompt.lockpick.open(otherPrompt.player);
  otherPrompt.player.amountAction.execute(0);
  const other = { acceptsZero: true, execute() {} };
  otherPrompt.player.setEnteredAmountAction(other);
  otherPrompt.tick();
  assert.equal(otherPrompt.player.getEnteredAmountAction(), other, 'unrelated amount prompt survives reopen tick');
  assert.equal(otherPrompt.scripts.length, 1, 'no lockpick UI overwrites the other prompt');

  const closed = harness(4, 153);
  closed.lockpick.open(closed.player);
  const beforeClose = closed.player.amountAction;
  closed.emitted('interface:closed', { player: closed.player, interfaceId: 811 });
  assert.equal(closed.player.amountAction, null, 'interface close cancels the pending prompt');
  beforeClose.execute(153);
  assert.equal(closed.solved(), 0, 'stale count after interface close is ignored');

  const h2 = harness(4, 153);
  h2.lockpick.open(h2.player);
  h2.player.amountAction.execute(0);
  h2.logout[0]({ player: h2.player });
  assert.equal(h2.player.amountAction, null);
  h2.player.registered = false;
  h2.tick();
  assert.equal(h2.scripts.length, 1, 'logout cancels the next-tick reopen');
  h2.death[0]({ player: h2.player });
});
