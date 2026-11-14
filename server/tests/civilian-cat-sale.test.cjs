// From server/ after `yarn build`: node --test tests/civilian-cat-sale.test.cjs
// RSPSApp/tsps#5295: West Ardougne civilians buy adult, overgrown, wily, lazy and hell cats for 100 Death
// runes (200 once the Ardougne easy diary is complete), by "use the cat on a civilian" and by Talk-to.
// Sellable cats are read from Pets' own pet table (__internals.PETS), not copied here. Kittens and the
// Witch's cat are refused.
// Handler layer: the item-on-NPC and dialogue hooks are called directly with event objects, the way the
// plugin API delivers them. The diary, pet-table and follower state are supplied by stubs on the same
// custom-event names the production plugins answer. Runes, inventory and messages are an in-memory model.
// Not covered: the packet/menu dispatch, the real dialogue runtime's variant choice for civilians 1-3,
// the live full-inventory text, and any natural playthrough.
const assert = require('node:assert/strict');
const path = require('node:path');
const { test, before } = require('node:test');
const { Server } = require('../dist/Server');
Server.installProductionPathResolver();
const { CachePipeline } = require('../dist/game/cache/CachePipeline');
const { PluginManager } = require('../dist/plugins/PluginManager');
const { Location } = require('../dist/game/model/Location');
const PetsPlugin = require('../plugins/npcs/Pets.plugin.js');

const core = PluginManager.getCoreApi();
const ITEM = core.ItemIdentifiers;
const NPC = core.NpcIdentifiers;
const DEATH_RUNE = ITEM.DEATH_RUNE;
const CIVILIAN_IDS = [NPC.CIVILIAN, NPC.CIVILIAN_2, NPC.CIVILIAN_3];
const PLUGIN_PATH = '../plugins/npcs/CivilianCats.plugin.js';

// The sellable and refused cats, from Pets' pet table. Family = enumName prefix.
const PETS = PetsPlugin.__internals.PETS;
const SELLABLE_ENUM = /^(PET_CAT|OVERGROWN_CAT|OVERGROWN_HELLCAT|HELLCAT|WILY_CAT|WILY_HELLCAT|LAZY_CAT|LAZY_HELLCAT)/;
const SELLABLE_ITEM_IDS = PETS.filter((pet) => SELLABLE_ENUM.test(pet.enumName)).map((pet) => pet.itemId);
const KITTEN_ITEM_IDS = PETS.filter((pet) => /KITTEN/.test(pet.enumName)).map((pet) => pet.itemId);
const WITCHS_CAT_IDS = [ITEM.WITCHS_CAT, ITEM.WITCHS_CAT_2];

before(async () => {
  await CachePipeline.initialize(path.resolve(__dirname, '..'));
});

function loadPlugin() {
  try {
    return require(PLUGIN_PATH);
  } catch (error) {
    // BEFORE: the civilian plugin is absent, so the harness has no handlers at all.
    if (error && error.code === 'MODULE_NOT_FOUND') return null;
    throw error;
  }
}

function harness({ diaryDone = false, pets = [], coins = 0, full = false, runes = 0, followingCat = null } = {}) {
  const handlers = { itemOnNpc: [], condition: [], action: [], custom: new Map() };
  const api = new Proxy({
    core,
    persistAttribute() {},
    onItemOnNpc(fn) { handlers.itemOnNpc.push(fn); },
    onNpcDialogueCondition(fn) { handlers.condition.push(fn); },
    onNpcDialogueVariant() {},
    onCustomEvent(name, fn) {
      if (name === 'npc-dialogue:action') handlers.action.push(fn);
      const list = handlers.custom.get(name) ?? [];
      list.push(fn);
      handlers.custom.set(name, list);
    },
    emitCustomEvent(name, event) { for (const fn of handlers.custom.get(name) ?? []) fn(event); },
  }, { get(target, key) { return target[key] ?? (() => {}); } });

  // Stubs for the production answers this plugin asks for.
  handlers.custom.set('pets:definitions', [(request) => { request.pets = PETS; }]);
  handlers.custom.set('pets:current', [(request) => { request.pet = followingCat; }]);
  handlers.custom.set('diary:is-complete', [(request) => {
    if (request.diary === 'ardougne' && request.tier === 'easy') request.complete = diaryDone;
  }]);

  const plugin = loadPlugin();
  if (plugin) plugin.register(api);

  const counts = new Map();
  const messages = [];
  const attrs = new Map();
  const inventory = {
    getAmount: (id) => counts.get(id) ?? 0,
    deleteNumber(id, count) {
      const left = (counts.get(id) ?? 0) - count;
      if (left > 0) counts.set(id, left); else counts.delete(id);
    },
    // A full bag takes only a stack it already holds (death runes stack; a cat never does).
    adds(id, count) {
      if (full && (counts.get(id) ?? 0) === 0) return false;
      counts.set(id, (counts.get(id) ?? 0) + count);
      return true;
    },
    isFull: () => full,
    getFreeSlots: () => (full ? 0 : 28),
    getItems: () => [],
  };
  for (const id of pets) inventory.adds(id, 1);
  if (coins > 0) inventory.adds(ITEM.COINS, coins);
  if (runes > 0) inventory.adds(DEATH_RUNE, runes);

  const sender = new Proxy({}, { get: (_, name) => (name === 'then' ? undefined : () => sender) });
  const player = {
    getUsername: () => 'civilian-cat-test',
    getIndex: () => 4,
    isRegistered: () => true,
    isPlayer: () => true,
    getHitpoints: () => 10,
    getInventory: () => inventory,
    getEquipment: () => ({ get: () => null, getItems: () => [] }),
    getAttribute: (key) => attrs.get(key),
    setAttribute: (key, value) => attrs.set(key, value),
    getLocation: () => new Location(2470, 3300, 0),
    getPrivateArea: () => null,
    getPacketSender: () => sender,
    sendMessage: (message) => messages.push(message),
  };

  const npc = (id) => ({ getId: () => id, isRegistered: () => true, getLocation: () => new Location(2470, 3300, 0) });
  const useItem = (itemId, targetId) => {
    const event = { player, target: npc(targetId), itemId, handled: false };
    for (const fn of handlers.itemOnNpc) fn(event);
    return event;
  };
  // The Civilian transcript's condition steps (D84Vce "If the player has a cat with them", and so on).
  const condition = (stepId, targetId) => {
    let result;
    for (const fn of handlers.condition) {
      const value = fn({ player, npcId: targetId, npc: npc(targetId), stepId });
      if (value !== undefined) result = value;
    }
    return result;
  };
  // The transcript's action step (s3pDQD "100 or 200 death runes") and the choice that leads to it.
  const action = (stepId, targetId) => {
    const event = { player, npcId: targetId, npc: npc(targetId), stepId, handled: false };
    for (const fn of handlers.action) fn(event);
    return event;
  };
  return { player, inventory, counts, messages, useItem, condition, action, handlers };
}

const runesOf = (h) => h.counts.get(DEATH_RUNE) ?? 0;

test('item route: an adult cat used on a civilian is taken and pays 100 Death runes (diary incomplete)', () => {
  const h = harness({ pets: [ITEM.PET_CAT] });
  const event = h.useItem(ITEM.PET_CAT, NPC.CIVILIAN);
  assert.equal(event.handled, true, 'the civilian takes the cat');
  assert.equal(h.inventory.getAmount(ITEM.PET_CAT), 0, 'the cat is removed permanently');
  assert.equal(runesOf(h), 100, '100 Death runes for an adult cat without the diary');
});

test('item route: with the Ardougne easy diary complete the same sale pays 200 Death runes', () => {
  const h = harness({ diaryDone: true, pets: [ITEM.PET_CAT] });
  const event = h.useItem(ITEM.PET_CAT, NPC.CIVILIAN);
  assert.equal(event.handled, true, 'the civilian takes the cat');
  assert.equal(h.inventory.getAmount(ITEM.PET_CAT), 0, 'the cat is removed permanently');
  assert.equal(runesOf(h), 200, '200 Death runes after the easy diary');
});

test('item route: every sellable cat family (overgrown, wily, lazy, hell) sells, one item id at a time', () => {
  assert.ok(SELLABLE_ITEM_IDS.length >= 28, `derived sellable set has ${SELLABLE_ITEM_IDS.length} ids (6 adult, 6 overgrown, 6 wily, 6 lazy, 4 hell)`);
  for (const itemId of SELLABLE_ITEM_IDS) {
    const h = harness({ pets: [itemId] });
    const event = h.useItem(itemId, NPC.CIVILIAN);
    assert.equal(event.handled, true, `item ${itemId} is taken by a civilian`);
    assert.equal(h.inventory.getAmount(itemId), 0, `item ${itemId} is removed`);
    assert.equal(runesOf(h), 100, `item ${itemId} pays 100`);
  }
});

test('item route: each civilian NPC id (3505-3507) accepts the sale', () => {
  for (const npcId of CIVILIAN_IDS) {
    const h = harness({ pets: [ITEM.PET_CAT] });
    assert.equal(h.useItem(ITEM.PET_CAT, npcId).handled, true, `civilian ${npcId} takes the cat`);
    assert.equal(runesOf(h), 100, `civilian ${npcId} pays 100`);
  }
});

test('talk-to route: the cat choice is offered and the transcript action step pays and takes the cat', () => {
  const h = harness({ pets: [ITEM.PET_CAT] });
  assert.equal(h.condition('D84Vce', NPC.CIVILIAN), true, '"If the player has a cat with them" is true');
  const event = h.action('s3pDQD', NPC.CIVILIAN);
  assert.equal(event.handled, true, 'the 100 or 200 death runes step is handled');
  assert.equal(h.inventory.getAmount(ITEM.PET_CAT), 0, 'the cat is handed over');
  assert.equal(runesOf(h), 100, 'the talk-to sale pays 100 without the diary');
});

test('talk-to route: the easy diary doubles the pay on the same transcript step', () => {
  const h = harness({ diaryDone: true, pets: [ITEM.PET_CAT] });
  h.action('s3pDQD', NPC.CIVILIAN);
  assert.equal(runesOf(h), 200, 'the talk-to sale pays 200 after the easy diary');
});

test('refusals: kittens, the Witch\'s cat, a non-cat item and a non-civilian NPC change nothing', () => {
  assert.ok(KITTEN_ITEM_IDS.length >= 7, `kitten ids from the pet table: ${KITTEN_ITEM_IDS.length}`);
  for (const itemId of [...KITTEN_ITEM_IDS, ...WITCHS_CAT_IDS]) {
    const h = harness({ pets: [itemId] });
    const event = h.useItem(itemId, NPC.CIVILIAN);
    assert.equal(event.handled, false, `item ${itemId} is refused`);
    assert.equal(h.inventory.getAmount(itemId), 1, `item ${itemId} is kept`);
    assert.equal(runesOf(h), 0, `no runes for item ${itemId}`);
  }
  const coins = harness({ coins: 50 });
  assert.equal(coins.useItem(ITEM.COINS, NPC.CIVILIAN).handled, false, 'coins are not a cat');
  const notCivilian = harness({ pets: [ITEM.PET_CAT] });
  assert.equal(notCivilian.useItem(ITEM.PET_CAT, 1).handled, false, 'a non-civilian NPC does not buy cats');
  assert.equal(notCivilian.inventory.getAmount(ITEM.PET_CAT), 1, 'the cat is kept when no civilian is used');
  const kittenTalk = harness({ pets: [KITTEN_ITEM_IDS[0]] });
  assert.notEqual(kittenTalk.condition('D84Vce', NPC.CIVILIAN), true, 'a kitten does not offer the cat choice');
});

test('full bag: with no death-rune stack to add to, the sale does not happen and the cat is kept (text not asserted)', () => {
  const h = harness({ pets: [ITEM.PET_CAT], full: true });
  h.useItem(ITEM.PET_CAT, NPC.CIVILIAN);
  assert.equal(h.inventory.getAmount(ITEM.PET_CAT), 1, 'the cat is kept');
  assert.equal(runesOf(h), 0, 'no runes are granted');
});

test('full bag holding death runes: the runes stack onto the existing stack and the sale is valid', () => {
  const h = harness({ pets: [ITEM.PET_CAT], full: true, runes: 40 });
  const event = h.useItem(ITEM.PET_CAT, NPC.CIVILIAN);
  assert.equal(event.handled, true, 'a full bag still sells onto an existing death-rune stack');
  assert.equal(h.inventory.getAmount(ITEM.PET_CAT), 0, 'the cat is removed');
  assert.equal(runesOf(h), 140, '100 runes stack onto the existing 40');
});

test('after a sale the player holds no cat or kitten item, so a Gertrude replacement is not blocked', () => {
  const h = harness({ pets: [ITEM.PET_CAT], followingCat: null });
  h.useItem(ITEM.PET_CAT, NPC.CIVILIAN);
  const kittenHeld = [...KITTEN_ITEM_IDS].some((id) => h.inventory.getAmount(id) > 0);
  assert.equal(kittenHeld, false, 'no kitten item is held (Gertrude gates on this)');
  assert.equal(h.inventory.getAmount(ITEM.PET_CAT), 0, 'no adult cat is left to block a replacement');
  const current = { player: h.player, pet: undefined };
  h.handlers.custom.get('pets:current').forEach((fn) => fn(current));
  assert.equal(current.pet, undefined, 'no follower is recorded');
});
