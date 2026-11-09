// Crab Quest's dream and ceremony instances, against RSProx capture 20261103T014803-ee79c12
// (revision 241): the bottle's black-out, what the dream holds, the floatsam, the band and the
// ceremony timeline.
const assert = require('node:assert/strict');
const path = require('node:path');
const { before, test } = require('node:test');
const { Server } = require('../dist/Server');
Server.installProductionPathResolver();
const { setup } = require('./crab-quest-harness.cjs');

before(async () => {
  await require('../dist/game/cache/CachePipeline').CachePipeline.initialize(path.resolve(__dirname, '..'));
  require('../dist/game/definition/ObjectDefinition').ObjectDefinition.init();
});

const MAIN_CRAB = 16471;
const FIRST_BLACKOUT = 'Cc5OQV';
const REALITY_BLACKOUT = '51SJsJ';

/** Starts the quest and blacks out into the dream; returns the instance offset from source tiles. */
function dream(h, stage = 5) {
  const quest = h.loadQuest();
  quest.setStage(h.player, stage);
  h.emit('npc-dialogue:action', { npcId: MAIN_CRAB, stepId: FIRST_BLACKOUT, kind: 'message' });
  h.tick(20);
  const crab = h.spawned.find((npc) => npc.definition.id === 16469 || npc.definition.id === 16470);
  const source = crab.definition.id === 16469 ? [3054, 2637] : [3056, 2637];
  return { quest, dx: crab.definition.x - source[0], dy: crab.definition.y - source[1] };
}

const sourceOf = ({ dx, dy }, x, y) => [x - dx, y - dy];

test('the first sip blacks out into a private copy of Dognose Island on the captured ticks', () => {
  const h = setup();
  const quest = h.loadQuest();
  quest.setStage(h.player, 5);
  const event = { npcId: MAIN_CRAB, stepId: FIRST_BLACKOUT, kind: 'message' };
  h.emit('npc-dialogue:action', event);
  assert.equal(event.end, true, 'the transcript stops at the black-out');
  assert.equal(h.area, null, 'still on the real beach');
  h.tick(2);
  assert.ok(h.messages.includes('...and immediately black out.'), 'black-out message two ticks after the sip');
  h.tick(2);
  assert.equal(h.area?.getName?.(), 'Crab Quest dream');
  assert.equal(h.varValues.get(15868), 1, 'crab_put_back_in_instance');
  assert.equal(h.varValues.get(15888), 1, 'crab_net');
  h.tick(10);
  assert.deepEqual(h.player.graphics, [245], 'the dizzy spotanim as the screen fades in');
  assert.ok(h.player.animations.includes(7330), 'the player gets up');
  assert.ok(h.currentDialogue, 'the rest of the conversation plays');
});

test('the dream holds the crab, the floatsam, the quest locs and the shells where live puts them', () => {
  const h = setup();
  const offset = dream(h);
  const spawned = h.spawned.map((npc) => [npc.definition.id, ...sourceOf(offset, npc.definition.x, npc.definition.y)]);
  assert.deepEqual(spawned, [[16469, 3054, 2637], [16820, 3051, 2632]]);
  const placed = h.placed.map(({ id, x, y }) => [id, ...sourceOf(offset, x, y)]);
  for (const loc of [[62438 + 4, 3057, 2637], [62459, 3056, 2637], [62466, 3054, 2637], [62474, 3043, 2640], [13723, 3059, 2639]]) {
    assert.ok(placed.some((entry) => entry.join() === loc.join()), `loc ${loc}`);
  }
  assert.ok(!placed.some(([id]) => id === 62438), 'the bottle is the cache map\'s own loc, not a second copy');
  const items = h.core.World.getItems().filter((item) => item.getPrivateArea() === h.area)
    .map((item) => [item.getItem().getId(), ...sourceOf(offset, item.getPosition().getX(), item.getPosition().getY())]);
  for (const shell of [[34575, 3059, 2648], [34576, 3044, 2652], [34577, 3051, 2634], [34581, 3040, 2636],
    [34582, 3048, 2645], [34583, 3055, 2654], [305, 3061, 2646]]) {
    assert.ok(items.some((entry) => entry.join() === shell.join()), `item ${shell}`);
  }
});

test('drinking again inside wakes the player on the real beach with progress kept', () => {
  const h = setup();
  const { quest } = dream(h, 25);
  h.emit('npc-dialogue:action', { npcId: MAIN_CRAB, stepId: REALITY_BLACKOUT, kind: 'message' });
  h.tick(6);
  assert.equal(h.area, null);
  assert.equal(h.varValues.get(15868), 0);
  const at = h.player.getLocation();
  assert.deepEqual([at.getX(), at.getY()], [3056, 2639]);
  assert.equal(quest.getStage(h.player), 25);
});

test('the dream is the headache: no boat and no teleport', () => {
  const h = setup();
  dream(h);
  const board = { player: h.player, allow: true };
  h.emit('sailing:can-board', board);
  assert.equal(board.allow, false);
  assert.match(board.reason, /difficult to find your boat/);
  const teleport = { player: h.player, allow: true };
  h.emit('teleport:can-start', teleport);
  assert.equal(teleport.allow, false);
});

test('the floatsam gives the bowstring, barrel and plank one catch at a time', () => {
  const h = setup();
  const { quest } = dream(h, 30);
  h.inventory.set(305, 1);
  const floatsam = h.spawned.find((npc) => npc.definition.id === 16820);
  const definition = { getActions: () => ['Net'] };
  h.hooks.npcs[0]({ player: h.player, npcId: 16820, clickType: 1, definition, npc: floatsam });
  h.tick(2);
  assert.ok(h.messages.includes('You cast out your net...'));
  h.tick(3);
  assert.equal(h.inventory.get(34586), 1, 'bowstring first');
  assert.equal(h.varValues.get(15852), 1);
  assert.equal(quest.getStage(h.player), 35);
  h.tick(6);
  assert.equal(h.inventory.get(34585), 1, 'barrel second');
  h.tick(6);
  assert.equal(h.inventory.get(34584), 1, 'plank last');
  assert.equal(h.varValues.get(15852), 3);
  assert.equal(quest.getStage(h.player), 37);
  assert.ok(!floatsam.isRegistered(), 'the emptied floatsam goes');
});

test('the sixth recruit sets crab_partial_complete; waiting completes the band at stage 50', () => {
  const h = setup();
  const { quest } = dream(h, 47);
  const joins = ['yUuVKM', 'ByoUzK', 'MVf-5E', 'XffNTB', 'XBEBvy'];
  for (const stepId of joins) h.emit('npc-dialogue:action', { npcId: 16483, stepId, kind: 'message' });
  assert.equal(h.varValues.get(15881), 0, 'five is not enough');
  const sixth = { npcId: 16483, stepId: 'beb_BL', kind: 'message' };
  h.emit('npc-dialogue:action', sixth);
  assert.equal(h.varValues.get(15881), 1, 'crab_partial_complete after the sixth');
  assert.equal(typeof sixth.after, 'function', 'the player\'s own "enough leaders" line follows');
  assert.deepEqual(sixth.box, { statement: true }, 'the scutter is a message box');
  h.emit('npc-dialogue:choice', { npcId: MAIN_CRAB, option: 'Wait for leaders to turn up.' });
  assert.equal(quest.getStage(h.player), 50);
  for (let index = 0; index < 11; index++) assert.equal(h.varValues.get(15853 + index), 1, `crab_bandmate_${index + 1}`);
  assert.equal(h.varValues.get(15869), 0, 'crab_recruited_bandmate_1 stays unrecruited');
  assert.equal(h.varValues.get(15875), 1, 'crab_recruited_bandmate_7 (the penguin palm) stays recruited');
  const band = h.spawned.filter((npc) => npc.definition.id === 16483 && npc.isRegistered());
  assert.equal(band.length, 11, 'the whole band practises');
});

test('a session cut off inside the dream logs back in on the real beach', () => {
  const h = setup();
  dream(h);
  assert.equal(h.attrs.get('crab-quest:in-instance'), true);
  h.player.moveTo(new h.core.Location(9000, 1700, 0));
  for (const fn of h.hooks.login) fn({ player: h.player });
  const at = h.player.getLocation();
  assert.deepEqual([at.getX(), at.getY()], [3056, 2639]);
  assert.equal(h.attrs.get('crab-quest:in-instance'), false);
});

test('the ceremony timeline is the capture\'s, from the first fade to the closing message box', () => {
  const timeline = require('../plugins/quests/crab/data/ceremony-timeline.json');
  assert.equal(timeline.sha256, 'f6a1ff253c796975ea47099405aeb5b063a42191bc8b4961b79220cb584ce7f2');
  assert.deepEqual(timeline.ticks, [6678, 7045]);
  assert.deepEqual(timeline.events[0].tick, 0);
  assert.ok(timeline.events.every((event, index, all) => index === 0 || all[index - 1].tick <= event.tick), 'ticks in order');
  assert.deepEqual(timeline.events.filter((event) => event.skybox !== undefined).map((event) => event.skybox), [61359, 61907, -1]);
  assert.ok(timeline.events.some((event) => event.mesbox?.startsWith('You carry the various instruments onto the heights')));
  assert.ok(timeline.events.some((event) => event.mesbox?.startsWith('As the day draws to an end')));
  assert.ok(timeline.events.some((event) => event.actorSay?.text === 'And a 1, 2, 3, 10!'));
});

test('the shy crab comes out of her palm, blushes and scutters to 3055,2650 only through the capture', () => {
  const valueOf = (h, id) => [...h.varbits].reverse().find((entry) => entry.id === id)?.value;
  const h = setup();
  const offset = dream(h, 47);
  h.investigate(62472, 3044 + offset.dx, 2653 + offset.dy); // crab_palm_update03
  assert.ok(h.messages.includes('A crab comes out shyly.'));
  const found = h.spawned.filter((npc) => npc.getId() === 16484).at(-1);
  assert.deepEqual(sourceOf(offset, found.definition.x, found.definition.y), [3045, 2653], 'captured shy spawn tile');
  assert.equal(valueOf(h, 15865), 0, 'finding her does not publish shy progress');
  h.emit('npc-dialogue:action', { npcId: 16484, stepId: 'shy-crab-blush' });
  assert.equal(valueOf(h, 15865), 1, 'the captured blush publishes 1');
  h.emit('npc-dialogue:action', { npcId: 16484, stepId: 'shy-crab-scutter' });
  assert.equal(valueOf(h, 15865), 2, 'the captured scutter publishes 2');
  const moved = h.spawned.filter((npc) => npc.getId() === 16484).at(-1);
  assert.deepEqual(sourceOf(offset, moved.definition.x, moved.definition.y), [3055, 2650], 'captured scutter tile');
  assert.equal(found.isRegistered(), false, 'the hiding crab is removed');

  const again = setup();
  again.attrs.set('crab-quest:shy-progress', 3);
  const back = dream(again, 47);
  const restored = again.spawned.filter((npc) => npc.getId() === 16484).at(-1);
  assert.deepEqual(sourceOf(back, restored.definition.x, restored.definition.y), [3055, 2650], 'the next dream keeps her there');
});

test('the dance lesson plays in the dream: the crab moves to its circle under the skybox', () => {
  const h = setup();
  const offset = dream(h, 50);
  h.emit('npc-dialogue:action', { npcId: 16474, stepId: 'uZozUI', kind: 'action' });
  h.tick(2);
  assert.ok(h.cameras.some(([kind, model]) => kind === 'skybox' && model === 61359), 'cam_skybox 61359');
  h.tick(2);
  const crab = h.spawned.find((npc) => npc.definition.id === 16474);
  assert.deepEqual(sourceOf(offset, crab.definition.x, crab.definition.y), [3062, 2641], 'the dancing crab');
  const placed = h.placed.map(({ id, x, y }) => [id, ...sourceOf(offset, x, y)].join());
  assert.ok(placed.includes('62479,3062,2641') && placed.includes('62480,3062,2642'), 'both sand circles');
  assert.ok(h.cameras.some(([kind, x, y, height]) => kind === 'move'
    && x - offset.dx === 3071 && y - offset.dy === 2637 && height === 470), 'the captured dance camera');
  h.emit('npc-dialogue:action', { npcId: 16474, stepId: 'UOa-Sd', kind: 'action' });
  h.tick(3);
  assert.ok(h.cameras.some(([kind, model]) => kind === 'skybox' && model === -1), 'the skybox clears');
  assert.equal(crab.isRegistered(), false);
});

test('a shell hand-in is an item box with that shell', () => {
  const h = setup();
  dream(h, 25);
  const event = { npcId: MAIN_CRAB, kind: 'message', text: 'You hand in a really large rose shell.' };
  h.emit('npc-dialogue:action', event);
  assert.deepEqual(event.box, { items: [34575] });
});

/** At stage 60 in the dream, the ceremony variant's hand-over step starts the cutscene. */
function ceremony(h) {
  const offset = dream(h, 60);
  h.emit('npc-dialogue:action', { npcId: 16474, stepId: 'dTDVEF', kind: 'message' });
  return offset;
}

test('review #4037: the screen fades back in on the beach once the ceremony ends', () => {
  const h = setup();
  ceremony(h);
  h.tick(372);
  assert.equal(h.area, null, 'back on the real beach');
  const at = h.player.getLocation();
  assert.deepEqual([at.getX(), at.getY()], [3056, 2639]);
  const last = h.mounts.at(-1);
  assert.deepEqual(last.args, [0, 0, 0, 255, 50], 'the last fade is a fade-in');
  h.tick(3);
  assert.equal(last.closed, true, 'and its overlay closes three ticks later');
});

test('review #4037: logging out before the ceremony rebuild stops it for good', () => {
  const h = setup();
  const { quest } = { quest: null, ...ceremony(h) };
  h.player.online = false;
  for (const fn of h.hooks.logout) fn({ player: h.player });
  const before = h.spawned.length;
  h.tick(400);
  assert.equal(h.spawned.length, before, 'no ceremony actors spawn for the offline player');
  assert.notEqual(h.area?.getName?.(), 'Crab Quest ceremony');
  assert.ok(!h.messages.some((text) => text.includes('completed a quest')), 'the closing steps never play');
});

test('review #4037: a flotsam outside the dream changes nothing', () => {
  const h = setup();
  const quest = h.loadQuest();
  quest.setStage(h.player, 30);
  h.inventory.set(305, 1);
  const definition = { getActions: () => ['Net'] };
  h.hooks.npcs[0]({ player: h.player, npcId: 16817, clickType: 1, definition });
  h.tick(20);
  assert.equal(quest.getStage(h.player), 30);
  assert.deepEqual(h.messages, []);
  assert.equal(h.inventory.get(34586) ?? 0, 0);
});
