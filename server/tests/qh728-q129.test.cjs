// From server/: node --test tests/qh728-q129.test.cjs
// Learning the Ropes has no Quest Helper equivalent. These focus on the source contract it
// owns: mirror the tutorial varp 281 (cache quest 9643, completion threshold 671) into the
// durable quest stage, complete once at 671, and keep the wire and saved stage together when
// the tutorial jumps past the threshold in one step (the island skip / quiet login resync).
const assert = require('node:assert/strict');
const { test } = require('node:test');
require('../dist/Server').Server.installProductionPathResolver();

require('node:test').before(async () => {
  await require('../dist/game/cache/CachePipeline').CachePipeline.initialize(
    require('node:path').resolve(__dirname, '..'));
});

const T = require('../plugins/areas/tutorialisland/Common.TutorialIsland');
const runtime = require('../plugins/quests/QuestRuntime');

function createHarness() {
  const loginHandlers = [];
  const events = new Map();
  const api = {
    core: {},
    persistAttribute() {},
    onPlayerLogin(handler) {
      loginHandlers.push(handler);
    },
    onCustomEvent(name, handler) {
      const list = events.get(name) ?? [];
      list.push(handler);
      events.set(name, list);
    },
    onInterfaceActionButton() {},
    emitCustomEvent(name, event) {
      for (const handler of events.get(name) ?? []) handler(event);
    },
  };
  T.init(api);
  require('../plugins/quests/quests/LearningTheRopes.Quest')(api);
  return { loginHandlers, quest: runtime.getRegisteredQuests().at(-1) };
}

const harness = createHarness();
const WIRE_VARP = 281;
const COMPLETION = 671;

function makePlayer(tutorialProgress) {
  const attributes = new Map();
  const varps = [];
  const messages = [];
  const jingles = [];
  const sender = new Proxy(
    {},
    {
      get: (_target, key) => (...args) => {
        if (key === 'sendConfig') varps.push([args[0], args[1]]);
        if (key === 'sendJingle') jingles.push(args[0]);
        return sender;
      },
    },
  );
  if (tutorialProgress !== undefined) attributes.set(T.PROGRESS_ATTRIBUTE, tutorialProgress);
  const player = {
    getAttribute: (key) => attributes.get(key),
    setAttribute: (key, value) => {
      if (value === null || value === undefined) attributes.delete(key);
      else attributes.set(key, value);
    },
    isPlayerBot: () => false,
    isRegistered: () => true,
    getPacketSender: () => sender,
    getDialogueManager: () => ({ isActive: () => false }),
    sendMessage: (text) => messages.push(text),
  };
  return { player, varps, messages, jingles };
}

function login(h, player) {
  for (const handler of h.loginHandlers) handler({ player });
}

function wire(player) {
  const sent = player.varps.filter(([id]) => id === WIRE_VARP).map(([, value]) => value);
  return sent.at(-1);
}

function questPoints(player) {
  return Number(player.player.getAttribute('quest.points')) || 0;
}

test('a fresh stage 0 account stays unstarted and uncompleted', () => {
  const p = makePlayer();
  login(harness, p.player);
  assert.equal(harness.quest.getStage(p.player), 0);
  assert.equal(harness.quest.isStarted(p.player), false);
  assert.equal(harness.quest.isComplete(p.player), false);
  assert.equal(questPoints(p), 0);
  assert.equal(wire(p), 0, 'login still resets the shared tutorial varp to the saved stage');
});

test('a new account at the past-experience step starts the quest on varp 281', () => {
  const p = makePlayer(T.STEP.PAST_EXPERIENCE);
  login(harness, p.player);
  assert.equal(harness.quest.getStage(p.player), 1);
  assert.equal(harness.quest.isStarted(p.player), true);
  assert.equal(harness.quest.isComplete(p.player), false);
  assert.equal(questPoints(p), 0);
  assert.equal(wire(p), 1);
});

test('an early tutorial login tracks the step without completing the quest', () => {
  const p = makePlayer(T.STEP.CAST_WIND_STRIKE);
  login(harness, p.player);
  assert.equal(harness.quest.getStage(p.player), 650);
  assert.equal(harness.quest.isComplete(p.player), false);
  assert.equal(questPoints(p), 0);
  assert.equal(wire(p), 650);
});

test('the Wind Strike hand-off completes once at 671 and follows later steps', () => {
  const p = makePlayer(T.STEP.CAST_WIND_STRIKE);
  login(harness, p.player);

  // The exact two advances Combat.TutorialIsland makes: 650 -> 670 on the hit, 670 -> 671 a tick later.
  assert.equal(T.advanceFrom(p.player, T.STEP.CAST_WIND_STRIKE, T.STEP.WIND_STRIKE_CAST), true);
  assert.equal(harness.quest.getStage(p.player), 670);
  assert.equal(harness.quest.isComplete(p.player), false, '670 is below the cache completion threshold');
  assert.equal(questPoints(p), 0);

  assert.equal(T.advanceFrom(p.player, T.STEP.WIND_STRIKE_CAST, T.STEP.LEAVE_TALK), true);
  assert.equal(COMPLETION, T.STEP.LEAVE_TALK, 'the cache threshold is the tutorial hand-off step');
  assert.equal(harness.quest.getStage(p.player), 671);
  assert.equal(harness.quest.isComplete(p.player), true);
  assert.equal(questPoints(p), 1);
  assert.equal(wire(p), 671);
  assert.ok(p.messages.some((text) => text.includes('Learning the Ropes')));
  assert.equal(p.jingles.length, 1);

  // 671 -> 680 is the Magic Instructor's "Yes."; the quest stays complete and the stage follows.
  assert.equal(T.advanceFrom(p.player, T.STEP.LEAVE_TALK, T.STEP.HOME_TELEPORT), true);
  assert.equal(harness.quest.getStage(p.player), 680);
  assert.equal(harness.quest.isComplete(p.player), true);
  assert.equal(questPoints(p), 1);
  assert.equal(p.jingles.length, 1, 'no second completion');
  assert.equal(wire(p), 680);
});

test('a one-step jump to completed (the island skip) saves and sends the final tutorial value', () => {
  const p = makePlayer(T.STEP.GIELINOR_TALK);
  login(harness, p.player);
  assert.equal(harness.quest.getStage(p.player), 2);

  // Leave.TutorialIsland.complete() ends the island with T.setProgress(player, STEP.COMPLETED).
  T.setProgress(p.player, T.STEP.COMPLETED);

  assert.equal(harness.quest.getStage(p.player), 1000, 'the durable stage follows the tutorial, not the threshold');
  assert.equal(harness.quest.isComplete(p.player), true);
  assert.equal(questPoints(p), 1);
  assert.equal(wire(p), 1000, 'the last wire value is the tutorial progress, not a stale 671');
  assert.equal(p.jingles.length, 1);
});

test('login replay quietly completes a legacy tutorial save exactly once', () => {
  const p = makePlayer(T.STEP.COMPLETED);
  login(harness, p.player);
  assert.equal(harness.quest.getStage(p.player), 1000);
  assert.equal(harness.quest.isComplete(p.player), true);
  assert.equal(questPoints(p), 1);
  assert.equal(wire(p), 1000);
  assert.equal(p.jingles.length, 0, 'a login resync does not replay the completion scroll/jingle');
  assert.equal(p.messages.some((text) => text.includes('Congratulations, you\'ve completed a quest')), false);

  login(harness, p.player);
  assert.equal(questPoints(p), 1, 'relogin does not award the quest point again');
  assert.equal(harness.quest.getStage(p.player), 1000);
  assert.equal(wire(p), 1000);
});
