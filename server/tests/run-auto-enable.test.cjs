// Run after `yarn build`: node --test tests/run-auto-enable.test.cjs
const assert = require("node:assert/strict");
const { test } = require("node:test");

const { Server } = require("../dist/Server");
Server.installProductionPathResolver();

const RunAutoEnable = require("../plugins/interface/RunAutoEnable.plugin");
const { settingClicked, process, restore } = RunAutoEnable._test;

function createPlayer({ energy = 100, running = true } = {}) {
  const log = [];
  const attributes = new Map();
  let amountAction = null;
  const sender = {
    sendVarbit: (id, value) => { log.push(`varbit ${id}=${value}`); return sender; },
    sendConfig: (id, value) => { log.push(`varp ${id}=${value}`); return sender; },
    sendEnterAmountPrompt: (title) => { log.push(`prompt ${title}`); return sender; },
    sendRunStatus: () => { log.push("run status"); return sender; },
  };
  const player = {
    log,
    energy,
    running,
    getPacketSender: () => sender,
    getAttribute: (key) => attributes.get(key),
    setAttribute: (key, value) => attributes.set(key, value),
    setEnteredAmountAction: (action) => { amountAction = action; },
    /** The player answers the prompt, as the server's amount handler would call it. */
    answer: (amount) => { if (amountAction && (amount > 0 || (amount === 0 && amountAction.acceptsZero))) amountAction.execute(amount); },
    isRunningReturn: () => player.running,
    setRunning: (value) => { player.running = value; },
    getRunEnergy: () => player.energy,
  };
  return player;
}

/** One tick: optionally change energy or run first (as the server's movement does), then the check. */
function tick(player, change = {}) {
  Object.assign(player, change);
  process({ player });
}

test("as captured: the setting asks for a threshold; the answer becomes runenergy_autoenable, 0 included", () => {
  const player = createPlayer();
  const request = { player, settingId: 389, handled: false };
  settingClicked(request);
  assert.equal(request.handled, true);
  assert.deepEqual(player.log, ["varbit 16075=1", "varbit 12393=1", "prompt Set energy threshold for auto-enabling run mode:"]);
  player.log.length = 0;
  player.answer(5);
  assert.deepEqual(player.log, ["varbit 11031=5", "varbit 16075=0", "varbit 12393=0"]);
  settingClicked({ player, settingId: 389, handled: false });
  player.log.length = 0;
  player.answer(0);
  assert.deepEqual(player.log, ["varbit 11031=0", "varbit 16075=0", "varbit 12393=0"], "0 turns it off");
  settingClicked({ player, settingId: 389, handled: false });
  player.answer(250);
  assert.equal(player.getAttribute("settings.run-auto-enable"), 100, "at most 100%");
  const other = { player, settingId: 1, handled: false };
  settingClicked(other);
  assert.equal(other.handled, false, "other settings are not ours");
});

test("as captured: run that ran out comes back on, without a message, the tick energy reaches the threshold", () => {
  const player = createPlayer();
  player.setAttribute("settings.run-auto-enable", 5);
  tick(player, { energy: 1 });
  tick(player, { energy: 0, running: false }); // ran out
  for (const energy of [1, 2, 3, 4]) tick(player, { energy });
  assert.equal(player.running, false);
  player.log.length = 0;
  tick(player, { energy: 5 });
  assert.equal(player.running, true);
  assert.deepEqual(player.log, ["varp 173=1", "run status"]);
});

test("the tick run runs out, the same tick's recovery may already have added 1%: it still counts", () => {
  const player = createPlayer({ energy: 1 });
  player.setAttribute("settings.run-auto-enable", 5);
  tick(player);
  tick(player, { energy: 1, running: false }); // drained to 0, then restored to 1 in the same process()
  for (const energy of [2, 3, 4]) tick(player, { energy });
  assert.equal(player.running, false);
  tick(player, { energy: 5 });
  assert.equal(player.running, true);
});

test("a deliberate walk is never overridden; threshold 0 never enables; turning run on by hand clears the wait", () => {
  const walker = createPlayer({ energy: 50 });
  walker.setAttribute("settings.run-auto-enable", 5);
  tick(walker);
  tick(walker, { running: false }); // turned off by hand at 50%
  tick(walker, { energy: 60 });
  assert.equal(walker.running, false);

  const off = createPlayer({ energy: 1 });
  tick(off);
  tick(off, { energy: 0, running: false });
  tick(off, { energy: 100 });
  assert.equal(off.running, false, "Do not enable");

  const manual = createPlayer({ energy: 1 });
  manual.setAttribute("settings.run-auto-enable", 5);
  tick(manual);
  tick(manual, { energy: 0, running: false });
  tick(manual, { energy: 2, running: true }); // toggled on by hand
  tick(manual, { running: false }); // and off again at 2%
  tick(manual, { energy: 10 });
  assert.equal(manual.running, false, "the wait was cleared");
});

test("login sends a set threshold", () => {
  const player = createPlayer();
  restore({ player });
  assert.deepEqual(player.log, []);
  player.setAttribute("settings.run-auto-enable", 20);
  restore({ player });
  assert.deepEqual(player.log, ["varbit 11031=20"]);
});
