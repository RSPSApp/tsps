// Run after `yarn build`: node --test tests/myreque-slice2.test.cjs
// In Search of the Myreque (#5488 follow-ups), plugin side, through the real dialogue runtime and the real plugin:
// (1) the Hair of the Dog's stranger is one spawn (cache NPC 6269) that shows Vanstrom while varbit 396 is 0 and the plain
//     Stranger when it is 1; void sets thsfm_vanstrom_hide (396) at the weapons hand-over (VeliafHurtz.kt:177-180):
//     Wiki/void-based, no capture;
// (2) the first conversation with a Myreque member plays the first-time intro only, not "If speaking again" as well.
const assert = require('node:assert/strict');
const path = require('node:path');
const { before, after, test } = require('node:test');
require('../dist/Server').Server.installProductionPathResolver();
const { CachePipeline } = require('../dist/game/cache/CachePipeline');
const { PluginManager: PM } = require('../dist/plugins/PluginManager');
const { Player } = require('../dist/game/entity/impl/player/Player');
const { PlayerSession } = require('../dist/net/PlayerSession');
const { startDialogue } = require('../plugins/npcs/NpcDialogues.plugin');
const { CacheDefinitions } = require('../dist/game/cache/CacheDefinitions');

const STAGE = 'quest.in_search_of_the_myreque.stage';
const MET_VELIAF = 65, WEAPONS_ACCEPTED = 67, DELIVERED_WEAPONS = 70;
let core, next = 3000;
before(async () => {
  await CachePipeline.initialize(path.resolve(__dirname, '..'));
  PM.loadFromDirectory(path.resolve(__dirname, '../plugins')); core = PM.getCoreApi();
  PM.emitServerStartup({});
});
after(() => PM.emitServerShutdown({}));

function actor(t, stage) {
  const channel = { kind: 'test', remoteAddress: '127.0.0.1', isOpen: () => true, send: () => true, close() {}, onData() {}, onError() {}, onClose() {}, flush() {} };
  const p = new Player(new PlayerSession(channel)); p.setIndex(next++); p.setUsername('myreques2' + next);
  p.setRegistered(true); p.setLocation(new core.Location(3508, 9838, 0)); p.needsPlacement = false;
  p.setAttribute(STAGE, stage);
  t.after(() => { p.setRegistered(false); core.TaskManager.cancelTasks(p.getIndex()); });
  return p;
}
const dialogues = (page = 'In Search of the Myreque') => require('../data/definitions/npc-dialogues.json')[page];

/** One conversation through the real runtime and plugin; returns the lines said until the first menu. */
function talk(player, npcId, name, variant, page = 'In Search of the Myreque') {
  const said = [];
  const dialoguePlayer = Object.create(player);
  dialoguePlayer.getDialogueManager = () => ({
    reset() {},
    startDialogues(chain) {
      for (const entry of [...chain.getDialogues().values()].sort((a, b) => a.getIndex() - b.getIndex())) {
        if (entry.text) said.push(String(entry.text));
        try { entry.send(dialoguePlayer); } catch { /* unwired dialogue entries are fine here */ }
      }
    },
  });
  const api = { emitCustomEvent: (name, payload) => PM.emitCustomEvent(name, payload), sendMultiChatboxPrompt() { return true; } };
  const definition = { getName: () => name, getId: () => npcId };
  const event = { player: dialoguePlayer, npc: { getId: () => npcId }, npcId, definition };
  startDialogue(api, event, dialogues(page).variants[variant], {}, { player: dialoguePlayer, npc: event.npc, npcId, definition, pages: [] });
  return said;
}

const MEMBERS = [
  ['Sani Piliu', 'sani-piliu', () => core.NpcIdentifiers.SANI_PILIU, /Very nice to meet you/, /Nice to see you again/],
  ['Harold Evans', 'harold-evans', () => core.NpcIdentifiers.HAROLD_EVANS, /Forgive me if I seem cautious/, /What can I do for you/],
  ['Ivan Strom', 'ivan-strom', () => core.NpcIdentifiers.IVAN_STROM, /Veliaf said that I should introduce myself/, /Oh, hello again/],
  ['Radigad Ponfit', 'radigad-ponfit', () => core.NpcIdentifiers.RADIGAD_PONFIT, /introduced yourself to Veliaf/, /Hello again/],
  ['Polmafi Ferdygris', 'polmafi-ferdygris', () => core.NpcIdentifiers.POLMAFI_FERDYGRIS, /introduced yourself to Veliaf/, /Salutations/],
];
for (const [name, slug, id, intro, greeting] of MEMBERS) {
  test(`${name}: the first conversation plays the intro only, the second the greeting only`, (t) => {
    const p = actor(t, MET_VELIAF);
    const variant = `myreque-hideout-speaking-to-myreque-members-${slug}`;
    const first = talk(p, id(), name, variant);
    assert.ok(first.some((line) => intro.test(line)), `intro in the first talk: ${first.join(' | ')}`);
    assert.ok(!first.some((line) => greeting.test(line)), `no 'speaking again' branch in the first talk: ${first.join(' | ')}`);
    const second = talk(p, id(), name, variant);
    assert.ok(!second.some((line) => intro.test(line)), `no intro in the second talk: ${second.join(' | ')}`);
    assert.ok(second.some((line) => greeting.test(line)), `the greeting in the second talk: ${second.join(' | ')}`);
  });
}

const runtime = require('../plugins/quests/QuestRuntime');
const questHandle = () => runtime.getRegisteredQuests().find((q) => q.name === 'In Search of the Myreque');
const resolvedAt6269 = (p) => CacheDefinitions.resolveNpc(6269, { getVarbit: (id) => p.getPacketSender().getVarbit(id), getVarp: () => 0 }).name;

test('the weapons hand-over moves the stage to 67; the cutscene that follows moves it to 70 and varbit 396 to 1: the pub shows the plain Stranger', (t) => {
  // Revision-242 capture: 67 with "You give the weapons to Veliaf." (tick 1295), 70 and varbit 396 as the cutscene starts (1301).
  const p = actor(t, MET_VELIAF);
  const { ItemIdentifiers: I } = core;
  assert.equal(p.getPacketSender().getVarbit(396), 0);
  assert.equal(resolvedAt6269(p), 'Vanstrom Klause');
  for (const [item, amount] of [[I.STEEL_LONGSWORD, 1], [I.STEEL_SHORTSWORD, 2], [I.STEEL_DAGGER, 1], [I.STEEL_MACE, 1], [I.STEEL_WARHAMMER, 1]]) p.getInventory().adds(item, amount);
  const message = { player: p, npcId: core.NpcIdentifiers.VELIAF_HURTZ_2, text: 'You give the weapons to Veliaf.', stepId: 'OVBQEv', kind: 'message', handled: false };
  PM.emitCustomEvent('npc-dialogue:action', message);
  assert.equal(p.getAttribute(STAGE), WEAPONS_ACCEPTED);
  assert.equal(p.getInventory().getAmount(I.STEEL_LONGSWORD), 0, 'the weapons go');
  assert.equal(p.getPacketSender().getVarbit(396), 0, 'Vanstrom is still in the pub');
  const thanks = { player: p, npcId: core.NpcIdentifiers.VELIAF_HURTZ_2, text: 'These weapons look great! Many thanks.', skip: false };
  PM.emitCustomEvent('npc-dialogue:line', thanks);
  assert.equal(thanks.pauseTicks, 9);
  thanks.after();
  for (let i = 0; i < 3; i++) core.TaskManager.process();
  assert.equal(p.getAttribute(STAGE), DELIVERED_WEAPONS);
  assert.equal(p.getPacketSender().getVarbit(396), 1);
  assert.equal(resolvedAt6269(p), 'Stranger');
});

test('every stage change re-derives varbit 396: a jump forward shows the Stranger, a reset below 70 shows Vanstrom again', (t) => {
  const p = actor(t, MET_VELIAF);
  questHandle().setStage(p, 85);
  assert.equal(p.getPacketSender().getVarbit(396), 1);
  assert.equal(resolvedAt6269(p), 'Stranger');
  questHandle().setStage(p, MET_VELIAF);
  assert.equal(p.getPacketSender().getVarbit(396), 0);
  assert.equal(resolvedAt6269(p), 'Vanstrom Klause');
});

test('login re-sends varbit 396 from the stage: 0 below 70, 1 from 70 on', (t) => {
  for (const [stage, expected] of [[MET_VELIAF, 0], [WEAPONS_ACCEPTED, 0], [DELIVERED_WEAPONS, 1], [85, 1], [97, 1], [105, 1]]) {
    const p = actor(t, stage);
    PM.emitPlayerLogin({ player: p, username: p.getUsername() });
    assert.equal(p.getPacketSender().getVarbit(396), expected, `stage ${stage}`);
    assert.equal(resolvedAt6269(p), expected ? 'Stranger' : 'Vanstrom Klause', `stage ${stage}`);
  }
});

const ask = (p, npcId, text) => PM.emitNpcDialogueCondition({ player: p, npcId, text, stepId: null });
const firstTimeBranch = (p, npcId, stepId) => PM.emitCustomEvent('npc-dialogue:condition', { player: p, npcId, text: 'If first time speaking:', stepId });

test('a conversation cannot observe its own flag, and the tail judgement consumes the note (first conversation, then a second)', (t) => {
  const p = actor(t, MET_VELIAF);
  const sani = core.NpcIdentifiers.SANI_PILIU;
  assert.equal(ask(p, sani, 'If first time speaking:'), true);
  // the runtime then reports the chosen first-time branch (the plugin marks the member as met) ...
  firstTimeBranch(p, sani, 'C5YuIy');
  // ... and judges the sibling in the same conversation: not "speaking again" yet (and that judgement uses the note up)
  assert.equal(ask(p, sani, 'If speaking again:'), false);
  // the next conversation
  assert.equal(ask(p, sani, 'If first time speaking:'), false);
  assert.equal(ask(p, sani, 'If speaking again:'), true);
});

test('the maintainer repro: stage 85, Veliaf first-time page played, stage 105, a page that asks only "speaking again" (In Aid job offer) gets true', (t) => {
  const p = actor(t, 85);
  const veliaf = core.NpcIdentifiers.VELIAF_HURTZ_2;
  assert.equal(ask(p, veliaf, 'If first time speaking:'), true);
  firstTimeBranch(p, veliaf, 'a8YEIJ');
  assert.equal(ask(p, veliaf, 'If speaking again:'), false, 'the tail judgement of the same conversation');
  questHandle().setStage(p, 105);
  assert.equal(ask(p, veliaf, 'If speaking again:'), true, "In Aid's page, asked on its own");
});

test('an intro abandoned before its tail judgement: a stage change of the quest, and a login, drop the note', (t) => {
  for (const reset of [(p) => questHandle().setStage(p, 105), (p) => PM.emitPlayerLogin({ player: p, username: p.getUsername() })]) {
    const p = actor(t, 85);
    const veliaf = core.NpcIdentifiers.VELIAF_HURTZ_2;
    assert.equal(ask(p, veliaf, 'If first time speaking:'), true);
    firstTimeBranch(p, veliaf, 'a8YEIJ'); // no tail judgement: the player walked away
    reset(p);
    assert.equal(ask(p, veliaf, 'If speaking again:'), true);
  }
});

test('the first-time branch that itself moves the stage (the fifth member, Veliaf after the hellhound) still skips "speaking again" in its own conversation', (t) => {
  const p = actor(t, 85);
  const veliaf = core.NpcIdentifiers.VELIAF_HURTZ_2;
  assert.equal(ask(p, veliaf, 'If first time speaking:'), true);
  firstTimeBranch(p, veliaf, 'a8YEIJ');
  // The branch's own "That's very useful. Thanks." moves the stage 85 -> 90 (capture tick 1502); the note survives it.
  const thanks = { player: p, npcId: veliaf, text: "That's very useful. Thanks.", skip: false };
  PM.emitCustomEvent('npc-dialogue:line', thanks);
  thanks.after(); // the player continues past it
  assert.equal(p.getAttribute(STAGE), 90);
  assert.equal(ask(p, veliaf, 'If speaking again:'), false);
});
