// Run after `yarn build`: node --test tests/myreque-quiz-counting.test.cjs
// In Search of the Myreque: Curpile Fyod's quiz as the regenerated record plays it (osrsreboxed-db#108, commit
// f860dc1cdd2341f70f632bc211c8680a90a17503, docs/dialogues/df21aef518b8a716.json, sha256 09fabadb...698a): a counted
// random of three of six questions, then four count conditions. PROSPECTIVE: this reads the ids from
// data/definitions/npc-dialogues.json, which only has the new quiz after that record is imported; against the old data it
// fails on purpose (the hosted job overlays the shard into a temporary copy, job-only, never committed).
const assert = require('node:assert/strict');
const path = require('node:path');
const { before, after, test } = require('node:test');
require('../dist/Server').Server.installProductionPathResolver();
const { CachePipeline } = require('../dist/game/cache/CachePipeline');
const { PluginManager: PM } = require('../dist/plugins/PluginManager');
const { Player } = require('../dist/game/entity/impl/player/Player');
const { PlayerSession } = require('../dist/net/PlayerSession');

const STAGE = 'quest.in_search_of_the_myreque.stage';
const QUESTIONED = 52, ANSWERED = 55;
const PREFIX = 'Okay, [first/second/third and final] question. ';
let core, next = 2900;
before(async () => {
  await CachePipeline.initialize(path.resolve(__dirname, '..'));
  PM.loadFromDirectory(path.resolve(__dirname, '../plugins')); core = PM.getCoreApi();
  PM.emitServerStartup({});
});
after(() => PM.emitServerShutdown({}));

const conversation = () => require('../data/definitions/npc-dialogues.json')['In Search of the Myreque']
  .variants['convincing-curpile-fyod-talking-to-curpile-fyod'];
function find(node, pred, out = []) {
  if (Array.isArray(node)) { for (const v of node) find(v, pred, out); return out; }
  if (!node || typeof node !== 'object') return out;
  if (pred(node)) out.push(node);
  for (const v of Object.values(node)) find(v, pred, out);
  return out;
}
const random = () => find(conversation(), (n) => n.type === 'random')[0];
const question = (n) => random().options[n].steps[0].text.slice(PREFIX.length);
const optionsOf = (n) => random().options[n].steps[1].options.map((o) => o.text);
const CORRECT = ['Sani Piliu.', 'Ivan Strom.', 'Veliaf Hurtz.', 'Polmafi Ferdygris.', 'Cyreg Paddlehorn.', 'Drakan.'];
const wrongOf = (n) => optionsOf(n).find((text) => text !== CORRECT[n]);

function actor(t, stage) {
  const channel = { kind: 'test', remoteAddress: '127.0.0.1', isOpen: () => true, send: () => true, close() {}, onData() {}, onError() {}, onClose() {}, flush() {} };
  const p = new Player(new PlayerSession(channel)); p.setIndex(next++); p.setUsername('myrequeq' + next);
  p.setRegistered(true); p.setLocation(new core.Location(3507, 3439, 0)); p.needsPlacement = false;
  p.setAttribute(STAGE, stage);
  t.after(() => { p.setRegistered(false); core.TaskManager.cancelTasks(p.getIndex()); });
  return p;
}
const npcId = () => core.NpcIdentifiers.CURPILE_FYOD;
const condition = (text) => find(conversation(), (n) => n.type === 'condition' && n.text === `If the player answered ${text} out of three questions correctly:`)[0];
const knockout = (n) => find(conversation(), (x) => x.type === 'message' && x.text === "Curpile knocks you out and takes you back to Mort'ton.")[n];

/** One attempt: draw d (0-based question numbers) answered right or wrong by `rights`. */
function attempt(p, questions, rights) {
  questions.forEach((q, i) => {
    PM.emitCustomEvent('npc-dialogue:draw', { player: p, npcId: npcId(), draw: i + 1, count: 3, text: `Dialogue ${q + 1}`, question: random().options[q].steps[0].text });
    PM.emitCustomEvent('npc-dialogue:choice', { player: p, npcId: npcId(), option: rights[i] ? CORRECT[q] : wrongOf(q) });
  });
}
const answers = (p, words) => {
  const step = condition(words);
  return PM.emitNpcDialogueCondition({ player: p, npcId: npcId(), text: step.text, stepId: step.id });
};

test('the ids the plugin binds exist in the dialogue file (a stale id fails loudly)', () => {
  assert.equal(random().count, 3);
  assert.equal(random().non_repeating, true);
  assert.equal(random().options.length, 6);
  for (const [words, id] of [['zero', 'A6wXnN'], ['one', 'arNFa2'], ['two', 'K8_P_w'], ['three', 'p493oV']]) assert.equal(condition(words)?.id, id, words);
  assert.deepEqual([0, 1, 2].map((n) => knockout(n)?.id), ['HQfMkY', 'XmM1Px', 'k1iShr']);
  for (let n = 0; n < 6; n++) assert.ok(optionsOf(n).includes(CORRECT[n]), question(n));
});

test('three correct answers pass: the three-of-three condition is true and moves the quest to 55', (t) => {
  const p = actor(t, QUESTIONED);
  attempt(p, [1, 4, 5], [true, true, true]);
  assert.equal(answers(p, 'three'), true);
  for (const words of ['zero', 'one', 'two']) assert.equal(answers(p, words), false, words);
  const pass = condition('three');
  PM.emitCustomEvent('npc-dialogue:condition', { player: p, npcId: npcId(), text: pass.text, stepId: pass.id });
  assert.equal(p.getAttribute(STAGE), ANSWERED);
});

test('zero, one and two correct answers select their own result and the matching knock-out sends the player to Mort\'ton', (t) => {
  for (const [rights, words, which] of [[[false, false, false], 'zero', 0], [[true, false, false], 'one', 1], [[true, true, false], 'two', 2]]) {
    const p = actor(t, QUESTIONED);
    attempt(p, [0, 2, 3], rights);
    for (const w of ['zero', 'one', 'two', 'three']) assert.equal(answers(p, w), w === words, `${words}: ${w}`);
    const step = knockout(which);
    PM.emitCustomEvent('npc-dialogue:action', { player: p, npcId: npcId(), step, text: step.text, stepId: step.id, handled: false });
    const at = p.getLocation();
    assert.deepEqual([at.getX(), at.getY(), at.getZ()], [3522, 3285, 0], words);
    assert.equal(p.getAttribute(STAGE), QUESTIONED, 'a failed attempt leaves the stage');
  }
});

test('a second attempt starts again from zero (draw 1 resets the counter)', (t) => {
  const p = actor(t, QUESTIONED);
  attempt(p, [0, 1, 2], [true, true, true]);
  assert.equal(answers(p, 'three'), true);
  attempt(p, [3, 4, 5], [false, true, false]);
  assert.equal(answers(p, 'one'), true, 'only this attempt counts');
  assert.equal(answers(p, 'three'), false);
});

test("the refusal stays a menu option with its own lines: \"I don't have to answer to you!\" is option 2 of 5", () => {
  const menu = find(conversation(), (n) => n.type === 'choice')[0];
  assert.equal(menu.options.length, 5);
  assert.equal(menu.options[1].text, "I don't have to answer to you!");
  const lines = menu.options[1].steps.map((s) => s.text ?? s.player);
  assert.deepEqual(lines, ["I don't have to answer to you!", "You do if you know what's good for you!", 'Curpile hits the player for 3 damage.']);
});

test('only Curpile\'s draws score: another speaker\'s choice is not counted', (t) => {
  const p = actor(t, QUESTIONED);
  PM.emitCustomEvent('npc-dialogue:draw', { player: p, npcId: npcId(), draw: 1, count: 3, text: 'Dialogue 1', question: random().options[0].steps[0].text });
  PM.emitCustomEvent('npc-dialogue:choice', { player: p, npcId: core.NpcIdentifiers.VELIAF_HURTZ, option: CORRECT[0] });
  assert.equal(answers(p, 'zero'), true);
});
