// Run after `yarn build`: node --test tests/icthlarin-step-ids.test.cjs
// Icthlarin's Little Helper: the plugin answered five steps by ids the regenerated npc-dialogues.json no longer
// has, so handing the Sphinx's token to the High Priest never took it or moved the quest on, and a wrong riddle
// answer never cost the cat. The steps are found here by their text in the current JSON and sent through the
// real dialogue action event.
const assert = require('node:assert/strict');
const path = require('node:path');
const { before, after, test } = require('node:test');
require('../dist/Server').Server.installProductionPathResolver();
const { CachePipeline } = require('../dist/game/cache/CachePipeline');
const { PluginManager: PM } = require('../dist/plugins/PluginManager');
const { Player } = require('../dist/game/entity/impl/player/Player');
const { PlayerSession } = require('../dist/net/PlayerSession');

const STAGE = 'quest.ictlharins_little_helper.stage';
const BITS = 'quest.ictlharins_little_helper.bits';
const CAT_LOST = 1 << 5;
const TOKEN = 4691, CAT = 1561;
const TALK_SPHINX = 5, TALK_HIGH_PRIEST = 6, FLASHBACK_2 = 7;
let core, next = 2900;
// Every transcript a quest starts, with its selector, so the riddle can be read as the player is shown it.
const started = [];
before(async () => {
  const runtime = require('../plugins/quests/QuestRuntime');
  const startTranscript = runtime.startTranscript;
  runtime.startTranscript = (api, player, npcId, page, variant, select, ...rest) => {
    started.push({ page, variant, select });
    return startTranscript(api, player, npcId, page, variant, select, ...rest);
  };
  await CachePipeline.initialize(path.resolve(__dirname, '..'));
  PM.loadFromDirectory(path.resolve(__dirname, '../plugins')); core = PM.getCoreApi();
  PM.emitServerStartup({});
});
after(() => PM.emitServerShutdown({}));

const page = () => require('../data/definitions/npc-dialogues.json')["Icthlarin's Little Helper"];
function steps(node, pred, out = []) {
  if (Array.isArray(node)) { for (const v of node) steps(v, pred, out); return out; }
  if (!node || typeof node !== 'object') return out;
  if (pred(node)) out.push(node);
  for (const v of Object.values(node)) steps(v, pred, out);
  return out;
}

function actor(t, stage, items) {
  const channel = { kind: 'test', remoteAddress: '127.0.0.1', isOpen: () => true, send: () => true, close() {}, onData() {}, onError() {}, onClose() {} };
  const p = new Player(new PlayerSession(channel)); p.setIndex(next++); p.setUsername('icsxtest' + next);
  p.setRegistered(true); p.setLocation(new core.Location(3290, 2780, 0)); p.needsPlacement = false;
  p.setAttribute(STAGE, stage);
  for (const [id, n] of items) p.getInventory().add(new core.Item(id, n), true);
  t.after(() => { p.setRegistered(false); core.TaskManager.cancelTasks(p.getIndex()); });
  return p;
}
const act = (p, step) => { const e = { player: p, step, text: step.text, stepId: step.id, handled: false }; PM.emitCustomEvent('npc-dialogue:action', e); return e; };

test('handing the token to the High Priest takes it and moves the quest to the second flashback', (t) => {
  const [step] = steps(page(), (n) => n.text === 'You hand the token to the High Priest.');
  assert.ok(step?.id);
  const p = actor(t, TALK_HIGH_PRIEST, [[TOKEN, 1]]);
  act(p, step);
  assert.equal(p.getInventory().getAmount(TOKEN), 0);
  assert.equal(p.getAttribute(STAGE), FLASHBACK_2);
});

test("the cat running away loses the cat", (t) => {
  const [runs] = steps(page(), (n) => n.type === 'action' && n.text === "The player's cat runs away.");
  const p = actor(t, TALK_SPHINX, [[CAT, 1]]);
  assert.equal(act(p, runs).handled, true, runs.id);
  assert.equal(p.getInventory().getAmount(CAT), 0);
  assert.ok((p.getAttribute(BITS) & CAT_LOST) !== 0);
});

// Wiki (Icthlarin's Little Helper): 7, 12 and 14 are wrong; each asks "Are you sure?", "Totally positive." loses the
// cat and "I don't know. I don't want to risk my cat." leaves it. The dump gives 12 and 14 only a "Same as answering
// 7" action, so they play answer 7's steps; picking them takes nothing by itself.
test("riddle answers 12 and 14 ask 'Are you sure?' like 7: confirming loses the cat, the exit keeps it", (t) => {
  const p = actor(t, TALK_SPHINX, [[CAT, 1]]);
  const npc = new core.NPC(core.NpcIdentifiers.SPHINX, new core.Location(3290, 2781, 0));
  started.length = 0;
  assert.equal(PM.emitNpcInteraction({ player: p, npc, npcId: npc.getId(), npcIndex: npc.getIndex(), clickType: 1,
    location: { x: 3290, y: 2781, z: 0 }, handled: false }), true, 'Talk-to the Sphinx plays the riddle');
  const riddle = started.find((s) => /asking-the-sphinx-for-help/.test(s.variant));
  assert.ok(riddle?.select, 'the riddle transcript and its selector');
  const shown = riddle.select(page().variants[riddle.variant]);
  const [answers] = steps(shown, (n) => n.type === 'choice' && (n.options ?? []).some((o) => o.text === '12.'));
  const option = (text) => answers.options.find((o) => o.text === text);
  const seven = JSON.stringify(option('7.').steps.slice(1));
  for (const text of ['12.', '14.']) {
    const own = option(text).steps;
    assert.deepEqual(own[0], { player: text }, `${text} says its own answer`);
    assert.equal(JSON.stringify(own.slice(1)), seven, `${text} plays answer 7's flow`);
    assert.ok(steps(own, (n) => n.text === 'Are you sure?').length === 1, `${text}: Are you sure?`);
    assert.ok(steps(own, (n) => n.text === "I don't know. I don't want to risk my cat.").length === 1, `${text}: the exit`);
    assert.ok(!steps(own, (n) => n.text === 'Same as answering 7 (incorrect answer)').length, `${text}: no instant loss`);
  }

  const choose = (who, text) => PM.emitCustomEvent('npc-dialogue:choice', { player: who, npc, npcId: npc.getId(), option: text });
  const lost = (who) => (who.getAttribute(BITS) & CAT_LOST) !== 0;
  for (const text of ['12.', '14.']) {
    const keeper = actor(t, TALK_SPHINX, [[CAT, 1]]);
    choose(keeper, text);
    assert.equal(keeper.getInventory().getAmount(CAT), 1, `${text}: picking it takes nothing yet`);
    choose(keeper, "I don't know. I don't want to risk my cat.");
    assert.equal(keeper.getInventory().getAmount(CAT), 1, `${text}: the exit keeps the cat`);
    assert.equal(lost(keeper), false);

    const loser = actor(t, TALK_SPHINX, [[CAT, 1]]);
    choose(loser, text);
    choose(loser, 'Totally positive.');
    assert.equal(loser.getInventory().getAmount(CAT), 0, `${text}: confirming loses the cat`);
    assert.equal(lost(loser), true);
  }
  core.World.getNpcs?.().remove?.(npc);
});
