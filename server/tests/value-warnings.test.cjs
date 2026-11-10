// Run after `yarn build`: node --test tests/value-warnings.test.cjs
// All Settings value warnings and loot notifications: what an item is worth, each threshold row's
// prompt, the drop, Alchemy, Grand Exchange and birdhouse warnings at, below and above their
// thresholds, the loot drop lines, the cannon ammo popups, and the rows' cache types and defaults.
const assert = require('node:assert/strict');
const { test, before } = require('node:test');
const { Server } = require('../dist/Server');
Server.installProductionPathResolver();

const { CachePipeline } = require('../dist/game/cache/CachePipeline');
const { CacheDefinitions } = require('../dist/game/cache/CacheDefinitions');
const { PluginManager } = require('../dist/plugins/PluginManager');
const { ItemDefinition } = require('../dist/game/definition/ItemDefinition');
const { Item } = require('../dist/game/model/Item');
const { DropItemPacketListener } = require('../dist/net/packet/impl/DropItemPacketListener');
const { MagicOnItemPacketListener } = require('../dist/net/packet/impl/MagicOnItemPacketListener');
const { MagicSpellbook } = require('../dist/game/model/MagicSpellbook');
const { ItemOnGroundManager } = require('../dist/game/entity/impl/grounditem/ItemOnGroundManager');
const { Wilderness } = require('../dist/game/content/wilderness/Wilderness');
const { Sounds } = require('../dist/game/Sounds');
const { World } = require('../dist/game/World');
const { TaskManager } = require('../dist/game/task/TaskManager');
const { ItemStatementDialogue } = require('../dist/game/model/dialogues/entries/impl/ItemStatementDialogue');
const { OptionDialogue } = require('../dist/game/model/dialogues/entries/impl/OptionDialogue');
const Value = require('../plugins/interface/ValueWarning');
const Warnings = require('../plugins/interface/ValueWarnings.plugin');
const GrandExchange = require('../plugins/interface/GrandExchange.plugin');
const Settings = require('../plugins/interface/Settings.plugin');
const settingsJson = require('../plugins/interface/data/settings.json').settings;

const RUNE_PLATELEGS = 1079;
const RUNE_PLATELEGS_NOTED = 1080;
const CANNONBALL = 2;
const COINS = 995;
const HIGH_ALCHEMY = 1178;
const LOW_ALCHEMY = 1162;
const NATURE_RUNE = 561;
const FIRE_RUNE = 554;

let core;
let restoreSettings;
const catalog = new Map();
/** An untradeable item the definitions know, found rather than assumed. */
let untradeableId;

before(async () => {
  await CachePipeline.initialize();
  core = PluginManager.getCoreApi();
  Warnings._test.setApi({ core, emitCustomEvent: () => {} });
  const api = { core, onPlayerLogin: (fn) => { if (fn.name === 'restoreSettings') restoreSettings = fn; }, emitCustomEvent: () => {} };
  Settings.register(new Proxy(api, { get: (t, p) => (p in t ? t[p] : () => {}) }));
  for (const [, structId] of CacheDefinitions.getEnumValues(422)) {
    const category = CacheDefinitions.getStructParams(Number(structId));
    for (const [, s] of CacheDefinitions.getEnumValues(Number(category.get(745)))) {
      const params = CacheDefinitions.getStructParams(Number(s));
      catalog.set(Number(params.get(1077)), Number(params.get(1078) ?? 0));
    }
  }
  for (const id of [1410, 6570, 7462, 8850, 10551, 12954]) {
    if (ItemDefinition.forId(id)?.isTradeable?.() === false) { untradeableId = id; break; }
  }
});

const price = (id) => ItemDefinition.forId(id).getGrandExchangeValue();

/** A player whose varbits and varps are `vars` ({ 5411: 1, ... }, varps as "p4850"), logging what it was shown. */
function player(vars = {}, items = []) {
  const log = { messages: [], dialogues: [], prompts: [], set: [], closed: 0, notifications: [] };
  const slots = [...items];
  const sender = {
    getVarbit: (id) => vars[id] ?? 0,
    getVarp: (id) => vars[`p${id}`] ?? 0,
    sendVarbit(id, value) { vars[id] = value; return sender; },
    sendConfig(id, value) { vars[`p${id}`] = value; return sender; },
    sendClientScript() { return sender; },
    sendEnterAmountPrompt: (text) => log.prompts.push(text),
    sendInterfaceRemoval() { return sender; },
    closeChatboxFor: () => { log.closed++; return true; },
    sendTab() { return sender; },
  };
  const attributes = new Map();
  let amountAction = null;
  const amounts = new Map([[NATURE_RUNE, 100], [FIRE_RUNE, 500]]);
  const inventory = {
    capacity: () => 28,
    getItems: () => slots,
    setItem(slot, item) { slots[slot] = item?.getId() === -1 ? null : item; return { refreshItems() {} }; },
    getAmount: (id) => amounts.get(id) || 0,
    contains: (id) => (amounts.get(id) || 0) > 0,
    getAddableAmount: (item) => item.getAmount(),
    deleteNumber(id, amount) { amounts.set(id, (amounts.get(id) || 0) - amount); },
    deleteAtSlot(slot) { slots[slot] = null; },
    adds: (id, amount) => amounts.set(id, (amounts.get(id) || 0) + amount),
  };
  return {
    log, vars, slots, amounts,
    getPacketSender: () => sender,
    getInventory: () => inventory,
    getAttribute: (k) => attributes.get(k),
    setAttribute: (k, v) => attributes.set(k, v),
    sendMessage: (m) => log.messages.push(m),
    setEnteredAmountAction: (action) => { amountAction = action; },
    enterAmount: (amount) => amountAction.execute(amount),
    getDialogueManager: () => ({ startDialogues: (chain) => log.dialogues.push([...chain.getDialogues().values()]) }),
    getHitpoints: () => 99,
    busy: () => false,
    getRights: () => null,
    getSkillManager: () => ({ stopSkillable() {}, getCurrentLevel: () => 99, addExperiences() {} }),
    getSpellbook: () => MagicSpellbook.NORMAL,
    getEquipment: () => ({ getWeapon: () => null }),
    isRegistered: () => true,
    performAnimation() {},
    performGraphic() {},
  };
}

// ------------------------------------------------------------------ worth

test('worth is the guide price of the unnoted item times the quantity; untradeables are worth nothing', () => {
  const each = price(RUNE_PLATELEGS);
  assert.ok(each > 0);
  assert.equal(Value.itemValue(core, RUNE_PLATELEGS), each);
  assert.equal(Value.itemValue(core, RUNE_PLATELEGS_NOTED, 3), 3 * each, 'a noted stack is worth its unnoted items');
  assert.equal(Value.itemValue(core, CANNONBALL, 1000), 1000 * price(CANNONBALL), 'a stack: quantity x price');
  assert.ok(untradeableId, 'an untradeable item to test with');
  assert.equal(Value.itemValue(core, untradeableId, 5), 0);
  assert.equal(Value.itemValue(core, -1), 0);
  assert.equal(Value.reaches(100, 100), true, 'worth exactly the threshold warns');
  assert.equal(Value.reaches(99, 100), false);
  assert.equal(Value.reaches(0, 0), false);
  assert.equal(Value.reaches(5000, 0), false, 'a threshold of 0 (a var never sent) never warns');
});

// ------------------------------------------------------------------ the number rows

test('each threshold row asks for its number and saves it, clamped to what the row holds', () => {
  const emitted = [];
  Warnings._test.setApi({ core, emitCustomEvent: (name, payload) => emitted.push([name, payload]) });
  try {
    for (const [settingId, { max }] of Object.entries(Warnings._test.PROMPTS)) {
      const p = player();
      const request = { player: p, settingId: Number(settingId), handled: false };
      Warnings._test.settingClicked(request);
      assert.equal(request.handled, true, `row ${settingId} is claimed`);
      assert.equal(p.log.prompts.length, 1);
      p.enterAmount(max + 1000);
      p.enterAmount('not a number');
      p.enterAmount(-5);
      p.enterAmount(12.9);
      const values = emitted.splice(0).map(([, e]) => e.value);
      assert.deepEqual(values, [max, 0, 0, 12], `row ${settingId}: capped, invalid input is 0, whole numbers`);
    }
  } finally {
    Warnings._test.setApi({ core, emitCustomEvent: () => {} });
  }
});

test('the prompt caps fit each row var', () => {
  for (const [settingId, { max }] of Object.entries(Warnings._test.PROMPTS)) {
    const row = settingsJson[settingId];
    if (row.varp !== undefined) { assert.ok(max <= 2147483647); continue; }
    const varbit = CacheDefinitions.getVarbit(row.varbit);
    const bits = varbit.endBit - varbit.startBit + 1;
    assert.ok(max <= 2 ** bits - 1, `row ${settingId}: ${max} fits ${bits} bits`);
  }
});

test('untradeable loot notifications cannot be changed while loot notifications are off', () => {
  const off = player({ 5399: 0 });
  const request = { player: off, settingId: 40, handled: false };
  Warnings._test.settingClicked(request);
  assert.equal(request.handled, true);
  assert.deepEqual(off.log.messages, ['You must have loot drop notifications turned on to change this setting.']);
  const on = { player: player({ 5399: 1 }), settingId: 40, handled: false };
  Warnings._test.settingClicked(on);
  assert.equal(on.handled, false, 'with them on, the row toggles as usual');
});

test('the new rows are the cache type their handler expects and start at the live values', () => {
  assert.equal(catalog.get(65), 0, '65 is a toggle');
  assert.equal(catalog.get(249), 4, '249 is a number');
  assert.equal(catalog.get(449), 4, '449 is a number');
  for (const id of [39, 43]) assert.equal(catalog.get(id), 4);
  const p = player();
  restoreSettings({ player: p });
  assert.equal(p.vars[6092], 1, 'untradeable alchemy warns by default');
  assert.equal(p.vars.p4850, 1000, 'birdhouse threshold');
  assert.equal(p.vars[14176] ?? 0, 0);
});

// ------------------------------------------------------------------ drop warning

function dropHarness(t) {
  const landed = [];
  const events = [];
  t.mock.method(PluginManager, 'emitItemDropPolicy', () => false);
  t.mock.method(PluginManager, 'emitCustomEvent', (name, payload) => {
    events.push(name);
    if (name === 'item:drop-warning') Warnings._test.dropWarning(payload);
  });
  t.mock.method(ItemOnGroundManager, 'registers', (_p, item) => landed.push([item.getId(), item.getAmount()]));
  t.mock.method(Wilderness, 'isIn', () => false);
  t.mock.method(Sounds, 'sendSound', () => {});
  return { landed, events };
}

test('dropping an item worth at least the threshold asks first, as live; below it drops at once', (t) => {
  const { landed } = dropHarness(t);
  const each = price(RUNE_PLATELEGS);
  for (const [threshold, warns] of [[each + 1, false], [each, true], [each - 1, true]]) {
    const p = player({ 5411: 1, 5412: threshold }, [new Item(RUNE_PLATELEGS, 1)]);
    landed.length = 0;
    DropItemPacketListener.drop(p, RUNE_PLATELEGS, 3214, 0);
    assert.equal(p.log.dialogues.length, warns ? 1 : 0, `threshold ${threshold}`);
    assert.deepEqual(landed, warns ? [] : [[RUNE_PLATELEGS, 1]]);
  }
});

test('the drop warning: the captured lines; "Put it down." drops it, the other answer keeps it', (t) => {
  const { landed } = dropHarness(t);
  const p = player({ 5411: 1, 5412: 1 }, [new Item(RUNE_PLATELEGS, 1)]);
  DropItemPacketListener.drop(p, RUNE_PLATELEGS, 3214, 0);
  const [statement, options] = p.log.dialogues[0];
  assert.ok(statement instanceof ItemStatementDialogue);
  assert.equal(statement.getItemId(), RUNE_PLATELEGS);
  assert.equal(statement.getText(), 'The item you are trying to put down is considered<br><col=7f0000>valuable</col>. Are you absolutely sure you want to do that?');
  assert.deepEqual(p.log.messages, ['The item you are trying to put down is considered <col=7f0000>valuable</col>. Are you absolutely sure you want to do that?']);
  assert.ok(options instanceof OptionDialogue);
  assert.equal(options.getTitle(), 'Rune platelegs: Really put it down?');
  assert.deepEqual(options.getOptions(), ['Put it down.', "No, don't put it down."]);
  options.execute(2);
  assert.deepEqual(landed, []);
  assert.ok(p.slots[0]);
  options.execute(1);
  assert.deepEqual(landed, [[RUNE_PLATELEGS, 1]]);
  assert.equal(p.slots[0], null);
  assert.equal(p.log.dialogues.length, 1, 'the confirmed drop does not ask again');
});

test('a stack is worth quantity x price; the warning off, or an untradeable item, drops without asking', (t) => {
  const { landed } = dropHarness(t);
  const stack = player({ 5411: 1, 5412: price(CANNONBALL) * 100 }, [new Item(CANNONBALL, 100)]);
  DropItemPacketListener.drop(stack, CANNONBALL, 3214, 0);
  assert.equal(stack.log.dialogues.length, 1, '100 cannonballs reach a 100-ball threshold');
  const small = player({ 5411: 1, 5412: price(CANNONBALL) * 100 }, [new Item(CANNONBALL, 99)]);
  DropItemPacketListener.drop(small, CANNONBALL, 3214, 0);
  assert.equal(small.log.dialogues.length, 0);
  const off = player({ 5411: 0, 5412: 1 }, [new Item(RUNE_PLATELEGS, 1)]);
  DropItemPacketListener.drop(off, RUNE_PLATELEGS, 3214, 0);
  assert.equal(off.log.dialogues.length, 0);
  assert.deepEqual(landed, [[CANNONBALL, 99], [RUNE_PLATELEGS, 1]]);
});

test('the item changing slot before the answer cancels the drop', (t) => {
  const { landed } = dropHarness(t);
  const p = player({ 5411: 1, 5412: 1 }, [new Item(RUNE_PLATELEGS, 1)]);
  DropItemPacketListener.drop(p, RUNE_PLATELEGS, 3214, 0);
  p.slots[0] = new Item(RUNE_PLATELEGS, 1);
  p.log.dialogues[0][1].execute(1);
  assert.deepEqual(landed, []);
});

// ------------------------------------------------------------------ alchemy

/** A real item, with the alch values the item plugins load at startup. */
function alchItem(id, amount = 1, tradeable = true) {
  const item = new Item(id, amount);
  const definition = item.getDefinition();
  item.getDefinition = () => Object.assign(Object.create(definition), {
    getHighAlchValue: () => 1000, getLowAlchValue: () => 600, isTradeable: () => tradeable });
  return item;
}

function alchemyHarness(t) {
  t.mock.method(World, 'getProcessCycle', () => 1000);
  t.mock.method(TaskManager, 'submit', () => {});
  t.mock.method(Sounds, 'sendSound', () => {});
  t.mock.method(PluginManager, 'emitCustomEvent', (name, payload) => {
    if (name === 'magic:alchemy-warning') Warnings._test.alchemyWarning(payload);
  });
  return new MagicOnItemPacketListener();
}

test('Alchemy on an item worth at least the threshold asks "considered valuable" first, as live', (t) => {
  const listener = alchemyHarness(t);
  const each = price(RUNE_PLATELEGS);
  for (const [threshold, warns] of [[each + 1, false], [each, true], [1, true]]) {
    const p = player({ 6091: threshold, 6092: 1 }, [alchItem(RUNE_PLATELEGS)]);
    listener.castOnItem(p, HIGH_ALCHEMY, RUNE_PLATELEGS, 0);
    assert.equal(p.log.dialogues.length, warns ? 1 : 0, `threshold ${threshold}`);
    assert.equal(p.amounts.get(COINS) > 0, !warns, 'cast at once only without the warning');
  }
  const p = player({ 6091: each, 6092: 1 }, [alchItem(RUNE_PLATELEGS)]);
  listener.castOnItem(p, LOW_ALCHEMY, RUNE_PLATELEGS, 0);
  const [statement, options] = p.log.dialogues[0];
  assert.equal(statement.getText(), 'That item is considered <col=7f0000>valuable</col>.<br>Really cast Low Level Alchemy on it?');
  assert.deepEqual(p.log.messages, ['That item is considered <col=7f0000>valuable</col>. Really cast Low Level Alchemy on it?']);
  assert.deepEqual(options.getOptions(), ['Proceed to cast Low Level Alchemy on it.', 'Cancel the alchemy spell.']);
  options.execute(1);
  assert.ok(p.amounts.get(COINS) > 0, 'cast once accepted');
});

test('a noted item is worth its unnoted guide price for the Alchemy warning', (t) => {
  const listener = alchemyHarness(t);
  const p = player({ 6091: price(RUNE_PLATELEGS), 6092: 1 }, [alchItem(RUNE_PLATELEGS_NOTED, 2)]);
  listener.castOnItem(p, HIGH_ALCHEMY, RUNE_PLATELEGS_NOTED, 0);
  assert.equal(p.log.dialogues.length, 1);
});

test('untradeable items always warn with row 65 on (the default) and cast without asking with it off', (t) => {
  const listener = alchemyHarness(t);
  const id = untradeableId;
  const on = player({ 6091: 20000, 6092: 1 }, [alchItem(id, 1, false)]);
  listener.castOnItem(on, HIGH_ALCHEMY, id, 0);
  assert.equal(on.log.dialogues.length, 1);
  assert.match(on.log.dialogues[0][0].getText(), /^That item cannot be traded\.<br>/);
  const off = player({ 6091: 20000, 6092: 0 }, [alchItem(id, 1, false)]);
  listener.castOnItem(off, HIGH_ALCHEMY, id, 0);
  assert.equal(off.log.dialogues.length, 0);
});

// ------------------------------------------------------------------ loot notifications

test('loot notifications: the captured lines, at and above the threshold only', () => {
  const each = price(RUNE_PLATELEGS);
  const line = Warnings._test.lootLine;
  assert.equal(line(core, { itemId: RUNE_PLATELEGS, amount: 1 }, each, true),
    `<col=ef1020>Valuable drop: Rune platelegs (${each.toLocaleString('en-GB')} coins)</col>`);
  assert.equal(line(core, { itemId: RUNE_PLATELEGS, amount: 1 }, each + 1, true), null);
  assert.equal(line(core, { id: CANNONBALL, amount: 1107 }, 1, true),
    `<col=ef1020>Valuable drop: 1,107 x ${ItemDefinition.forId(CANNONBALL).getName()} (${(1107 * price(CANNONBALL)).toLocaleString('en-GB')} coins)</col>`);
  const name = ItemDefinition.forId(untradeableId).getName();
  assert.equal(line(core, { itemId: untradeableId, amount: 1 }, 1, true), `<col=ef1020>Untradeable drop: ${name}</col>`);
  assert.equal(line(core, { itemId: untradeableId, amount: 1 }, 1, false), null, 'row 40 off');
});

test('loot notifications follow rows 38-40, for an NPC drop, once the roll has been edited', async () => {
  const each = price(RUNE_PLATELEGS);
  const roll = (vars) => {
    const p = player(vars);
    const request = { player: p, npc: {}, drops: [{ itemId: RUNE_PLATELEGS, amount: 1 }, { itemId: untradeableId, amount: 1 }] };
    Warnings._test.lootNotifications(request);
    request.drops.push({ itemId: RUNE_PLATELEGS, amount: 2 });
    return p;
  };
  const on = roll({ 5399: 1, 5400: each, 5402: 1 });
  const off = roll({ 5399: 0, 5400: each, 5402: 1 });
  const noUntradeables = roll({ 5399: 1, 5400: each * 2, 5402: 0 });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(on.log.messages.length, 3, 'both valuable stacks and the untradeable one, read after the edit');
  assert.deepEqual(off.log.messages, []);
  assert.equal(noUntradeables.log.messages.length, 1, 'only the 2 x stack reaches the doubled threshold');
  const noNpc = player({ 5399: 1, 5400: 1, 5402: 1 });
  Warnings._test.lootNotifications({ player: noNpc, drops: [{ itemId: RUNE_PLATELEGS, amount: 1 }] });
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(noNpc.log.messages, [], 'a reward that is not an NPC drop says nothing');
});

// ------------------------------------------------------------------ Grand Exchange

test('Grand Exchange: buy over 10x the guide and sell under 10% warn while their rows are on', () => {
  const { priceWarning, price: guide, sellPrice } = GrandExchange._test;
  const buy = { itemId: RUNE_PLATELEGS, sell: false };
  const sell = { itemId: RUNE_PLATELEGS, sell: true };
  const g = guide(RUNE_PLATELEGS);
  const s = sellPrice(RUNE_PLATELEGS);
  const on = player({ 14700: 0, 14701: 0 });
  assert.equal(priceWarning(on, buy, g * 10), null, 'exactly 10x is allowed');
  assert.equal(priceWarning(on, buy, g * 10 + 1), 'Your offer is more than 10 times the guide price.');
  assert.equal(priceWarning(on, sell, Math.ceil(s / 10)), null);
  assert.equal(priceWarning(on, sell, Math.ceil(s / 10) - 1), 'Your offer is less than 10% of the guide price.');
  const disabled = player({ 14700: 1, 14701: 1 });
  assert.equal(priceWarning(disabled, buy, g * 100), null, '14700 set disables the buy warning');
  assert.equal(priceWarning(disabled, sell, 1), null, '14701 set disables the sell warning');
});

test('Grand Exchange: an offer edited behind the warning is checked again when the warning is accepted', () => {
  const { confirm, setApi, setOffer, sellPrice } = GrandExchange._test;
  const placed = [];
  setApi({ core, emitCanBank: () => true,
    emitCustomEvent: (name, e) => { if (name === 'ge:offer-confirmed') { placed.push(e.quantity); e.accepted = false; } } });
  const p = player({ 14701: 0 }, [new Item(RUNE_PLATELEGS, 1)]);
  p.getInterfaceId = () => 465;
  const low = Math.ceil(sellPrice(RUNE_PLATELEGS) / 10) - 1;
  const offer = { itemId: RUNE_PLATELEGS, sell: true, quantity: 1, price: low, slot: 0 };
  setOffer(p, offer);

  confirm(p, offer);
  assert.equal(p.log.dialogues.length, 1, 'warned');
  offer.price = low - 1; // the -5% button, with the warning still up
  p.log.dialogues[0][1].execute(1);
  assert.equal(p.log.dialogues.length, 2, 'the lower price warns again');
  assert.deepEqual(placed, []);
  p.log.dialogues[1][1].execute(1);
  assert.deepEqual(placed, [1], 'accepted as warned, the offer goes ahead');

  confirm(p, offer);
  offer.price = sellPrice(RUNE_PLATELEGS); // edited back into bounds
  p.log.dialogues[2][1].execute(1);
  assert.equal(p.log.dialogues.length, 3, 'a fair price needs no warning');
  assert.deepEqual(placed, [1, 1]);
});

// ------------------------------------------------------------------ birdhouse seeds

test('birdhouse seeds worth at least row 449 ask first while row 448 is on', () => {
  const Context = require('../plugins/skills/hunter/Context.Hunter');
  Context.H.core = core;
  const Birdhouses = require('../plugins/skills/hunter/Birdhouses.Hunter');
  const ranarr = core.ItemIdentifiers.RANARR_SEED;
  const each = price(ranarr);
  assert.equal(Birdhouses.valuableSeeds(player({ 17869: 1, p4850: each * 5 }), ranarr, 5), true, '5 seeds at the threshold');
  assert.equal(Birdhouses.valuableSeeds(player({ 17869: 1, p4850: each * 5 + 1 }), ranarr, 5), false);
  assert.equal(Birdhouses.valuableSeeds(player({ 17869: 0, p4850: 1 }), ranarr, 5), false, 'row 448 off');
});

// ------------------------------------------------------------------ cannon

test('cannon ammo popups: at the low amount and when empty, each only with its row on', () => {
  const Cannon = require('../plugins/items/dwarfcannon/Common.DwarfCannon');
  const Firing = require('../plugins/items/dwarfcannon/Firing.DwarfCannon');
  const shown = [];
  Cannon.init({ core, emitCustomEvent: (name, payload) => { if (name === 'notification:show') shown.push(payload.text); } });
  Firing.ammoNotification(player({ 14175: 1, 14176: 10 }), 10);
  Firing.ammoNotification(player({ 14175: 1, 14176: 10 }), 9);
  Firing.ammoNotification(player({ 14175: 0, 14176: 10 }), 10);
  Firing.ammoNotification(player({ 14177: 1 }), 0);
  Firing.ammoNotification(player({ 14177: 0 }), 0);
  Firing.ammoNotification(player({ 14175: 1, 14176: 0, 14177: 0 }), 0);
  assert.deepEqual(shown, ['Your cannon is low on ammo.', 'Your cannon is out of ammo.']);
});
