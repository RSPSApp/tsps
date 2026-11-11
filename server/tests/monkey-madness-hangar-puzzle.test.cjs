// From server/: node --test tests/monkey-madness-hangar-puzzle.test.cjs (after yarn build and yarn ensure-cache).
//
// Monkey Madness I, chapter 1: Waydar's reinitialisation puzzle. Operating the panel opens the 5x5 sliding
// puzzle (interface trail_slidepuzzle, inventory reinitialisation_inv, pieces reinitialisation_01..24) and the
// quest moves on only when the last piece slides home. The board is read back from the inventory the server
// sends, as the client draws it. The scramble is not recorded; the test fixes Math.random to know the way back.
'use strict';

const assert = require('node:assert/strict');
const { test, before, afterEach } = require('node:test');
const path = require('node:path');
const { Server } = require('../dist/Server');
Server.installProductionPathResolver();
const { PluginManager } = require('../dist/plugins/PluginManager');
const { DialogueManager } = require('../dist/game/model/dialogues/DialogueManager');
const { CachePipeline } = require('../dist/game/cache/CachePipeline');
const { NpcDefinitionLoader } = require('../dist/game/definition/loader/impl/NpcDefinitionLoader');
const runtime = require('../plugins/quests/QuestRuntime');
const core = PluginManager.getCoreApi();
const { neighbours, slide, solvedBoard } = require('../plugins/treasuretrails/trails/Puzzle.TreasureTrails');

const STAGE_DAERO = 4;
const STAGE_REINITIALISED = 5;
const DAERO_STATE = 'quest.monkey_madness_i.mm-daero';
const PANEL = core.ObjectIdentifiers.REINITIALISATION_PANEL;
const realRandom = Math.random;
let nextIndex = 1;
let quest;
let api;
let PIECES;
let INVENTORY;
let INTERFACE;
let PIECES_BUTTON;
let IF1;

before(async () => {
  await CachePipeline.initialize(path.resolve(__dirname, '..'));
  new NpcDefinitionLoader().load();
  api = PluginManager.createApi('MonkeyMadnessHangarPuzzleTest');
  const existing = runtime.getRegisteredQuests().length;
  require('../plugins/quests/quests/MonkeyMadnessI.Quest')(api);
  quest = runtime.getRegisteredQuests().slice(existing).find(entry => entry.key === 'monkey_madness_i');
  assert.ok(quest, 'Monkey Madness I registered its quest handle');
  const ids = core.CacheDefinitions;
  PIECES = Array.from({ length: 24 }, (_, i) => ids.getObjId(`reinitialisation_${String(i + 1).padStart(2, '0')}`));
  INVENTORY = ids.getInventoryId('reinitialisation_inv');
  INTERFACE = ids.getInterfaceId('trail_slidepuzzle');
  PIECES_BUTTON = ids.getComponentId('trail_slidepuzzle:pieces');
  IF1 = ids.getVarpId('if1');
});

afterEach(() => { Math.random = realRandom; });

function player(stage, daero) {
  const attrs = new Map();
  const items = new Map();
  const log = [];
  let location = new core.Location(2394, 9889, 0);
  const packet = new Proxy({}, { get: (target, key) => (...args) => { log.push([key, ...args]); return packet; } });
  const inventory = {
    getAmount: id => items.get(id) ?? 0, getFreeSlots: () => 28, isFull: () => false, getItems: () => [],
    adds: (id, amount = 1) => items.set(id, (items.get(id) ?? 0) + amount),
    deleteNumber(id, amount = 1) { items.set(id, (items.get(id) ?? 0) - amount); },
  };
  const p = {
    log, messages: [], index: nextIndex++, getIndex: () => p.index,
    getAttribute: key => attrs.get(key), setAttribute: (key, value) => attrs.set(key, value),
    getInventory: () => inventory, getEquipment: () => ({ get: () => null }), getPacketSender: () => packet,
    getDialogueManager: () => p.manager, getLocation: () => location, moveTo: to => { location = to; },
    isRegistered: () => true, isDyingReturn: () => false, getPrivateArea: () => null, getArea: () => null,
    getHitpoints: () => 10, getUsername: () => 'Puzzle', getDisplayName: () => 'Puzzle',
    getAppearance: () => ({ isMale: () => true }), getSkillManager: () => ({ addExperiences() {}, getCombatLevel: () => 3 }),
    getUpdateFlag: () => ({ flag() {} }), getMovementQueue: () => ({ reset() { return this; }, setBlockMovement() { return this; } }),
    setPositionToFace() {}, forceChat() {}, performAnimation() {}, sendMessage: text => p.messages.push(text),
  };
  p.manager = new DialogueManager(p);
  quest.setStage(p, stage);
  if (daero !== undefined) p.setAttribute(DAERO_STATE, daero);
  return p;
}

function operatePanel(p) {
  const definition = { getName: () => 'Reinitialisation Panel', getActions: () => ['Operate'], getInteractions: () => ['Operate'] };
  const object = { getId: () => PANEL, getDefinition: () => definition };
  return PluginManager.emitObjectInteraction({ player: p, object, objectId: PANEL, clickType: 1, definition, location: { x: 2397, y: 9887, z: 0 }, handled: false });
}

function clickSlot(p, slot) {
  return PluginManager.emitInterfaceActionClick({ player: p, buttonId: PIECES_BUTTON, action: 0, opId: 1, slot, handled: false });
}

const calls = (p, name) => p.log.filter(row => row[0] === name);
/** The board as the client was last sent it: piece 0-23 in each slot, -1 for the blank. */
function board(p) {
  const [, id, capacity, items] = calls(p, 'sendInventory').filter(row => row[1] === INVENTORY).at(-1);
  assert.equal(capacity, 25);
  return items.map(item => item ? PIECES.indexOf(item.id) : -1);
}

/** A fixed pseudo-random sequence (a linear congruential generator), so a scramble can be replayed. */
function sequence(seed) {
  let state = seed;
  return () => (state = (state * 1664525 + 1013904223) % 4294967296) / 4294967296;
}

/**
 * The clicks that undo the 101 slides scramble() makes with this generator: the blank walks p0 (slot 24), p1 ...
 * pn, each slide moving the piece at p(i) into the blank, so the way back clicks p(n-1) ... p0.
 */
function solutionFor(random) {
  const walk = solvedBoard();
  const visited = [walk.indexOf(-1)];
  for (let i = 0; i < 101; i++) {
    const options = neighbours(walk.indexOf(-1));
    const at = options[Math.floor(random() * options.length)];
    slide(walk, at);
    visited.push(at);
  }
  return visited.slice(0, -1).reverse();
}

test('operating the panel opens the sliding puzzle and leaves the quest at the briefing', () => {
  Math.random = () => 0;
  const p = player(STAGE_DAERO, 5);
  assert.equal(operatePanel(p), true);
  assert.equal(quest.getStage(p), STAGE_DAERO, 'the panel alone no longer reinitialises the hangar');
  assert.ok(!p.manager.getCurrent(), 'no closing lines before the puzzle is solved');
  assert.ok(calls(p, 'sendInterface').some(row => row[1] === INTERFACE), 'trail_slidepuzzle opens');
  assert.ok(calls(p, 'sendConfig').some(row => row[1] === IF1 && row[2] === 7), 'if1 7: CS2 690 draws inventory 221');
  const sent = board(p);
  assert.deepEqual([...sent].sort((a, b) => a - b), [-1, ...Array(24).keys()], 'the 24 pieces and one blank');
  assert.notDeepEqual(sent, solvedBoard(), 'the board is scrambled');
});

test('a piece away from the blank does not move; the board is sent again', () => {
  Math.random = () => 0;
  const p = player(STAGE_DAERO, 5);
  operatePanel(p);
  const before = board(p);
  const blank = before.indexOf(-1);
  const far = before.findIndex((_, slot) => slot !== blank && !neighbours(blank).includes(slot));
  const sends = calls(p, 'sendInventory').length;
  clickSlot(p, far);
  assert.deepEqual(board(p), before);
  assert.equal(calls(p, 'sendInventory').length, sends + 1, 'resent so the client snaps back');
  assert.equal(quest.getStage(p), STAGE_DAERO);
});

for (const [name, seed] of [['a scramble whose blank oscillates (Math.random = 0)', null], ['a scramble from a fixed pseudo-random sequence', 7]]) {
  test(`sliding the last piece home closes the puzzle and plays the closing lines that reinitialise the hangar: ${name}`, () => {
    const generator = () => seed === null ? () => 0 : sequence(seed);
    Math.random = generator();
    const p = player(STAGE_DAERO, 5);
    operatePanel(p);
    const way = solutionFor(generator());
    assert.equal(way.length, 101);
    let moved = board(p);
    assert.notDeepEqual(moved, solvedBoard(), 'scrambled');
    for (const slot of way.slice(0, -1)) {
      clickSlot(p, slot);
      assert.notDeepEqual(board(p), moved, `slot ${slot} was a legal slide`);
      moved = board(p);
      assert.equal(quest.getStage(p), STAGE_DAERO, 'unsolved until the last slide');
    }
    assert.equal(calls(p, 'sendInterfaceRemoval').length, 0);
    clickSlot(p, way.at(-1));
    assert.deepEqual(board(p), solvedBoard());
    assert.equal(calls(p, 'sendInterfaceRemoval').length, 1, 'the puzzle closes');
    for (let guard = 0; quest.getStage(p) < STAGE_REINITIALISED && p.manager.getCurrent() && guard < 80; guard++) p.manager.advance();
    assert.equal(quest.getStage(p), STAGE_REINITIALISED);
    assert.equal(p.getAttribute(DAERO_STATE), 6);
  });
}

test('a puzzle left open while Glough reinitialises the hangar does not replay the closing lines', () => {
  Math.random = () => 0;
  const p = player(STAGE_DAERO, 5);
  operatePanel(p);
  const way = solutionFor(() => 0);
  quest.setStage(p, STAGE_REINITIALISED); // Glough's 200,000 coins
  for (const slot of way) clickSlot(p, slot);
  assert.equal(calls(p, 'sendInterfaceRemoval').length, 0);
  assert.ok(!p.manager.getCurrent());
});

test('controls: another player, a puzzle box on the shared interface, and a panel not yet asked for', () => {
  Math.random = () => 0;
  const p = player(STAGE_DAERO, 5), other = player(STAGE_DAERO, 5);
  operatePanel(p);
  const sends = calls(p, 'sendInventory').length;
  clickSlot(other, 1);
  assert.equal(calls(p, 'sendInventory').length, sends, 'another player has no board here');
  assert.equal(calls(other, 'sendInventory').length, 0);
  // A puzzle box takes the shared interface: its clicks are its own.
  api.emitCustomEvent('sliding-puzzle:opened', { player: p, source: 'box' });
  clickSlot(p, 1);
  assert.equal(calls(p, 'sendInventory').length, sends, 'the panel board no longer answers');
  const early = player(STAGE_DAERO, 1);
  operatePanel(early);
  assert.equal(calls(early, 'sendInterface').length, 0, 'before Waydar sets the task the panel opens no puzzle');
  assert.equal(quest.getStage(early), STAGE_DAERO);
});
