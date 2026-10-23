// From server/: node --test tests/qh728-q107.test.cjs (after the baseline build).
// Focused Song of the Elves source contracts. Each case fixture-sets the stage
// and inventory state that the transcript route would have produced, then calls
// the real registered handler. This proves those handler contracts only; it is
// not a natural playthrough of the route.
const assert = require('node:assert/strict');
const { test, before } = require('node:test');
const path = require('node:path');
const { Server } = require('../dist/Server');
Server.installProductionPathResolver();
const { PluginManager } = require('../dist/plugins/PluginManager');
const { CachePipeline } = require('../dist/game/cache/CachePipeline');
const { Inventory } = require('../dist/game/model/container/impl/Inventory');
const { Item } = require('../dist/game/model/Item');
const runtime = require('../plugins/quests/QuestRuntime');
const core = PluginManager.getCoreApi();
const noop = () => {};

const STAGE_ATTR = 'quest.song_of_the_elves.stage';
const LATE_CHAPTER = 'quest.song_of_the_elves.late-chapter';
const FRAGMENT_DEFEATED = 'quest.song_of_the_elves.fragment-defeated';
const WAR_END_DONE = 'quest.song_of_the_elves.war-end-arianwyn-done';
const FALLS_PILLARS = 'quest.song_of_the_elves.falls-pillars';
const FALLS_ORDER = 'quest.song_of_the_elves.falls-order';
const FALLS_BOOK_READ = 'song-of-the-elves:falls-book-read';
const START_HOOK = 'quest:song-of-the-elves:start';
const REWARD_SKILLS = [core.Skill.AGILITY, core.Skill.CONSTRUCTION, core.Skill.FARMING,
  core.Skill.HERBLORE, core.Skill.HUNTER, core.Skill.MINING, core.Skill.SMITHING,
  core.Skill.WOODCUTTING];

before(async () => {
  await CachePipeline.initialize(path.resolve(__dirname, '..'));
});

function makePlayer() {
  const attrs = new Map();
  const items = new Map();
  const messages = [];
  const xp = new Map();
  const equipment = new Map();
  let location = new core.Location(0, 0, 0);
  const inventory = {
    getAmount: id => items.get(id) ?? 0,
    contains: id => (items.get(id) ?? 0) > 0,
    adds: (id, amount = 1) => { items.set(id, (items.get(id) ?? 0) + amount); return true; },
    deleteNumber: (id, amount = 1) => {
      items.set(id, Math.max(0, (items.get(id) ?? 0) - amount));
      return true;
    },
    getFreeSlots: () => 28 - [...items.values()].filter(amount => amount > 0).length,
    isFull: () => inventory.getFreeSlots() <= 0,
    full: () => messages.push('Not enough space in your inventory.'),
    getItems: () => [],
  };
  let activeInventory = inventory;
  const skillManager = {
    getMaxLevel: () => 99,
    addExperience: (skill, amount) => xp.set(skill.index, (xp.get(skill.index) ?? 0) + amount),
  };
  const sender = new Proxy({}, { get: () => (...args) => sender });
  return {
    attrs, items, messages, xp, equipment,
    amount: id => items.get(id) ?? 0,
    setStage(value) { attrs.set(STAGE_ATTR, value); },
    getStage() { return attrs.get(STAGE_ATTR) ?? 0; },
    getAttribute: key => attrs.get(key),
    setAttribute: (key, value) => attrs.set(key, value),
    getInventory: () => activeInventory,
    setInventory: value => { activeInventory = value; },
    getEquipment: () => ({ get: slot => equipment.has(slot) ? { getId: () => equipment.get(slot) } : null }),
    getSkillManager: () => skillManager,
    getUsername: () => 'sote-test',
    getLocation: () => location,
    setLocation: (x, y, z = 0) => { location = new core.Location(x, y, z); },
    getDialogueManager: () => ({ isActive: () => false, getCurrent: () => null, startDialogues: noop,
      handleResume: noop, reset: noop }),
    getPacketSender: () => sender,
    sendMessage: text => messages.push(text),
    isRegistered: () => true,
  };
}

function harness() {
  const events = {};
  const itemOnItem = [];
  const itemOnObject = [];
  const objectInteraction = [];
  const namedObjectInteraction = new Map();
  const variants = [];
  const api = new Proxy({
    core,
    persistAttribute: noop,
    onItemOnItem: handler => itemOnItem.push(handler),
    onItemOnObject: (first) => { if (typeof first === 'function') itemOnObject.push(first); },
    onNpcDialogueVariant: handler => variants.push(handler),
    onObjectInteraction: (first, second) => {
      if (typeof first === 'function') objectInteraction.push(first);
      else namedObjectInteraction.set(first, second);
    },
    onCustomEvent: (key, handler) => (events[key] ??= []).push(handler),
    emitCustomEvent: (key, event) => (events[key] ?? []).forEach(handler => handler(event)),
  }, { get: (target, key) => target[key] ?? noop });
  require('../plugins/quests/quests/SongOfTheElves.Quest')(api);
  // The required prerequisite quests are outside this quest's registration.
  (events['quest:is-complete'] ??= []).push(request => { if (request.player) request.complete = true; });
  const dispatch = (key, event) => {
    if (key === 'item-on-item') return itemOnItem.forEach(handler => handler(event));
    if (key === 'item-on-object') return itemOnObject.forEach(handler => handler(event));
    if (key === 'object-interaction') return objectInteraction.forEach(handler => handler(event));
    return (events[key] ?? []).forEach(handler => handler(event));
  };
  return {
    events, dispatch, variants,
    object(name, option, event) { return namedObjectInteraction.get(name)?.[option]?.(event) ?? false; },
    quest: runtime.getRegisteredQuests().find(q => q.key === 'song_of_the_elves'),
  };
}

test('fresh stage 0: the Edmond start hook starts the quest; an unknown hook does not', () => {
  const h = harness();
  const p = makePlayer();
  h.dispatch('npc-dialogue:hook', { player: p, hook: 'quest:not-this-quest' });
  assert.equal(p.getStage(), 0);
  h.dispatch('npc-dialogue:hook', { player: p, hook: START_HOOK });
  assert.equal(p.getStage(), 10);
  assert.equal(h.quest.isStarted(p), true);
});

test('making the inversion potion consumes each ingredient into the next item', () => {
  const h = harness();
  const p = makePlayer();
  p.setStage(120); // chapter 11, preparing to enter Prifddinas
  p.items.set(core.ItemIdentifiers.ELDER_CADANTINE, 1);
  p.items.set(core.ItemIdentifiers.VIAL_OF_WATER, 1);
  const unfinished = { player: p, usedItemId: core.ItemIdentifiers.ELDER_CADANTINE,
    usedWithItemId: core.ItemIdentifiers.VIAL_OF_WATER, handled: false };
  h.dispatch('item-on-item', unfinished);
  assert.equal(unfinished.handled, true);
  assert.equal(p.amount(core.ItemIdentifiers.ELDER_CADANTINE), 0);
  assert.equal(p.amount(core.ItemIdentifiers.VIAL_OF_WATER), 0);
  assert.equal(p.amount(core.ItemIdentifiers.ELDER_CADANTINE_POTION_UNF_), 1);
  assert.equal(p.amount(core.ItemIdentifiers.INVERSION_POTION), 0);

  p.items.set(core.ItemIdentifiers.CRYSTAL_DUST, 1);
  const potion = { player: p, usedItemId: core.ItemIdentifiers.CRYSTAL_DUST,
    usedWithItemId: core.ItemIdentifiers.ELDER_CADANTINE_POTION_UNF_, handled: false };
  h.dispatch('item-on-item', potion);
  assert.equal(potion.handled, true);
  assert.equal(p.amount(core.ItemIdentifiers.CRYSTAL_DUST), 0);
  assert.equal(p.amount(core.ItemIdentifiers.ELDER_CADANTINE_POTION_UNF_), 0);
  assert.equal(p.amount(core.ItemIdentifiers.INVERSION_POTION), 1);
});

test('Baxtorian pillar: a correctly numbered offering is consumed, a wrong one resets the puzzle and is consumed', () => {
  const h = harness();
  const p = makePlayer();
  p.setStage(110); // chapter 10, Baxtorian Falls
  p.setAttribute(FALLS_BOOK_READ, true);
  p.setAttribute(FALLS_ORDER, '0,1,2,3,4,5');
  p.items.set(core.ItemIdentifiers.NATURE_RUNE, 1);
  const good = { player: p, itemId: core.ItemIdentifiers.NATURE_RUNE, location: { x: 2600, y: 9909, z: 0 }, handled: false };
  h.dispatch('item-on-object', good);
  assert.equal(good.handled, true);
  assert.equal(p.amount(core.ItemIdentifiers.NATURE_RUNE), 0);
  assert.equal(Number(p.getAttribute(FALLS_PILLARS)) & 1, 1);

  p.items.set(core.ItemIdentifiers.CABBAGE, 1);
  const wrong = { player: p, itemId: core.ItemIdentifiers.CABBAGE, location: { x: 2600, y: 9911, z: 0 }, handled: false };
  h.dispatch('item-on-object', wrong);
  assert.equal(wrong.handled, true);
  assert.equal(p.amount(core.ItemIdentifiers.CABBAGE), 0);
  assert.equal(Number(p.getAttribute(FALLS_PILLARS)), 0);
  assert.equal(String(p.getAttribute(FALLS_ORDER)).split(',').length, 6);
});

test('final hand-in requires Arianwyn farewell, completes once, and awards 4 QP and the eight XP rewards once', () => {
  const h = harness();
  const p = makePlayer();
  p.setStage(190);
  p.setAttribute(LATE_CHAPTER, 20);
  p.setAttribute(FRAGMENT_DEFEATED, true);
  const blocked = { player: p, stepId: 'W-ainS', kind: 'action', handled: false };
  h.dispatch('npc-dialogue:action', blocked);
  assert.equal(blocked.handled, true);
  assert.equal(h.quest.isComplete(p), false);
  assert.ok(p.messages.some(text => text.includes('Finish Arianwyn')));

  p.setAttribute(WAR_END_DONE, true);
  const finish = { player: p, stepId: 'W-ainS', kind: 'action', handled: false };
  h.dispatch('npc-dialogue:action', finish);
  assert.equal(h.quest.isComplete(p), true);
  assert.equal(p.getStage(), 200);
  assert.equal(p.getAttribute('quest.points'), 4);
  for (const skill of REWARD_SKILLS) assert.equal(p.xp.get(skill.index), 40000, `skill ${skill.index}`);
  assert.ok(p.messages.some(text => text.includes("Congratulations, you've completed a quest")));

  const repeat = { player: p, stepId: 'W-ainS', kind: 'action', handled: false };
  h.dispatch('npc-dialogue:action', repeat);
  assert.equal(p.getAttribute('quest.points'), 4);
  for (const skill of REWARD_SKILLS) assert.equal(p.xp.get(skill.index), 40000, `skill ${skill.index} rewarded once`);
});

test('post-quest talk selects the canonical after-Song-of-the-Elves variant for shared named NPCs', () => {
  const h = harness();
  const p = makePlayer();
  p.setStage(200);
  const select = (name, page, variants) => h.variants[0]({
    player: p,
    definition: { getName: () => name },
    pages: [{ page, variants }],
  });
  assert.deepEqual(select('Edmond', 'Edmond',
    ['standard-dialogue-after-plague-city', 'standard-dialogue-after-the-song-of-the-elves-quest']),
    { page: 'Edmond', variant: 'standard-dialogue-after-the-song-of-the-elves-quest' });
  assert.deepEqual(select('Elena', 'Elena',
    ['after-mourning-s-end-part-i', 'after-song-of-the-elves']),
    { page: 'Elena', variant: 'after-song-of-the-elves' });
  assert.deepEqual(select('Alrena', 'Alrena',
    ['standard-dialogue-after-mourning-s-end-part-ii', 'standard-dialogue-after-song-of-the-elves']),
    { page: 'Alrena', variant: 'standard-dialogue-after-song-of-the-elves' });
  assert.equal(select('Edmond', 'Edmond (merchant)', ['standard-dialogue']), null,
    'the ordinary merchant Edmond page is not hijacked');
});

test('Elena prison chemical: cabinet choice grants the selected liquid and handover consumes it and the acid', () => {
  const h = harness();
  const p = makePlayer();
  p.setStage(30); // chapter 2, freeing Elena
  h.dispatch('npc-dialogue:choice', { player: p, option: 'The thick clear liquid.',
    definition: { getName: () => 'Elena' } });
  h.dispatch('npc-dialogue:action', { player: p, stepId: 'QMXa3C', kind: 'message' });
  assert.equal(p.amount(core.ItemIdentifiers.CLEAR_LIQUID), 1);
  assert.equal(p.getAttribute('song-of-the-elves:elena-escape-progress'), 24);
  p.items.set(core.ItemIdentifiers.SULPHURIC_ACID, 1);
  h.dispatch('npc-dialogue:action', { player: p, stepId: 'PZ3EOG', kind: 'action' });
  assert.equal(p.amount(core.ItemIdentifiers.CLEAR_LIQUID), 0);
  assert.equal(p.amount(core.ItemIdentifiers.SULPHURIC_ACID), 0);
  assert.equal(p.getAttribute('song-of-the-elves:elena-escape-progress'), 26);
});

test('incitement recruit action needs the matching disguise and awards support once per citizen', () => {
  const h = harness();
  const p = makePlayer();
  p.setStage(50); // chapter 4, causing an insurrection
  const mourner = [[core.Equipment.HEAD_SLOT, core.ItemIdentifiers.GAS_MASK],
    [core.Equipment.BODY_SLOT, core.ItemIdentifiers.MOURNER_TOP],
    [core.Equipment.LEG_SLOT, core.ItemIdentifiers.MOURNER_TROUSERS],
    [core.Equipment.HANDS_SLOT, core.ItemIdentifiers.MOURNER_GLOVES],
    [core.Equipment.FEET_SLOT, core.ItemIdentifiers.MOURNER_BOOTS],
    [core.Equipment.CAPE_SLOT, core.ItemIdentifiers.MOURNER_CLOAK]];
  const event = { player: p, action: 'recruit-resistance', definition: { getName: () => 'Priest' },
    npc: { getSpawnPosition: () => new core.Location(2527, 3287, 0) } };
  h.dispatch('npc-dialogue:action', event);
  assert.equal(p.getAttribute('quest.song_of_the_elves.resistance-members'), undefined,
    'no support is awarded without the mourner outfit');
  for (const [slot, id] of mourner) p.equipment.set(slot, id);
  h.dispatch('npc-dialogue:action', event);
  assert.equal(p.getAttribute('quest.song_of_the_elves.resistance-members'), 6);
  h.dispatch('npc-dialogue:action', event);
  assert.equal(p.getAttribute('quest.song_of_the_elves.resistance-members'), 6,
    'the same citizen is only recruited once');
});

test('Ithell statue build consumes exactly eight limestone bricks and keeps the tools', () => {
  const h = harness();
  const p = makePlayer();
  p.setStage(170); // chapter 16, after the attack
  p.setAttribute('quest.song_of_the_elves.ithell-clue-stage', 2);
  p.items.set(core.ItemIdentifiers.LIMESTONE_BRICK, 8);
  p.items.set(core.ItemIdentifiers.SAW, 1);
  p.items.set(core.ItemIdentifiers.HAMMER, 1);
  const build = { player: p, option: 'build', objectId: 37308, location: { x: 2337, y: 3170, z: 0 }, handled: false };
  h.dispatch('object-interaction', build);
  assert.equal(build.handled, true);
  assert.equal(p.amount(core.ItemIdentifiers.LIMESTONE_BRICK), 0);
  assert.equal(p.amount(core.ItemIdentifiers.SAW), 1);
  assert.equal(p.amount(core.ItemIdentifiers.HAMMER), 1);
  assert.equal(p.getAttribute('quest.song_of_the_elves.ithell-statue'), true);
});

test('Ardougne knight disguise: helm dye and tabard-on-platebody consume their inputs at chapter 1', () => {
  const h = harness();
  const p = makePlayer();
  p.setStage(20); // chapter 1, making a knightly disguise
  p.items.set(core.ItemIdentifiers.STEEL_FULL_HELM, 1);
  p.items.set(core.ItemIdentifiers.RED_DYE, 1);
  h.dispatch('npc-dialogue:action', { player: p, stepId: '_moa2Q', kind: 'action' });
  assert.equal(p.amount(core.ItemIdentifiers.STEEL_FULL_HELM), 0);
  assert.equal(p.amount(core.ItemIdentifiers.RED_DYE), 0);
  assert.equal(p.amount(core.ItemIdentifiers.ARDOUGNE_KNIGHT_HELM), 1);

  p.items.set(core.ItemIdentifiers.STEEL_PLATEBODY, 1);
  p.items.set(core.ItemIdentifiers.ARDOUGNE_KNIGHT_TABARD, 1);
  h.dispatch('npc-dialogue:action', { player: p, stepId: 'I5Jusz', kind: 'action' });
  assert.equal(p.amount(core.ItemIdentifiers.STEEL_PLATEBODY), 0);
  assert.equal(p.amount(core.ItemIdentifiers.ARDOUGNE_KNIGHT_TABARD), 0);
  assert.equal(p.amount(core.ItemIdentifiers.ARDOUGNE_KNIGHT_PLATEBODY), 1);
});

test('mandatory Song of the Elves handouts refuse a full inventory and retry after space is freed', () => {
  const h = harness();
  const p = makePlayer();
  const inventory = new Inventory(p);
  for (const id of new Set(Object.values(core.ItemIdentifiers))) {
    if (Number.isInteger(id) && id > 0 && inventory.getFreeSlots() > 0) inventory.adds(id, 1);
  }
  assert.equal(inventory.getFreeSlots(), 0, 'cache-backed inventory is full');
  p.setInventory(inventory);

  const chemical = { player: p, stepId: 'QMXa3C', kind: 'action', handled: false };
  p.setStage(30); // Chapter 2, the Elena prison cabinet.
  h.dispatch('npc-dialogue:action', chemical);
  assert.equal(chemical.handled, true);
  assert.equal(inventory.getAmount(core.ItemIdentifiers.CLEAR_LIQUID), 0);
  assert.ok(p.messages.some(text => text.includes('Make room in your inventory')));

  const ode = { player: p, stepId: '5Ndx0y', kind: 'message', handled: false };
  p.setStage(110); // Chapter 10, the waterfall book.
  h.dispatch('npc-dialogue:action', ode);
  assert.equal(ode.handled, true);
  assert.equal(inventory.getAmount(core.ItemIdentifiers.ODE_TO_ETERNITY), 0);

  const keyEvent = { player: p, location: new core.Location(2589, 9888, 0), handled: false };
  assert.equal(h.object('Crate', 'Search', keyEvent), true);
  assert.equal(keyEvent.handled, true);
  assert.equal(inventory.getAmount(core.ItemIdentifiers.KEY_18), 0);
  const keyRetrySlot = inventory.getItems().findIndex(item => item.getId() > 0);
  const filler = inventory.getItems()[keyRetrySlot].clone();
  inventory.setItem(keyRetrySlot, new Item(-1, 0));
  const keyRetry = { player: p, location: new core.Location(2589, 9888, 0), handled: false };
  assert.equal(h.object('Crate', 'Search', keyRetry), true);
  assert.equal(inventory.getAmount(core.ItemIdentifiers.KEY_18), 1);
  inventory.deleteNumber(core.ItemIdentifiers.KEY_18, 1);
  inventory.setItem(keyRetrySlot, filler);
  assert.equal(inventory.getFreeSlots(), 0);

  const seed = { player: p, stepId: 'eS601c', kind: 'message', handled: false };
  p.setStage(120); // Chapter 11, the crystal seed handout.
  h.dispatch('npc-dialogue:action', seed);
  assert.equal(seed.handled, true);
  assert.equal(inventory.getAmount(core.ItemIdentifiers.CRYSTAL_SEED_3), 0);

  const explosives = { player: p, stepId: 'gBRsQm', kind: 'message', handled: false };
  p.setStage(180); // Chapter 17, Elena's seven stackable potions.
  h.dispatch('npc-dialogue:action', explosives);
  assert.equal(explosives.handled, true);
  assert.equal(inventory.getAmount(core.ItemIdentifiers.EXPLOSIVE_POTION_3), 0);

  const fillerSlot = inventory.getItems().findIndex(item => item.getId() > 0);
  inventory.setItem(fillerSlot, new Item(-1, 0));
  const retry = { player: p, stepId: 'eS601c', kind: 'message', handled: false };
  h.dispatch('npc-dialogue:action', retry);
  assert.equal(inventory.getAmount(core.ItemIdentifiers.CRYSTAL_SEED_3), 1);
  assert.deepEqual(retry.box, { items: [core.ItemIdentifiers.CRYSTAL_SEED_3] });
});
