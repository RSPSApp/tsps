// From server/: node --test tests/sea-slug-scenes.test.cjs (after yarn build).
// Sea Slug's timed moments against the RSProx capture 20261110T112750-5ab63b4 (rev 242): Kent's
// grab (ticks 196-209) and the loose panel's kick (334-340), on a tick-by-tick task scheduler.
const assert = require('node:assert/strict');
const { test, before } = require('node:test');
const path = require('node:path');
process.chdir(path.resolve(__dirname, '..'));
const { Server } = require('../dist/Server');
Server.installProductionPathResolver();
const { PluginManager } = require('../dist/plugins/PluginManager');
const runtime = require('../plugins/quests/QuestRuntime');
const core = PluginManager.getCoreApi();
const noop = () => {};

const KENT_VARIANT = 'at-the-shipwreck-island-talking-to-kent';

function scheduler() {
  const tasks = [];
  return {
    tasks,
    TaskManager: {
      submit: task => { task.running = true; tasks.push(task); },
      cancelTasks: key => { for (const task of tasks) if (task.key === key) task.stop(); },
    },
    tick(count = 1) {
      for (let i = 0; i < count; i++) for (const task of tasks.slice()) if (task.isRunning()) task.tick();
    },
  };
}

function makePlayer() {
  const log = [];
  const messages = [];
  let blocked = false;
  const movement = { reset() { return movement; }, setBlockMovement(value) { blocked = value; return movement; }, addSteps: noop };
  const sender = new Proxy({}, { get: (_t, prop) => (...args) => { log.push([String(prop), ...args]); return sender; } });
  const player = {
    log, messages, blocked: () => blocked, chat: false,
    getDialogueManager: () => ({ isActive: () => player.chat }),
    isPlayer: () => true,
    getMovementQueue: () => movement,
    getPacketSender: () => sender,
    getLocation: () => new core.Location(2792, 3321, 0),
    setPositionToFace: noop,
    setUntargetable: noop,
    sendMessage: text => messages.push(text),
    performAnimation: animation => log.push(['anim', animation.getId()]),
    getUsername: () => 'sea-slug-scenes',
  };
  return player;
}

function load() {
  const clock = scheduler();
  const transcripts = [];
  const drops = [];
  const hooks = { kentDone: 0, panelOpened: 0 };
  const api = new Proxy({
    core: { ...core, TaskManager: clock.TaskManager },
    persistAttribute: noop,
    onPlayerLogin: noop,
    onCustomEvent: noop,
    emitCustomEvent: noop,
    getItemOnGroundManager: () => ({ registerLocation: (player, item, at) => drops.push([item.getId(), at.getX(), at.getY()]) }),
  }, { get: (target, key) => target[key] ?? noop });
  const original = runtime.startTranscript;
  runtime.startTranscript = (_api, player, npcId, page, variant, select) => {
    player.chat = true;
    transcripts.push({ npcId, page, variant, steps: select(runtime.loadTranscripts(api)[page].variants[variant]) });
    return true;
  };
  const file = require.resolve('../plugins/quests/seaslug/Scenes.SeaSlug');
  delete require.cache[file];
  let scenes;
  try {
    scenes = require(file)(api, { onKentDone: () => hooks.kentDone++, onPanelOpened: () => hooks.panelOpened++ });
  } finally {
    // The module bound startTranscript at load; keep the stub for its calls, restore for others.
    setImmediate(() => { runtime.startTranscript = original; });
  }
  return { clock, transcripts, drops, hooks, scenes };
}

function kentNpc() {
  const log = [];
  return {
    log,
    getLocation: () => new core.Location(2791, 3321, 0),
    performGraphic: graphic => log.push(['gfx', graphic.getId()]),
    performAnimation: animation => log.push(['anim', animation.getId()]),
  };
}

test('Kent calls the player back three ticks after his talk, then squashes the slug on the capture timeline', () => {
  const { clock, transcripts, drops, hooks, scenes } = load();
  const player = makePlayer();
  const kent = kentNpc();
  scenes.startKent(player, kent, core.NpcIdentifiers.KENT, KENT_VARIANT);
  assert.equal(player.blocked(), true, 'held from the talk to "Yuck! Thanks Kent." (busy 190-210)');

  clock.tick(2);
  assert.equal(transcripts.length, 0);
  clock.tick(1);
  const wait = transcripts.at(-1);
  assert.equal(wait.steps[0].text, '[player name] wait!', 'tick 199: "wait!"');
  assert.equal(wait.steps[1].id, scenes.MARK.KENT_GRAB);

  player.chat = false;
  const grab = { player, npc: kent, stepId: scenes.MARK.KENT_GRAB, handled: false };
  assert.equal(scenes.marker(grab), true);
  assert.deepEqual([grab.handled, grab.end], [true, true]);
  clock.tick(1);
  assert.deepEqual(kent.log, [['gfx', 790], ['anim', 4807]], 'tick 201: spotanim 790, seq 4807');
  assert.ok(player.log.some(row => row[0] === 'sendSound' && row[1] === 3025 && row[3] === 10), 'slug_scoop_slug, delay 10');
  clock.tick(2);
  assert.deepEqual(player.messages, ['*slooop*'], 'tick 203');
  clock.tick(2);
  assert.deepEqual(player.messages, ['*slooop*', 'He pulls a sea slug from under your top.'], 'tick 205');
  assert.equal(drops.length, 0);
  clock.tick(2);
  assert.deepEqual(drops, [[1466, 2792, 3321]], 'tick 207: the sea slug on the player tile');
  const last = transcripts.at(-1);
  assert.equal(last.steps[0].text, 'A few more minutes and that thing would have full control of your body.');
  assert.equal(last.steps[1].player, 'Yuck! Thanks Kent.');
  assert.equal(last.steps.at(-1).id, scenes.MARK.KENT_DONE);

  clock.tick(1);
  assert.equal(player.blocked(), true, 'still held while his last lines are up');
  player.chat = false;
  assert.equal(scenes.marker({ player, stepId: scenes.MARK.KENT_DONE, handled: false }), true);
  assert.equal(player.blocked(), false);
  assert.equal(hooks.kentDone, 1);
});

test('one Kick plays the kick with its three messages three ticks apart and opens the wall on the last', () => {
  const { clock, hooks, scenes } = load();
  const player = makePlayer();
  scenes.kickPanel(player);
  assert.ok(player.log.some(row => row[0] === 'anim' && row[1] === 4804), 'seaslug_human_kick');
  assert.ok(player.log.some(row => row[0] === 'sendSound' && row[1] === 3024), 'slug_kick_panel');
  assert.deepEqual(player.messages, ['You kick the loose panel.'], 'tick 334');
  scenes.kickPanel(player);
  assert.equal(player.messages.length, 1, 'a second click while kicking does nothing (tick 337)');
  clock.tick(3);
  assert.equal(player.messages.at(-1), 'The wood is rotten and crumbles away...', 'tick 337');
  assert.equal(hooks.panelOpened, 0);
  clock.tick(3);
  assert.equal(player.messages.at(-1), 'leaving an opening big enough for Kennith to climb through.', 'tick 340');
  assert.equal(hooks.panelOpened, 1, 'the stage moves with the last message');
  assert.equal(player.blocked(), false);
});

test('a logout mid-kick or before Kent calls back drops the pending steps', () => {
  const { clock, transcripts, hooks, scenes } = load();
  const kicker = makePlayer();
  scenes.kickPanel(kicker);
  scenes.interrupted({ player: kicker });
  clock.tick(6);
  assert.deepEqual(kicker.messages, ['You kick the loose panel.'], 'no later messages');
  assert.equal(hooks.panelOpened, 0, 'the wall does not open for a logged-out player');

  const waiting = makePlayer();
  scenes.startKent(waiting, kentNpc(), core.NpcIdentifiers.KENT, KENT_VARIANT);
  scenes.interrupted({ player: waiting });
  clock.tick(4);
  assert.equal(transcripts.length, 0, 'Kent does not call a logged-out player back');
});

test("Kent's line closed some other way (a teleport) releases the hold, and the stage-8 kick still works", () => {
  const { clock, transcripts, hooks, scenes } = load();
  const player = makePlayer();
  scenes.startKent(player, kentNpc(), core.NpcIdentifiers.KENT, KENT_VARIANT);
  clock.tick(3);
  assert.equal(transcripts.length, 1, '"wait!" is up');
  // TeleportHandler.onTeleporting -> sendInterfaceRemoval resets the dialogue: no marker runs.
  player.chat = false;
  clock.tick(1);
  assert.equal(player.blocked(), false, 'the hold goes with the chatbox');
  assert.equal(hooks.kentDone, 1);
  clock.tick(10);
  assert.equal(transcripts.length, 1, 'nothing more of the grab plays');

  scenes.kickPanel(player);
  clock.tick(6);
  assert.equal(player.messages.at(-1), 'leaving an opening big enough for Kennith to climb through.');
  assert.equal(hooks.panelOpened, 1, 'the kick is not blocked by a stale hold');
});
