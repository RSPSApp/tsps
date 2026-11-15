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

test('the weapons hand-over moves the stage to 70 and varbit 396 to 1: the pub shows the plain Stranger, not Vanstrom', (t) => {
  const p = actor(t, WEAPONS_ACCEPTED);
  const { ItemIdentifiers: I } = core;
  assert.equal(p.getPacketSender().getVarbit(396), 0);
  assert.equal(resolvedAt6269(p), 'Vanstrom Klause');
  for (const [item, amount] of [[I.STEEL_LONGSWORD, 1], [I.STEEL_SHORTSWORD, 2], [I.STEEL_DAGGER, 1], [I.STEEL_MACE, 1], [I.STEEL_WARHAMMER, 1]]) p.getInventory().adds(item, amount);
  PM.emitCustomEvent('npc-dialogue:condition', { player: p, npcId: core.NpcIdentifiers.VELIAF_HURTZ_2, text: 'x', stepId: 'VLPyT3' });
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

test('a conversation cannot observe its own flag, and a new conversation starts without its predecessor\'s note (abandoned intro, then a new conversation)', (t) => {
  const p = actor(t, MET_VELIAF);
  const sani = core.NpcIdentifiers.SANI_PILIU;
  const ask = (text) => PM.emitNpcDialogueCondition({ player: p, npcId: sani, text, stepId: null });
  const begin = () => PM.emitCustomEvent('npc-dialogue:begin', { player: p, npcId: sani });
  begin();
  assert.equal(ask('If first time speaking:'), true);
  // the runtime then reports the chosen first-time branch (the plugin marks the member as met) ...
  PM.emitCustomEvent('npc-dialogue:condition', { player: p, npcId: sani, text: 'If first time speaking:', stepId: 'C5YuIy' });
  // ... and judges the sibling in the same conversation: not "speaking again" yet
  assert.equal(ask('If speaking again:'), false);
  // the intro was abandoned; the next conversation begins, so the member now counts as met
  begin();
  assert.equal(ask('If first time speaking:'), false);
  assert.equal(ask('If speaking again:'), true);
});

test('Veliaf: the after-hellhound first-time page does not make a later conversation, in the same session, skip "speaking again" (stage 85 -> 105)', (t) => {
  const p = actor(t, 85);
  const veliaf = core.NpcIdentifiers.VELIAF_HURTZ_2;
  const first = talk(p, veliaf, 'Veliaf Hurtz', 'myreque-hideout-after-defeating-the-skeleton-hellhound-veliaf-hurtz');
  assert.ok(first.some((line) => /Sani\.\.\. Harold\.\.\./.test(line)), `the first-time page: ${first.join(' | ')}`);
  assert.ok(!first.includes('Need something?'), 'no "speaking again" in the first conversation');
  questHandle().setStage(p, 105);
  // another quest's page, as In Aid's job offer is: only "If speaking again" is asked, in a conversation of its own
  const again = talk(p, veliaf, 'Veliaf Hurtz', 'the-myreque-s-job-offer-veliaf-hurtz', 'In Aid of the Myreque');
  const asked = PM.emitNpcDialogueCondition({ player: p, npcId: veliaf, text: 'If speaking again:', stepId: 'KOQqfF' });
  assert.equal(asked, true, `'If speaking again:' for Veliaf after a conversation of its own; lines: ${again.join(' | ')}`);
});
