// Run after `yarn build`: node --test tests/items-kept-on-death.test.cjs
// Which items a player keeps on death, upgraded Nightmare staffs splitting into their staff and orb
// for a Wilderness killer, and the staffs' special attack graphics (docs/items-kept-on-death.md).
const assert = require('node:assert/strict');
const path = require('node:path');
const { test, before } = require('node:test');

const { Server } = require('../dist/Server');
Server.installProductionPathResolver();

const { CachePipeline } = require('../dist/game/cache/CachePipeline');
const { PlayerDeathTask } = require('../dist/game/task/impl/PlayerDeath');
const { Item } = require('../dist/game/model/Item');
const { Location } = require('../dist/game/model/Location');
const { PlayerRights } = require('../dist/game/model/rights/PlayerRights');
const { ItemIdentifiers: I } = require('../dist/util/ItemIdentifiers');

before(async () => {
  await CachePipeline.initialize(path.resolve(__dirname, '..'));
  require('../plugins/items/ItemDefinitionLoader.plugin').register({ log() {}, onPlayerLogin() {}, registerContentEndpoint() {} });
});

const WILDERNESS = new Location(3090, 3600, 0);
const EDGEVILLE = new Location(3090, 3490, 0);

function fakePlayer({ items, protectItem = false, skulled = false, location = EDGEVILLE }) {
  const prayers = new Array(40).fill(false);
  if (protectItem) prayers.fill(true);
  return {
    getInventory: () => ({ getItems: () => items }),
    getEquipment: () => ({ getItems: () => [] }),
    getSkullTimer: () => (skulled ? 100 : 0),
    getSkullType: () => 0,
    getSkillManager: () => ({ getMaxLevel: () => 99, getCurrentLevel: () => 99 }),
    getPrayerActive: () => prayers,
    getLocation: () => location,
    getRights: () => PlayerRights.NONE,
  };
}

const names = (items) => items.map((item) => item.getDefinition().getName());

test('Bounty Hunter bots use normal death drops, including Protect Item', (t) => {
  const { PluginManager } = require('../dist/plugins/PluginManager');
  const { ItemOnGroundManager } = require('../dist/game/entity/impl/grounditem/ItemOnGroundManager');
  const botLoot = require('../plugins/bots/runtime/DeathLoot.PlayerBots');
  const at = new Location(3446, 4005);
  const whip = new Item(I.ABYSSAL_WHIP, 1);
  const sword = new Item(I.RUNE_SCIMITAR, 1);
  const food = new Item(I.SHARK, 5);
  const container = (items) => ({
    getItems: () => items, getValidItems: () => items,
    resetItems() { items.length = 0; return this; }, refreshItems() { return this; },
  });
  const inventory = container([sword, food]);
  const equipment = container([whip]);
  const victim = {
    ...fakePlayer({ items: [], skulled: true, protectItem: true, location: at }),
    getInventory: () => inventory, getEquipment: () => equipment,
    getUsername: () => 'BhBot1', isPlayerBot: () => true,
  };
  const killer = { getLocation: () => at, sendMessage: (message) => assert.fail(message) };
  const ground = [];
  const emitItemDrop = PluginManager.emitPlayerDeathItemDrop;
  const register = ItemOnGroundManager.registerLocation;
  t.after(() => {
    PluginManager.emitPlayerDeathItemDrop = emitItemDrop;
    ItemOnGroundManager.registerLocation = register;
  });
  botLoot.initBotDeathLootCoreAccess({
    getWorld: () => ({}),
    getItemOnGroundManager: () => ({ registerNonGlobals: () => assert.fail('BH must use core drops') }),
  });
  PluginManager.emitPlayerDeathItemDrop = (event) => {
    botLoot.handleBotDeathItemDrop(event);
    return event.handled;
  };
  ItemOnGroundManager.registerLocation = (owner, item, position) => {
    assert.equal(owner, killer);
    assert.equal(position, at);
    ground.push(item);
  };
  const kept = PlayerDeathTask.dropItems(victim, killer, at);
  assert.deepEqual(kept, [whip]);
  assert.deepEqual(ground, [sword, food]);
  assert.equal(inventory.getItems().length + equipment.getItems().length, 0);
});

test('untradeable items compete for the kept slots by value (Wiki: Items Kept on Death)', () => {
  // Skulled with Protect Item: one item kept. The 4.6m staff beat the 125k ballista only once
  // untradeables were ranked; before, the ballista took the slot.
  const staff = new Item(I.VOLATILE_NIGHTMARE_STAFF, 1);
  const ballista = new Item(I.LIGHT_BALLISTA, 1);
  const player = fakePlayer({ items: [ballista, staff], protectItem: true, skulled: true });
  assert.deepEqual(names(PlayerDeathTask.getItemsToKeep(player)), ['Volatile Nightmare staff']);
  // Unskulled without Protect Item: three, both among them.
  assert.deepEqual(names(PlayerDeathTask.getItemsToKeep(fakePlayer({ items: [ballista, staff] }))).sort(),
    ['Light ballista', 'Volatile Nightmare staff']);
});

test('the kept items are the most valuable by Grand Exchange price, not store value (Wiki: Items Kept on Death)', () => {
  // Store values: rune platebody 65,000, platelegs 64,000, kiteshield 54,400; dragon boots 20,000,
  // berserker ring 10,000, ranger boots 200. The Grand Exchange prices run the other way.
  const items = [I.RUNE_PLATEBODY, I.RUNE_PLATELEGS, I.RUNE_KITESHIELD, I.DRAGON_BOOTS, I.BERSERKER_RING, I.RANGER_BOOTS]
    .map((id) => new Item(id, 1));
  assert.deepEqual(names(PlayerDeathTask.getItemsToKeep(fakePlayer({ items }))), ['Ranger boots', 'Berserker ring', 'Dragon boots']);
  assert.deepEqual(names(PlayerDeathTask.getItemsToKeep(fakePlayer({ items, skulled: true, protectItem: true }))), ['Ranger boots']);
});

test('an item with no Grand Exchange price is ranked by its high alchemy value (Wiki: Items Kept on Death)', () => {
  // Dragon defender: store value 68,007, so an alchemy value of 40,804, though it cannot be alchemised
  // (Wiki: Not alchemisable; item-alch.json gives it none). A dragon scimitar trades for more than the
  // alch value but less than the store value, so only the alch value lets the scimitar win.
  const defender = new Item(I.DRAGON_DEFENDER, 1);
  const scimitar = new Item(I.DRAGON_SCIMITAR, 1);
  assert.equal(defender.getDefinition().hasGrandExchangeValue(), false);
  assert.equal(defender.getDefinition().getHighAlchValue(), 0, 'it cannot be alchemised');
  assert.equal(PlayerDeathTask.keepValue(defender), 40804);
  const scimitarPrice = PlayerDeathTask.keepValue(scimitar);
  assert.ok(scimitarPrice > 40804 && scimitarPrice < defender.getDefinition().getValue(),
    `dragon scimitar price ${scimitarPrice} sits between the defender's alch and store values`);
  const player = fakePlayer({ items: [defender, scimitar], skulled: true, protectItem: true });
  assert.deepEqual(names(PlayerDeathTask.getItemsToKeep(player)), ['Dragon scimitar']);
});

test('the Items Kept on Death interface shows what a death keeps, and prices the risk at Grand Exchange value', () => {
  // rsprox recording 430: the kept list holds an untradeable max cape, and turning Protect Item on
  // moved a sanfew serum (store value 300) to the kept side, lowering the guide risk value by 18,569.
  const { PluginManager } = require('../dist/plugins/PluginManager');
  const handlers = new Map();
  require('../plugins/interface/ItemsKeptOnDeath.plugin').register({
    core: PluginManager.getCoreApi(),
    getPrayerHandler: () => ({ isActivated: () => false, PROTECT_ITEM: 0 }),
    emitCustomEvent() {},
    onInterfaceActionButton: (uid, handler) => handlers.set(uid, handler),
  });
  const items = [I.RUNE_PLATEBODY, I.RUNE_PLATELEGS, I.RUNE_KITESHIELD, I.MAX_CAPE, I.BERSERKER_RING, I.RANGER_BOOTS]
    .map((id) => new Item(id, 1));
  const sent = { scripts: [], strings: [] };
  const sender = {
    sendSubInterface() { return sender; },
    sendInterfaceScript(id, args) { sent.scripts.push({ id, args }); return sender; },
    sendInterfaceFlagsRange() { return sender; },
    sendString(text) { sent.strings.push(text); return sender; },
    sendInterfaceRemoval() { return sender; },
  };
  const player = {
    ...fakePlayer({ items }),
    busy: () => false,
    setInterfaceId() {},
    getInterfaceId: () => 4,
    getPacketSender: () => sender,
  };
  handlers.get((387 << 16) | 5)({ player });
  const [{ args }] = sent.scripts;
  assert.equal(args[5], 3);
  const kept = args.slice(6, 9).map((id) => new Item(id, 1).getDefinition().getName()).sort();
  assert.deepEqual(kept, ['Berserker ring', 'Max cape', 'Ranger boots']);
  const risk = [I.RUNE_PLATEBODY, I.RUNE_PLATELEGS, I.RUNE_KITESHIELD]
    .reduce((sum, id) => sum + new Item(id, 1).getDefinition().getGrandExchangeValue(), 0);
  assert.equal(sent.strings[0], `Guide risk value:<br><col=ffffff>${risk.toLocaleString()}</col>`);
});

test('the guide risk value counts every item not kept: untradeables, and coins at face value', () => {
  // rsprox recordings 1463 and 435: 305,509,624 coins add their face value to the risk, keeping an
  // untradeable Barrows gloves (fourth slot, Protect Item) lowers it, and the PvP and Wilderness
  // toggles leave it alone while the kept items stay the same.
  const { PluginManager } = require('../dist/plugins/PluginManager');
  const handlers = new Map();
  const custom = new Map();
  const api = {
    core: PluginManager.getCoreApi(),
    getPrayerHandler: () => ({ isActivated: player => player.getPrayerActive()[0], PROTECT_ITEM: 0 }),
    getPluginConfig: (_key, fallback) => fallback,
    onInterfaceActionButton: (uid, handler) => handlers.set(uid, handler),
    onPlayerDeathDrops() {},
    onCustomEvent: (name, handler) => custom.set(name, handler),
    emitCustomEvent: (name, query) => custom.get(name)?.(query),
  };
  custom.set('ironman:mode', query => { query.mode = null; });
  require('../plugins/world/gravestones/Death.Gravestones').attach(api);
  require('../plugins/interface/ItemsKeptOnDeath.plugin').register(api);
  const coins = new Item(I.COINS, 119_000_000);
  const gloves = new Item(I.BARROWS_GLOVES, 1);
  const whip = new Item(I.ABYSSAL_WHIP, 1);
  const boots = new Item(I.DRAGON_BOOTS, 1);
  const ring = new Item(I.BERSERKER_RING, 1);
  const items = [coins, gloves, whip, boots, ring];
  assert.equal(gloves.isTradeable(), false);
  let risk;
  const sender = {
    sendSubInterface() { return sender; },
    sendInterfaceScript() { return sender; },
    sendInterfaceFlagsRange() { return sender; },
    sendString(text) { risk = Number(/>([\d,]+)</.exec(text)[1].replace(/,/g, '')); return sender; },
  };
  const player = {
    ...fakePlayer({ items, skulled: true }),
    setInterfaceId() {}, getInterfaceId: () => 4, getPacketSender: () => sender,
  };
  const value = item => PlayerDeathTask.keepValue(item);
  const everything = 119_000_000 + value(gloves) + value(whip) + value(boots) + value(ring);
  handlers.get((387 << 16) | 5)({ player });
  assert.equal(risk, everything, 'skulled: nothing kept, coins at face value and the untradeable gloves count');

  const toggle = action => handlers.get((4 << 16) | 12)({ player, action });
  const ranked = [whip, boots, ring, gloves].sort((a, b) => value(b) - value(a));
  toggle(0); // Protect Item on: the most valuable item is kept
  assert.equal(risk, everything - value(ranked[0]));
  toggle(1); // skull off as well: four kept, only the coins are at risk
  assert.equal(risk, 119_000_000);
  toggle(0); // Protect Item off: three kept
  assert.equal(risk, 119_000_000 + value(ranked[3]));
  toggle(3); // Wilderness beyond level 20: the same items are kept, the same risk
  assert.equal(risk, 119_000_000 + value(ranked[3]));
});

// Wiki, Items Kept on Death (Interface), "Guide risk value": "Repair costs if the item becomes broken and must be
// repaired via Perdu". A PvP Wilderness death breaks them (docs/broken-items.md): above level 20 the killer gets the
// repair cost for an unlocked fire or infernal cape, 500,000 for a locked one that mangles. No recording shows a PvP
// preview with one of them.
test('the guide risk value counts Perdu repair costs for what a PvP Wilderness death breaks', () => {
  const { PluginManager } = require('../dist/plugins/PluginManager');
  const handlers = new Map();
  const custom = new Map();
  const api = {
    core: PluginManager.getCoreApi(),
    getPrayerHandler: () => ({ isActivated: player => player.getPrayerActive()[0], PROTECT_ITEM: 0 }),
    getPluginConfig: (_key, fallback) => fallback,
    onInterfaceActionButton: (uid, handler) => handlers.set(uid, handler),
    onPlayerDeathDrops() {},
    onPlayerDeathItemDrop() {},
    onCustomEvent: (name, handler) => custom.set(name, handler),
    emitCustomEvent: (name, query) => custom.get(name)?.(query),
  };
  custom.set('ironman:mode', query => { query.mode = null; });
  require('../plugins/world/gravestones/Death.Gravestones').attach(api);
  require('../plugins/items/brokenitems/Common.BrokenItems').init(api);
  require('../plugins/items/brokenitems/Death.BrokenItems')(api);
  require('../plugins/interface/ItemsKeptOnDeath.plugin').register(api);
  const C = api.core.CacheDefinitions;
  const fire = new Item(I.FIRE_CAPE, 1);
  const infernal = new Item(I.INFERNAL_CAPE, 1);
  const locked = new Item(C.getObjId('infernal_cape_l') ?? I.INFERNAL_CAPE_L_, 1);
  assert.ok(locked.getId() > 0 && locked.getDefinition().getName() === 'Infernal cape (l)', 'the locked infernal cape');
  let risk;
  const sender = {
    sendSubInterface() { return sender; },
    sendInterfaceScript() { return sender; },
    sendInterfaceFlagsRange() { return sender; },
    sendString(text) { risk = Number(/>([\d,]+)</.exec(text)[1].replace(/,/g, '')); return sender; },
  };
  const player = {
    ...fakePlayer({ items: [fire, infernal, locked], skulled: true }),
    setInterfaceId() {}, getInterfaceId: () => 4, getPacketSender: () => sender,
  };
  const value = item => PlayerDeathTask.keepValue(item);
  const toggle = action => handlers.get((4 << 16) | 12)({ player, action });
  handlers.get((387 << 16) | 5)({ player });
  assert.equal(risk, value(fire) + value(infernal) + value(locked), 'a PvM preview: nothing breaks');
  toggle(2); // killed by a player outside the Wilderness: nothing breaks, and the untradeables stay
  assert.equal(risk, 0);
  toggle(3); // and beyond level 20 Wilderness: each breaks, is lost or mangles
  assert.equal(risk, 150_000 + 225_000 + 500_000, 'fire cape repair, unlocked infernal repair, locked infernal mangled');
  toggle(2); // a monster in the Wilderness: nothing breaks
  assert.equal(risk, value(fire) + value(infernal) + value(locked));
});

test('the death preview does not protect unkept untradeables that a PvM grave takes', (t) => {
  const { PluginManager } = require('../dist/plugins/PluginManager');
  const handlers = new Map();
  const custom = new Map();
  let gravesEnabled = true;
  const api = {
    core: PluginManager.getCoreApi(),
    getPrayerHandler: () => ({ isActivated: player => player.getPrayerActive()[0], PROTECT_ITEM: 0 }),
    getPluginConfig: (key, fallback) => key === 'Gravestones:enabled' ? gravesEnabled : fallback,
    onInterfaceActionButton: (uid, handler) => handlers.set(uid, handler),
    onPlayerDeathDrops() {},
    onCustomEvent: (name, handler) => custom.set(name, handler),
    emitCustomEvent: (name, query) => custom.get(name)?.(query),
  };
  custom.set('ironman:mode', query => { query.mode = query.player.ironmanMode; });
  require('../plugins/world/gravestones/Death.Gravestones').attach(api);
  require('../plugins/interface/ItemsKeptOnDeath.plugin').register(api);
  const items = [I.RANGER_BOOTS, I.BERSERKER_RING, I.DRAGON_BOOTS, I.ABYSSAL_WHIP,
    I.RUNE_DEFENDER, I.ADAMANT_DEFENDER, I.MITHRIL_DEFENDER, I.STEEL_DEFENDER, I.IRON_DEFENDER, I.BRONZE_DEFENDER]
    .map(id => new Item(id, 1));
  assert.ok(items.slice(4).every(item => !item.isTradeable()), 'defenders are untradeable in the active cache');
  let sent;
  const sender = {
    sendSubInterface() { return sender; },
    sendInterfaceScript(id, args, _varps, _varbits, inventories) { sent = { id, args, inventories }; return sender; },
    sendInterfaceFlagsRange() { return sender; },
    sendString() { return sender; },
  };
  const untradeableStates = () => sent.inventories[584].slots
    .filter(slot => items.slice(4).some(item => item.getId() === slot.itemId))
    .map(slot => sent.inventories[468].slots[slot.slot].itemId);
  for (const [skulled, protectItem, count] of [[false, false, 3], [false, true, 4], [true, true, 1], [true, false, 0]]) {
    const player = {
      ...fakePlayer({ items, skulled, protectItem }),
      setInterfaceId() {}, getInterfaceId: () => 4, getPacketSender: () => sender,
    };
    handlers.get((387 << 16) | 5)({ player });
    assert.equal(sent.args[5], count);
    assert.deepEqual(sent.args.slice(6, 6 + count), PlayerDeathTask.getItemsToKeep(player).map(item => item.getId()));
    assert.ok(sent.inventories[468].slots.every(slot => slot.itemId === 367),
      'the six extra untradeables must not add protected icons to the selected kept slots');
    assert.equal(sent.inventories[584].slots.length, items.length - count);

    handlers.get((4 << 16) | 12)({ player, action: 2 });
    assert.deepEqual(untradeableStates(), new Array(6).fill(323), 'the existing PvP preview stays unchanged');
  }
  const player = {
    ...fakePlayer({ items }),
    setInterfaceId() {}, getInterfaceId: () => 4, getPacketSender: () => sender,
  };
  for (const exception of ['ultimate', 'bot', 'config-disabled', 'plugin-disabled']) {
    player.ironmanMode = exception === 'ultimate' ? 'ultimate' : null;
    player.isPlayerBot = () => exception === 'bot';
    gravesEnabled = exception !== 'config-disabled';
    if (exception === 'plugin-disabled') custom.delete('gravestones:makes-grave');
    handlers.get((387 << 16) | 5)({ player });
    assert.deepEqual(untradeableStates(), new Array(6).fill(323), `${exception}: without a grave, core returns these untradeables`);
  }

  require('../plugins/world/gravestones/Death.Gravestones').attach(api);
  const keep = PluginManager.emitShouldKeepItemOnDeath;
  t.after(() => { PluginManager.emitShouldKeepItemOnDeath = keep; });
  PluginManager.emitShouldKeepItemOnDeath = (owner, item) => item === items[4] ? true : keep(owner, item);
  handlers.get((387 << 16) | 5)({ player });
  assert.equal(sent.args[5], 4, 'an always-kept hook adds a legitimate protected item beyond the normal three');
  assert.ok(sent.args.slice(6).includes(items[4].getId()));
  assert.ok(!sent.inventories[584].slots.some(slot => slot.itemId === items[4].getId()), 'the always-kept item has no lost marker');
  assert.deepEqual(untradeableStates(), new Array(5).fill(367), 'the other unprotected defenders still go to the grave');
});

test('the Items Kept on Death markers: grave with its fee on PvM, lost on PvP or with no grave, deleted for the looting bag', (t) => {
  // Clientscript 974: 323 kept, 367 to the gravestone (the count less one is the item's fee),
  // 1991 lost to the killer or dropped, any other marker (368) deleted.
  const { PluginManager } = require('../dist/plugins/PluginManager');
  const handlers = new Map();
  const custom = new Map();
  let gravesEnabled = true;
  const api = {
    core: PluginManager.getCoreApi(),
    getPrayerHandler: () => ({ isActivated: () => false, PROTECT_ITEM: 0 }),
    getPluginConfig: (key, fallback) => key === 'Gravestones:enabled' ? gravesEnabled : fallback,
    onInterfaceActionButton: (uid, handler) => handlers.set(uid, handler),
    onPlayerDeathDrops() {},
    onCustomEvent: (name, handler) => custom.set(name, handler),
    emitCustomEvent: (name, query) => custom.get(name)?.(query),
  };
  custom.set('ironman:mode', query => { query.mode = null; });
  require('../plugins/world/gravestones/Death.Gravestones').attach(api);
  const Fees = require('../plugins/world/gravestones/Fees.Gravestones');
  custom.set('gravestones:fee', query => { query.fee = Fees.graveFee(query.items, false); });
  require('../plugins/interface/ItemsKeptOnDeath.plugin').register(api);
  const keep = PluginManager.emitShouldKeepItemOnDeath;
  t.after(() => { PluginManager.emitShouldKeepItemOnDeath = keep; });
  PluginManager.emitShouldKeepItemOnDeath = (owner, item) =>
    item.getDefinition().getName() === 'Looting bag' ? false : keep(owner, item);

  const NOTED_WHIP = 4152;
  const ids = [I.TWISTED_BOW, I.ARMADYL_GODSWORD, I.ABYSSAL_WHIP, I.DRAGON_SCIMITAR, I.RUNE_SCIMITAR, I.SHARK,
    I.LOOTING_BAG, I.COINS, NOTED_WHIP];
  const stacks = { [I.COINS]: 1000000, [NOTED_WHIP]: 10 };
  const items = ids.map(id => new Item(id, stacks[id] ?? 1));
  let sent;
  const sender = {
    sendSubInterface() { return sender; },
    sendInterfaceScript(id, args, _varps, _varbits, inventories) { sent = inventories; return sender; },
    sendInterfaceFlagsRange() { return sender; },
    sendString() { return sender; },
  };
  const player = {
    ...fakePlayer({ items, skulled: true }),
    setInterfaceId() {}, getInterfaceId: () => 4, getPacketSender: () => sender,
  };
  const markers = () => Object.fromEntries(sent[584].slots.map(slot =>
    [slot.itemId, [sent[468].slots[slot.slot].itemId, sent[468].slots[slot.slot].quantity]]));
  const fee = id => Fees.graveFee([{ id, amount: 1 }], false);

  handlers.get((387 << 16) | 5)({ player });
  const pvm = markers();
  assert.equal(Object.keys(pvm).length, items.length, 'skulled: every item is listed as unkept');
  for (const id of ids.filter(id => id !== I.LOOTING_BAG)) {
    assert.deepEqual(pvm[id], [367, 1 + fee(id)], `${new Item(id, 1).getDefinition().getName()} goes to the grave with its fee`);
  }
  assert.deepEqual(pvm[I.TWISTED_BOW], [367, 100001]);
  assert.deepEqual(pvm[I.SHARK], [367, 1]);
  assert.deepEqual(pvm[I.COINS], [367, 1], 'a stack of coins is priced by one coin');
  // The client counts each item in the stack: ten noted whips owe ten times one whip's fee.
  assert.deepEqual(pvm[NOTED_WHIP], [367, 1 + fee(NOTED_WHIP)], 'a stack is priced by one item');
  assert.ok(fee(NOTED_WHIP) > 0 && 10 * fee(NOTED_WHIP) === Fees.graveFee([{ id: NOTED_WHIP, amount: 10 }], false),
    'the fee the client shows for the stack is the grave fee for it');
  const counts = new Set(Object.values(pvm).map(([, count]) => count));
  assert.ok(counts.size > 2, `the fee bands differ: ${[...counts]}`);
  assert.deepEqual(pvm[I.LOOTING_BAG], [368, 1], 'the looting bag disappears completely');

  handlers.get((4 << 16) | 12)({ player, action: 2 });
  const pvp = markers();
  for (const id of ids.filter(id => id !== I.LOOTING_BAG)) assert.deepEqual(pvp[id], [1991, 1]);
  assert.deepEqual(pvp[I.LOOTING_BAG], [368, 1]);

  gravesEnabled = false;
  handlers.get((387 << 16) | 5)({ player });
  const dropped = markers();
  for (const id of ids.filter(id => id !== I.LOOTING_BAG)) assert.deepEqual(dropped[id], [1991, 1], 'no grave: dropped where you die');
});

test('the Bounty Hunter risk skull counts what a death drops, by Grand Exchange price', () => {
  // Store order (rune platebody 65,000 > platelegs 64,000 > sq shield 38,400 > ranger boots 200)
  // crosses the Grand Exchange order, where the ranger boots come first: an unskulled death keeps
  // the boots, body and legs and drops the sq shield, and the risk skull must price that shield.
  const { PluginManager } = require('../dist/plugins/PluginManager');
  const RiskSkulls = require('../plugins/minigames/bountyhunter/RiskSkulls.BountyHunter');
  RiskSkulls({ core: PluginManager.getCoreApi(), onPlayerLogout() {}, onServerStartup() {}, onCustomEvent() {} }, {});
  const items = [I.RUNE_PLATEBODY, I.RUNE_PLATELEGS, I.RUNE_SQ_SHIELD, I.RANGER_BOOTS].map((id) => new Item(id, 1));
  const player = fakePlayer({ items });
  const shield = items[2];
  assert.ok(shield.getDefinition().getValue() > items[3].getDefinition().getValue(), 'store value puts the shield above the boots');
  const kept = PlayerDeathTask.getItemsToKeep(player);
  assert.deepEqual(names(kept).sort(), ['Ranger boots', 'Rune platebody', 'Rune platelegs']);
  assert.equal(RiskSkulls._test.riskOf(player), PlayerDeathTask.keepValue(shield));
});

test('preset items are never protected', () => {
  const staff = new Item(I.VOLATILE_NIGHTMARE_STAFF, 1);
  staff.setMetaValue(Item.UNTRADEABLE_META, true);
  const ballista = new Item(I.LIGHT_BALLISTA, 1);
  const player = fakePlayer({ items: [staff, ballista], protectItem: true, skulled: true });
  assert.deepEqual(names(PlayerDeathTask.getItemsToKeep(player)), ['Light ballista']);
});

test('an unkept upgraded staff splits into its staff and orb for a Wilderness killer (Wiki)', () => {
  const killer = { isPlayer: () => true };
  const split = (victim, items, kept = [], by = killer) => names(PlayerDeathTask.splitIntoComponents(victim, by, kept, items));
  for (const [staffId, orb] of [[I.VOLATILE_NIGHTMARE_STAFF, 'Volatile orb'], [I.HARMONISED_NIGHTMARE_STAFF, 'Harmonised orb'], [I.ELDRITCH_NIGHTMARE_STAFF, 'Eldritch orb']]) {
    const staff = new Item(staffId, 1);
    const victim = fakePlayer({ items: [staff], location: WILDERNESS });
    assert.deepEqual(split(victim, [staff]), ['Nightmare staff', orb]);
    assert.deepEqual(split(victim, [staff], [staff]).length, 1, 'kept: stays whole');
  }
  const staff = new Item(I.VOLATILE_NIGHTMARE_STAFF, 1);
  assert.deepEqual(split(fakePlayer({ items: [staff], location: EDGEVILLE }), [staff]), ['Volatile Nightmare staff'], 'outside the Wilderness');
  assert.deepEqual(split(fakePlayer({ items: [staff], location: WILDERNESS }), [staff], [], null), ['Volatile Nightmare staff'], 'no player killer');
  const preset = new Item(I.VOLATILE_NIGHTMARE_STAFF, 1);
  preset.setMetaValue(Item.UNTRADEABLE_META, true);
  assert.deepEqual(split(fakePlayer({ items: [preset], location: WILDERNESS }), [preset]), ['Volatile Nightmare staff'],
    'a preset staff is deleted, never split into free components');
});

test('the Volatile and Eldritch specials show their cache graphics', () => {
  const { PluginManager } = require('../dist/plugins/PluginManager');
  const core = { ...PluginManager.getCoreApi(), CombatSpecial: { drain() {} } };
  for (const [file, cast, hit] of [['VolatileNightmareStaff', 1760, 1759], ['EldritchNightmareStaff', 1762, 1761]]) {
    let special = null;
    require(`../plugins/combat/specials/${file}.SpecialAttack`)({ core, registerCombatSpecial: (entry) => { special = entry; } });
    const shown = { animations: [], graphics: [], target: [] };
    const caster = {
      isPlayer: () => false,
      performAnimation: (animation) => shown.animations.push(animation.getId()),
      performGraphic: (graphic) => shown.graphics.push(graphic.getId()),
    };
    const target = { performGraphic: (graphic) => shown.target.push(graphic.getId()) };
    special.combatMethod.start(caster, target);
    special.combatMethod.handleAfterHitEffects({ isAccurate: () => true, getTarget: () => target, getAttacker: () => caster, getTotalDamage: () => 0 });
    special.combatMethod.handleAfterHitEffects({ isAccurate: () => false, getTarget: () => target, getAttacker: () => caster, getTotalDamage: () => 0 });
    assert.deepEqual(shown, { animations: [8532], graphics: [cast], target: [hit, 85] }, file);
  }
  // Ending the special must not play the reset animation over the cast.
  const resets = [];
  let volatile = null;
  require('../plugins/combat/specials/VolatileNightmareStaff.SpecialAttack')({ core, registerCombatSpecial: (entry) => { volatile = entry; } });
  volatile.combatMethod.finished({
    getCombat: () => ({ reset: (...args) => resets.push(args) }),
    setMobileInteraction() {},
    getMovementQueue: () => ({ reset() {} }),
  }, {});
  assert.deepEqual(resets, [[false]]);
});

test('kept items retain their per-item charges and infusion after death',()=>{
 const {PluginManager}=require('../dist/plugins/PluginManager'),{ItemOnGroundManager}=require('../dist/game/entity/impl/grounditem/ItemOnGroundManager');
 const sword=new Item(I.ARCLIGHT_INACTIVE_,1).setMetaValue('arclight',{charges:0,infusion:7200}),kept=[];
 let carried=[sword];const inventory={getItems:()=>carried,getValidItems:()=>carried,resetItems(){carried=[];return this;},refreshItems(){return this;},addItem:i=>{kept.push(i);return inventory;},adds:(id,n)=>{kept.push(new Item(id,n));return inventory;}};
 const equipment={getItems:()=>[],getValidItems:()=>[],resetItems(){return this;},refreshItems(){return this;}};
 const player={...fakePlayer({items:carried}),getInventory:()=>inventory,getEquipment:()=>equipment,getCombat:()=>({getRecentDamagerEntries:()=>[],getKiller:()=>null}),resetAttributes(){},isPlayerBot:()=>false,
  sendMessage(){},getPacketSender:()=>({sendJingle(){return this;}})};
 const originals=new Map(['emitShouldDropItemsOnDeath','emitPlayerDeathItemDrop','emitPlayerDefeated','emitPlayerDeath'].map(k=>[k,PluginManager[k]])),register=ItemOnGroundManager.registerLocation;
 try{
  PluginManager.emitShouldDropItemsOnDeath=()=>true;PluginManager.emitPlayerDeathItemDrop=()=>false;PluginManager.emitPlayerDefeated=()=>{};PluginManager.emitPlayerDeath=()=>true;ItemOnGroundManager.registerLocation=()=>null;
  const task=new PlayerDeathTask(player);task.ticks=0;task.execute();assert.equal(kept.length,1);assert.notEqual(kept[0],sword);assert.equal(kept[0].getId(),I.ARCLIGHT_INACTIVE_);assert.deepEqual(kept[0].getMetaValue('arclight'),{charges:0,infusion:7200});
  kept[0].setMetaValue('arclight',{charges:1000,infusion:7200});assert.deepEqual(sword.getMetaValue('arclight'),{charges:0,infusion:7200});
 }finally{for(const[k,v]of originals)PluginManager[k]=v;ItemOnGroundManager.registerLocation=register;}
});
test('ordinary preview matches completed death across skull and Protect Item states', async t => {
  const { PluginManager } = require('../dist/plugins/PluginManager');
  const { Player } = require('../dist/game/entity/impl/player/Player');
  const { PrayerHandler } = require('../dist/game/content/PrayerHandler');
  const { Skill } = require('../dist/game/model/Skill');
  const { SkullType } = require('../dist/game/model/SkullType');
  const { GameConstants } = require('../dist/game/GameConstants');
  const { NullPlayerPersistence } = require('../dist/game/entity/impl/player/persistence/NullPlayerPersistence');
  const { ItemOnGroundManager } = require('../dist/game/entity/impl/grounditem/ItemOnGroundManager');
  const { ItemDefinition } = require('../dist/game/definition/ItemDefinition');
  const core = PluginManager.getCoreApi();
  assert.ok(GameConstants.PLAYER_PERSISTENCE instanceof NullPlayerPersistence, 'fixture must not write saves');

  // Six fixed positive guide-price inputs, independent of market-data refreshes; never derive the oracle
  // from getItemsToKeep/keepValue or the death hook's supplied item list.
  const prices = new Map([[2577, 36201000], [6737, 2900000], [11840, 151958],
    [1127, 38713], [1079, 37744], [1201, 31942]]);
  const priceInputs = [...prices].map(([id, value]) => {
    const definition = ItemDefinition.forId(id);
    assert.notEqual(definition, ItemDefinition.DEFAULT, `real guide definition ${id}`);
    return { id, value, definition,
      descriptor: Object.getOwnPropertyDescriptor(definition, 'grandExchangeValue') };
  });
  assert.equal(new Set(priceInputs.map(input => input.definition)).size, prices.size, 'six distinct real definitions');
  // Register exact restoration before the first write, including setup/subtest failures.
  t.after(() => {
    for (const { definition, descriptor } of priceInputs) {
      if (descriptor === undefined) {
        assert.equal(Reflect.deleteProperty(definition, 'grandExchangeValue'), true);
      } else {
        Object.defineProperty(definition, 'grandExchangeValue', descriptor);
      }
    }
  });
  for (const { id, value, definition, descriptor } of priceInputs) {
    assert.ok(descriptor === undefined || ('value' in descriptor && descriptor.writable), `writable guide input ${id}`);
    Object.defineProperty(definition, 'grandExchangeValue', descriptor
      ? { ...descriptor, value }
      : { value, writable: true, enumerable: true, configurable: true });
  }
  assert.ok(ItemDefinition.forId(2577).getValue() < ItemDefinition.forId(1201).getValue(),
    'fixture distinguishes guide-price ordering from store values');
  const allIds = [...prices.keys()];
  const sourceOrder = [1201, 2577, 1127, 1079, 11840, 6737]; // inventory, then equipment slots 7/10/12
  const rows = [
    { name: 'unskulled, prayer off', skull: false, prayer: false, kept: [2577, 6737, 11840] },
    { name: 'unskulled, prayer on', skull: false, prayer: true, kept: [2577, 6737, 11840, 1127] },
    { name: 'white skull, prayer off', skull: true, prayer: false, kept: [] },
    { name: 'white skull, prayer on', skull: true, prayer: true, kept: [2577] },
  ];
  const clone = value => structuredClone(value);
  const pairs = items => items.map(item => [item.getId(), item.getAmount()]).sort((a, b) => a[0] - b[0]);
  const expectedPairs = ids => ids.map(id => [id, 1]).sort((a, b) => a[0] - b[0]);

  // These plugins have module-local API/state. Load private instances and put the original
  // cache entries back afterwards, rather than rebinding another test's singleton API.
  const graveRoot = path.resolve(__dirname, '../plugins/world/gravestones') + path.sep;
  const previewPath = require.resolve('../plugins/interface/ItemsKeptOnDeath.plugin');
  const fixtureModule = filename => filename.startsWith(graveRoot) || filename === previewPath;
  const previousModules = new Map(Object.entries(require.cache).filter(([filename]) => fixtureModule(filename)));
  for (const filename of previousModules.keys()) delete require.cache[filename];
  t.after(() => {
    for (const filename of Object.keys(require.cache)) if (fixtureModule(filename)) delete require.cache[filename];
    for (const [filename, entry] of previousModules) require.cache[filename] = entry;
  });
  const hooks = {}, buttons = new Map(), spawned = [], scheduled = [];
  const custom = new Map(), graveQueries = [];
  const api = {
    core,
    getPluginConfig: (_key, fallback) => fallback,
    onCustomEvent: (name, handler) => {
      const handlers = custom.get(name) ?? [];
      handlers.push(handler);
      custom.set(name, handlers);
    },
    emitCustomEvent: (name, payload) => {
      const handlers = custom.get(name) ?? [];
      if (name === 'gravestones:makes-grave') assert.equal(handlers.length, 1, 'real grave query registered once');
      for (const handler of handlers) handler(payload);
      if (name === 'gravestones:makes-grave') graveQueries.push({ ...payload });
    }, // other optional events have no tutorial, ironman, discount or persistence listeners here
    spawnNpc: definition => { const npc = { definition }; spawned.push(npc); return npc; },
    removeNpc: npc => { const index = spawned.indexOf(npc); if (index >= 0) spawned.splice(index, 1); },
    onPlayerDeathDrops: handler => { hooks.drops = handler; },
  };
  // Use the same real death/grave modules as Gravestones.register, without unrelated UI/login hooks.
  require('../plugins/world/gravestones/Death.Gravestones').attach(api);
  const Grave = require('../plugins/world/gravestones/Grave.Gravestones');
  require(previewPath).register({ ...api, getPrayerHandler: () => PrayerHandler,
    onInterfaceActionButton: (component, handler) => buttons.set(component, handler) });
  const submit = core.TaskManager.submit;
  core.TaskManager.submit = task => { scheduled.push(task); }; // no live scheduler; timer/message tasks are stopped below
  t.after(() => { for (const task of scheduled) task.stop(); core.TaskManager.submit = submit; });

  for (const row of rows) await t.test(row.name, () => {
    const player = new Player(null, EDGEVILLE.clone());
    player.setUsername(`death-oracle-${rows.indexOf(row)}`);
    player.setRights(PlayerRights.NONE);
    player.setSkullType(SkullType.WHITE_SKULL);
    player.setSkullTimer(row.skull ? 100 : 0);
    player.getSkillManager().setMaxLevels(Skill.PRAYER, 99, false).setCurrentLevel(Skill.PRAYER, 99, false);
    player.getPrayerActive().fill(false);
    player.setPrayerActive(PrayerHandler.PROTECT_ITEM, row.prayer);
    const sent = { scripts: [], strings: [] }, varbits = new Map();
    const sender = new Proxy({}, { get: (_target, key) => {
      if (key === 'getVarbit') return id => varbits.get(id) ?? 0;
      if (key === 'sendVarbit') return (id, value) => { varbits.set(id, value); return sender; };
      if (key === 'isSubInterfaceOpen') return () => false;
      if (key === 'sendInterfaceScript') return (...args) => { sent.scripts.push(clone(args)); return sender; };
      if (key === 'sendString') return (...args) => { sent.strings.push(args); return sender; };
      return () => sender;
    } });
    player.getPacketSender = () => sender;
    player.sendMessage = () => {};
    for (const [slot, id] of [[0, 1201], [1, 2577], [2, 1127]]) player.getInventory().setItem(slot, new Item(id, 1));
    for (const [slot, id] of [[7, 1079], [10, 11840], [12, 6737]]) player.getEquipment().setItem(slot, new Item(id, 1));
    for (const item of [...player.getInventory().getValidItems(), ...player.getEquipment().getValidItems()]) {
      assert.equal(item.isTradeable(), true, `ordinary tradeable ${item.getId()}`);
      assert.equal(item.isLostOnDeath(), false, `no preset/lost flag ${item.getId()}`);
      assert.equal(item.getMeta(), null, `no metadata ${item.getId()}`);
      assert.equal(item.getDefinition().hasGrandExchangeValue(), true);
      assert.equal(item.getDefinition().getGrandExchangeValue(), prices.get(item.getId()), `injected guide ${item.getId()}`);
      assert.equal(PluginManager.emitShouldKeepItemOnDeath(player, item) ?? null, null, 'no special keep hook');
    }
    assert.equal(PluginManager.emitShouldDropItemsOnDeath(player, null) ?? null, null, 'ordinary core loss policy');
    assert.deepEqual(pairs([...player.getInventory().getValidItems(), ...player.getEquipment().getValidItems()]), expectedPairs(allIds));
    const lost = sourceOrder.filter(id => !row.kept.includes(id));
    const paddedKept = [...row.kept];
    while (paddedKept.length < 4) paddedKept.push(-1);
    const queryStart = graveQueries.length;
    assert.equal(buttons.get((387 << 16) | 5)({ player }), true);
    assert.equal(graveQueries.length, queryStart + 1, 'preview dispatched one real grave query');
    const query = graveQueries.at(-1);
    assert.equal(query.player, player);
    assert.equal(query.playerKill, false);
    assert.equal(query.makesGrave, true, 'registered grave callback confirms ordinary PvM grave');
    // Snapshot every 972 argument, including both full inventory-state payloads.
    assert.deepEqual(sent.scripts, [[972, [Number(row.skull), Number(row.prayer), 0, 0, '', row.kept.length, ...paddedKept], undefined, undefined, {
      584: { capacity: 50, slots: lost.map((itemId, slot) => ({ slot, itemId, quantity: 1 })) },
      468: { capacity: 50, slots: lost.map((_id, slot) => ({ slot, itemId: 367, quantity: 1 })) },
    }]], `${row.name}: complete preview snapshot`);
    assert.deepEqual(sent.strings, [[`Guide risk value:<br><col=ffffff>${lost.reduce((sum, id) => sum + prices.get(id), 0).toLocaleString()}</col>`, (4 << 16) | 18]]);

    const floor = [], failures = [], completed = [];
    let dropHookCalls = 0;
    const originalDrops = PluginManager.emitPlayerDeathDrops, originalDeath = PluginManager.emitPlayerDeath;
    const originalGround = ItemOnGroundManager.registerLocation, originalError = console.error;
    try {
      PluginManager.emitPlayerDeathDrops = event => {
        assert.equal(event.player, player);
        assert.equal(event.killer, null);
        dropHookCalls++;
        hooks.drops(event); // the real core-generated loss list, not an oracle-built event
      };
      PluginManager.emitPlayerDeath = event => { completed.push(event); return true; }; // contain respawn/world movement only
      ItemOnGroundManager.registerLocation = (_owner, item) => { floor.push(item.clone()); return null; };
      console.error = (...args) => failures.push(args.map(String)); // execute catches exceptions; never silently accept them
      const task = new PlayerDeathTask(player);
      task.setRunning(true);
      for (let tick = 0; tick < 5; tick++) task.execute(); // real animation-to-respawn phases, no forced tick-zero shortcut
      assert.equal(task.isStopped(), true);
      assert.deepEqual(failures, [], `${row.name}: death exceptions`);
      assert.equal(dropHookCalls, 1, 'real core dispatched grave hook once');
      assert.equal(completed.length, 1, 'completed reset/return path reached death callback');
      assert.equal(completed[0].itemsLost, true);
      assert.deepEqual(pairs(player.getInventory().getValidItems()), expectedPairs(row.kept), 'actual carried keeps');
      assert.deepEqual(player.getEquipment().getValidItems(), [], 'equipment emptied by death');
      const held = player.getAttribute('gravestones:grave');
      assert.ok(held && Array.isArray(held.items), 'actual grave storage exists');
      assert.deepEqual(held.items.map(item => [item.id, item.amount]).sort((a, b) => a[0] - b[0]), expectedPairs(lost), 'actual grave complement');
      assert.deepEqual(pairs(floor), [[I.BONES, 1]], 'only one generated bone on floor');
      const observed = [...player.getInventory().getValidItems().map(item => [item.getId(), item.getAmount()]),
        ...held.items.map(item => [item.id, item.amount]), ...floor.filter(item => item.getId() !== I.BONES).map(item => [item.getId(), item.getAmount()])];
      assert.deepEqual(observed.sort((a, b) => a[0] - b[0]), expectedPairs(allIds), 'each original unit conserved exactly once');
    } finally {
      PluginManager.emitPlayerDeathDrops = originalDrops;
      PluginManager.emitPlayerDeath = originalDeath;
      ItemOnGroundManager.registerLocation = originalGround;
      console.error = originalError;
      GameConstants.PLAYER_PERSISTENCE.cancelRequestedSave(player);
      Grave.despawn(player);
      player.getInventory().resetItems();
      player.getEquipment().resetItems();
      player.setAttribute('gravestones:grave', null);
    }
  });
});
