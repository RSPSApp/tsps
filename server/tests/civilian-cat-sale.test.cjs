// From server/ after `yarn build`: node --test tests/civilian-cat-sale.test.cjs
// RSPSApp/tsps#5295: West Ardougne civilians (3505-3507) buy adult, overgrown, wily, lazy and hell cats for
// 100 Death runes (200 once the Ardougne easy diary is complete): by "use the cat on a civilian" and by
// Talk-to. Kittens and the Witch's cat are refused.
//
// Sources, none hand-typed:
// - sellable cats: Pets' own pet table (__internals.PETS), filtered by enumName;
// - Talk-to condition ids and the transaction step (s3pDQD "receive") and feedback step (gRYTQp):
//   read read-only from data/definitions/npc-dialogues.json at test time, per civilian variant;
// - inventory: the real Inventory class (stacking and full-bag semantics are its own);
// - diary: a stub on the same "diary:is-complete" event Achievement Diaries answers (Progress.isTierComplete
//   is not exercised here).
// Handler layer: the item-on-NPC, condition and action hooks are called directly with event objects. The
// variant-selection layer (which civilian shows which Talk-to variant) is NOT exercised: every test asks each
// civilian id against all three variants' condition ids. Packet/menu dispatch is not exercised.
// Controls (green on BEFORE): the refusal tests, the full-bag refusal, and the no-cat replacement check.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { test, before } = require('node:test');
const { Server } = require('../dist/Server');
Server.installProductionPathResolver();
const { CachePipeline } = require('../dist/game/cache/CachePipeline');
const { PluginManager } = require('../dist/plugins/PluginManager');
const { Inventory } = require('../dist/game/model/container/impl/Inventory');
const { Item } = require('../dist/game/model/Item');
const { Location } = require('../dist/game/model/Location');
const PetsPlugin = require('../plugins/npcs/Pets.plugin.js');

const core = PluginManager.getCoreApi();
const ITEM = core.ItemIdentifiers;
const NPC = core.NpcIdentifiers;
const DEATH_RUNE = ITEM.DEATH_RUNE;
const CIVILIAN_IDS = [NPC.CIVILIAN, NPC.CIVILIAN_2, NPC.CIVILIAN_3];
const PLUGIN_PATH = '../plugins/npcs/CivilianCats.plugin.js';
const TREE = JSON.parse(fs.readFileSync(path.resolve(__dirname, '../data/definitions/npc-dialogues.json'), 'utf8')).Civilian.variants;

const PETS = PetsPlugin.__internals.PETS;
const SELLABLE_ENUM = /^(PET_CAT|OVERGROWN_CAT|OVERGROWN_HELLCAT|HELLCAT|WILY_CAT|WILY_HELLCAT|LAZY_CAT|LAZY_HELLCAT)/;
const SELLABLE_ITEM_IDS = PETS.filter((pet) => SELLABLE_ENUM.test(pet.enumName)).map((pet) => pet.itemId);
const KITTEN_ITEM_IDS = PETS.filter((pet) => /KITTEN/.test(pet.enumName)).map((pet) => pet.itemId);
const WITCHS_CAT_IDS = [ITEM.WITCHS_CAT, ITEM.WITCHS_CAT_2];
const SALE_ADULT = ITEM.PET_CAT;

// Standard civilian variants (1-3): the Talk-to condition ids, by their written condition text.
const STANDARD_VARIANTS = Object.keys(TREE).filter((key) => key.startsWith('standard-dialogue-civilian-'));
function conditionIds(variant) {
  const found = { noCat: null, hasCat: null, witch: null };
  const visit = (node) => {
    if (Array.isArray(node)) return node.forEach(visit);
    if (!node || typeof node !== 'object') return;
    if (node.type === 'condition') {
      const text = String(node.text ?? '');
      if (/does not have a cat/i.test(text)) found.noCat = node.id;
      else if (/Witch's cat/i.test(text)) found.witch = node.id;
      else if (/has (a )?cat/i.test(text)) found.hasCat = node.id;
    }
    Object.values(node).forEach(visit);
  };
  visit(TREE[variant]);
  return found;
}
const SALE_VARIANT = TREE['using-a-cat-on-the-civilian'];
function stepOf(tree, predicate) {
  let hit = null;
  const visit = (node) => {
    if (hit || !node || typeof node !== 'object') return;
    if (Array.isArray(node)) return node.forEach(visit);
    if (predicate(node)) { hit = node; return; }
    Object.values(node).forEach(visit);
  };
  visit(tree);
  return hit;
}
const RECEIVE_STEP = stepOf(SALE_VARIANT, (node) => node.type === 'action' && node.action === 'receive');
const RECEIPT_MESSAGE = stepOf(SALE_VARIANT, (node) => node.type === 'message' && /You hand over the cat/.test(String(node.text ?? '')));
const RECEIVE_STEP_ID = RECEIVE_STEP?.id;
const RECEIPT_TEXT = String(RECEIPT_MESSAGE?.text ?? '');
const receiptFor = (price) => RECEIPT_TEXT.replace(/\[100\/200\]/g, String(price));

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

function harness({ diaryDone = false, items = [], full = false, followingCat = null } = {}) {
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

  handlers.custom.set('pets:definitions', [(request) => { request.pets = PETS; }]);
  handlers.custom.set('pets:current', [(request) => { request.pet = followingCat; }]);
  handlers.custom.set('diary:is-complete', [(request) => {
    if (request.diary === 'ardougne' && request.tier === 'easy') request.complete = diaryDone;
  }]);

  const plugin = loadPlugin();
  if (plugin) plugin.register(api);

  const messages = [];
  const attrs = new Map();
  const sender = new Proxy({}, { get: (_, name) => (name === 'then' ? undefined : () => sender) });
  const player = {
    getUsername: () => 'civilian-cat-test',
    getIndex: () => 4,
    isRegistered: () => true,
    isPlayer: () => true,
    getHitpoints: () => 10,
    getEquipment: () => ({ get: () => null, getItems: () => [] }),
    getAttribute: (key) => attrs.get(key),
    setAttribute: (key, value) => attrs.set(key, value),
    getLocation: () => new Location(2470, 3300, 0),
    getPrivateArea: () => null,
    getPacketSender: () => sender,
    sendMessage: (message) => messages.push(message),
  };
  const inventory = new Inventory(player);
  player.getInventory = () => inventory;
  // Items first; then, for a full bag, the empty slots are filled with a non-stackable item.
  items.forEach(([id, amount], slot) => inventory.setItem(slot, new Item(id, amount)));
  if (full) {
    for (let slot = 0; slot < 28; slot++) {
      if (!inventory.getItems()[slot]) inventory.setItem(slot, new Item(ITEM.BRONZE_DAGGER, 1));
    }
  }

  const npc = (id) => ({ getId: () => id, isRegistered: () => true, getLocation: () => new Location(2470, 3300, 0) });
  const useItem = (itemId, targetId) => {
    const event = { player, target: npc(targetId), itemId, handled: false };
    for (const fn of handlers.itemOnNpc) fn(event);
    return event;
  };
  // A Talk-to condition step: the value the plugin answers, or undefined if nothing answers.
  const condition = (stepId, targetId) => {
    let result;
    for (const fn of handlers.condition) {
      const value = fn({ player, npcId: targetId, npc: npc(targetId), stepId });
      if (value !== undefined) result = value;
    }
    return result;
  };
  const action = (stepId, targetId) => {
    const event = { player, npcId: targetId, npc: npc(targetId), stepId, handled: false };
    for (const fn of handlers.action) fn(event);
    return event;
  };
  return { player, inventory, messages, useItem, condition, action, handlers };
}

const runesOf = (h) => h.inventory.getAmount(DEATH_RUNE);
const catsOf = (h) => h.inventory.getAmount(SALE_ADULT);

test('item route: an adult cat used on a civilian is taken, pays 100 Death runes and gives the transcript receipt', () => {
  const h = harness({ items: [[SALE_ADULT, 1]] });
  const event = h.useItem(SALE_ADULT, NPC.CIVILIAN);
  assert.equal(event.handled, true, 'the civilian takes the cat');
  assert.equal(catsOf(h), 0, 'the cat is removed permanently');
  assert.equal(runesOf(h), 100, '100 Death runes without the diary');
  assert.deepEqual(h.messages, [receiptFor(100)], 'the receipt is the tree text, with the price filled in');
});

test('item route: with the Ardougne easy diary complete the same sale pays 200 Death runes and its receipt', () => {
  const h = harness({ diaryDone: true, items: [[SALE_ADULT, 1]] });
  assert.equal(h.useItem(SALE_ADULT, NPC.CIVILIAN).handled, true, 'the civilian takes the cat');
  assert.equal(catsOf(h), 0, 'the cat is removed');
  assert.equal(runesOf(h), 200, '200 Death runes after the easy diary');
  assert.deepEqual(h.messages, [receiptFor(200)], 'the receipt is the tree text with 200');
});

test('item route: every sellable cat family (overgrown, wily, lazy, hell) sells, one item id at a time', () => {
  assert.ok(SELLABLE_ITEM_IDS.length >= 28, `derived sellable set has ${SELLABLE_ITEM_IDS.length} ids`);
  for (const itemId of SELLABLE_ITEM_IDS) {
    const h = harness({ items: [[itemId, 1]] });
    assert.equal(h.useItem(itemId, NPC.CIVILIAN).handled, true, `item ${itemId} is taken by a civilian`);
    assert.equal(h.inventory.getAmount(itemId), 0, `item ${itemId} is removed`);
    assert.equal(runesOf(h), 100, `item ${itemId} pays 100`);
  }
});

test('item route: each civilian NPC id (3505, 3506, 3507) accepts the sale', () => {
  for (const npcId of CIVILIAN_IDS) {
    const h = harness({ items: [[SALE_ADULT, 1]] });
    assert.equal(h.useItem(SALE_ADULT, npcId).handled, true, `civilian ${npcId} takes the cat`);
    assert.equal(runesOf(h), 100, `civilian ${npcId} pays 100`);
  }
});

test('item route: two cats in the bag sell one; the second is still held and the pay is not doubled', () => {
  const h = harness({ items: [[SALE_ADULT, 2]] });
  assert.equal(h.useItem(SALE_ADULT, NPC.CIVILIAN).handled, true, 'the first use sells one cat');
  assert.equal(catsOf(h), 1, 'one cat is left');
  assert.equal(runesOf(h), 100, 'one sale, 100 runes');
  assert.equal(h.useItem(SALE_ADULT, NPC.CIVILIAN).handled, true, 'the second use sells the other');
  assert.equal(catsOf(h), 0, 'no cat is left');
  assert.equal(runesOf(h), 200, 'two sales, 200 runes in total');
});

test('item route: repeating the use after the cat is gone changes nothing', () => {
  const h = harness({ items: [[SALE_ADULT, 1]] });
  h.useItem(SALE_ADULT, NPC.CIVILIAN);
  const before = { cats: catsOf(h), runes: runesOf(h), messages: h.messages.length };
  h.useItem(SALE_ADULT, NPC.CIVILIAN);
  assert.equal(catsOf(h), before.cats, 'no cat is taken twice');
  assert.equal(runesOf(h), before.runes, 'no runes are paid twice');
  assert.equal(h.messages.length, before.messages, 'no second receipt');
});

test('talk-to conditions: for each civilian id and each standard variant, "has a cat" and "no cat" answer correctly', () => {
  for (const variant of STANDARD_VARIANTS) {
    const ids = conditionIds(variant);
    assert.ok(ids.noCat && ids.hasCat && ids.witch, `${variant} has the three condition ids`);
    for (const npcId of CIVILIAN_IDS) {
      const withCat = harness({ items: [[SALE_ADULT, 1]] });
      assert.equal(withCat.condition(ids.hasCat, npcId), true, `${variant}/${npcId}: "has a cat" is true with an adult cat`);
      assert.equal(withCat.condition(ids.noCat, npcId), false, `${variant}/${npcId}: "no cat" is false with an adult cat`);
      const noCat = harness({});
      assert.equal(noCat.condition(ids.noCat, npcId), true, `${variant}/${npcId}: "no cat" is true with no cat`);
      assert.equal(noCat.condition(ids.hasCat, npcId), false, `${variant}/${npcId}: "has a cat" is false with no cat`);
      const witch = harness({ items: [[WITCHS_CAT_IDS[0], 1]] });
      assert.equal(witch.condition(ids.witch, npcId), true, `${variant}/${npcId}: the Witch's cat branch is true`);
      assert.equal(witch.condition(ids.hasCat, npcId), false, `${variant}/${npcId}: "has a cat" is false with only the Witch's cat`);
    }
  }
});

test('talk-to action: the receive step pays 100, takes the cat and gives the receipt', () => {
  assert.ok(RECEIVE_STEP_ID, 'the transcript receive step exists in the generated tree');
  assert.ok(RECEIPT_TEXT.includes('You hand over the cat'), 'the receipt step exists in the same variant');
  const h = harness({ items: [[SALE_ADULT, 1]] });
  const event = h.action(RECEIVE_STEP_ID, NPC.CIVILIAN);
  assert.equal(event.handled, true, 'the receive step is handled');
  assert.equal(catsOf(h), 0, 'the cat is handed over');
  assert.equal(runesOf(h), 100, 'the talk-to sale pays 100 without the diary');
  assert.deepEqual(h.messages, [receiptFor(100)], 'the receipt is the tree text');
});

test('talk-to action: with the easy diary the same receive step pays 200', () => {
  const h = harness({ diaryDone: true, items: [[SALE_ADULT, 1]] });
  h.action(RECEIVE_STEP_ID, NPC.CIVILIAN);
  assert.equal(runesOf(h), 200, 'the talk-to sale pays 200 after the easy diary');
  assert.deepEqual(h.messages, [receiptFor(200)], 'the receipt is the tree text with 200');
});

test('control: refusals (kittens, the Witch\'s cat, a non-cat item, a non-civilian NPC) change nothing and do not sell', () => {
  assert.ok(KITTEN_ITEM_IDS.length >= 7, `kitten ids from the pet table: ${KITTEN_ITEM_IDS.length}`);
  for (const itemId of [...KITTEN_ITEM_IDS, ...WITCHS_CAT_IDS]) {
    const h = harness({ items: [[itemId, 1]] });
    assert.equal(h.useItem(itemId, NPC.CIVILIAN).handled, false, `item ${itemId} is not taken as a sale`);
    assert.equal(h.inventory.getAmount(itemId), 1, `item ${itemId} is kept`);
    assert.equal(runesOf(h), 0, `no runes for item ${itemId}`);
  }
  const coins = harness({ items: [[ITEM.COINS, 50]] });
  assert.equal(coins.useItem(ITEM.COINS, NPC.CIVILIAN).handled, false, 'coins are not a cat');
  const nonCivilian = harness({ items: [[SALE_ADULT, 1]] });
  assert.equal(nonCivilian.useItem(SALE_ADULT, 1).handled, false, 'a non-civilian NPC does not buy cats');
  assert.equal(catsOf(nonCivilian), 1, 'the cat is kept');
});

test('control: Talk-to refuses a kitten and the Witch\'s cat at every standard variant\'s "has a cat" step', () => {
  for (const variant of STANDARD_VARIANTS) {
    const ids = conditionIds(variant);
    for (const npcId of CIVILIAN_IDS) {
      const kitten = harness({ items: [[KITTEN_ITEM_IDS[0], 1]] });
      assert.equal(kitten.condition(ids.hasCat, npcId), false, `${variant}/${npcId}: a kitten does not offer the cat sale`);
    }
  }
});

test('control: a full bag with no death-rune stack refuses the sale; the cat is kept and no runes are granted', () => {
  const h = harness({ items: [[SALE_ADULT, 1]], full: true });
  const event = h.useItem(SALE_ADULT, NPC.CIVILIAN);
  assert.equal(event.handled, false, 'the sale is not taken on a full bag with no stack to add to');
  assert.equal(catsOf(h), 1, 'the cat is kept');
  assert.equal(runesOf(h), 0, 'no runes are granted');
});

test('full bag holding death runes: the runes stack onto the existing stack and the sale is valid', () => {
  // The 40-rune stack sits in slot 1, beside the cat; the rest of the bag is then filled.
  const h = harness({ items: [[SALE_ADULT, 1], [DEATH_RUNE, 40]], full: true });
  const event = h.useItem(SALE_ADULT, NPC.CIVILIAN);
  assert.equal(event.handled, true, 'a full bag still sells onto an existing death-rune stack');
  assert.equal(catsOf(h), 0, 'the cat is removed');
  assert.equal(runesOf(h), 140, '100 runes stack onto the existing 40');
});

test('control: with no cat held and no follower, the Gertrude replacement preconditions pass (kitten items absent)', () => {
  const h = harness({});
  const kittenHeld = KITTEN_ITEM_IDS.some((id) => h.inventory.getAmount(id) > 0);
  assert.equal(kittenHeld, false, 'no kitten item is held (Gertrude gates on this)');
  const current = { player: h.player, pet: undefined };
  h.handlers.custom.get('pets:current').forEach((fn) => fn(current));
  assert.equal(current.pet, undefined, 'no follower is recorded');
});
