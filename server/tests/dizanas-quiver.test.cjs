// Run after `yarn build`: node --test tests/dizanas-quiver.test.cjs
const assert = require('node:assert/strict');
const { test, before } = require('node:test');
const { Server } = require('../dist/Server');
Server.installProductionPathResolver();

const { CachePipeline } = require('../dist/game/cache/CachePipeline');
const { PluginManager } = require('../dist/plugins/PluginManager');
const { Ammunition } = require('../dist/game/content/combat/ranged/RangedData');
const { BonusManager } = require('../dist/game/model/equipment/BonusManager');
const { Misc } = require('../dist/util/Misc');
const Quiver = require('../plugins/items/DizanasQuiver.plugin');

const core = PluginManager.getCoreApi();
const { Equipment, Item, ItemIdentifiers: I } = core;
const SLOT = { group: 387, child: 28 };

function fakePlayer({ cape = I.DIZANAS_QUIVER, weapon = I.TWISTED_BOW, ammo = null } = {}) {
  const worn = Array.from({ length: 14 }, () => new Item(-1, 0));
  if (cape) worn[Equipment.CAPE_SLOT] = new Item(cape, 1);
  if (weapon) worn[Equipment.WEAPON_SLOT] = new Item(weapon, 1);
  if (ammo) worn[Equipment.AMMUNITION_SLOT] = new Item(ammo[0], ammo[1]);
  const attributes = new Map();
  const varps = new Map();
  const messages = [];
  const carried = new Map();
  const bonuses = new BonusManager();
  const equipment = {
    getItems: () => worn,
    get: (slot) => worn[slot],
    set: (slot, item) => { worn[slot] = item; },
    refreshItems() {},
  };
  const inventory = {
    contains: (id) => carried.has(id),
    getAmount: (id) => carried.get(id) ?? 0,
    getFreeSlots: () => 27,
    adds(id, amount) { carried.set(id, (carried.get(id) ?? 0) + amount); return inventory; },
    add(item) { carried.set(item.getId(), (carried.get(item.getId()) ?? 0) + item.getAmount()); return inventory; },
    deleteNumber(id, amount) {
      const left = (carried.get(id) ?? 0) - amount;
      if (left > 0) carried.set(id, left); else carried.delete(id);
    },
    getItems: () => [...carried].map(([id, amount]) => new Item(id, amount)),
    refreshItems() {},
  };
  const sentStrings = [];
  const sentItems = [];
  let interfaceId = -1;
  const location = { getX: () => 3000, getY: () => 3500 };
  const player = {
    worn, varps, messages, carried, sentStrings, sentItems,
    getInterfaceId: () => interfaceId,
    setInterfaceId: (id) => { interfaceId = id; },
    getLocation: () => location,
    getAttribute: (key) => attributes.get(key),
    setAttribute: (key, value) => attributes.set(key, value),
    getEquipment: () => equipment,
    getInventory: () => inventory,
    getBonusManager: () => bonuses,
    getPacketSender() {
      const sender = {
        sendConfig: (id, value) => { varps.set(id, value); return sender; },
        sendSubInterface: (target, group) => { interfaceId = group; return sender; },
        sendString: (text, uid) => { sentStrings.push([uid, text]); return sender; },
        sendItemOnInterfaces: (uid, itemId, amount) => { sentItems.push([uid, itemId, amount]); return sender; },
        sendItemOnInterface: (uid, itemId, slot, amount) => { sentItems.push([uid, itemId, amount]); return sender; },
      };
      return sender;
    },
    sendMessage: (message) => messages.push(message),
    isPlayer: () => true,
  };
  return player;
}

function click(player, op) {
  const event = { player, groupId: SLOT.group, childId: SLOT.child, opId: op, action: op, handled: false };
  Quiver.slotClicked(event);
  assert.equal(event.handled, true);
}

function rangedStrength(player) {
  BonusManager.update(player);
  return player.getBonusManager().getOtherBonus()[BonusManager.RANGED_STRENGTH];
}

let loginHandlers = [];
let shouldKeepHandlers = [];
let deathDropHandlers = [];

before(async () => {
  await CachePipeline.initialize();
  require('../plugins/items/ItemDefinitionLoader.plugin').register({ log() {}, onPlayerLogin() {}, registerContentEndpoint() {} });
  const api = PluginManager.createApi('DizanasQuiver');
  const onPlayerLogin = api.onPlayerLogin;
  api.onPlayerLogin = (handler) => { loginHandlers.push(handler); return onPlayerLogin?.(handler); };
  const onShouldKeepItemOnDeath = api.onShouldKeepItemOnDeath;
  api.onShouldKeepItemOnDeath = (handler) => { shouldKeepHandlers.push(handler); return onShouldKeepItemOnDeath?.(handler); };
  const onPlayerDeathItemDrop = api.onPlayerDeathItemDrop;
  api.onPlayerDeathItemDrop = (handler) => { deathDropHandlers.push(handler); return onPlayerDeathItemDrop?.(handler); };
  Quiver.register(api);
});

test('an empty quiver sends -1 for its item, not item 0 (the "Dwarf remains")', () => {
  const player = fakePlayer();
  for (const handler of loginHandlers) handler({ player });
  assert.equal(player.varps.get(Quiver.VARP.ITEM), -1);
  assert.equal(player.varps.get(Quiver.VARP.AMOUNT), 0);
});

test("the gameframe enables the quiver slot's ops, so a left-click reaches the server", () => {
  const { encodeGameframeFlags, encodeWidgetSetFlagsRange } = require('../dist/net/protocol/ClientProtocol');
  const expected = encodeWidgetSetFlagsRange((387 << 16) | 28, -1, -1, (1 << 1) | (1 << 2) | (1 << 10));
  for (const root of [161, 164, 548]) {
    assert.ok(encodeGameframeFlags(root).some((packet) => packet.equals(expected)), `root ${root}`);
  }
});

test('Fill moves the worn arrows into the quiver; with none worn, the Wiki message', () => {
  const player = fakePlayer({ ammo: [I.DRAGON_ARROW, 100] });
  click(player, 2);
  assert.deepEqual(Quiver.stored(player), { id: I.DRAGON_ARROW, amount: 100 });
  assert.equal(player.worn[Equipment.AMMUNITION_SLOT].getId(), -1);
  assert.equal(player.varps.get(Quiver.VARP.ITEM), I.DRAGON_ARROW);
  assert.equal(player.varps.get(Quiver.VARP.AMOUNT), 100);

  const empty = fakePlayer();
  click(empty, 2);
  assert.equal(empty.messages.at(-1), 'You have nothing in your worn quiver to fill your Dizana\'s Quiver with.');
});

test('only arrows and bolts go in, and only of the type already there', () => {
  const blessing = fakePlayer({ ammo: [I.HOLY_BLESSING, 1] });
  click(blessing, 2);
  assert.equal(Quiver.stored(blessing), null);
  const javelins = fakePlayer({ ammo: [I.DRAGON_JAVELIN, 50] });
  click(javelins, 2);
  assert.equal(Quiver.stored(javelins), null, 'no javelins (Wiki)');

  const mixed = fakePlayer({ ammo: [I.DRAGON_ARROW, 10] });
  click(mixed, 2);
  mixed.worn[Equipment.AMMUNITION_SLOT] = new Item(I.RUNE_ARROW, 10);
  // Filled now: op 2 is Swap. Fill only shows on an empty slot.
  click(mixed, 2);
  assert.deepEqual(Quiver.stored(mixed), { id: I.RUNE_ARROW, amount: 10 }, 'swapped');
  assert.equal(mixed.worn[Equipment.AMMUNITION_SLOT].getId(), I.DRAGON_ARROW);
});

test('Quiver-Remove puts the ammo in the inventory', () => {
  const player = fakePlayer({ ammo: [I.DRAGON_ARROW, 40] });
  click(player, 2);
  click(player, 1);
  assert.equal(player.carried.get(I.DRAGON_ARROW), 40);
  assert.equal(Quiver.stored(player), null);
  assert.equal(player.varps.get(Quiver.VARP.ITEM), -1);
});

test('the bow fires the quiver when the ammo slot holds something it can\'t fire', () => {
  const player = fakePlayer({ ammo: [I.DRAGON_ARROW, 100] });
  click(player, 2);
  player.worn[Equipment.AMMUNITION_SLOT] = new Item(I.HOLY_BLESSING, 1);
  assert.equal(Ammunition.getFor(player), Ammunition.getForItem(I.DRAGON_ARROW));

  // The arrows' ranged strength counts as if worn.
  const wornArrows = fakePlayer({ ammo: [I.DRAGON_ARROW, 100] });
  const blessingStrength = Number(core.ItemDefinition.forId(I.HOLY_BLESSING).getBonuses()?.[11] ?? 0);
  assert.equal(rangedStrength(player), rangedStrength(wornArrows) + blessingStrength - 0);
});

test('the ammo slot comes first when the weapon can fire it (Wiki)', () => {
  const player = fakePlayer({ ammo: [I.RUNE_ARROW, 100] });
  click(player, 2);
  player.worn[Equipment.AMMUNITION_SLOT] = new Item(I.DRAGON_ARROW, 50);
  assert.equal(Quiver.firedAmmunition(player), null);
  assert.equal(Ammunition.getFor(player), Ammunition.getForItem(I.DRAGON_ARROW));

  // A crossbow can't fire the quiver's arrows: its bolts in the ammo slot are fired.
  const crossbow = fakePlayer({ weapon: I.RUNE_CROSSBOW, ammo: [I.DRAGON_ARROW, 100] });
  click(crossbow, 2);
  crossbow.worn[Equipment.AMMUNITION_SLOT] = new Item(I.RUNITE_BOLTS, 50);
  assert.equal(Quiver.firedAmmunition(crossbow), null);
});

test('without a quiver worn, its ammo is not fired', () => {
  const player = fakePlayer({ ammo: [I.DRAGON_ARROW, 100] });
  click(player, 2);
  player.worn[Equipment.CAPE_SLOT] = new Item(-1, 0);
  assert.equal(Quiver.firedAmmunition(player), null);
  assert.equal(PluginManager.checkRangedAmmo(player, 1, true), null);
});

test('shots use up the quiver: 20% break, the rest drop, and it runs out', () => {
  const player = fakePlayer({ ammo: [I.DRAGON_ARROW, 3] });
  click(player, 2);
  assert.equal(PluginManager.checkRangedAmmo(player, 1, true), true);
  const getRandom = Misc.getRandom;
  const drops = [];
  const registerLocation = core.ItemOnGroundManager.registerLocation;
  core.ItemOnGroundManager.registerLocation = (who, item) => drops.push(item.getAmount());
  try {
    Misc.getRandom = () => 10; // breaks
    assert.equal(PluginManager.decrementRangedAmmo(player, null, 1), true);
    assert.deepEqual(Quiver.stored(player), { id: I.DRAGON_ARROW, amount: 2 });
    Misc.getRandom = () => 50; // drops
    PluginManager.decrementRangedAmmo(player, { getX: () => 0 }, 2);
    assert.deepEqual(drops, [2]);
    assert.equal(Quiver.stored(player), null);
    assert.equal(player.messages.at(-1), 'You have run out of ammunition!');
    assert.equal(player.varps.get(Quiver.VARP.ITEM), -1);
  } finally {
    Misc.getRandom = getRandom;
    core.ItemOnGroundManager.registerLocation = registerLocation;
  }
});

test("every quiver stage is a cape with the Wiki's +18 ranged attack and +3 ranged strength", () => {
  for (const id of [I.DIZANAS_QUIVER_UNCHARGED_, I.DIZANAS_QUIVER, I.BLESSED_DIZANAS_QUIVER]) {
    const definition = core.ItemDefinition.forId(id);
    assert.equal(definition.getEquipmentType().getSlot(), Equipment.CAPE_SLOT, `item ${id}`);
    assert.equal(definition.getBonuses()[4], 18, `ranged attack ${id}`);
    assert.equal(definition.getBonuses()[11], 3, `ranged strength ${id}`);
    assert.equal(definition.getRequirements()[4], 75, `ranged level ${id}`);
  }
});

function splinterEvent(player, amount) {
  player.carried.set(I.SUNFIRE_SPLINTERS, amount);
  const splinters = new Item(I.SUNFIRE_SPLINTERS, amount);
  const quiver = player.worn[Equipment.CAPE_SLOT];
  return {
    player, usedItem: splinters, usedWithItem: quiver,
    usedItemId: I.SUNFIRE_SPLINTERS, usedWithItemId: quiver.getId(), handled: false,
  };
}

test('sunfire splinters charge up to 20,000, and uncharging returns them', () => {
  const player = fakePlayer();
  const event = splinterEvent(player, 100);
  assert.equal(Quiver._test.chargeWithSplinters(event), true);
  assert.equal(player.worn[Equipment.CAPE_SLOT].getId(), I.DIZANAS_QUIVER);
  assert.equal(Quiver._test.itemCharges(player.worn[Equipment.CAPE_SLOT]), 100);
  assert.equal(player.carried.has(I.SUNFIRE_SPLINTERS), false);
  assert.match(player.messages.at(-1), /It now has 100 charges/);

  const capped = fakePlayer();
  Quiver._test.chargeWithSplinters(splinterEvent(capped, 30000));
  assert.equal(Quiver._test.itemCharges(capped.worn[Equipment.CAPE_SLOT]), 20000);
  assert.equal(capped.carried.get(I.SUNFIRE_SPLINTERS), 10000);

  assert.equal(Quiver._test.uncharge({ player: capped, item: capped.worn[Equipment.CAPE_SLOT] }), true);
  assert.equal(capped.worn[Equipment.CAPE_SLOT].getId(), I.DIZANAS_QUIVER_UNCHARGED_);
  assert.equal(Quiver._test.itemCharges(capped.worn[Equipment.CAPE_SLOT]), 0);
  assert.equal(capped.carried.get(I.SUNFIRE_SPLINTERS), 30000, 'the charge is reversible');
});

function sunfireBonuses(player) {
  const bonuses = new Array(14).fill(0);
  Quiver._test.quiverBonuses({ player, bonuses });
  return bonuses;
}

test("Dizana's Sunfire adds +10 ranged attack and +1 ranged strength to arrows and bolts", () => {
  const charged = fakePlayer({ ammo: [I.DRAGON_ARROW, 100] });
  charged.worn[Equipment.CAPE_SLOT].setMetaValue(Quiver.CHARGE_META, 5);
  assert.equal(sunfireBonuses(charged)[4], 10);
  assert.equal(sunfireBonuses(charged)[11], 1);

  const uncharged = fakePlayer({ ammo: [I.DRAGON_ARROW, 100] });
  assert.equal(sunfireBonuses(uncharged)[4], 0);

  const blessing = fakePlayer({ ammo: [I.HOLY_BLESSING, 1] });
  blessing.worn[Equipment.CAPE_SLOT].setMetaValue(Quiver.CHARGE_META, 5);
  assert.equal(sunfireBonuses(blessing)[4], 0, 'not a storable arrow/bolt');

  const quiverAmmo = fakePlayer({ ammo: [I.DRAGON_ARROW, 100] });
  click(quiverAmmo, 2);
  quiverAmmo.worn[Equipment.AMMUNITION_SLOT] = new Item(I.HOLY_BLESSING, 1);
  quiverAmmo.worn[Equipment.CAPE_SLOT].setMetaValue(Quiver.CHARGE_META, 5);
  assert.equal(sunfireBonuses(quiverAmmo)[4], 10);
});

test('one in three shots spends a charge, and exhausting it leaves the uncharged quiver', () => {
  const player = fakePlayer({ ammo: [I.DRAGON_ARROW, 100] });
  player.worn[Equipment.CAPE_SLOT].setMetaValue(Quiver.CHARGE_META, 2);
  const getRandom = Misc.getRandom;
  try {
    Misc.getRandom = () => 0;
    Quiver._test.spendCharge({ attacker: player, hit: { getCombatType: () => core.CombatType.RANGED } });
    assert.equal(Quiver._test.itemCharges(player.worn[Equipment.CAPE_SLOT]), 1);
    assert.equal(player.worn[Equipment.CAPE_SLOT].getId(), I.DIZANAS_QUIVER);
    Quiver._test.spendCharge({ attacker: player, hit: { getCombatType: () => core.CombatType.RANGED } });
    assert.equal(player.worn[Equipment.CAPE_SLOT].getId(), I.DIZANAS_QUIVER_UNCHARGED_);
    assert.equal(player.messages.at(-1), "Your Dizana's quiver has run out of charges.");
  } finally {
    Misc.getRandom = getRandom;
  }
});

test("an NPC attacker never spends the quiver charge", () => {
  const npc = { isPlayer: () => false };
  assert.doesNotThrow(() => Quiver._test.spendCharge({ attacker: npc, hit: { getCombatType: () => core.CombatType.RANGED } }));
});

test("Ava's device applies its recovery without being consumed", () => {
  const player = fakePlayer();
  const device = new Item(I.AVAS_ASSEMBLER, 1);
  player.carried.set(I.AVAS_ASSEMBLER, 1);
  const event = {
    player, usedItem: player.worn[Equipment.CAPE_SLOT], usedWithItem: device,
    usedItemId: player.worn[Equipment.CAPE_SLOT].getId(), usedWithItemId: I.AVAS_ASSEMBLER, handled: false,
  };
  assert.equal(Quiver._test.upgradeWithAva(event), true);
  assert.equal(player.getAttribute(Quiver.AVA_ATTRIBUTE), 80);
  assert.equal(player.carried.get(I.AVAS_ASSEMBLER), 1, 'the device is not consumed');
  assert.equal(Quiver._test.avaRecovery(player), 80);

  const noQuiver = fakePlayer({ cape: null });
  assert.equal(Quiver._test.avaRecovery(noQuiver), null);
});

test('Open shows the stored ammo without moving or duplicating it', () => {
  const player = fakePlayer({ ammo: [I.DRAGON_ARROW, 100] });
  click(player, 2);
  assert.equal(Quiver._test.openQuiver({ player }), true);
  assert.equal(player.getInterfaceId(), 30010);
  assert.ok(player.sentItems.some(([, itemId, amount]) => itemId === I.DRAGON_ARROW && amount === 100));
  assert.ok(player.sentStrings.some(([, text]) => /Dragon arrow x 100/.test(text)));
  assert.deepEqual(Quiver.stored(player), { id: I.DRAGON_ARROW, amount: 100 });
  assert.equal(player.carried.size, 0);
});

test('blessing costs the remaining 150,000 splinters and makes Sunfire permanent', () => {
  const player = fakePlayer();
  Quiver._test.chargeWithSplinters(splinterEvent(player, 1000));
  player.carried.set(I.SUNFIRE_SPLINTERS, 149000);
  const item = player.worn[Equipment.CAPE_SLOT];
  const event = { player, item, handled: false };
  assert.equal(Quiver._test.blessAtShrine(event), true);
  assert.equal(item.getId(), I.BLESSED_DIZANAS_QUIVER);
  assert.equal(player.carried.has(I.SUNFIRE_SPLINTERS), false);
  assert.match(player.messages.at(-1), /allowing it to not need charges/);
});

test('Wilderness death below 20 breaks the quiver, drops 270,000 coins and its ammo', () => {
  const player = fakePlayer({ ammo: [I.DRAGON_ARROW, 50] });
  click(player, 2);
  const item = player.worn[Equipment.CAPE_SLOT];
  const levelAt = core.Wilderness.levelAt;
  const registerLocation = core.ItemOnGroundManager.registerLocation;
  const drops = [];
  core.Wilderness.levelAt = () => 10;
  core.ItemOnGroundManager.registerLocation = (who, dropped) => drops.push(dropped);
  try {
    assert.equal(shouldKeepHandlers[0]({ player, item }), true);
    const event = { player, killer: { isPlayer: () => true }, item, location: { getX: () => 0, getY: () => 0 }, handled: false };
    deathDropHandlers[0](event);
    assert.equal(item.getId(), I.DIZANAS_QUIVER_BROKEN_);
    assert.equal(Quiver.stored(player), null);
    assert.ok(drops.some((drop) => drop.getId() === 995 && drop.getAmount() === 270000));
    assert.ok(drops.some((drop) => drop.getId() === I.DRAGON_ARROW && drop.getAmount() === 50));
  } finally {
    core.Wilderness.levelAt = levelAt;
    core.ItemOnGroundManager.registerLocation = registerLocation;
  }
});

test('Wilderness death above 20 destroys an unlocked quiver, but keeps a locked one and its ammo loss', () => {
  const levelAt = core.Wilderness.levelAt;
  const registerLocation = core.ItemOnGroundManager.registerLocation;
  const drops = [];
  core.Wilderness.levelAt = () => 30;
  core.ItemOnGroundManager.registerLocation = (who, dropped) => drops.push(dropped);
  try {
    const unlocked = fakePlayer({ ammo: [I.DRAGON_ARROW, 50] });
    click(unlocked, 2);
    const unlockedItem = unlocked.worn[Equipment.CAPE_SLOT];
    unlockedItem.setMetaValue(Quiver.CHARGE_META, 10);
    assert.equal(shouldKeepHandlers[0]({ player: unlocked, item: unlockedItem }), null);
    const destroyed = { player: unlocked, killer: { isPlayer: () => true }, item: unlockedItem, location: { getX: () => 0, getY: () => 0 }, handled: false };
    deathDropHandlers[0](destroyed);
    assert.equal(destroyed.handled, true);
    assert.equal(unlockedItem.getId(), -1);
    assert.ok(drops.some((drop) => drop.getId() === 995 && drop.getAmount() === 9600));
    assert.ok(drops.some((drop) => drop.getId() === I.DRAGON_ARROW));

    drops.length = 0;
    const locked = fakePlayer({ cape: I.DIZANAS_QUIVER_L_, ammo: [I.DRAGON_ARROW, 50] });
    click(locked, 2);
    const lockedItem = locked.worn[Equipment.CAPE_SLOT];
    lockedItem.setMetaValue(Quiver.CHARGE_META, 10);
    assert.equal(shouldKeepHandlers[0]({ player: locked, item: lockedItem }), true);
    const kept = { player: locked, killer: { isPlayer: () => true }, item: lockedItem, location: { getX: () => 0, getY: () => 0 }, handled: false };
    deathDropHandlers[0](kept);
    assert.equal(kept.handled, false);
    assert.equal(lockedItem.getId(), I.DIZANAS_QUIVER_L_UNCHARGED_);
    assert.equal(Quiver.stored(locked), null);
    assert.equal(drops.length, 0, 'locked quivers keep nothing to drop');
  } finally {
    core.Wilderness.levelAt = levelAt;
    core.ItemOnGroundManager.registerLocation = registerLocation;
  }
});
