// From server/ after `yarn build`: node --test tests/civilian-cat-sale.test.cjs
// RSPSApp/tsps#5295: West Ardougne civilians (3505-3507) buy adult, overgrown, wily, lazy and hell cats for
// 100 Death runes (200 once the Ardougne easy diary is complete), by "use the cat on a civilian" and by Talk-to.
// Kittens and the Witch's cat are refused.
//
// Sources, none hand-typed:
// - sellable cats: Pets' own pet table (__internals.PETS), filtered by enumName;
// - the transcript (data/definitions/npc-dialogues.json, read-only): the Talk-to condition ids per civilian
//   variant, the receipt message gRYTQp, the receive action s3pDQD, and the using-a-cat variant's text;
// - the inventory: the real Inventory class (ItemContainer pre-fills empty slots; occupancy is isSlotOccupied);
// - the diary: a stub on "diary:is-complete" (Progress.isTierComplete is not run).
//
// Runtime model (what NpcDialogues does, reproduced here): an item use starts the variant "using-a-cat-on-the-
// civilian" with "npc-dialogue:start" (exact). The variant then plays its message step (gRYTQp, the receipt; it
// reaches the plugin as "npc-dialogue:action" with kind "message" and is sent unless a plugin handled it), then
// its action step (s3pDQD, the receive), then its closing lines. The harness plays message-then-action in that
// order (runVariant). The closing lines are not checked.
//
// Seam NOT exercised (stated in the PR): the real NpcDialogues resolution for civilians 3505-3507 (the variant
// page lookup and the dialogue chain), and the Talk-to choice path that reaches the same steps. Those are the
// runtime's; here they are modelled from the same transcript.
// Handler layer otherwise: hooks are called with event objects of the shapes PluginTypes documents; packet and
// menu dispatch are not exercised.
// Controls (green on BEFORE): repeat-after-sale, the Talk-to guards, the refusals, the full-bag conservation
// check, and the no-cat replacement check. Reds on BEFORE: the sale positives, the Talk-to conditions, the
// receipt price, and the variant start.
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
const USING_VARIANT = 'using-a-cat-on-the-civilian';

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
const USING_STEPS = TREE[USING_VARIANT];
const RECEIVE_STEP_ID = USING_STEPS.find((step) => step.type === 'action' && step.action === 'receive')?.id;
const RECEIPT_STEP = USING_STEPS.find((step) => step.type === 'message' && /You hand over the cat/.test(String(step.text ?? '')));
const RECEIPT_STEP_ID = RECEIPT_STEP?.id;
const RECEIPT_RAW = String(RECEIPT_STEP?.text ?? '');
const receiptFor = (price) => RECEIPT_RAW.replace(/\[100\/200\]/g, String(price));

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
  const starts = [];
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
  // The runtime's variant start: a request with no select plays the variant (the stub records it as started);
  // a request with select captures the variant's steps (the treasure-trail pattern).
  handlers.custom.set('npc-dialogue:start', [(request) => {
    if (typeof request.select === 'function') { request.select(TREE[request.variant] ?? []); return; }
    if (request.exact && TREE[request.variant] && request.npcId != null) {
      request.handled = true;
      starts.push({ variant: request.variant, exact: request.exact, npcId: request.npcId });
    }
  }]);

  const plugin = loadPlugin();
  if (plugin) plugin.register(api);

  const messages = [];
  const dialogues = [];
  const attrs = new Map();
  const sender = new Proxy({}, { get: (_, name) => (name === 'then' ? undefined : () => sender) });
  const player = {
    getUsername: () => 'civilian-cat-test',
    getIndex: () => 4,
    isRegistered: () => true,
    isPlayer: () => true,
    getHitpoints: () => 10,
    getEquipment: () => ({ get: () => null, getItems: () => [] }),
    getDialogueManager: () => ({ isActive: () => false, reset() {}, startDialogues: (chain) => { dialogues.push(chain); } }),
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
    // ItemContainer pre-fills every slot with an empty Item(-1, 0): occupancy is isSlotOccupied, not a null check.
    for (let slot = 0; slot < inventory.capacity(); slot++) {
      if (!inventory.isSlotOccupied(slot)) inventory.setItem(slot, new Item(ITEM.BRONZE_DAGGER, 1));
    }
    assert.equal(inventory.isFull(), true, 'precondition: the bag is genuinely full');
    assert.equal(inventory.getFreeSlots(), 0, 'precondition: no free slots');
  }

  const npc = (id) => ({ getId: () => id, isRegistered: () => true, getLocation: () => new Location(2470, 3300, 0) });
  // An item use: the civilian's handler; the sale itself happens later, at the receive step (runVariant).
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
  // The runtime's order for the using variant: the receipt message (sent unless handled), then the receive action.
  // Returns the action event, so a test can read whether the sale happened.
  const runVariant = (targetId) => {
    const message = { player, npc: npc(targetId), npcId: targetId, stepId: RECEIPT_STEP_ID, kind: 'message',
      text: RECEIPT_RAW, handled: false };
    for (const fn of handlers.action) fn(message);
    // Unhandled, the runtime sends the step's own text (not event.text). The raw token is kept here on purpose:
    // on the base it reaches the player unreplaced, which is the defect the receipt test reds on.
    if (!message.handled) messages.push(RECEIPT_RAW);
    const action = { player, npc: npc(targetId), npcId: targetId, stepId: RECEIVE_STEP_ID, kind: 'action', handled: false };
    for (const fn of handlers.action) fn(action);
    return action;
  };
  return { player, inventory, messages, dialogues, starts, useItem, condition, runVariant, handlers };
}

const runesOf = (h) => h.inventory.getAmount(DEATH_RUNE);
const catsOf = (h, id = SALE_ADULT) => h.inventory.getAmount(id);
// Feedback arrives on exactly one channel: a chat message, or a dialogue; the receipt text must be the price's.
function assertReceipt(h, price) {
  const channels = h.messages.length + h.dialogues.length;
  assert.equal(channels, 1, 'the receipt arrives on exactly one channel (chat or dialogue)');
  assert.equal(h.messages[0], receiptFor(price), 'the receipt is the transcript text with the real price');
}
function assertNoReceipt(h) {
  assert.equal(h.messages.length + h.dialogues.length, 0, 'no feedback is given');
}

test('item route: the use starts the using variant exact for the civilian, and no sale happens before the receive step', () => {
  assert.ok(RECEIVE_STEP_ID && RECEIPT_STEP_ID, 'the transcript steps exist in the generated tree');
  const h = harness({ items: [[SALE_ADULT, 1]] });
  const event = h.useItem(SALE_ADULT, NPC.CIVILIAN);
  assert.equal(event.handled, true, 'the civilian takes the use');
  assert.deepEqual(h.starts, [{ variant: USING_VARIANT, exact: true, npcId: NPC.CIVILIAN }], 'the using variant starts for this civilian');
  assert.equal(catsOf(h), 1, 'no sale before the receive step: the cat is still held');
  assert.equal(runesOf(h), 0, 'no runes before the receive step');
});

test('item route: the receive step takes the cat and pays 100 Death runes, with the receipt once, at the real price', () => {
  const h = harness({ items: [[SALE_ADULT, 1]] });
  assert.equal(catsOf(h), 1, 'precondition: the adult cat is held');
  assert.equal(runesOf(h), 0, 'precondition: no runes are held');
  h.useItem(SALE_ADULT, NPC.CIVILIAN);
  const action = h.runVariant(NPC.CIVILIAN);
  assert.equal(action.handled, true, 'the receive step sells');
  assert.equal(catsOf(h), 0, 'the cat is removed permanently');
  assert.equal(runesOf(h), 100, '100 Death runes without the diary');
  assertReceipt(h, 100);
});

test('item route: with the Ardougne easy diary complete the same sale pays 200 Death runes and the receipt shows 200', () => {
  const h = harness({ diaryDone: true, items: [[SALE_ADULT, 1]] });
  h.useItem(SALE_ADULT, NPC.CIVILIAN);
  h.runVariant(NPC.CIVILIAN);
  assert.equal(catsOf(h), 0, 'the cat is removed');
  assert.equal(runesOf(h), 200, '200 Death runes after the easy diary');
  assertReceipt(h, 200);
});

test('message: the receipt is handled and sent once by the plugin, with the real price (100 and 200), and no raw token on any channel', () => {
  for (const [diaryDone, price] of [[false, 100], [true, 200]]) {
    const h = harness({ diaryDone, items: [[SALE_ADULT, 1]] });
    const message = { player: h.player, npc: { getId: () => NPC.CIVILIAN, isRegistered: () => true }, npcId: NPC.CIVILIAN,
      stepId: RECEIPT_STEP_ID, kind: 'message', text: RECEIPT_RAW, step: RECEIPT_STEP, handled: false };
    for (const fn of h.handlers.action) fn(message);
    assert.equal(message.handled, true, `price ${price}: the plugin takes the message over`);
    assert.equal(h.messages.length, 0, `price ${price}: the receipt is held until the runes are paid`);
    const action = { player: h.player, npc: { getId: () => NPC.CIVILIAN, isRegistered: () => true }, npcId: NPC.CIVILIAN,
      stepId: RECEIVE_STEP_ID, kind: 'action', handled: false };
    for (const fn of h.handlers.action) fn(action);
    assert.equal(action.handled, true, `price ${price}: the receive step sells`);
    assert.equal(h.messages.length, 1, `price ${price}: the receipt is sent exactly once`);
    assert.equal(h.messages[0], receiptFor(price), `price ${price}: the receipt carries the real price`);
    assert.equal(h.messages.some((text) => text.includes('[100/200]')), false, `price ${price}: no raw token is sent`);
  }
});

test('capped rune stack: the sale is refused, the cat is restored, and no receipt or hand-over line is sent', () => {
  // A Death rune stack at MAX_STACK_AMOUNT (0x7fffffff) cannot take 100 more: the runes do not fit.
  const h = harness({ items: [[SALE_ADULT, 1], [DEATH_RUNE, 0x7fffffff]] });
  assert.equal(runesOf(h), 0x7fffffff, 'precondition: the rune stack is at its cap');
  h.useItem(SALE_ADULT, NPC.CIVILIAN);
  const action = h.runVariant(NPC.CIVILIAN);
  assert.equal(action.handled, false, 'the receive step does not sell');
  assert.equal(catsOf(h), 1, 'the cat is restored');
  assert.equal(runesOf(h), 0x7fffffff, 'no runes are added');
  assertNoReceipt(h);
});

test('message: with no sellable cat the receipt is handled and nothing is sent', () => {
  const h = harness({});
  const message = { player: h.player, npc: { getId: () => NPC.CIVILIAN, isRegistered: () => true }, npcId: NPC.CIVILIAN,
    stepId: RECEIPT_STEP_ID, kind: 'message', text: RECEIPT_RAW, step: RECEIPT_STEP, handled: false };
  for (const fn of h.handlers.action) fn(message);
  assert.equal(message.handled, true, 'the receipt is handled (not sent by the runtime) when nothing can be sold');
  assert.equal(h.messages.length, 0, 'no receipt is sent when nothing can be sold');
});

test('pending cat: an item use that starts the variant and then loses the cat leaves no sale for a later Talk-to', () => {
  const h = harness({ items: [[SALE_ADULT, 1]] });
  h.useItem(SALE_ADULT, NPC.CIVILIAN);
  h.inventory.deleteNumber(SALE_ADULT, 1);
  h.runVariant(NPC.CIVILIAN);
  assert.equal(runesOf(h), 0, 'no runes are paid for a cat that is no longer held');
  assertNoReceipt(h);
});

test('item route: every sellable cat family (overgrown, wily, lazy, hell) sells at the receive step, one item id at a time', () => {
  assert.ok(SELLABLE_ITEM_IDS.length >= 28, `derived sellable set has ${SELLABLE_ITEM_IDS.length} ids`);
  for (const itemId of SELLABLE_ITEM_IDS) {
    const h = harness({ items: [[itemId, 1]] });
    assert.equal(h.useItem(itemId, NPC.CIVILIAN).handled, true, `item ${itemId} starts the using variant`);
    h.runVariant(NPC.CIVILIAN);
    assert.equal(catsOf(h, itemId), 0, `item ${itemId} is removed`);
    assert.equal(runesOf(h), 100, `item ${itemId} pays 100`);
  }
});

test('item route: each civilian NPC id (3505, 3506, 3507) starts the variant and sells', () => {
  for (const npcId of CIVILIAN_IDS) {
    const h = harness({ items: [[SALE_ADULT, 1]] });
    assert.equal(h.useItem(SALE_ADULT, npcId).handled, true, `civilian ${npcId} takes the use`);
    assert.equal(h.starts[0]?.npcId, npcId, `civilian ${npcId} starts its variant`);
    h.runVariant(npcId);
    assert.equal(runesOf(h), 100, `civilian ${npcId} pays 100`);
  }
});

test('item route: two cats in the bag sell one per receive step; the pay is not doubled', () => {
  // Two separate single-cat slots: the cats are non-stackable, so one slot holding two would be one stack.
  const h = harness({ items: [[SALE_ADULT, 1], [SALE_ADULT, 1]] });
  h.useItem(SALE_ADULT, NPC.CIVILIAN);
  h.runVariant(NPC.CIVILIAN);
  assert.equal(catsOf(h), 1, 'one cat is left after the first sale');
  assert.equal(runesOf(h), 100, 'one sale, 100 runes');
  h.useItem(SALE_ADULT, NPC.CIVILIAN);
  h.runVariant(NPC.CIVILIAN);
  assert.equal(catsOf(h), 0, 'no cat is left after the second sale');
  assert.equal(runesOf(h), 200, 'two sales, 200 runes in total');
});

test('repeat (control): repeating the use after the cat is gone changes nothing', () => {
  const h = harness({ items: [[SALE_ADULT, 1]] });
  h.useItem(SALE_ADULT, NPC.CIVILIAN);
  h.runVariant(NPC.CIVILIAN);
  const before = { cats: catsOf(h), runes: runesOf(h), channels: h.messages.length + h.dialogues.length };
  h.useItem(SALE_ADULT, NPC.CIVILIAN);
  h.runVariant(NPC.CIVILIAN);
  assert.equal(catsOf(h), before.cats, 'no cat is taken twice');
  assert.equal(runesOf(h), before.runes, 'no runes are paid twice');
  assert.equal(h.messages.length + h.dialogues.length, before.channels, 'no second receipt');
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

test('talk-to receive step: the receive step with the cat pays 100, takes the cat, and the receipt is sent once', () => {
  const h = harness({ items: [[SALE_ADULT, 1]] });
  // Talk-to: the receipt message comes first in the runtime's order, then the receive step.
  h.runVariant(NPC.CIVILIAN);
  assert.equal(catsOf(h), 0, 'the cat is handed over');
  assert.equal(runesOf(h), 100, 'the talk-to sale pays 100 without the diary');
  assertReceipt(h, 100);
});

test('talk-to receive step: with the easy diary the same sale pays 200 and shows 200', () => {
  const h = harness({ diaryDone: true, items: [[SALE_ADULT, 1]] });
  h.runVariant(NPC.CIVILIAN);
  assert.equal(runesOf(h), 200, 'the talk-to sale pays 200 after the easy diary');
  assertReceipt(h, 200);
});

test('talk-to guard: the receive step with no cat in the bag pays nothing and gives no receipt', () => {
  const h = harness({});
  assert.equal(catsOf(h), 0, 'precondition: no cat is held');
  h.runVariant(NPC.CIVILIAN);
  assert.equal(runesOf(h), 0, 'no runes are paid without a cat');
  assertNoReceipt(h);
});

test('talk-to guard: the receive step with only a kitten or the Witch\'s cat pays nothing', () => {
  for (const itemId of [KITTEN_ITEM_IDS[0], WITCHS_CAT_IDS[0]]) {
    const h = harness({ items: [[itemId, 1]] });
    h.runVariant(NPC.CIVILIAN);
    assert.equal(h.inventory.getAmount(itemId), 1, `item ${itemId} is kept`);
    assert.equal(runesOf(h), 0, `no runes for item ${itemId}`);
    assertNoReceipt(h);
  }
});

test('control: refusals (kittens, the Witch\'s cat, a non-cat item, a non-civilian NPC) change nothing and do not start the sale', () => {
  for (const itemId of [...KITTEN_ITEM_IDS, ...WITCHS_CAT_IDS]) {
    const h = harness({ items: [[itemId, 1]] });
    assert.equal(h.useItem(itemId, NPC.CIVILIAN).handled, false, `item ${itemId} is not taken as a sale`);
    assert.equal(h.starts.length, 0, `item ${itemId} starts no variant`);
    assert.equal(h.inventory.getAmount(itemId), 1, `item ${itemId} is kept`);
    assert.equal(runesOf(h), 0, `no runes for item ${itemId}`);
  }
  const coins = harness({ items: [[ITEM.COINS, 50]] });
  assert.equal(coins.useItem(ITEM.COINS, NPC.CIVILIAN).handled, false, 'coins are not a cat');
  const nonCivilian = harness({ items: [[SALE_ADULT, 1]] });
  assert.equal(nonCivilian.useItem(SALE_ADULT, 1).handled, false, 'a non-civilian NPC does not buy cats');
  assert.equal(catsOf(nonCivilian), 1, 'the cat is kept');
});

test('behaviour: Talk-to answers "has a cat" false for a kitten or the Witch\'s cat, at every standard variant (red on BEFORE: unanswered)', () => {
  for (const variant of STANDARD_VARIANTS) {
    const ids = conditionIds(variant);
    for (const npcId of CIVILIAN_IDS) {
      const kitten = harness({ items: [[KITTEN_ITEM_IDS[0], 1]] });
      assert.equal(kitten.condition(ids.hasCat, npcId), false, `${variant}/${npcId}: a kitten does not offer the cat sale`);
    }
  }
});

test('control (conservation): a full bag with a cat and no rune stack ends in one consistent state, never partial', () => {
  // The live rule for a full bag is not sourced here, so only conservation is asserted: either the sale is
  // taken (cat gone, exactly 100 runes, one receipt) or it is not (cat kept, no runes, no feedback). A partial
  // state (cat gone without runes, or runes without the cat) fails.
  const h = harness({ items: [[SALE_ADULT, 1]], full: true });
  assert.equal(catsOf(h), 1, 'precondition: the cat is held');
  assert.equal(runesOf(h), 0, 'precondition: no runes are held');
  h.useItem(SALE_ADULT, NPC.CIVILIAN);
  const action = h.runVariant(NPC.CIVILIAN);
  if (action.handled) {
    assert.equal(catsOf(h), 0, 'sold: the cat is gone');
    assert.equal(runesOf(h), 100, 'sold: exactly 100 runes');
    assert.equal(h.messages.length, 1, 'sold: one receipt');
  } else {
    assert.equal(catsOf(h), 1, 'refused: the cat is kept');
    assert.equal(runesOf(h), 0, 'refused: no runes');
  }
});

test('full bag holding death runes: the runes stack onto the existing stack and the sale is valid', () => {
  // The 40-rune stack sits in slot 1, beside the cat; the rest of the bag is then filled.
  const h = harness({ items: [[SALE_ADULT, 1], [DEATH_RUNE, 40]], full: true });
  assert.equal(h.inventory.isFull(), true, 'precondition: the bag is full');
  assert.equal(runesOf(h), 40, 'precondition: a 40-rune stack is held');
  h.useItem(SALE_ADULT, NPC.CIVILIAN);
  const action = h.runVariant(NPC.CIVILIAN);
  assert.equal(action.handled, true, 'a full bag still sells onto an existing death-rune stack');
  assert.equal(catsOf(h), 0, 'the cat is removed');
  assert.equal(runesOf(h), 140, '100 runes stack onto the existing 40');
  assertReceipt(h, 100);
});

test('control: with no cat held and no follower, the Gertrude replacement preconditions pass (kitten items absent)', () => {
  const h = harness({});
  const kittenHeld = KITTEN_ITEM_IDS.some((id) => h.inventory.getAmount(id) > 0);
  assert.equal(kittenHeld, false, 'no kitten item is held (Gertrude gates on this)');
  const current = { player: h.player, pet: undefined };
  h.handlers.custom.get('pets:current').forEach((fn) => fn(current));
  assert.ok(current.pet == null, 'no follower is recorded (null or undefined)');
});
