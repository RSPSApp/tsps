const assert = require('node:assert/strict');
const path = require('node:path');
const { before, test } = require('node:test');
const { Server } = require('../dist/Server');
Server.installProductionPathResolver();
const { PluginManager } = require('../dist/plugins/PluginManager');
const runtime = require('../plugins/quests/QuestRuntime');
const { CacheDefinitions } = require('../dist/game/cache/CacheDefinitions');

const CACHE = path.resolve(__dirname, '..');
const SIT_SLOT = 54;
const SIT_LOOP = 10061; // emote_sit_loop, interface 216 child 54 (cache enum 1001 -> 5248)

before(async () => {
  await require('../dist/game/cache/CachePipeline').CachePipeline.initialize(CACHE);
  require('../dist/game/definition/ObjectDefinition').ObjectDefinition.init();
});

const { setup, enterDream } = require('./crab-quest-harness.cjs');

/** A harness in the dream at `stage`, driven with source tiles (the coax is the dream's). */
function dreaming(stage = 47) {
  const h = setup();
  const d = enterDream(h, stage);
  return {
    h, quest: d.quest,
    at: d.at,
    setLocation: (x, y) => h.setLocation(...d.at(x, y)),
    investigate: (id, x, y) => h.investigate(id, ...d.at(x, y)),
    sit: (x, y, slot) => h.sit(...d.at(x, y), slot),
  };
}

// `bit` is the spot-array index bit used by SCARED/MET (join bits differ).
const SIT_SPOTS = [
  { id: 62473, x: 3043, y: 2640, sit: [3042, 2640], bit: 1 << 0 },
  { id: 62470, x: 3042, y: 2637, sit: [3041, 2638], bit: 1 << 1 },
  { id: 62475, x: 3036, y: 2644, sit: [3037, 2643], bit: 1 << 3 },
  { id: 62475, x: 3046, y: 2656, sit: [3046, 2655], bit: 1 << 9 },
];

test('Crab coax needs the real Sit emote after the too-scared investigate', () => {
  const d = dreaming();
  const { h } = d;
  for (const spot of SIT_SPOTS) {
    d.setLocation(spot.sit[0], spot.sit[1]);
    d.investigate(spot.id, spot.x, spot.y);
    assert.ok((h.attrs.get('quest.crab_quest.scared') & spot.bit) !== 0, `spot ${spot.id} set scared`);
    assert.equal(h.attrs.get('quest.crab_quest.met') & spot.bit, 0, `spot ${spot.id} not coaxed by investigate`);

    d.investigate(spot.id, spot.x, spot.y);
    assert.equal(h.attrs.get('quest.crab_quest.met') & spot.bit, 0, `second investigate does not coax ${spot.id}`);

    d.sit(spot.sit[0], spot.sit[1], 12);
    h.tick(30);
    assert.equal(h.attrs.get('quest.crab_quest.met') & spot.bit, 0, 'a different emote does not coax');

    d.sit(spot.x - 3, spot.y - 3);
    h.tick(30);
    assert.equal(h.attrs.get('quest.crab_quest.met') & spot.bit, 0, 'Sit away from the hiding place does not coax');

    const wait = spot.id === 62473 ? 24 : 12;
    d.sit(spot.sit[0], spot.sit[1]);
    assert.equal(h.messages.at(-1), 'And now, you wait...');
    h.tick(wait - 1);
    assert.equal(h.attrs.get('quest.crab_quest.met') & spot.bit, 0, `${spot.id}: the crab is still hiding`);
    h.tick(1);
    assert.ok((h.attrs.get('quest.crab_quest.met') & spot.bit) !== 0, `Sit at ${spot.sit} coaxes ${spot.id} after ${wait} ticks`);
    assert.ok(h.currentDialogue, 'A crab appears! and its conversation');
  }
  // The captured crab chathead is crab_bandcrab 16483; its join action must count.
  h.emit('npc-dialogue:action', { npcId: 16483, stepId: '5WiO-g' });
  assert.ok((h.attrs.get('quest.crab_quest.recruited') & (1 << 0)) !== 0, 'bandcrab chathead action sets the join bit');
});

test('Crab recruit pocket is reachable once the 3039,2644 flavor palm is skipped (real cache pathfinder)', () => {
  const { RegionManager } = require('../dist/game/collision/RegionManager');
  const { ObjectDefinition } = require('../dist/game/definition/ObjectDefinition');
  const { GameObject } = require('../dist/game/entity/impl/object/GameObject');
  const { Location } = require('../dist/game/model/Location');
  const { MapObjects } = require('../dist/game/entity/impl/object/MapObjects');
  ObjectDefinition.init();
  RegionManager.init();

  const spots = [
    [62473, 3043, 2640], [62470, 3042, 2637], [62470, 3039, 2644], [62475, 3037, 2644],
    [62470, 3037, 2647], [62470, 3039, 2647], [62470, 3040, 2649], [62470, 3048, 2658],
    [62470, 3040, 2636], [62475, 3047, 2656], [62475, 3063, 2653], [62477, 3054, 2656],
    [62478, 3050, 2636], [62478, 3057, 2640],
  ];
  const objects = spots.map(([id, x, y]) => new GameObject(id, new Location(x, y, 0), 10, 0, null));
  for (const object of objects) MapObjects.add(object);

  const reachable = () => {
    const start = [3039, 2645];
    const seen = new Set([start.join(',')]);
    const queue = [start];
    while (queue.length) {
      const [x, y] = queue.shift();
      for (const [dx, dy] of [[0, 1], [1, 0], [0, -1], [-1, 0]]) {
        const nx = x + dx;
        const ny = y + dy;
        const key = `${nx},${ny}`;
        if (seen.has(key) || RegionManager.getClipping(nx, ny, 0, null) !== 0) continue;
        seen.add(key);
        queue.push([nx, ny]);
      }
    }
    return seen;
  };

  const sealed = reachable();
  assert.equal(sealed.has('3042,2640'), false, 'solid 3039,2644 palm seals the magic tree');
  assert.equal(sealed.has('3041,2637'), false, 'solid 3039,2644 palm seals the palm south');

  const flavor = objects[2];
  MapObjects.remove(flavor);
  RegionManager.removeObjectClipping(flavor);
  const open = reachable();
  assert.equal(open.has('3042,2640'), true, 'magic tree reachable once the flavor palm is skipped');
  assert.equal(open.has('3041,2637'), true, 'palm south reachable once the flavor palm is skipped');
});

test('Crab tree NW (capture 3036,2644) sits at 3037,2643; the 2x2 tree refuses 3037,2644', () => {
  const { RegionManager } = require('../dist/game/collision/RegionManager');
  const { ObjectDefinition } = require('../dist/game/definition/ObjectDefinition');
  const { GameObject } = require('../dist/game/entity/impl/object/GameObject');
  const { Location } = require('../dist/game/model/Location');
  const { MapObjects } = require('../dist/game/entity/impl/object/MapObjects');
  ObjectDefinition.init();
  RegionManager.init();
  MapObjects.add(new GameObject(62475, new Location(3036, 2644, 0), 10, 2, null));
  assert.notEqual(RegionManager.getClipping(3037, 2644, 0, null), 0, '3037,2644 is inside the 2x2 tree');
  assert.equal(RegionManager.getClipping(3037, 2643, 0, null), 0, '3037,2643 is walkable');

  const d = dreaming();
  const { h } = d;
  d.setLocation(3037, 2643);
  d.investigate(62475, 3036, 2644);
  assert.ok((h.attrs.get('quest.crab_quest.scared') & (1 << 3)) !== 0, 'tree NW scared bit 3');
  assert.equal(h.attrs.get('quest.crab_quest.met') & (1 << 3), 0, 'no auto-coax');
  d.investigate(62475, 3036, 2644);
  assert.equal(h.attrs.get('quest.crab_quest.met') & (1 << 3), 0, 'second investigate does not coax');
  d.sit(3037, 2644);
  h.tick(12);
  assert.equal(h.attrs.get('quest.crab_quest.met') & (1 << 3), 0, 'Sit on the tree tile is refused');
  d.sit(3037, 2643);
  h.tick(12);
  assert.ok((h.attrs.get('quest.crab_quest.met') & (1 << 3)) !== 0, 'Sit at 3037,2643 coaxes');
});

test('issue 6670: any tile beside the hiding place coaxes, as live (3047,2655) and Quest Helper (3038,2644) sit', () => {
  for (const [x, y, spotX, spotY, id, bit] of [
    [3047, 2655, 3046, 2656, 62475, 1 << 9], // capture 20261103T014803 tick 6369
    [3038, 2644, 3036, 2644, 62475, 1 << 3], // QH sitForCrabNine
    [3041, 2638, 3042, 2637, 62470, 1 << 1], // QH sitForCrabOne, diagonal to the 1x1 palm
  ]) {
    const d = dreaming();
    const { h } = d;
    d.setLocation(x, y);
    d.investigate(id, spotX, spotY);
    d.sit(x, y);
    h.tick(12);
    assert.ok((h.attrs.get('quest.crab_quest.met') & bit) !== 0, `Sit at ${x},${y} coaxes the crab at ${spotX},${spotY}`);
  }
});

test('issue 6670: standing up or walking off before the crab appears leaves it hidden', () => {
  const d = dreaming();
  const { h } = d;
  d.setLocation(3046, 2655);
  d.investigate(62475, 3046, 2656);
  d.sit(3046, 2655);
  h.tick(6);
  h.emit('player:emote', { slot: 12, sequence: 0 });
  h.tick(12);
  assert.equal(h.attrs.get('quest.crab_quest.met') & (1 << 9), 0, 'another emote stands the player up');

  d.sit(3046, 2655);
  h.tick(6);
  d.setLocation(3045, 2654);
  h.tick(12);
  assert.equal(h.attrs.get('quest.crab_quest.met') & (1 << 9), 0, 'walking off cancels the wait');

  d.sit(3046, 2655);
  h.tick(4);
  d.setLocation(3050, 2650);
  h.tick(4);
  d.setLocation(3046, 2655);
  h.tick(12);
  assert.equal(h.attrs.get('quest.crab_quest.met') & (1 << 9), 0, 'stepping off and back mid-wait still cancels it');

  d.sit(3046, 2655);
  h.tick(6);
  d.sit(3046, 2655); // sitting again keeps the first wait
  h.tick(6);
  assert.ok((h.attrs.get('quest.crab_quest.met') & (1 << 9)) !== 0, 'twelve ticks after the first Sit');
});

test('review #6819: a new Sit on another tile beside the same hiding place restarts the wait', () => {
  const d = dreaming();
  const { h } = d;
  d.setLocation(3046, 2655);
  d.investigate(62475, 3046, 2656);
  d.sit(3046, 2655);
  h.tick(4);
  const waits = h.messages.filter((message) => message === 'And now, you wait...').length;
  d.sit(3047, 2655);
  assert.equal(h.messages.filter((message) => message === 'And now, you wait...').length, waits + 1, 'a new wait');
  h.tick(11);
  assert.equal(h.attrs.get('quest.crab_quest.met') & (1 << 9), 0, 'not before twelve ticks on the new tile');
  h.tick(1);
  assert.ok((h.attrs.get('quest.crab_quest.met') & (1 << 9)) !== 0, 'twelve ticks after the second Sit');
});

test('Crab legacy hand-in count derives colours only when complete and never from pickups', () => {
  const valueOf = (h, id) => [...h.varbits].reverse().find((entry) => entry.id === id)?.value;
  const partial = setup();
  const partialQuest = partial.loadQuest();
  partialQuest.setStage(partial.player, 30);
  partial.attrs.set('quest.crab_quest.shells-handed', 3);
  partial.attrs.set('quest.crab_quest.shells-picked', 0b1111111);
  for (const fn of partial.hooks.login) fn({ player: partial.player });
  for (let index = 0; index < 7; index++) {
    assert.equal(valueOf(partial, 15844 + index), 0, `legacy partial count does not guess shell ${index + 1}`);
  }
  assert.equal(partialQuest.getStage(partial.player), 30);

  const complete = setup();
  const completeQuest = complete.loadQuest();
  completeQuest.setStage(complete.player, 30);
  complete.attrs.set('quest.crab_quest.shells-handed', 7);
  for (const fn of complete.hooks.login) fn({ player: complete.player });
  for (let index = 0; index < 7; index++) {
    assert.equal(valueOf(complete, 15844 + index), 1, `completed hand-in count derives shell ${index + 1}`);
  }
  assert.equal(completeQuest.getStage(complete.player), 30);
});

test('Crab does not count a duplicate colour towards the seven shells', () => {
  const h = setup();
  const quest = h.loadQuest();
  quest.setStage(h.player, 25);
  const talk = () => h.hooks.npcs.at(-1)({
    player: h.player,
    npcId: 16471,
    clickType: 1,
    definition: h.core.NpcDefinition.forId(16471),
  });

  h.inventory.set(34575, 2);
  talk();
  assert.equal(h.attrs.get('quest.crab_quest.shells-handed'), 1, 'first colour counted once');
  assert.equal(h.attrs.get('crab-quest:shells-handed-mask'), 1 << 0);

  talk();
  assert.equal(h.attrs.get('quest.crab_quest.shells-handed'), 1, 'duplicate colour does not increment again');
  assert.equal(h.attrs.get('crab-quest:shells-handed-mask'), 1 << 0);
  assert.equal(h.inventory.get(34575), 0, 'duplicate shell is still consumed');
  assert.equal(quest.getStage(h.player), 25, 'duplicate colour cannot reach the seven-shell stage');
});

test('Crab clears the native instance flag on completion only', () => {
  const valueOf = (h, id) => [...h.varbits].reverse().find((entry) => entry.id === id)?.value;
  const h = setup();
  const quest = h.loadQuest();
  quest.setStage(h.player, 60);
  h.varbits.length = 0;
  h.emit('npc-dialogue:action', { npcId: 16474, stepId: 'Wk9imR' });
  assert.equal(quest.getStage(h.player), 63, 'ceremony completion still reaches 63');
  assert.equal(valueOf(h, 15868), 0, 'completed quest leaves the instance flag clear');
  assert.equal(valueOf(h, 15842), 63, 'stage varbit still publishes 63');
});

test('Crab Sit uses the real cached slot 54 loop', () => {
  const Emotes = require('../plugins/interface/Emotes.plugin');
  const player = { getEquipment: () => ({ getItems: () => [] }) };
  assert.deepEqual(Emotes._test.resolveEmote(player, SIT_SLOT, 1, {}), { sequence: SIT_LOOP, graphic: undefined });
});

// Native registered bottle, mooring and spell consumers. The fixture drives the real dialogue
// manager and scheduled sailing tasks; it does not claim a decoded click or a sailing journey.

test('issue 6670: the recruits\' narration is a message box, as live sends it (capture type=mesbox)', () => {
  const h = setup();
  h.loadQuest().setStage(h.player, 47);
  for (const text of ['A crab appears!', "A 'crab' appears!", 'No crab is coming out of the tree. Maybe they are too scared?']) {
    const event = { npcId: 16483, stepId: 'probe', kind: 'message', text };
    h.emit('npc-dialogue:action', event);
    assert.deepEqual(event.box, { statement: true }, text);
  }
  const wait = { npcId: 16483, stepId: 'probe', kind: 'message', text: 'And now, you wait...' };
  h.emit('npc-dialogue:action', wait);
  assert.equal(wait.box, undefined, 'the wait is a game message');
});

test('review #6819: a Sit on the real beach coaxes nothing; the hiding places are the dream\'s', () => {
  const d = dreaming();
  d.investigate(62475, 3046, 2656);
  assert.ok((d.h.attrs.get('quest.crab_quest.scared') & (1 << 9)) !== 0, 'scared in the dream');
  // Woken by the bottle: back on the real island, where the same source tile has no tree.
  d.h.emit('npc-dialogue:action', { npcId: 16471, stepId: '51SJsJ', kind: 'message' });
  d.h.tick(10);
  assert.equal(d.h.area, null, 'out of the dream');
  const before = d.h.messages.length;
  d.h.sit(3047, 2655);
  d.h.tick(30);
  assert.equal(d.h.attrs.get('quest.crab_quest.met') & (1 << 9), 0, 'no crab on the real beach');
  assert.ok(!d.h.messages.slice(before).includes('And now, you wait...'), 'no wait message');
});

// The crab that comes out (capture 20261103T014803, ticks 6256-6519): added by its hiding place as
// "A crab appears!" opens, the player steps straight beside it when the box is continued, and it
// goes when it scutters off to practice.
const appears = (d, npcId = 16483, text = 'A crab appears!') => {
  const event = { npcId, stepId: 'probe-appears', kind: 'message', text };
  d.h.emit('npc-dialogue:action', event);
  return event;
};
const where = (d) => { const at = d.h.player.getLocation(); return [at.getX(), at.getY()]; };

test('the plant\'s crab comes out on its captured tile and the player steps west off it (ticks 6292-6293)', () => {
  const d = dreaming();
  d.setLocation(3053, 2656);
  d.investigate(62477, 3054, 2656);
  const event = appears(d);
  const crab = d.h.spawned.find((npc) => npc.definition.id === 16483 && npc.registered
    && npc.definition.x === d.at(3053, 2656)[0] && npc.definition.y === d.at(3053, 2656)[1]);
  assert.ok(crab, 'crab_bandcrab added on 3053,2656');
  assert.deepEqual(event.box, { statement: true });
  event.after();
  assert.deepEqual(where(d), d.at(3052, 2656), 'one step west');
});

test('with its west tile blocked by the palm, the player steps east instead (ticks 6473-6475)', () => {
  const d = dreaming();
  d.setLocation(3041, 2649);
  d.h.blocked.add(d.at(3040, 2649).join());
  d.investigate(62470, 3040, 2649);
  const event = appears(d);
  event.after();
  assert.deepEqual(where(d), d.at(3042, 2649), 'one step east');
});

test('a crab no recording reached comes out on the player\'s tile (Ours); its scutter removes it', () => {
  const d = dreaming();
  d.setLocation(3051, 2635); // east of the 2x2 western bush at 3049,2635
  d.h.blocked.add(d.at(3050, 2635).join());
  d.investigate(62478, 3049, 2635);
  // The western bush's conversation never says "A crab appears!": its first box shows the crab (Ours).
  const event = appears(d, 16483, 'The crab stares past you serenely.');
  const crab = d.h.spawned.filter((npc) => npc.definition.id === 16483 && npc.registered)
    .find((npc) => npc.definition.x === d.at(3051, 2635)[0] && npc.definition.y === d.at(3051, 2635)[1]);
  assert.ok(crab, 'on the player\'s tile');
  event.after();
  assert.deepEqual(where(d), d.at(3052, 2635), 'east, the bush being west');
  const scutter = { npcId: 16483, stepId: 'UtfH3c', kind: 'message', text: 'The crab serenely scutters away to practise.' };
  d.h.emit('npc-dialogue:action', scutter);
  assert.deepEqual(scutter.box, { statement: true });
  assert.equal(crab.registered, false, 'gone when it scutters');
  assert.ok(d.h.spawned.some((npc) => npc.definition.id === 16483 && npc.registered), 'and practising on the beach');
});

test('the penguin: kicked into the sea on the captured ticks, then the crab comes out (6256-6277)', () => {
  const d = dreaming();
  d.setLocation(3048, 2657);
  d.h.blocked.add(d.at(3048, 2658).join());
  d.investigate(62470, 3048, 2658);
  const shown = appears(d, 16485, "A 'crab' appears!");
  const penguin = d.h.spawned.find((npc) => npc.definition.id === 16485 && npc.registered);
  assert.deepEqual([penguin.definition.x, penguin.definition.y], d.at(3049, 2658), "'Crab' on 3049,2658");
  shown.after();
  assert.deepEqual(where(d), d.at(3049, 2657), 'from the diagonal to its south');

  const kick = { npcId: 16485, stepId: 'S6fPkj', kind: undefined, text: 'The player kicks the penguin into the ocean.' };
  d.h.emit('npc-dialogue:action', kick);
  let resumed = false;
  kick.wait(() => { resumed = true; });
  assert.ok(d.h.player.animations.includes(423), 'human_unarmedkick');
  assert.deepEqual(d.h.sounds.at(-1), [2565, 10]);
  d.h.tick(1);
  assert.equal(penguin.registered, false, 'gone the next tick');
  const [fromX, fromY] = d.at(3049, 2658);
  assert.deepEqual(d.h.projectiles.at(-1), [4022, fromX, fromY, fromX, fromY + 20, 250]);
  assert.deepEqual(d.h.graphics.at(-1), [68, 250, fromX, fromY + 20]);
  d.h.tick(1);
  assert.equal(d.h.varValues.get(15867), 1, 'crab_kicked_penguin');
  d.h.tick(8);
  assert.equal(resumed, false, 'the crab is not out yet');
  d.h.tick(1);
  assert.equal(resumed, true, 'the conversation carries on 11 ticks after the kick');
  appears(d);
  const crab = d.h.spawned.filter((npc) => npc.definition.id === 16483 && npc.registered).at(-1);
  assert.deepEqual([crab.definition.x, crab.definition.y], d.at(3049, 2658));
});

test('the shy crab\'s narration is message boxes, and the player steps up to her (ticks 6228-6250)', () => {
  const d = dreaming();
  d.setLocation(3044, 2652);
  d.h.blocked.add(d.at(3044, 2653).join());
  const out = { npcId: 16484, stepId: 'shy-crab-out', kind: 'message', text: '' };
  d.investigate(62472, 3044, 2653);
  d.h.emit('npc-dialogue:action', out);
  assert.deepEqual(out.box, { statement: true });
  assert.equal(out.text, 'A crab comes out shyly.');
  out.after();
  assert.deepEqual(where(d), d.at(3045, 2652), 'beside her, south of 3045,2653');
  for (const [stepId, text] of [['shy-crab-blush', 'The crab appears to turn bright red.'], ['shy-crab-scutter', 'The crab scutters away.']]) {
    const event = { npcId: 16484, stepId, kind: 'message', text: '' };
    d.h.emit('npc-dialogue:action', event);
    assert.deepEqual(event.box, { statement: true }, stepId);
    assert.equal(event.text, text);
  }
  assert.ok(!d.h.messages.includes('The crab appears to turn bright red.'), 'not a chat message any more');
});
