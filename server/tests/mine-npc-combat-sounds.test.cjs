// From server/: node --test tests/mine-npc-combat-sounds.test.cjs
//
// scripts/mine-npc-combat-sounds.mjs builds data/definitions/npc-combat-sounds.json from rsprox captures. A
// dark beast (4005) attacked and died in silence (issue 6915): npc-captured-animations.json has no class for
// its animations, so none of its attack or death ticks were counted, and its attack sound (389) mostly plays
// in the tick the player's hit lands on it, which the specificity test did not credit. These feed the miner
// transcript-format ticks shaped like the dark beast's in rsprox captures (local 1000730, local 1001309).
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const path = require('node:path');
const { test } = require('node:test');

const script = path.resolve(__dirname, '../scripts/mine-npc-combat-sounds.mjs');

function mine(lines) {
  const run = spawnSync(process.execPath, ['--no-warnings', script], { input: lines.join('\n') + '\n', encoding: 'utf8' });
  return { status: run.status, stderr: run.stderr, npcs: run.status === 0 ? JSON.parse(run.stdout).npcs : null };
}

const BEAST = '        [walk] npc=(index=26936, id=mourning_dark_beast (4005), coord=(3227, 12394, 0)), newcoord=(3226, 12393, 0), step=south-west';
const SEQ = (name, id) => `            [sequence] id=${name} (${id})`;
const HIT = '            [hit] id=16, value=4, limit=8';

/** One tick: its synths, then the dark beast's update in an NPC info packet. */
function tick(t, sounds, info) {
  return [
    `rec.txt:[${t}]`,
    ...sounds.map((s) => `rec.txt:    [synth_sound] id=${s}`),
    'rec.txt:    [npc_info_small_v5] ',
    `rec.txt:${BEAST}`,
    ...info.map((line) => `rec.txt:${line}`),
    // A player's hitsplat is no NPC's.
    'rec.txt:    [player_info] ',
    'rec.txt:        [run] player=(index=1, name=p, coord=(3213, 12409, 0)), newcoord=(3211, 12409, 0)',
    `rec.txt:${HIT}`,
  ];
}

function fight() {
  const lines = [];
  let t = 1;
  const attack = SEQ('dark_beast_update_attack', 2731);
  for (let i = 0; i < 15; i++) lines.push(...tick(t++, ['dark_beast_attack (389)'], [attack]));
  // The beast attacks in the tick the player's hit lands: both sounds, most of the 389s.
  for (let i = 0; i < 40; i++) lines.push(...tick(t++, ['dark_beast_attack (389)', 'dark_beast_hit (391)'], [attack, HIT]));
  for (let i = 0; i < 20; i++) lines.push(...tick(t++, ['dark_beast_hit (391)'], [SEQ('dark_beast_update_defend', 2732), HIT]));
  for (let i = 0; i < 15; i++) lines.push(...tick(t++, ['390, delay=0'], [SEQ('dark_beast_update_death', 2733), HIT]));
  return lines;
}

test('an NPC with no captured animation classes gets its attack and death sounds from the animation names', () => {
  const { status, stderr, npcs } = mine(fight());
  assert.equal(status, 0, stderr);
  assert.deepEqual(npcs['4005'], { hit: [[391, 0]], attack: [[389, 0]], death: [[390, 0]] });
});

test('a recorded delay is kept, and ticks with no NPC update count for no NPC', () => {
  const lines = fight().map((line) => line.replace('[synth_sound] id=390, delay=0', '[synth_sound] id=390, delay=20'));
  for (let t = 1000; t < 1003; t++) lines.push(`rec.txt:[${t}]`, 'rec.txt:    [synth_sound] id=dark_beast_hit (391)');
  const { status, stderr, npcs } = mine(lines);
  assert.equal(status, 0, stderr);
  assert.deepEqual(npcs['4005'].death, [[390, 20]]);
  assert.deepEqual(npcs['4005'].hit, [[391, 0]]);
});

test("another player's hits and kills count for no NPC: their sounds go to that player", () => {
  const lines = fight();
  let t = 500;
  const OTHER = '            [hit] id=17, value=3, limit=8';
  // Someone else fights a dark beast nearby: their hitsplats (17) with no sound, and kills where the beast's
  // last hitsplat was theirs (the death tick itself has none).
  for (let i = 0; i < 60; i++) lines.push(...tick(t++, [], [SEQ('dark_beast_update_defend', 2732), OTHER]));
  for (let i = 0; i < 20; i++) {
    lines.push(...tick(t++, [], [OTHER]), ...tick(t++, [], [SEQ('dark_beast_update_death', 2733)]));
  }
  const { status, stderr, npcs } = mine(lines);
  assert.equal(status, 0, stderr);
  assert.deepEqual(npcs['4005'], { hit: [[391, 0]], attack: [[389, 0]], death: [[390, 0]] });
});

test('a sound the server already sends is left out, a number in a comment or string beside "sound" is not', () => {
  // 4020: plugins/bosses/araxxor/Shared.Araxxor.js plays it as the Mirrorback's hit sound, in
  // `HIT_SOUND = Object.freeze({ ..., mirrorback: Object.freeze([4020, 9]) })` over several lines.
  // 500: only "1,500 coins" in The Writings on the Wall's dialogue (and 451 in a capture note in
  // Wilderness.Agility.js) sit near the word "sound".
  const lines = fight().map((line) => line.replace('dark_beast_hit (391)', '4020').replace('dark_beast_attack (389)', '500')
    .replace('[synth_sound] id=390, delay=0', '[synth_sound] id=451'));
  const { status, stderr, npcs } = mine(lines);
  assert.equal(status, 0, stderr);
  assert.deepEqual(npcs['4005'], { attack: [[500, 0]], death: [[451, 0]] });
});

test('input in neither format is refused', () => {
  const { status, stderr } = mine(['[tick 1] something else', 'SynthSound(id=1)']);
  assert.equal(status, 1);
  assert.match(stderr, /Nothing written/);
});
