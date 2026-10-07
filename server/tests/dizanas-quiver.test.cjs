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
    refreshItems() {},
  };
  const player = {
    worn, varps, messages, carried,
    getAttribute: (key) => attributes.get(key),
    setAttribute: (key, value) => attributes.set(key, value),
    getEquipment: () => equipment,
    getInventory: () => inventory,
    getBonusManager: () => bonuses,
    getPacketSender() {
      const sender = {
        sendConfig: (id, value) => { varps.set(id, value); return sender; },
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

before(async () => {
  await CachePipeline.initialize();
  require('../plugins/items/ItemDefinitionLoader.plugin').register({ log() {}, onPlayerLogin() {}, registerContentEndpoint() {} });
  const api = PluginManager.createApi('DizanasQuiver');
  const onPlayerLogin = api.onPlayerLogin;
  api.onPlayerLogin = (handler) => { loginHandlers.push(handler); return onPlayerLogin?.(handler); };
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
