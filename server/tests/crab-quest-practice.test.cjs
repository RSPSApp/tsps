// Crab Quest's band at practice (issue #6916): Talk-to on a practising crab, the shy crab by
// the chest, and the crab_bass varbit that dresses the main crab's instrument. Against RSProx
// capture 20261103T014803-ee79c12 (revision 241) and the Wiki's "Crab Quest" transcript.
const assert = require('node:assert/strict');
const path = require('node:path');
const { before, test } = require('node:test');
const { Server } = require('../dist/Server');
Server.installProductionPathResolver();
const runtime = require('../plugins/quests/QuestRuntime');
const { setup, enterDream } = require('./crab-quest-harness.cjs');

before(async () => {
  await require('../dist/game/cache/CachePipeline').CachePipeline.initialize(path.resolve(__dirname, '..'));
  require('../dist/game/definition/ObjectDefinition').ObjectDefinition.init();
});

const BAND_CRAB = 16483;
const SHY_CRAB = 16484;
const RECRUITED = 'quest.crab_quest.recruited';
const PRACTICE = 'talking-to-the-crab-at-practi';

// Every transcript the plugin starts: [chathead npc, variant]. The plugin takes startTranscript
// from QuestRuntime when it loads, so the wrapper is installed before each loadQuest.
const started = [];
const startTranscript = runtime.startTranscript;
runtime.startTranscript = (api, player, npcId, page, variant, ...rest) => {
  started.push([npcId, variant]);
  return startTranscript(api, player, npcId, page, variant, ...rest);
};

function practising(stage, recruited) {
  const h = setup();
  h.attrs.set(RECRUITED, recruited);
  const { quest } = enterDream(h, stage);
  started.length = 0;
  return { h, quest };
}

/** Talk-to on the practising bandmate-N (1-based, Quest Helper's numbering). */
function talkToBandmate(h, number) {
  const tiles = [
    [3057, 2637], [3057, 2638], [3056, 2638], [3055, 2638], [3055, 2637], [3056, 2636],
    [3055, 2636], [3054, 2637], [3054, 2638], [3056, 2639], [3057, 2639],
  ];
  const band = h.spawned.filter((npc) => npc.definition.id === BAND_CRAB && npc.isRegistered());
  const offset = band[0] && h.spawned.find((npc) => npc.definition.id === 16470);
  const dx = offset.definition.x - 3056;
  const dy = offset.definition.y - 2637;
  const [x, y] = tiles[number - 1];
  const crab = band.find((npc) => npc.definition.x === x + dx && npc.definition.y === y + dy);
  assert.ok(crab, `bandmate ${number} is at practice`);
  const event = { player: h.player, npcId: BAND_CRAB, clickType: 1, definition: h.core.NpcDefinition.forId(BAND_CRAB), npc: crab };
  for (const fn of h.hooks.npcs) fn(event);
  return event;
}

const condition = (h, stepId, npcId = BAND_CRAB) => {
  for (const fn of h.hooks.conditions) {
    const answer = fn({ player: h.player, npcId, stepId });
    if (answer !== null && answer !== undefined) return answer;
  }
  return null;
};

test('issue 6916: a recruited crab at practice talks about the practice, not the quest start', () => {
  // bandmate 1 is the palm south of the magic tree (join bit 1 << 1).
  const { h } = practising(47, 1 << 1);
  const event = talkToBandmate(h, 1);
  assert.equal(event.handled, true, 'the plugin answers the bandmate');
  assert.deepEqual(started, [[BAND_CRAB,
    'crab-hunting-investigating-the-palm-south-of-the-magic-tree-talking-to-the-crab-at-practice']]);
  assert.ok(!started.some(([, variant]) => variant === 'drinking-from-bottle'), 'no "Start Crab Quest?"');
});

test('issue 6916: every recruited bandmate has its own practice talk', () => {
  const { h } = practising(50, (1 << 11) - 1);
  for (let number = 1; number <= 11; number++) talkToBandmate(h, number);
  assert.equal(started.length, 11);
  assert.ok(started.every(([npcId, variant]) => npcId === BAND_CRAB && variant.includes(PRACTICE)), JSON.stringify(started));
  assert.equal(new Set(started.map(([, variant]) => variant)).size, 11, 'one talk per crab');
});

test('issue 6916: a crab that joined by waiting answers with the main crab (capture tick 6547)', () => {
  // The capture's band: bandmates 3, 4, 5, 7, 10, 11 recruited, the rest joined at stage 50.
  const recruited = (1 << 5) | (1 << 8) | (1 << 3) | (1 << 6) | (1 << 7) | (1 << 4);
  const { h } = practising(47, recruited);
  h.emit('npc-dialogue:choice', { npcId: 16471, option: 'Wait for leaders to turn up.' });
  started.length = 0;
  const event = talkToBandmate(h, 8); // 3054,2637, the crab the capture talks to
  assert.equal(event.handled, true);
  assert.deepEqual(started, [[16471, 'crab-hunting-after-finding-every-crab-to-join-practise-talking-to-the-main-crab']]);
});

test('issue 6916: the practice talks follow which crabs are at practice', () => {
  let { h } = practising(47, 1 << 5); // the red-shell crab alone
  assert.equal(condition(h, 'GC7Wza'), true, 'no coconut crab beside her');
  assert.equal(condition(h, 'BHU5Nd'), false);
  assert.equal(condition(h, 'YYDbAn'), true, 'the coconut crab\'s neighbour is there');
  const plant = practising(47, (1 << 7) | (1 << 8)).h; // the plant and the coconut crab
  assert.equal(condition(plant, 'BHU5Nd'), true, 'the coconut crab is at practice');
  assert.equal(condition(plant, 'YYDbAn'), false, 'no red-shell crab');
  talkToBandmate(plant, 4);
  assert.equal(condition(plant, 'D5DXe_'), false, 'no red-shell crab: the plain talk');
  assert.equal(condition(plant, '_ooOVB'), true);
  const both = practising(47, (1 << 5) | (1 << 8)).h;
  h = both;
  talkToBandmate(h, 4); // the plant
  assert.equal(condition(h, 'D5DXe_'), true, 'first talk with the red-shell crab present');
  assert.equal(condition(h, '_ooOVB'), false);
  talkToBandmate(h, 4);
  assert.equal(condition(h, 'D5DXe_'), false, 'subsequent times');
  assert.equal(condition(h, '_ooOVB'), true);
  assert.equal(h.persistentKeys.has('quest.crab_quest.plant-practice-talked'), true, 'the first talk is saved');
});

test('issue 6916: the shy crab by the chest has her Wiki conversation', () => {
  const { h } = practising(47, 0);
  h.attrs.set('crab-quest:shy-progress', 3);
  h.attrs.set('quest.crab_quest.instrument-name', 'bass');
  const event = { player: h.player, npcId: SHY_CRAB, clickType: 1, definition: h.core.NpcDefinition.forId(SHY_CRAB) };
  for (const fn of h.hooks.npcs) fn(event);
  assert.equal(event.handled, true);
  assert.deepEqual(started, [[SHY_CRAB,
    'crab-hunting-investigating-the-palm-directly-north-of-the-magic-tree-talking-to-the-crab-next-to-the-chest']]);
  assert.equal(condition(h, '_VgJ7G', SHY_CRAB), true, 'her lines follow the instrument\'s name');
  assert.equal(condition(h, 'suOAJW', SHY_CRAB), false);
});

test('issue 6916: crab_bass is crab_main + 64 * crab_bassname, as live sends it', () => {
  const valueOf = (h, id) => h.varValues.get(id);
  const { h, quest } = practising(45, 0);
  assert.equal(valueOf(h, 15887), 45, 'capture tick 6190: 40 -> 45 with no name yet');
  h.emit('npc-dialogue:choice', { npcId: 16471, option: 'A disaster.' });
  assert.equal(valueOf(h, 15843), 1, 'crab_bassname: "A disaster." is the first option (tick 6200)');
  assert.equal(valueOf(h, 15887), 109, 'tick 6200: 45 -> 109');
  h.emit('npc-dialogue:choice', { npcId: 16471, option: 'Let me show you!' });
  assert.equal(quest.getStage(h.player), 47);
  assert.equal(valueOf(h, 15887), 111, '47 + 64');
  for (const [name, value] of [['bass', 2], ['banjo', 3]]) {
    const other = practising(50, 0);
    other.h.attrs.set('quest.crab_quest.instrument-name', name);
    for (const fn of other.h.hooks.login) fn({ player: other.h.player });
    assert.equal(valueOf(other.h, 15843), value, `crab_bassname for the ${name}`);
    assert.equal(valueOf(other.h, 15887), 50 + 64 * value);
  }
  quest.setStage(h.player, 60);
  h.emit('npc-dialogue:action', { npcId: 16474, stepId: 'Wk9imR' });
  assert.equal(valueOf(h, 15887), 127, 'complete: 63 + 64');
});
